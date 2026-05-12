"""
Google Meet bot using Playwright.
Opens Chrome, joins meeting as guest, captures audio, transcribes via Freedom Speech.
"""

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

# JavaScript injected before page load to intercept WebRTC audio streams
AUDIO_INTERCEPT_SCRIPT = """
(function() {
    const _OrigRTC = window.RTCPeerConnection;
    if (!_OrigRTC || window.__meetBotPatched) return;
    window.__meetBotPatched = true;
    window.__meetBotRecorders = [];

    window.RTCPeerConnection = function(...args) {
        const pc = new _OrigRTC(...args);
        pc.addEventListener('track', (evt) => {
            if (evt.track.kind !== 'audio') return;
            const streams = evt.streams;
            if (!streams || streams.length === 0) return;

            const mr = new MediaRecorder(streams[0], { mimeType: 'audio/webm;codecs=opus' });
            mr.ondataavailable = async (e) => {
                if (e.data && e.data.size > 0) {
                    const buf = await e.data.arrayBuffer();
                    window.__onMeetAudio(Array.from(new Uint8Array(buf)));
                }
            };
            mr.start(250);
            window.__meetBotRecorders.push(mr);
        });
        return pc;
    };
    Object.assign(window.RTCPeerConnection, _OrigRTC);
})();
"""


async def _join_meet(page, bot_name: str) -> bool:
    """Handle Google Meet join flow. Returns True if joined."""
    # Fill in guest name if prompted
    for selector in [
        'input[aria-label*="name" i]',
        'input[placeholder*="name" i]',
        'input[data-initial-value]',
    ]:
        try:
            el = await page.wait_for_selector(selector, timeout=6000)
            await el.triple_click()
            await el.type(bot_name)
            logger.info("Filled bot name: %s", bot_name)
            break
        except Exception:
            continue

    # Click join / ask to join button
    joined = False
    for label in ["Ask to join", "Join now", "Попросить разрешения", "Присоединиться сейчас", "Присоединиться"]:
        try:
            btn = page.get_by_role("button", name=label, exact=False)
            await btn.click(timeout=4000)
            joined = True
            logger.info("Clicked join button: %s", label)
            break
        except Exception:
            continue

    if not joined:
        # Fallback: look for any button with join-related text
        try:
            await page.locator("button", has_text="join").first.click(timeout=4000)
            joined = True
        except Exception:
            pass

    # Wait until we're in the meeting (controls bar appears)
    try:
        await page.wait_for_selector(
            '[aria-label*="Leave call"], [data-tooltip*="Leave"], [aria-label*="microphone" i], [data-tooltip*="microphone" i]',
            timeout=45000,
        )
        logger.info("Joined Google Meet successfully")
        return True
    except Exception:
        logger.warning("Could not confirm joining Meet within timeout")
        return False


async def run_meet_bot(
    meet_url: str,
    meeting_id: str,
    stop_event: asyncio.Event,
    bot_name: str = "Freedom Notetaker",
):
    """
    Full bot lifecycle: join meet, capture audio, transcribe, save segments.
    Call stop_event.set() to stop the bot.
    """
    from database import AsyncSessionLocal
    from models import Meeting, TranscriptSegment, MeetingStatus
    from services.freedom_client import FreedomWSClient
    from sqlalchemy import select

    try:
        from playwright.async_api import async_playwright
    except ImportError:
        logger.error("playwright not installed. Run: pip install playwright && python -m playwright install chrome")
        async with AsyncSessionLocal() as db:
            r = await db.execute(select(Meeting).where(Meeting.id == meeting_id))
            m = r.scalar_one_or_none()
            if m:
                m.status = MeetingStatus.error
                m.title = "Ошибка: playwright не установлен"
                await db.commit()
        return

    audio_queue: asyncio.Queue[Optional[bytes]] = asyncio.Queue()
    elapsed = 0.0

    def _on_audio(arr):
        """Sync callback from Playwright — puts chunk into queue."""
        try:
            audio_queue.put_nowait(bytes(arr))
        except asyncio.QueueFull:
            pass

    async with async_playwright() as p:
        # Prefer system Chrome — less likely to be detected
        browser_type = p.chromium
        launch_kwargs = dict(
            headless=False,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--use-fake-ui-for-media-stream",  # auto-allow mic/cam
                "--no-first-run",
                "--disable-default-apps",
            ],
        )
        # Use system Chrome if available
        chrome_path = (
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
            if os.path.exists("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
            else None
        )
        if chrome_path:
            launch_kwargs["executable_path"] = chrome_path

        browser = await browser_type.launch(**launch_kwargs)
        context = await browser.new_context(
            permissions=["microphone", "camera"],
        )
        page = await context.new_page()

        # Inject audio capture before any page scripts run
        await page.add_init_script(AUDIO_INTERCEPT_SCRIPT)
        await page.expose_function("__onMeetAudio", _on_audio)

        try:
            logger.info("Navigating to Meet: %s", meet_url)
            await page.goto(meet_url, wait_until="domcontentloaded", timeout=30000)

            joined = await _join_meet(page, bot_name)

            async with AsyncSessionLocal() as db:
                r = await db.execute(select(Meeting).where(Meeting.id == meeting_id))
                m = r.scalar_one_or_none()
                if m:
                    m.status = MeetingStatus.recording if joined else MeetingStatus.error
                    if not joined:
                        m.title = "Ошибка: не удалось подключиться к Google Meet"
                    await db.commit()

            if not joined:
                return

            # Start Freedom Speech WS and stream audio
            async with FreedomWSClient() as freedom:
                await freedom.wait_ready(timeout=20.0)
                logger.info("Freedom Speech ready, streaming meet audio")

                async def _send_audio():
                    nonlocal elapsed
                    while not stop_event.is_set():
                        try:
                            chunk = await asyncio.wait_for(audio_queue.get(), timeout=1.0)
                            await freedom.send_audio(chunk)
                            elapsed += 0.25
                        except asyncio.TimeoutError:
                            continue
                    await freedom.finish()

                async def _recv_results():
                    async for res in freedom.stream():
                        msg_type = res.get("type")
                        text = (res.get("text") or "").strip()
                        if msg_type == "final" and text:
                            async with AsyncSessionLocal() as db:
                                db.add(TranscriptSegment(
                                    meeting_id=meeting_id,
                                    start_time=max(0.0, elapsed - 10),
                                    end_time=elapsed,
                                    text=text,
                                    confidence=None,
                                ))
                                await db.commit()
                            logger.info("[Meet] Final: %s", text[:60])

                await asyncio.gather(_send_audio(), _recv_results())

        except Exception as e:
            logger.error("Meet bot error: %s", e, exc_info=True)
            async with AsyncSessionLocal() as db:
                r = await db.execute(select(Meeting).where(Meeting.id == meeting_id))
                m = r.scalar_one_or_none()
                if m:
                    m.status = MeetingStatus.error
                    m.title = f"Ошибка Google Meet: {str(e)[:100]}"
                    await db.commit()
        finally:
            await browser.close()

    # Run analysis on collected segments
    from routers.meetings import _run_analysis
    await _run_analysis(meeting_id)
