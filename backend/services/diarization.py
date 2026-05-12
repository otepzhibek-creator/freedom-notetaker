"""
Speaker diarization using pyannote.audio.
Requires:
  1. HuggingFace token (HF_TOKEN env var)
  2. Accept model license at https://hf.co/pyannote/speaker-diarization-3.1
"""

import os
import logging
from typing import List, Dict, Optional

logger = logging.getLogger(__name__)

HF_TOKEN = os.getenv("HF_TOKEN", "")
_pipeline = None


def _load_pipeline():
    global _pipeline
    if _pipeline is not None:
        return _pipeline
    if not HF_TOKEN:
        logger.warning("HF_TOKEN not set — diarization disabled")
        return None
    try:
        from pyannote.audio import Pipeline
        import torch
        _pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1",
            use_auth_token=HF_TOKEN,
        )
        device = "cuda" if torch.cuda.is_available() else "cpu"
        _pipeline = _pipeline.to(torch.device(device))
        logger.info("pyannote pipeline loaded on %s", device)
    except Exception as e:
        logger.error("Failed to load pyannote pipeline: %s", e)
        _pipeline = None
    return _pipeline


def diarize(audio_path: str, num_speakers: Optional[int] = None) -> List[Dict]:
    """
    Run speaker diarization on an audio file.
    Returns list of: {"start": float, "end": float, "speaker": "SPEAKER_00"}
    """
    pipeline = _load_pipeline()
    if pipeline is None:
        return []

    try:
        kwargs = {}
        if num_speakers:
            kwargs["num_speakers"] = num_speakers

        diarization = pipeline(audio_path, **kwargs)
        segments = []
        for turn, _, speaker in diarization.itertracks(yield_label=True):
            segments.append({
                "start": round(turn.start, 3),
                "end": round(turn.end, 3),
                "speaker": speaker,
            })
        return segments
    except Exception as e:
        logger.error("Diarization failed: %s", e)
        return []


def assign_speakers(
    transcript_segments: List[Dict],
    diarization_segments: List[Dict],
) -> List[Dict]:
    """
    Merge STT segments with diarization by maximum overlap.
    """
    if not diarization_segments:
        return transcript_segments

    result = []
    for seg in transcript_segments:
        t_start, t_end = seg["start"], seg["end"]
        best_speaker = None
        best_overlap = 0.0

        for d in diarization_segments:
            overlap = min(t_end, d["end"]) - max(t_start, d["start"])
            if overlap > best_overlap:
                best_overlap = overlap
                best_speaker = d["speaker"]

        result.append({**seg, "speaker": best_speaker})
    return result
