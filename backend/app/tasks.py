import json
import asyncio
from sqlmodel import Session, select

from .db import engine
from .models import AITask, AudioItem, Transcript, TranscriptSegment, Setting
from .models import now_iso
from .transcriber import transcribe_audio
from .search import rebuild_audio_search_index
from .ai_client import (
    call_openai_compatible_chat,
    get_ai_message_content,
    parse_ai_json_content,
)


_task_runner_started = False


class TaskCanceled(Exception):
    pass


def create_task(
    session: Session,
    audio_id: int,
    task_type: str,
    input_payload: dict | None = None,
) -> AITask:
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


def get_setting_int(session: Session, key: str, default: int) -> int:
    value = get_setting(session, key)
    if value is None or value == "":
        return default

    try:
        return int(value)
    except Exception:
        return default


def get_setting_float(session: Session, key: str, default: float) -> float:
    value = get_setting(session, key)
    if value is None or value == "":
        return default

    try:
        return float(value)
    except Exception:
        return default


def is_task_canceled(session: Session, task_id: int) -> bool:
    session.expire_all()
    task = session.get(AITask, task_id)
    return bool(task and task.status == "canceled")


def set_audio_task_status(
    session: Session,
    audio_id: int,
    task_type: str,
    status: str,
):
    audio = session.get(AudioItem, audio_id)
    if not audio:
        return

    if task_type == "transcribe":
        audio.transcript_status = status

    if task_type == "analyze":
        audio.ai_status = status

    audio.updated_at = now_iso()
    session.add(audio)
    session.commit()


def finalize_canceled_task(session: Session, task_id: int):
    session.expire_all()
    task = session.get(AITask, task_id)
    if not task:
        return

    task.status = "canceled"
    task.finished_at = task.finished_at or now_iso()
    task.updated_at = now_iso()
    session.add(task)
    session.commit()

    set_audio_task_status(session, task.audio_id, task.task_type, "canceled")


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

            task_id = task.id

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

                session.expire_all()
                fresh = session.get(AITask, task_id)

                if not fresh:
                    continue

                if fresh.status == "canceled":
                    finalize_canceled_task(session, task_id)
                    continue

                fresh.status = "done"
                fresh.finished_at = now_iso()
                fresh.updated_at = now_iso()
                session.add(fresh)
                session.commit()

            except TaskCanceled:
                finalize_canceled_task(session, task_id)

            except Exception as e:
                session.expire_all()
                fresh = session.get(AITask, task_id)

                if fresh and fresh.status == "canceled":
                    finalize_canceled_task(session, task_id)
                    continue

                if not fresh:
                    continue

                fresh.status = "failed"
                fresh.error_message = str(e)
                fresh.finished_at = now_iso()
                fresh.updated_at = now_iso()
                session.add(fresh)

                audio = session.get(AudioItem, fresh.audio_id)
                if audio:
                    if fresh.task_type == "transcribe":
                        audio.transcript_status = "failed"
                    if fresh.task_type == "analyze":
                        audio.ai_status = "failed"

                    audio.updated_at = now_iso()
                    session.add(audio)

                session.commit()


async def handle_transcribe_task(session: Session, task: AITask):
    task_id = task.id
    audio_id = task.audio_id

    audio = session.get(AudioItem, audio_id)
    if not audio:
        raise ValueError("Audio not found")

    if is_task_canceled(session, task_id):
        raise TaskCanceled()

    audio = session.get(AudioItem, audio_id)
    audio.transcript_status = "running"
    audio.updated_at = now_iso()
    session.add(audio)
    session.commit()

    model_name = get_setting(session, "asr.model_name", "small") or "small"
    device = get_setting(session, "asr.device", "cpu") or "cpu"
    compute_type = get_setting(session, "asr.compute_type", "int8") or "int8"
    beam_size = get_setting_int(session, "asr.beam_size", 5)

    result = await asyncio.to_thread(
        transcribe_audio,
        audio.file_path,
        model_name,
        device,
        compute_type,
        beam_size,
    )

    if is_task_canceled(session, task_id):
        set_audio_task_status(session, audio_id, "transcribe", "canceled")
        raise TaskCanceled()

    old = session.exec(
        select(Transcript).where(Transcript.audio_id == audio_id)
    ).first()

    if old:
        old_segments = session.exec(
            select(TranscriptSegment).where(
                TranscriptSegment.transcript_id == old.id
            )
        ).all()

        for seg in old_segments:
            session.delete(seg)

        session.delete(old)
        session.commit()

    transcript = Transcript(
        audio_id=audio_id,
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

    audio = session.get(AudioItem, audio_id)
    audio.transcript_status = "done"
    audio.updated_at = now_iso()
    session.add(audio)
    session.commit()

    rebuild_audio_search_index(session, audio_id)


async def handle_analyze_task(session: Session, task: AITask):
    task_id = task.id
    audio_id = task.audio_id

    audio = session.get(AudioItem, audio_id)
    if not audio:
        raise ValueError("Audio not found")

    if is_task_canceled(session, task_id):
        raise TaskCanceled()

    audio = session.get(AudioItem, audio_id)
    audio.ai_status = "running"
    audio.updated_at = now_iso()
    session.add(audio)
    session.commit()

    endpoint = get_setting(session, "llm.endpoint")
    model_name = get_setting(session, "llm.model_name")
    api_key = get_setting(session, "llm.api_key", "")

    timeout = get_setting_int(session, "llm.timeout", 60)
    max_tokens = get_setting_int(session, "llm.max_tokens", 800)
    temperature = get_setting_float(session, "llm.temperature", 0.2)

    if not endpoint or not model_name:
        raise ValueError("LLM endpoint or model_name is not configured")

    transcript = session.exec(
        select(Transcript).where(Transcript.audio_id == audio_id)
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
- 避免低价值标签，例如：音频、内容、对话、讲话
- 不要编造 transcript 中不存在的具体事实
- 如果 transcript 为空，只能根据已有 metadata 做保守描述

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
        timeout=timeout,
        max_tokens=max_tokens,
        temperature=temperature,
        messages=[
            {"role": "system", "content": "你是一个本地音频知识库整理助手。你必须只输出合法 JSON。"},
            {"role": "user", "content": prompt},
        ],
    )

    content = get_ai_message_content(response)

    task_row = session.get(AITask, task_id)
    if task_row:
        task_row.output_payload = json.dumps(
            {
                "raw_content": content,
            },
            ensure_ascii=False,
        )
        task_row.updated_at = now_iso()
        session.add(task_row)
        session.commit()

    if is_task_canceled(session, task_id):
        set_audio_task_status(session, audio_id, "analyze", "canceled")
        raise TaskCanceled()

    try:
        parsed = parse_ai_json_content(content)
    except Exception as e:
        raise ValueError(f"LLM response is not valid JSON: {e}")

    description = parsed.get("description")
    tags = parsed.get("tags", [])
    language = parsed.get("language")

    if not description or not isinstance(description, str):
        raise ValueError("Invalid AI JSON schema: description is required")

    if not isinstance(tags, list):
        raise ValueError("Invalid AI JSON schema: tags must be an array")

    normalized_tags = []
    for name in tags[:8]:
        name = str(name).strip()
        if name and name not in normalized_tags:
            normalized_tags.append(name)

    audio = session.get(AudioItem, audio_id)
    audio.description_ai = description.strip()
    audio.language = audio.language or language
    audio.ai_status = "done"
    audio.updated_at = now_iso()
    session.add(audio)

    task_row = session.get(AITask, task_id)
    if task_row:
        task_row.output_payload = json.dumps(
            {
                "description": description.strip(),
                "tags": normalized_tags,
                "language": language,
                "raw_content": content,
            },
            ensure_ascii=False,
        )
        task_row.updated_at = now_iso()
        session.add(task_row)

    session.commit()

    rebuild_audio_search_index(session, audio_id)


def start_worker_once():
    global _task_runner_started

    if _task_runner_started:
        return

    _task_runner_started = True
    asyncio.create_task(worker_loop())
