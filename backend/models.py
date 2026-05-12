from sqlalchemy import Column, String, Text, Float, Integer, DateTime, ForeignKey, Enum
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
import enum
import uuid

from database import Base


class MeetingStatus(str, enum.Enum):
    recording = "recording"
    processing = "processing"
    done = "done"
    error = "error"


class Meeting(Base):
    __tablename__ = "meetings"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    title = Column(String, nullable=False, default="Без названия")
    status = Column(Enum(MeetingStatus), default=MeetingStatus.recording)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    finished_at = Column(DateTime, nullable=True)
    audio_path = Column(String, nullable=True)
    duration_seconds = Column(Float, nullable=True)
    speaker_names = Column(Text, nullable=True, default='{}')

    segments = relationship("TranscriptSegment", back_populates="meeting", cascade="all, delete-orphan", order_by="TranscriptSegment.start_time")
    analysis = relationship("MeetingAnalysis", back_populates="meeting", uselist=False, cascade="all, delete-orphan")


class TranscriptSegment(Base):
    __tablename__ = "transcript_segments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    meeting_id = Column(String, ForeignKey("meetings.id"), nullable=False)
    start_time = Column(Float, nullable=False)
    end_time = Column(Float, nullable=False)
    text = Column(Text, nullable=False)
    speaker = Column(String, nullable=True)
    confidence = Column(Float, nullable=True)

    meeting = relationship("Meeting", back_populates="segments")


class MeetingAnalysis(Base):
    __tablename__ = "meeting_analyses"

    id = Column(Integer, primary_key=True, autoincrement=True)
    meeting_id = Column(String, ForeignKey("meetings.id"), nullable=False, unique=True)
    summary = Column(Text, nullable=True)
    action_items = Column(Text, nullable=True)
    key_topics = Column(Text, nullable=True)
    decisions = Column(Text, nullable=True)
    speaker_stats = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    meeting = relationship("Meeting", back_populates="analysis")
