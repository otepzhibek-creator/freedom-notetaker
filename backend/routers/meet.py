import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from database import get_db
from models import Meeting, MeetingStatus

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/meet", tags=["meet"])

# Active bot stop events keyed by meeting_id
_active_bots: dict[str, asyncio.Event] = {}


class StartMeetBody(BaseModel):
    url: str
    title: str = "Google Meet"
    bot_name: str = "Freedom Notetaker"


@router.post("/start")
async def start_meet_bot(body: StartMeetBody, db: AsyncSession = Depends(get_db)):
    if "meet.google.com" not in body.url:
        raise HTTPException(status_code=400, detail="Только ссылки Google Meet (meet.google.com/...)")

    meeting = Meeting(title=body.title or "Google Meet", status=MeetingStatus.processing)
    db.add(meeting)
    await db.commit()
    await db.refresh(meeting)

    stop_event = asyncio.Event()
    _active_bots[meeting.id] = stop_event

    async def _run():
        from services.meet_bot import run_meet_bot
        try:
            await run_meet_bot(body.url, meeting.id, stop_event, body.bot_name)
        finally:
            _active_bots.pop(meeting.id, None)

    asyncio.create_task(_run())
    return {"meeting_id": meeting.id, "status": "starting"}


@router.post("/{meeting_id}/stop")
async def stop_meet_bot(meeting_id: str):
    event = _active_bots.get(meeting_id)
    if not event:
        raise HTTPException(status_code=404, detail="Активная встреча не найдена")
    event.set()
    return {"ok": True}
