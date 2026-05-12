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
CHUNK_SECONDS = 300  # 5 minutes per chunk


async def _download_youtube(url: str, out_path: str) -> str:
    """Download audio from YouTube URL using yt-dlp. Returns path to downloaded file."""
    import yt_dlp

    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": out_path,
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": "128",
        }],
        "quiet": True,
        "no_warnings": True,
        "nocheckcertificate": True,  # fix SSL cert issues on macOS
    }

    loop = asyncio.get_event_loop()

    def _download():
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            return info

    info = await loop.run_in_executor(None, _download)
    mp3_path = out_path + ".mp3"
    title = info.get("title", "YouTube видео") if info else "YouTube видео"
    return mp3_path, title


async def _run_ffmpeg(*args) -> bool:
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", *args,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        logger.error("ffmpeg error: %s", stderr.decode())
    return proc.returncode == 0


async def _get_duration(path: str) -> float:
    """Get audio duration in seconds using ffprobe."""
    proc = await asyncio.create_subprocess_exec(
        "ffprobe", "-v", "quiet", "-print_format", "json",
        "-show_format", path,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    stdout, _ = await proc.communicate()
    try:
        info = json.loads(stdout)
        return float(info["format"]["duration"])
    except Exception:
        return 0.0


async def _to_wav(src: str, dst: str) -> bool:
    return await _run_ffmpeg(
        "-y", "-i", src,
        "-vn", "-ar", "16000", "-ac", "1", "-f", "wav", dst
    )


async def _split_audio(wav_path: str, out_dir: str, chunk_sec: int) -> list[tuple[str, float]]:
    """
    Split WAV into chunks of chunk_sec seconds.
    Returns list of (chunk_path, start_offset_seconds).
    """
    duration = await _get_duration(wav_path)
    if duration == 0:
        return [(wav_path, 0.0)]

    if duration <= chunk_sec:
        return [(wav_path, 0.0)]

    chunks = []
    start = 0.0
    idx = 0
    while start < duration:
        chunk_path = os.path.join(out_dir, f"chunk_{idx:04d}.wav")
        ok = await _run_ffmpeg(
            "-y", "-i", wav_path,
            "-ss", str(start), "-t", str(chunk_sec),
            "-ar", "16000", "-ac", "1", chunk_path
        )
        if ok and os.path.exists(chunk_path):
            chunks.append((chunk_path, start))
        start += chunk_sec
        idx += 1

    return chunks if chunks else [(wav_path, 0.0)]


async def _transcribe_chunked(wav_path: str, meeting_id: str) -> list[dict]:
    """Transcribe audio file in chunks, return segments with timestamps."""
    out_dir = os.path.join(UPLOAD_DIR, f"{meeting_id}_chunks")
    os.makedirs(out_dir, exist_ok=True)

    try:
        chunks = await _split_audio(wav_path, out_dir, CHUNK_SECONDS)
        logger.info("Transcribing %d chunk(s) for meeting %s", len(chunks), meeting_id)

        all_segments = []
        for chunk_path, offset in chunks:
            with open(chunk_path, "rb") as f:
                audio_bytes = f.read()
            filename = os.path.basename(chunk_path)
            result = await transcribe_file(audio_bytes, filename)
            for seg in result.get("segments", []):
                all_segments.append({
                    "start": seg["start"] + offset,
                    "end": seg["end"] + offset,
                    "text": seg["text"],
                    "confidence": seg.get("confidence"),
                })
        return all_segments
    finally:
        # Clean up chunk files
        import shutil
        shutil.rmtree(out_dir, ignore_errors=True)


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

            # Convert to WAV if needed
            ext = os.path.splitext(audio_path)[1].lower()
            if ext != ".wav":
                wav_path = audio_path.rsplit(".", 1)[0] + ".wav"
                await _to_wav(audio_path, wav_path)
            else:
                wav_path = audio_path

            segments = await _transcribe_chunked(wav_path, meeting_id)

            if run_diarization and segments and os.path.exists(wav_path):
                diar_segments = await asyncio.get_event_loop().run_in_executor(
                    None, diarize, wav_path
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

            meeting.duration_seconds = segments[-1]["end"] if segments else 0
            meeting.finished_at = datetime.now(timezone.utc)
            meeting.audio_path = audio_path
            await db.commit()
        except Exception as e:
            logger.error("Upload processing failed: %s", e, exc_info=True)
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
    diarization: bool = Form(False),  # off by default — needs HF token
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
    max_bytes = 500 * 1024 * 1024  # 500 MB
    if len(content) > max_bytes:
        raise HTTPException(status_code=413, detail="Файл слишком большой (максимум 500 МБ)")

    raw_path = os.path.join(UPLOAD_DIR, f"{meeting.id}_raw{ext}")
    with open(raw_path, "wb") as f:
        f.write(content)

    background_tasks.add_task(_process_upload, meeting.id, raw_path, diarization)
    return {"meeting_id": meeting.id, "status": "processing"}


# ---------------------------------------------------------------------------
# WebSocket real-time transcription
# ---------------------------------------------------------------------------

@router.post("/api/transcribe/youtube")
async def youtube_transcribe(
    background_tasks: BackgroundTasks,
    url: str = Form(...),
    diarization: bool = Form(False),
    db: AsyncSession = Depends(get_db),
):
    if "youtube.com" not in url and "youtu.be" not in url:
        raise HTTPException(status_code=400, detail="Только ссылки YouTube")

    meeting = Meeting(title="Загрузка YouTube...")
    db.add(meeting)
    await db.commit()
    await db.refresh(meeting)

    async def _process():
        from database import AsyncSessionLocal
        mp3_path = None
        async with AsyncSessionLocal() as db2:
            result = await db2.execute(select(Meeting).where(Meeting.id == meeting.id))
            m = result.scalar_one_or_none()
            if not m:
                return
            try:
                m.status = MeetingStatus.processing
                await db2.commit()

                out_base = os.path.join(UPLOAD_DIR, f"{m.id}_yt")
                mp3_path, yt_title = await _download_youtube(url, out_base)

                m.title = yt_title
                await db2.commit()

            except Exception as e:
                logger.error("YouTube download failed: %s", e, exc_info=True)
                m.status = MeetingStatus.error
                m.title = f"Ошибка загрузки: {str(e)[:120]}"
                await db2.commit()
                return

        if mp3_path:
            await _process_upload(meeting.id, mp3_path, diarization)

    background_tasks.add_task(_process)
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
    # Collect all audio for fallback batch transcription
    audio_chunks: list[bytes] = []
    segment_count = 0

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
                            audio_chunks.append(chunk)
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
                        await freedom.finish()
                        break

            async def forward_results():
                nonlocal segment_count
                last_partial = ""
                had_final = False
                async for res in freedom.stream():
                    msg_type = res.get("type")
                    text = res.get("text", "").strip()
                    if msg_type == "partial" and text:
                        last_partial = text
                    try:
                        await websocket.send_json(res)
                    except Exception:
                        pass
                    if msg_type == "final" and text:
                        had_final = True
                        last_partial = ""
                        segment_count += 1
                        async with AsyncSessionLocal() as db:
                            db.add(TranscriptSegment(
                                meeting_id=meeting_id,
                                start_time=max(0.0, elapsed - 10),
                                end_time=elapsed,
                                text=text,
                                confidence=None,
                            ))
                            await db.commit()
                if not had_final and last_partial:
                    segment_count += 1
                    async with AsyncSessionLocal() as db:
                        db.add(TranscriptSegment(
                            meeting_id=meeting_id,
                            start_time=0.0,
                            end_time=elapsed,
                            text=last_partial,
                            confidence=None,
                        ))
                        await db.commit()

            await asyncio.gather(forward_audio(), forward_results())

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error("WS transcribe error: %s", e, exc_info=True)
        try:
            await websocket.send_json({"type": "error", "error": str(e)})
        except Exception:
            pass
    finally:
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Meeting).where(Meeting.id == meeting_id))
            m = result.scalar_one_or_none()
            if m:
                m.status = MeetingStatus.processing
                m.finished_at = datetime.now(timezone.utc)
                await db.commit()

        # Fallback: if realtime gave no results, transcribe recorded audio as a file
        if segment_count == 0 and audio_chunks:
            logger.info("Realtime gave no segments — falling back to batch transcription")
            webm_path = os.path.join(UPLOAD_DIR, f"{meeting_id}_ws.webm")
            try:
                with open(webm_path, "wb") as f:
                    for chunk in audio_chunks:
                        f.write(chunk)
                asyncio.create_task(_process_upload(meeting_id, webm_path, False))
                return  # _process_upload will call _run_analysis at the end
            except Exception as e:
                logger.error("Fallback transcription failed: %s", e)

        asyncio.create_task(_run_analysis(meeting_id))
