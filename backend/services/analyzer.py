"""
Meeting analysis using Claude API.
"""

import os
import json
import logging
from typing import List, Dict, Optional

import anthropic

logger = logging.getLogger(__name__)

_client: Optional[anthropic.AsyncAnthropic] = None


def _get_client() -> anthropic.AsyncAnthropic:
    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))
    return _client


def _format_transcript(segments: List[Dict]) -> str:
    lines = []
    for seg in segments:
        speaker = seg.get("speaker") or "Спикер"
        t = f"[{seg['start']:.1f}s] {speaker}: {seg['text']}"
        lines.append(t)
    return "\n".join(lines)


SYSTEM_PROMPT = """Ты — AI-ассистент для анализа встреч. Твоя задача — создать структурированный
анализ транскрипции встречи в формате Notion. Отвечай только на языке транскрипции (русский или казахский).

Возвращай ответ строго в JSON формате со следующими полями:
- summary: краткое резюме встречи (2-4 предложения)
- key_topics: список ключевых тем (массив строк)
- action_items: список задач и действий с ответственными, если упоминаются (массив строк)
- decisions: принятые решения (массив строк)
- speaker_stats: статистика по спикерам (объект {"SPEAKER_00": {"name": "Спикер 1", "talk_time": "~30%"}})
"""


async def analyze_meeting(
    segments: List[Dict],
    meeting_title: str = "",
) -> Dict:
    if not segments:
        return {}

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
        )
        raw = response.content[0].text

        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1]
            raw = raw.rsplit("```", 1)[0]

        data = json.loads(raw)

        return {
            "summary": data.get("summary", ""),
            "key_topics": json.dumps(data.get("key_topics", []), ensure_ascii=False),
            "action_items": json.dumps(data.get("action_items", []), ensure_ascii=False),
            "decisions": json.dumps(data.get("decisions", []), ensure_ascii=False),
            "speaker_stats": json.dumps(data.get("speaker_stats", {}), ensure_ascii=False),
        }
    except Exception as e:
        logger.error("Analysis failed: %s", e)
        return {"summary": f"Ошибка анализа: {e}"}
