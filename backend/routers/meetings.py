from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from datetime import datetime, timezone

from database import get_db
from models import Meeting, MeetingAnalysis, TranscriptSegment, MeetingStatus
from schemas import MeetingCreate, MeetingOut, MeetingListItem
from services.analyzer import analyze_meeting

router = APIRouter(prefix="/api/meetings", tags=["meetings"])


def _with_relations():
    return select(Meeting).options(
        selectinload(Meeting.segments),
        selectinload(Meeting.analysis),
    )


@router.post("", response_model=MeetingOut)
async def create_meeting(body: MeetingCreate, db: AsyncSession = Depends(get_db)):
    meeting = Meeting(title=body.title)
    db.add(meeting)
    await db.commit()
    result = await db.execute(_with_relations().where(Meeting.id == meeting.id))
    return result.scalar_one()


@router.get("", response_model=list[MeetingListItem])
async def list_meetings(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Meeting).order_by(Meeting.created_at.desc()).limit(100)
    )
    meetings = result.scalars().all()

    items = []
    for m in meetings:
        count_res = await db.execute(
            select(func.count()).where(TranscriptSegment.meeting_id == m.id)
        )
        items.append(MeetingListItem(
            id=m.id,
            title=m.title,
            status=m.status,
            created_at=m.created_at,
            finished_at=m.finished_at,
            duration_seconds=m.duration_seconds,
            segment_count=count_res.scalar() or 0,
        ))
    return items


@router.get("/{meeting_id}", response_model=MeetingOut)
async def get_meeting(meeting_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(_with_relations().where(Meeting.id == meeting_id))
    meeting = result.scalar_one_or_none()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return meeting


@router.delete("/{meeting_id}")
async def delete_meeting(meeting_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Meeting).where(Meeting.id == meeting_id))
    meeting = result.scalar_one_or_none()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    await db.delete(meeting)
    await db.commit()
    return {"ok": True}


@router.patch("/{meeting_id}/title")
async def update_title(meeting_id: str, body: MeetingCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Meeting).where(Meeting.id == meeting_id))
    meeting = result.scalar_one_or_none()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    meeting.title = body.title
    await db.commit()
    return {"ok": True}


async def _run_analysis(meeting_id: str):
    from database import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Meeting).where(Meeting.id == meeting_id))
        meeting = result.scalar_one_or_none()
        if not meeting:
            return

        segs_result = await db.execute(
            select(TranscriptSegment)
            .where(TranscriptSegment.meeting_id == meeting_id)
            .order_by(TranscriptSegment.start_time)
        )
        segments = [
            {"start": s.start_time, "end": s.end_time, "text": s.text, "speaker": s.speaker}
            for s in segs_result.scalars().all()
        ]

        analysis_data = await analyze_meeting(segments, meeting.title)

        existing = await db.execute(
            select(MeetingAnalysis).where(MeetingAnalysis.meeting_id == meeting_id)
        )
        existing_analysis = existing.scalar_one_or_none()

        if existing_analysis:
            for k, v in analysis_data.items():
                setattr(existing_analysis, k, v)
        else:
            db.add(MeetingAnalysis(meeting_id=meeting_id, **analysis_data))

        meeting.status = MeetingStatus.done
        await db.commit()


@router.post("/{meeting_id}/analyze")
async def trigger_analysis(
    meeting_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Meeting).where(Meeting.id == meeting_id))
    meeting = result.scalar_one_or_none()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    meeting.status = MeetingStatus.processing
    await db.commit()
    background_tasks.add_task(_run_analysis, meeting_id)
    return {"ok": True, "message": "Analysis started"}
