"""
Freedom Speech API client.
Docs: https://freedomspeech.kz/docs
"""

import asyncio
import os
import ssl
import logging
from typing import AsyncGenerator
import httpx
import websockets
import json

# macOS ships without bundled CA certs — disable verification globally
_SSL_CTX = ssl.create_default_context()
_SSL_CTX.check_hostname = False
_SSL_CTX.verify_mode = ssl.CERT_NONE

logger = logging.getLogger(__name__)

FREEDOM_API_KEY = os.getenv("FREEDOM_API_KEY", "")
FREEDOM_STT_URL = os.getenv("FREEDOM_STT_URL", "https://freedomspeech.kz/v1/audio/transcriptions")
FREEDOM_WS_URL = os.getenv("FREEDOM_WS_URL", "wss://freedomspeech.kz/ws/asr")


async def transcribe_file(audio_bytes: bytes, filename: str, prettify: bool = True) -> dict:
    """
    Send audio file to Freedom Speech STT.
    Returns: {"text": "...", "segments": [{"start": 0, "end": duration, "text": "..."}]}
    Note: API returns only full text + duration, no word-level timestamps.
    """
    async with httpx.AsyncClient(timeout=300.0, verify=False) as client:
        files = {"file": (filename, audio_bytes)}
        data = {"prettify": "true" if prettify else "false"}
        resp = await client.post(
            FREEDOM_STT_URL,
            headers={"X-API-Key": FREEDOM_API_KEY},
            files=files,
            data=data,
        )
        resp.raise_for_status()
        result = resp.json()

    text = result.get("text", "")
    duration = result.get("duration", 0.0)

    segments = []
    if text.strip():
        segments = [{"start": 0.0, "end": duration, "text": text, "confidence": None}]

    return {"text": text, "segments": segments}


class FreedomWSClient:
    """
    Freedom Speech WebSocket ASR client for real-time streaming.

    Protocol:
    1. Connect to wss://freedomspeech.kz/ws/asr?apiKey=KEY
    2. Wait for {"type": "ready"}
    3. Send binary audio chunks (WebM or PCM)
    4. Receive {"type": "partial", "text": "..."} incremental results
    5. Send {"type": "stop"} when done
    6. Receive {"type": "final", "text": "..."} final result
    """

    def __init__(self, prettify: bool = True):
        self.prettify = prettify
        self._ws = None
        self._results: asyncio.Queue = asyncio.Queue()
        self._recv_task = None
        self.ready = asyncio.Event()

    async def __aenter__(self):
        params = f"?apiKey={FREEDOM_API_KEY}"
        if self.prettify:
            params += "&prettify=true"

        self._ws = await websockets.connect(FREEDOM_WS_URL + params, ssl=_SSL_CTX)
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
                    if msg.get("type") == "ready":
                        self.ready.set()
                    else:
                        await self._results.put(msg)
                except Exception:
                    logger.warning("Unparseable WS message: %s", raw)
        except websockets.ConnectionClosed:
            pass
        finally:
            await self._results.put(None)

    async def wait_ready(self, timeout: float = 10.0):
        await asyncio.wait_for(self.ready.wait(), timeout=timeout)

    async def send_audio(self, audio_bytes: bytes):
        if self._ws:
            try:
                await self._ws.send(audio_bytes)
            except Exception:
                pass

    async def finish(self):
        if self._ws:
            try:
                await self._ws.send(json.dumps({"type": "stop"}))
            except Exception:
                pass

    async def stream(self) -> AsyncGenerator[dict, None]:
        """Yield partial and final transcription results."""
        while True:
            item = await self._results.get()
            if item is None:
                break
            msg_type = item.get("type", "")
            if msg_type in ("partial", "final"):
                yield {
                    "type": msg_type,
                    "text": item.get("text", ""),
                    "start": 0.0,
                    "end": 0.0,
                    "language": item.get("language"),
                }
