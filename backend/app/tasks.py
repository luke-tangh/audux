import json
import asyncio
from datetime import datetime
from sqlmodel import Session, select

from .db import engine
from .models import AITask, AudioItem, Transcript, TranscriptSegment, Setting, Tag, AudioTag
from .models import now_iso
from .transcriber import transcribe_audio_stub
from .search import rebuild_audio_search_index
from .ai_client import call_openai_compatible_chat, parse_ai_json_response


_task_runner_started = False


def create_task(session: Session, audio_id: int, task_type: str, input_payload: dict | None = None) -> AITask:
    task = AITask(
        audio_id=audio_id,
        task_type=task_type,
        status="pending",
        input_payload=json.dumps(input_payload or {}, ensure_ascii=False),
        updated_at=now_iso(),
    )
    session.add(task)
    session.commit()
    session.refresh(task)
    return task


def get_setting(session: Session, key: str, default: str | None = None) -> str | None:
    row = session.get(Setting, key)
    return row.value if row else default


async def worker_loop():
    while True:
        await asyncio.sleep(1)

        with Session(engine) as session:
            task = session.exec(
                select(AITask)
                .where(AITask.status == "pending")
                .order_by(AITask.created_at)
            ).first()

            if not task:
                continue

            task.status = "running"
            task.started_at = now_iso()
            task.updated_at = now_iso()
            session.add(task)
            session.commit()
            session.refresh(task)

            try:
                if task.task_type == "transcribe":
                    await handle_transcribe_task(session, task)
                elif task.task_type == "analyze":
                    await handle_analyze_task(session, task)
                else:
                    raise ValueError(f"Unknown task type: {task.task_type}")

                task.status = "done"
                task.finished_at = now_iso()
                task.updated_at = now_iso()
                session.add(task)
                session.commit()

            except Exception as e:
                task.status = "failed"
                task.error_message = str(e)
                task.finished_at = now_iso()
                task.updated_at = now_iso()
                session.add(task)

                audio = session.get(AudioItem, task.audio_id)
                if audio:
                    if task.task_type == "transcribe":
                        audio.transcript_status = "failed"
                    if task.task_type == "analyze":
                        audio.ai_status = "failed"
                    audio.updated_at = now_iso()
                    session.add(audio)

                session.commit()


async def handle_transcribe_task(session: Session, task: AITask):
    audio = session.get(AudioItem, task.audio_id)
    if not audio:
        raise ValueError("Audio not found")

    audio.transcript_status = "running"
    audio.updated_at = now_iso()
    session.add(audio)
    session.commit()

    result = await asyncio.to_thread(transcribe_audio_stub, audio.file_path)

    old = session.exec(
        select(Transcript).where(Transcript.audio_id == audio.id)
    ).first()

    if old:
        session.delete(old)
        session.commit()

    transcript = Transcript(
        audio_id=audio.id,
        language=result.get("language"),
        full_text=result["full_text"],
        model_name=result.get("model_name"),
        status="done",
        generated_at=now_iso(),
        updated_at=now_iso(),
    )
    session.add(transcript)
    session.commit()
    session.refresh(transcript)

    for seg in result.get("segments", []):
        row = TranscriptSegment(
            transcript_id=transcript.id,
            segment_index=seg["segment_index"],
            start_seconds=seg["start_seconds"],
            end_seconds=seg["end_seconds"],
            text=seg["text"],
        )
        session.add(row)

    audio.transcript_status = "done"
    audio.updated_at = now_iso()
    session.add(audio)
    session.commit()

    rebuild_audio_search_index(session, audio.id)


async def handle_analyze_task(session: Session, task: AITask):
    audio = session.get(AudioItem, task.audio_id)
    if not audio:
        raise ValueError("Audio not found")

    audio.ai_status = "running"
    audio.updated_at = now_iso()
    session.add(audio)
    session.commit()

    endpoint = get_setting(session, "llm.endpoint")
    model_name = get_setting(session, "llm.model_name")
    api_key = get_setting(session, "llm.api_key", "")

    if not endpoint or not model_name:
        raise ValueError("LLM endpoint or model_name is not configured")

    transcript = session.exec(
        select(Transcript).where(Transcript.audio_id == audio.id)
    ).first()

    transcript_text = transcript.full_text if transcript else ""
    transcript_text = transcript_text[:12000]

    prompt = f"""
请根据以下本地音频信息生成结构化 JSON。

要求：
- 只输出 JSON，不要输出 Markdown
- description 为 80 到 200 字
- tags 为 5 到 8 个
- tags 应具体、可检索
- 不要编造 transcript 中不存在的具体事实

音频信息：
title: {audio.title_user or audio.title_original or audio.file_name}
author: {audio.author_user or audio.author_original or ""}
album: {audio.album_user or audio.album_original or ""}
existing_description: {audio.description_user or audio.description_original or ""}
duration_seconds: {audio.duration_seconds}
language: {audio.language or ""}

transcript:
{transcript_text}

输出格式：
{{
  "description": "string",
  "tags": ["string"],
  "language": "zh"
}}
"""

    response = await call_openai_compatible_chat(
        endpoint=endpoint,
        model_name=model_name,
        api_key=api_key or None,
        messages=[
            {"role": "system", "content": "你是一个本地音频知识库整理助手。"},
            {"role": "user", "content": prompt},
        ],
    )

    parsed = parse_ai_json_response(response)

    description = parsed.get("description")
    tags = parsed.get("tags", [])
    language = parsed.get("language")

    if not description or not isinstance(tags, list):
        raise ValueError("Invalid AI JSON schema")

    audio.description_ai = description
    audio.language = audio.language or language
    audio.ai_status = "done"
    audio.updated_at = now_iso()
    session.add(audio)

    for name in tags[:8]:
        name = str(name).strip()
        if not name:
            continue

        tag = session.exec(select(Tag).where(Tag.name == name)).first()
        if not tag:
            tag = Tag(name=name, source="ai")
            session.add(tag)
            session.commit()
            session.refresh(tag)

        exists = session.exec(
            select(AudioTag).where(
                AudioTag.audio_id == audio.id,
                AudioTag.tag_id == tag.id,
            )
        ).first()

        if not exists:
            session.add(AudioTag(audio_id=audio.id, tag_id=tag.id))

    task.output_payload = json.dumps(parsed, ensure_ascii=False)
    session.add(task)
    session.commit()

    rebuild_audio_search_index(session, audio.id)


def start_worker_once():
    global _task_runner_started

    if _task_runner_started:
        return

    _task_runner_started = True
    asyncio.create_task(worker_loop())
