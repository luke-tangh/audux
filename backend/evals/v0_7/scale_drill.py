"""Exercise v0.7 retrieval, Agent cancellation and playback lookup with 10k items."""

import json
import sys
import tempfile
import time
import tracemalloc
from pathlib import Path


def main() -> None:
    runtime = tempfile.TemporaryDirectory(prefix="audux-v07-scale-")
    runtime_path = Path(runtime.name)
    original_home = Path.home
    Path.home = classmethod(lambda cls: runtime_path)  # type: ignore[method-assign]
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    tracemalloc.start()

    try:
        from sqlalchemy import text
        from sqlmodel import Session

        from app import db
        from app.models import AudioItem
        from app.schemas import AgentConversationCreate, AgentRunCreate, AgentScope
        from app.services.agent_service import cancel_run, create_conversation, create_run
        from app.services.retrieval_service import search_segments

        db.create_db_and_tables()
        item_count = 10_000
        with Session(db.engine) as session:
            rows = [
                AudioItem(
                    file_path=str(runtime_path / "library" / f"audio-{index}.mp3"),
                    file_name=f"audio-{index}.mp3",
                    title_original=f"Scale item needle{index}",
                    duration_seconds=60,
                )
                for index in range(item_count)
            ]
            session.add_all(rows)
            session.flush()
            session.execute(
                text(
                    """
                    INSERT INTO segment_search_index(
                        audio_id, transcript_id, segment_id, segment_index,
                        start_seconds, end_seconds, title, author, description,
                        tags, transcript
                    ) VALUES (:audio_id, 0, 0, 0, 0, 60, :title, '', '', '', '')
                    """
                ),
                [{"audio_id": int(row.id), "title": row.title_original} for row in rows],
            )
            session.commit()

            wall_started = time.perf_counter()
            cpu_started = time.process_time()
            result = search_segments(
                session,
                "needle9999",
                AgentScope(kind="library"),
                limit=20,
            )
            search_ms = (time.perf_counter() - wall_started) * 1000
            search_cpu_ms = (time.process_time() - cpu_started) * 1000
            assert result["items"] and result["items"][0]["audio_id"] == rows[-1].id

            conversation = create_conversation(
                session,
                AgentConversationCreate(scope=AgentScope(kind="library")),
            )
            run = create_run(session, conversation["id"], AgentRunCreate(content="needle9999"))
            cancel_started = time.perf_counter()
            canceled = cancel_run(session, run["id"])
            cancel_ms = (time.perf_counter() - cancel_started) * 1000
            assert canceled["status"] == "canceled"

            playback_started = time.perf_counter()
            playable = session.get(AudioItem, int(rows[item_count // 2].id))
            playback_lookup_ms = (time.perf_counter() - playback_started) * 1000
            assert playable is not None

        _, peak_bytes = tracemalloc.get_traced_memory()
        database_bytes = sum(
            path.stat().st_size
            for path in db.DB_PATH.parent.glob(f"{db.DB_PATH.name}*")
            if path.is_file()
        )
        metrics = {
            "item_count": item_count,
            "first_result_latency_ms": round(search_ms, 3),
            "search_cpu_ms": round(search_cpu_ms, 3),
            "agent_cancel_latency_ms": round(cancel_ms, 3),
            "playback_lookup_latency_ms": round(playback_lookup_ms, 3),
            "python_peak_allocated_bytes": peak_bytes,
            "database_bytes": database_bytes,
            "retrieval_mode": result["retrieval_mode"],
        }
        assert search_ms < 5_000
        assert cancel_ms < 500
        assert playback_lookup_ms < 500
        assert database_bytes < 128 * 1024 * 1024
        print(json.dumps(metrics, ensure_ascii=False, indent=2))
    finally:
        tracemalloc.stop()
        Path.home = original_home  # type: ignore[method-assign]
        runtime.cleanup()


if __name__ == "__main__":
    main()
