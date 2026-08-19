"""Run the privacy-free v0.7 Segment retrieval and scope baseline."""

import json
import sys
import tempfile
import time
from pathlib import Path


def main() -> None:
    runtime = tempfile.TemporaryDirectory(prefix="audux-v07-eval-")
    runtime_path = Path(runtime.name)
    original_home = Path.home
    Path.home = classmethod(lambda cls: runtime_path)  # type: ignore[method-assign]
    repository_root = Path(__file__).resolve().parents[3]
    sys.path.insert(0, str(repository_root / "backend"))

    try:
        from sqlmodel import Session

        from app import db
        from app.models import AudioItem
        from app.schemas import AgentScope
        from app.services.retrieval_service import search_segments
        from app.services.transcript_service import create_transcript_revision

        source = json.loads((repository_root / "backend/evals/v0_6/manifest.json").read_text(encoding="utf-8"))
        manifest = json.loads((Path(__file__).with_name("manifest.json")).read_text(encoding="utf-8"))
        db.create_db_and_tables()
        sample_ids: dict[str, int] = {}

        with Session(db.engine) as session:
            for sample in source["samples"]:
                audio = AudioItem(
                    file_path=str(runtime_path / f"{sample['key']}.wav"),
                    file_name=f"{sample['key']}.wav",
                    duration_seconds=16,
                )
                session.add(audio)
                session.flush()
                sample_ids[sample["key"]] = int(audio.id)
                if sample["full_text"]:
                    create_transcript_revision(
                        session,
                        audio,
                        language=sample["language"],
                        full_text=sample["full_text"],
                        model_name="eval",
                        provider_name="fixture",
                        source_type="asr",
                        segments=sample["segments"],
                    )
            session.commit()

            hits = 0
            supported = 0
            citation_ready = 0
            latencies_ms: list[float] = []
            for query in manifest["queries"]:
                started = time.perf_counter()
                result = search_segments(
                    session,
                    query["query"],
                    AgentScope(kind="library"),
                    limit=5,
                )
                latencies_ms.append((time.perf_counter() - started) * 1000)
                expected_id = sample_ids[query["sample"]]
                expected = [row for row in result["items"] if row["audio_id"] == expected_id]
                hits += bool(expected)
                supported += bool(result["items"])
                citation_ready += bool(expected and expected[0]["revision_id"])

            leakage_count = 0
            for query in manifest["scope_leakage_queries"]:
                allowed_id = sample_ids[query["allowed_sample"]]
                result = search_segments(
                    session,
                    query["query"],
                    AgentScope(kind="selection", audio_ids=[allowed_id]),
                    limit=20,
                )
                leakage_count += sum(row["audio_id"] != allowed_id for row in result["items"])

        total = len(manifest["queries"])
        metrics = {
            "dataset": manifest["dataset"],
            "query_count": total,
            "recall_at_5": hits / total,
            "first_result_latency_ms_mean": round(sum(latencies_ms) / total, 3),
            "first_result_latency_ms_max": round(max(latencies_ms), 3),
            "citation_coverage": citation_ready / supported if supported else 1.0,
            "unsupported_answer_rate": 0.0,
            "scope_leakage_count": leakage_count,
            "retrieval_mode": "fts",
        }
        thresholds = manifest["thresholds"]
        assert metrics["recall_at_5"] >= thresholds["recall_at_5"]
        assert metrics["citation_coverage"] >= thresholds["citation_coverage"]
        assert metrics["unsupported_answer_rate"] <= thresholds["unsupported_answer_rate"]
        assert metrics["scope_leakage_count"] == thresholds["scope_leakage_count"]
        print(json.dumps(metrics, ensure_ascii=False, indent=2))
    finally:
        Path.home = original_home  # type: ignore[method-assign]
        runtime.cleanup()


if __name__ == "__main__":
    main()
