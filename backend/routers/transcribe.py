import os
import asyncio
import logging
import json
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, WebSocket, WebSocketDisconnect, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from database import get_db
from models import Meeting, TranscriptSegment, MeetingStatus
from services.freedom_client import transcribe_file, FreedomWSClient
from services.diarization import diarize, assign_speakers
from routers.meetings import _run_analysis

logger = logging.getLogger(__name__)

router = APIRouter(tags=["transcribe"])

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "/tmp/notetaker_uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

SUPPORTED_AUDIO = {".wav", ".mp3", ".ogg", ".flac", ".m4a", ".aac", ".webm"}
SUPPORTED_VIDEO = {".mp4", ".mkv", ".avi", ".mov"}


async def _extract_audio(video_path: str, out_path: str):
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-y", "-i", video_path,
        "-vn", "-ar", "16000", "-ac", "1", "-f", "wav", out_path,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )
    await proc.wait()


async def _process_upload(meeting_id: str, audio_path: str, run_diarization: bool):
    from database import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Meeting).where(Meeting.id == meeting_id))
        meeting = result.scalar_one_or_none()
        if not meeting:
            return

        try:
            meeting.status = MeetingStatus.processing
            await db.commit()

            with open(audio_path, "rb") as f:
                audio_bytes = f.read()

            filename = os.path.basename(audio_path)
            stt_result = await transcribe_file(audio_bytes, filename)
            segments = stt_result.get("segments", [])

            if run_diarization and segments:
                diar_segments = await asyncio.get_event_loop().run_in_executor(
                    None, diarize, audio_path
                )
                segments = assign_speakers(segments, diar_segments)

            for seg in segments:
                db.add(TranscriptSegment(
                    meeting_id=meeting_id,
                    start_time=seg.get("start", 0.0),
                    end_time=seg.get("end", 0.0),
                    text=seg.get("text", ""),
                    speaker=seg.get("speaker"),
                    confidence=seg.get("confidence"),
                ))

            if segments:
                meeting.duration_seconds = max(s.get("end", 0.0) for s in segments)

            meeting.finished_at = datetime.now(timezone.utc)
            meeting.audio_path = audio_path
            await db.commit()
        except Exception as e:
            logger.error("Upload processing failed: %s", e)
            meeting.status = MeetingStatus.error
            await db.commit()
            return

    await _run_analysis(meeting_id)


@router.post("/api/transcribe/upload")
async def upload_transcribe(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    meeting_id: Optional[str] = Form(None),
    title: str = Form("Без названия"),
    diarization: bool = Form(True),
    db: AsyncSession = Depends(get_db),
):
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in SUPPORTED_AUDIO | SUPPORTED_VIDEO:
        raise HTTPException(status_code=400, detail=f"Unsupported format: {ext}")

    if meeting_id:
        result = await db.execute(select(Meeting).where(Meeting.id == meeting_id))
        meeting = result.scalar_one_or_none()
        if not meeting:
            raise HTTPException(status_code=404, detail="Meeting not found")
    else:
        meeting = Meeting(title=title)
        db.add(meeting)
        await db.commit()
        await db.refresh(meeting)

    content = await file.read()
    raw_path = os.path.join(UPLOAD_DIR, f"{meeting.id}_raw{ext}")
    with open(raw_path, "wb") as f:
        f.write(content)

    if ext in SUPPORTED_VIDEO:
        audio_path = os.path.join(UPLOAD_DIR, f"{meeting.id}.wav")
        await _extract_audio(raw_path, audio_path)
    else:
        audio_path = raw_path

    background_tasks.add_task(_process_upload, meeting.id, audio_path, diarization)
    return {"meeting_id": meeting.id, "status": "processing"}


@router.websocket("/ws/transcribe/{meeting_id}")
async def ws_transcribe(websocket: WebSocket, meeting_id: str):
    from database import AsyncSessionLocal

    await websocket.accept()

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Meeting).where(Meeting.id == meeting_id))
        meeting = result.scalar_one_or_none()
        if not meeting:
            await websocket.send_json({"type": "error", "error": "Meeting not found"})
            await websocket.close()
            return
        meeting.status = MeetingStatus.recording
        await db.commit()

    elapsed = 0.0

    try:
        async with FreedomWSClient() as freedom:
            await freedom.wait_ready(timeout=15.0)
            await websocket.send_json({"type": "ready"})

            async def forward_audio():
                nonlocal elapsed
                while True:
                    try:
                        data = await websocket.receive()
                        if "bytes" in data:
                            chunk = data["bytes"]
                            await freedom.send_audio(chunk)
                            elapsed += 0.25
                        elif "text" in data:
                            msg = json.loads(data["text"])
                            if msg.get("type") == "stop":
                                await freedom.finish()
                                break
                    except WebSocketDisconnect:
                        await freedom.finish()
                        break
                    except Exception as e:
                        logger.warning("Audio forward error: %s", e)
                        break

            async def forward_results():
                async for result in freedom.stream():
                    msg_type = result.get("type")
                    text = result.get("text", "").strip()
                    await websocket.send_json(result)
                    if msg_type == "final" and text:
                        async with AsyncSessionLocal() as db:
                            db.add(TranscriptSegment(
                                meeting_id=meeting_id,
                                start_time=result.get("start", 0.0),
                                end_time=result.get("end", elapsed),
                                text=text,
                                confidence=None,
                            ))
                            await db.commit()

            await asyncio.gather(forward_audio(), forward_results())

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error("WS transcribe error: %s", e)
        try:
            await websocket.send_json({"type": "error", "error": str(e)})
        except Exception:
            pass
    finally:
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Meeting).where(Meeting.id == meeting_id))
            meeting = result.scalar_one_or_none()
            if meeting:
                meeting.status = MeetingStatus.processing
                meeting.finished_at = datetime.now(timezone.utc)
                await db.commit()
        asyncio.create_task(_run_analysis(meeting_id))
