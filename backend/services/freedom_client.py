"""
Freedom Speech API client.
Docs: https://freedomspeech.kz/docs#stt  and  #ws-asr

IMPORTANT: Review and adjust the endpoint URLs, auth headers, and
response parsing below once you have confirmed the actual API contract.
The assumptions here follow common speech-API patterns.
"""

import asyncio
import os
import logging
from typing import AsyncGenerator, Optional
import httpx
import websockets
import json

logger = logging.getLogger(__name__)

FREEDOM_API_KEY = os.getenv("FREEDOM_API_KEY", "")
FREEDOM_STT_URL = os.getenv("FREEDOM_STT_URL", "https://freedomspeech.kz/api/stt")
FREEDOM_WS_URL = os.getenv("FREEDOM_WS_URL", "wss://freedomspeech.kz/api/ws-asr")


def _auth_headers() -> dict:
    return {"Authorization": f"Bearer {FREEDOM_API_KEY}"}


async def transcribe_file(audio_bytes: bytes, filename: str, language: str = "ru") -> dict:
    """
    Send audio file to Freedom Speech STT.
    Returns: {"text": "...", "segments": [{"start": 0.0, "end": 1.5, "text": "...", "confidence": 0.9}]}
    """
    async with httpx.AsyncClient(timeout=300.0) as client:
        files = {"audio": (filename, audio_bytes, "audio/wav")}
        data = {"language": language}
        resp = await client.post(
            FREEDOM_STT_URL,
            headers=_auth_headers(),
            files=files,
            data=data,
        )
        resp.raise_for_status()
        result = resp.json()

    # Normalise response — adjust field names to match actual API
    segments = result.get("segments") or result.get("chunks") or []
    if not segments and result.get("text"):
        segments = [{"start": 0.0, "end": 0.0, "text": result["text"], "confidence": 1.0}]

    return {
        "text": result.get("text", ""),
        "segments": [
            {
                "start": s.get("start", s.get("start_time", 0.0)),
                "end": s.get("end", s.get("end_time", 0.0)),
                "text": s.get("text", ""),
                "confidence": s.get("confidence", s.get("score", None)),
            }
            for s in segments
        ],
    }


class FreedomWSClient:
    """
    Wraps the Freedom Speech WebSocket ASR endpoint for real-time streaming.
    """

    def __init__(self, sample_rate: int = 16000, language: str = "ru"):
        self.sample_rate = sample_rate
        self.language = language
        self._ws = None
        self._results: asyncio.Queue = asyncio.Queue()

    async def __aenter__(self):
        extra_headers = {"Authorization": f"Bearer {FREEDOM_API_KEY}"}
        self._ws = await websockets.connect(
            FREEDOM_WS_URL,
            additional_headers=extra_headers,
        )
        await self._ws.send(json.dumps({
            "token": FREEDOM_API_KEY,
            "sample_rate": self.sample_rate,
            "language": self.language,
        }))
        self._recv_task = asyncio.create_task(self._recv_loop())
        return self

    async def __aexit__(self, *_):
        if self._recv_task:
            self._recv_task.cancel()
        if self._ws:
            await self._ws.close()

    async def _recv_loop(self):
        try:
            async for raw in self._ws:
                try:
                    msg = json.loads(raw)
                    await self._results.put(msg)
                except Exception:
                    logger.warning("Unparseable message from Freedom WS: %s", raw)
        except websockets.ConnectionClosed:
            pass
        finally:
            await self._results.put(None)

    async def send_audio(self, pcm_bytes: bytes):
        if self._ws:
            await self._ws.send(pcm_bytes)

    async def finish(self):
        if self._ws:
            try:
                await self._ws.send(json.dumps({"eof": True}))
            except Exception:
                pass

    async def stream(self) -> AsyncGenerator[dict, None]:
        while True:
            item = await self._results.get()
            if item is None:
                break
            yield {
                "type": item.get("type", "final"),
                "text": item.get("text", item.get("transcript", "")),
                "start": item.get("start", item.get("start_time", 0.0)),
                "end": item.get("end", item.get("end_time", 0.0)),
                "confidence": item.get("confidence", None),
            }
