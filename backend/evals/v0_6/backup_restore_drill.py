"""Run the v0.6 snapshot/revision/restore exit drill in an isolated temporary home."""

import json
import sys
import tempfile
from pathlib import Path


def main() -> None:
    runtime = tempfile.TemporaryDirectory(prefix="audux-v06-restore-drill-")
    runtime_path = Path(runtime.name)
    original_home = Path.home
    Path.home = classmethod(lambda cls: runtime_path)  # type: ignore[method-assign]
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

    try:
        from sqlmodel import Session, func, select

        from app import db
        from app.models import AudioItem, Transcript
        from app.services import backup_service
        from app.services.transcript_service import create_transcript_revision

        db.create_db_and_tables()
        audio_count = 100
        revisions_per_audio = 5

        with Session(db.engine) as session:
            for audio_index in range(audio_count):
                audio = AudioItem(
                    file_path=str(runtime_path / "library" / f"audio-{audio_index}.wav"),
                    file_name=f"audio-{audio_index}.wav",
                    duration_seconds=60,
                )
                session.add(audio)
                session.flush()
                for revision_index in range(revisions_per_audio):
                    text = f"样本 {audio_index} 修订 {revision_index}"
                    create_transcript_revision(
                        session,
                        audio,
                        language="zh",
                        full_text=text,
                        model_name="drill-model",
                        provider_name="drill-provider",
                        source_type="asr" if revision_index == 0 else "manual",
                        segments=[
                            {
                                "segment_index": 0,
                                "start_seconds": 0,
                                "end_seconds": 5,
                                "text": text,
                            }
                        ],
                    )
                session.commit()

            snapshot = backup_service.create_database_backup(
                session,
                "v0.6 revision restore drill",
            )

            audios = session.exec(select(AudioItem).order_by(AudioItem.id)).all()
            for audio in audios:
                create_transcript_revision(
                    session,
                    audio,
                    language="zh",
                    full_text="快照后的修订",
                    model_name="drill-model",
                    provider_name="drill-provider",
                    source_type="manual",
                    segments=[],
                )
            session.commit()
            before_restore = session.exec(
                select(func.count()).select_from(Transcript)
            ).one()
            pending = backup_service.schedule_database_restore(session, snapshot["id"])

        backup_service.initialize_database_with_pending_restore()

        with Session(db.engine) as session:
            after_restore = session.exec(
                select(func.count()).select_from(Transcript)
            ).one()
            current_after_restore = session.exec(
                select(func.count())
                .select_from(Transcript)
                .where(Transcript.is_current.is_(True))
            ).one()

        expected = audio_count * revisions_per_audio
        assert before_restore == expected + audio_count
        assert after_restore == expected
        assert current_after_restore == audio_count
        assert backup_service.get_database_restore_status()["last_result"]["status"] == "succeeded"
        print(
            json.dumps(
                {
                    "ok": True,
                    "snapshot_id": snapshot["id"],
                    "safety_snapshot_id": pending["safety_snapshot_id"],
                    "revisions_before_restore": before_restore,
                    "revisions_after_restore": after_restore,
                    "current_revisions_after_restore": current_after_restore,
                    "temporary_runtime": str(runtime_path),
                },
                ensure_ascii=False,
            )
        )
    finally:
        Path.home = original_home  # type: ignore[method-assign]
        runtime.cleanup()


if __name__ == "__main__":
    main()
