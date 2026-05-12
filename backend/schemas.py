from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List
from models import MeetingStatus


class TranscriptSegmentOut(BaseModel):
    id: int
    start_time: float
    end_time: float
    text: str
    speaker: Optional[str] = None
    confidence: Optional[float] = None

    class Config:
        from_attributes = True


class MeetingAnalysisOut(BaseModel):
    summary: Optional[str] = None
    action_items: Optional[str] = None
    key_topics: Optional[str] = None
    decisions: Optional[str] = None
    speaker_stats: Optional[str] = None

    class Config:
        from_attributes = True


class MeetingCreate(BaseModel):
    title: Optional[str] = "Без названия"


class MeetingOut(BaseModel):
    id: str
    title: str
    status: MeetingStatus
    created_at: datetime
    finished_at: Optional[datetime] = None
    duration_seconds: Optional[float] = None
    segments: List[TranscriptSegmentOut] = []
    analysis: Optional[MeetingAnalysisOut] = None

    class Config:
        from_attributes = True


class MeetingListItem(BaseModel):
    id: str
    title: str
    status: MeetingStatus
    created_at: datetime
    finished_at: Optional[datetime] = None
    duration_seconds: Optional[float] = None
    segment_count: int = 0

    class Config:
        from_attributes = True


class WSMessage(BaseModel):
    type: str
    text: Optional[str] = None
    start_time: Optional[float] = None
    end_time: Optional[float] = None
    speaker: Optional[str] = None
    error: Optional[str] = None
