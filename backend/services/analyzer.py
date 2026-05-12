"""
Meeting analysis using Claude API.
"""

import os
import re
import json
import logging
from typing import List, Dict, Optional

import anthropic

logger = logging.getLogger(__name__)

_client: Optional[anthropic.AsyncAnthropic] = None

EMPTY_ANALYSIS = {
    "summary": "",
    "key_topics": "[]",
    "action_items": "[]",
    "decisions": "[]",
    "speaker_stats": "{}",
}


def _get_client() -> anthropic.AsyncAnthropic:
    global _client
    if _client is None:
        key = os.getenv("ANTHROPIC_API_KEY", "")
        if not key:
            raise RuntimeError("ANTHROPIC_API_KEY is not set")
        _client = anthropic.AsyncAnthropic(api_key=key)
    return _client


def _format_transcript(segments: List[Dict]) -> str:
    lines = []
    for seg in segments:
        speaker = seg.get("speaker") or "Спикер"
        t = f"[{seg['start']:.1f}s] {speaker}: {seg['text']}"
        lines.append(t)
    return "\n".join(lines)


def _extract_json(raw: str) -> str:
    """Strip markdown code fences and return clean JSON string."""
    raw = raw.strip()
    # Remove ```json ... ``` or ``` ... ``` blocks
    match = re.search(r"```(?:json)?\s*\n?(.*?)```", raw, re.DOTALL)
    if match:
        return match.group(1).strip()
    return raw


SYSTEM_PROMPT = """Ты — AI-ассистент для анализа встреч. Твоя задача — создать структурированный
анализ транскрипции встречи в формате Notion. Отвечай только на языке транскрипции (русский или казахский).

Возвращай ответ строго в JSON формате со следующими полями:
- summary: краткое резюме встречи (2-4 предложения)
- key_topics: список ключевых тем (массив строк)
- action_items: список задач и действий с ответственными, если упоминаются (массив строк)
- decisions: принятые решения (массив строк)
- speaker_stats: статистика по спикерам (объект {"SPEAKER_00": {"name": "Спикер 1", "talk_time": "~30%"}})

Не добавляй ничего кроме JSON. Не используй markdown-обёртки.
"""


async def analyze_meeting(
    segments: List[Dict],
    meeting_title: str = "",
) -> Dict:
    if not segments:
        return EMPTY_ANALYSIS.copy()

    transcript = _format_transcript(segments)
    user_message = f"""Встреча: {meeting_title or 'Без названия'}

Транскрипция:
{transcript}

Проведи анализ этой встречи."""

    try:
        client = _get_client()
        response = await client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}],
            timeout=120.0,
        )

        if not response.content or response.content[0].type != "text":
            raise ValueError("Unexpected response format from Claude")

        raw = _extract_json(response.content[0].text)
        data = json.loads(raw)

        return {
            "summary": str(data.get("summary", "")),
            "key_topics": json.dumps(data.get("key_topics", []), ensure_ascii=False),
            "action_items": json.dumps(data.get("action_items", []), ensure_ascii=False),
            "decisions": json.dumps(data.get("decisions", []), ensure_ascii=False),
            "speaker_stats": json.dumps(data.get("speaker_stats", {}), ensure_ascii=False),
        }
    except Exception as e:
        logger.error("Analysis failed: %s", e, exc_info=True)
        return {**EMPTY_ANALYSIS, "summary": f"Ошибка анализа: {e}"}
