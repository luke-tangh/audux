import os
import time
from pathlib import Path

import pytest
from sqlmodel import Session, select

from app.models import (
    AudioItem,
    AudioTag,
    LibraryHealthTask,
    Playlist,
    PlaylistItem,
    ScanTask,
    Tag,
    Transcript,
    TranscriptSegment,
)
from app.scanner import calculate_sampled_file_hash
from app.services import health_service
from tests.api_test_support import ApiIntegrationTest


class TestLibraryHealthApi(ApiIntegrationTest):
    def mutate(self, method: str, url: str, json_body: dict | None = None):
        return self.client.request(
            method,
            url,
            headers=self.auth_headers(include_client=True),
            json=json_body,
        )

    def wait_for_health_task(self, task_id: int) -> dict:
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            tasks = self.client.get(
                "/library-health/tasks",
                headers=self.auth_headers(),
            ).json()
            task = next(row for row in tasks if row["id"] == task_id)
            if task["status"] not in {"pending", "running", "cancel_requested"}:
                return task
            time.sleep(0.01)
        raise AssertionError(f"health task {task_id} did not finish")

    def test_health_check_summarizes_roots_missing_unsupported_scans_and_duplicates(self):
        enabled = self.add_library_root(self.root_path / "enabled")
        disabled = self.add_library_root(self.root_path / "disabled", enabled=False)
        first = self.add_audio(self.root_path / "enabled" / "one.mp3", root_id=enabled.id)
        second = self.add_audio(self.root_path / "enabled" / "two.mp3", root_id=enabled.id)
        missing = self.add_audio(self.root_path / "disabled" / "gone.mp3", root_id=disabled.id)
        Path(missing.file_path).unlink()
        (self.root_path / "enabled" / "unsupported.wma").write_bytes(b"unsupported")

        with Session(self.engine) as session:
            for audio_id in (first.id, second.id):
                audio = session.get(AudioItem, audio_id)
                audio.duration_seconds = 60.0
                audio.title_original = "Same recording"
                session.add(audio)
            session.add(
                ScanTask(
                    root_id=enabled.id,
                    status="failed",
                    error_message="permission denied",
                )
            )
            session.commit()

        created = self.mutate("POST", "/library-health/checks")
        assert created.status_code == 200, created.text

        task = self.wait_for_health_task(created.json()["id"])
        assert task["status"] == "done"
        assert task["result"]["missing_audio_ids"] == [missing.id]

        response = self.client.get("/library-health", headers=self.auth_headers())
        assert response.status_code == 200, response.text
        summary = response.json()
        assert summary["totals"] == {
            "roots": 2,
            "disabled_roots": 1,
            "available": 2,
            "missing": 1,
            "unsupported": 1,
            "scan_failures": 1,
            "duplicate_groups": 1,
            "detached_audio": 0,
        }
        assert summary["missing_audio"][0]["id"] == missing.id
        enabled_summary = next(
            row for row in summary["roots"] if row["root"]["id"] == enabled.id
        )
        assert enabled_summary["unsupported_count"] == 1
        assert enabled_summary["latest_scan"]["status"] == "failed"
        assert {
            item["id"] for item in summary["duplicate_groups"][0]["audio_items"]
        } == {first.id, second.id}

    def test_health_task_can_be_canceled_retried_and_interrupted_tasks_recover(self):
        with Session(self.engine) as session:
            pending = health_service.create_health_task(session)
            pending_id = pending.id

        canceled = self.mutate("POST", f"/library-health/tasks/{pending_id}/cancel")
        assert canceled.status_code == 200, canceled.text
        assert canceled.json()["status"] == "canceled"

        retried = self.mutate("POST", f"/library-health/tasks/{pending_id}/retry")
        assert retried.status_code == 200, retried.text
        assert retried.json()["status"] == "pending"
        assert self.wait_for_health_task(retried.json()["id"])["status"] == "done"

        with Session(self.engine) as session:
            requested = health_service.create_health_task(
                session,
                task_type="duplicate_hash",
                audio_ids=[101, 102],
            )
            requested.status = "cancel_requested"
            session.add(requested)
            session.commit()
            requested_id = requested.id
        health_service.run_health_task(self.engine, requested_id)
        with Session(self.engine) as session:
            assert session.get(LibraryHealthTask, requested_id).status == "canceled"

        with Session(self.engine) as session:
            interrupted = LibraryHealthTask(task_type="duplicate_hash", status="running")
            session.add(interrupted)
            session.commit()
            interrupted_id = interrupted.id
        assert health_service.recover_interrupted_health_tasks(self.engine) == 1
        with Session(self.engine) as session:
            stored = session.exec(
                select(LibraryHealthTask).where(LibraryHealthTask.id == interrupted_id)
            ).one()
            assert stored.status == "failed"
            assert stored.error_code == "health.interrupted"

    def test_full_hash_confirmation_only_reports_identical_files(self):
        root = self.add_library_root(self.root_path / "duplicates")
        first = self.add_audio(self.root_path / "duplicates" / "a.mp3", root_id=root.id)
        second = self.add_audio(self.root_path / "duplicates" / "b.mp3", root_id=root.id)
        third = self.add_audio(self.root_path / "duplicates" / "c.mp3", root_id=root.id)
        Path(third.file_path).write_bytes(b"different-content")

        response = self.mutate(
            "POST",
            "/library-health/duplicates/confirm",
            {"audio_ids": [first.id, second.id, third.id]},
        )
        assert response.status_code == 200, response.text
        task = self.wait_for_health_task(response.json()["id"])
        result = task["result"]
        assert task["status"] == "done"
        assert [
            item["id"] for item in result["confirmed_groups"][0]["audio_items"]
        ] == [first.id, second.id]

    def test_safe_relink_previews_and_preserves_related_data_and_fts(self):
        root = self.add_library_root(self.root_path / "library")
        old_path = self.root_path / "library" / "old.mp3"
        audio = self.add_audio(old_path, root_id=root.id)
        old_hash = calculate_sampled_file_hash(old_path)
        candidate = self.root_path / "library" / "moved.mp3"
        candidate.write_bytes(old_path.read_bytes())
        old_path.unlink()
        cover = self.root_path / "cover.jpg"
        cover.write_bytes(b"cover")

        with Session(self.engine) as session:
            stored = session.get(AudioItem, audio.id)
            stored.file_hash = old_hash
            stored.is_missing = True
            stored.title_user = "User title"
            stored.play_count = 7
            stored.last_position_seconds = 12.5
            stored.cover_path = str(cover)
            stored.cover_source = "user"
            tag = Tag(name="preserved")
            playlist = Playlist(name="preserved")
            session.add_all([stored, tag, playlist])
            session.commit()
            session.refresh(tag)
            session.refresh(playlist)
            transcript = Transcript(audio_id=audio.id, full_text="searchable evidence")
            session.add(transcript)
            session.commit()
            session.refresh(transcript)
            session.add_all(
                [
                    AudioTag(audio_id=audio.id, tag_id=tag.id),
                    PlaylistItem(
                        playlist_id=playlist.id,
                        audio_id=audio.id,
                        order_index=0,
                    ),
                    TranscriptSegment(
                        transcript_id=transcript.id,
                        segment_index=0,
                        start_seconds=0,
                        end_seconds=1,
                        text="searchable evidence",
                    ),
                ]
            )
            session.commit()

        candidates = self.client.get(
            f"/library-health/audio/{audio.id}/relink-candidates",
            headers=self.auth_headers(),
        )
        assert candidates.status_code == 200, candidates.text
        candidate_row = next(
            row for row in candidates.json()["candidates"] if row["path"] == str(candidate)
        )
        assert candidate_row["eligible"] is True
        assert candidate_row["checks"]["size"] is True
        assert candidate_row["checks"]["fingerprint"] is True

        preview_response = self.mutate(
            "POST",
            f"/library-health/audio/{audio.id}/relink-preview",
            {"candidate_path": str(candidate)},
        )
        assert preview_response.status_code == 200, preview_response.text
        preview = preview_response.json()
        assert preview["impacts"] == {
            "transcript_preserved": True,
            "transcript_segments": 1,
            "tags_preserved": 1,
            "manual_playlists_preserved": 1,
            "cover_preserved": True,
            "cover_source": "user",
            "play_count_preserved": 7,
            "playback_position_preserved": 12.5,
            "user_metadata_preserved": True,
            "files_deleted": 0,
            "database_records_deleted": 0,
        }

        committed = self.mutate(
            "POST",
            f"/library-health/audio/{audio.id}/relink",
            {
                "candidate_path": str(candidate),
                **preview["confirmation"],
            },
        )
        assert committed.status_code == 200, committed.text
        assert committed.json()["audio"]["file_path"] == str(candidate)

        with Session(self.engine) as session:
            stored = session.get(AudioItem, audio.id)
            assert stored.title_user == "User title"
            assert stored.play_count == 7
            assert stored.last_position_seconds == 12.5
            assert stored.cover_path == str(cover)
            assert stored.is_missing is False
            fts = session.exec(
                select(AudioItem.id).where(AudioItem.id == audio.id)
            ).one()
            assert fts == audio.id
            search_row = session.connection().exec_driver_sql(
                "SELECT transcript FROM search_index WHERE audio_id = ?",
                (audio.id,),
            ).one()
            assert search_row[0] == "searchable evidence"

    def test_relink_rejects_outside_symlink_filename_only_conflict_and_stale_preview(self):
        root = self.add_library_root(self.root_path / "library")
        old = self.root_path / "library" / "same-name.mp3"
        audio = self.add_audio(old, root_id=root.id)
        old_hash = calculate_sampled_file_hash(old)
        old.unlink()
        outside = self.root_path / "outside.mp3"
        outside.write_bytes(b"test-audio-content")
        symlink = self.root_path / "library" / "escape.mp3"
        try:
            symlink.symlink_to(outside)
        except OSError:
            symlink = None
        wrong = self.root_path / "library" / "other" / "same-name.mp3"
        wrong.parent.mkdir()
        wrong.write_bytes(b"wrong-content-xxx")
        candidate = self.root_path / "library" / "valid.mp3"
        candidate.write_bytes(b"test-audio-content")
        claimed = self.root_path / "library" / "claimed.mp3"
        claimed.write_bytes(b"test-audio-content")
        claimed_audio = self.add_audio(claimed, root_id=root.id)

        with Session(self.engine) as session:
            stored = session.get(AudioItem, audio.id)
            stored.file_hash = old_hash
            stored.is_missing = True
            session.add(stored)
            session.commit()

        outside_response = self.mutate(
            "POST",
            f"/library-health/audio/{audio.id}/relink-preview",
            {"candidate_path": str(outside)},
        )
        assert outside_response.status_code == 400
        assert outside_response.json()["detail"]["code"] == "audio.outside_library"

        if symlink is not None:
            symlink_response = self.mutate(
                "POST",
                f"/library-health/audio/{audio.id}/relink-preview",
                {"candidate_path": str(symlink)},
            )
            assert symlink_response.status_code == 400
            assert symlink_response.json()["detail"]["code"] == "audio.outside_library"

        candidates = self.client.get(
            f"/library-health/audio/{audio.id}/relink-candidates",
            headers=self.auth_headers(),
        ).json()["candidates"]
        assert str(wrong) not in {row["path"] for row in candidates}
        claimed_row = next(row for row in candidates if row["path"] == str(claimed))
        assert claimed_row["eligible"] is False
        assert claimed_row["conflict_audio_id"] == claimed_audio.id

        conflict = self.mutate(
            "POST",
            f"/library-health/audio/{audio.id}/relink-preview",
            {"candidate_path": str(claimed)},
        )
        assert conflict.status_code == 409
        with Session(self.engine) as session:
            assert session.get(AudioItem, audio.id).file_path == str(old.resolve())

        preview = self.mutate(
            "POST",
            f"/library-health/audio/{audio.id}/relink-preview",
            {"candidate_path": str(candidate)},
        ).json()
        candidate.write_bytes(b"changed-after-preview")
        stale = self.mutate(
            "POST",
            f"/library-health/audio/{audio.id}/relink",
            {"candidate_path": str(candidate), **preview["confirmation"]},
        )
        assert stale.status_code == 409
        assert stale.json()["detail"]["code"] == "health.candidate_rejected"

        alternate_case = Path(str(candidate).swapcase())
        assert health_service._same_path(str(candidate), alternate_case) is (os.name == "nt")

    def test_relink_rolls_back_audio_and_fts_when_index_update_fails(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ):
        root = self.add_library_root(self.root_path / "rollback")
        old = self.root_path / "rollback" / "old.mp3"
        audio = self.add_audio(old, root_id=root.id)
        candidate = self.root_path / "rollback" / "new.mp3"
        candidate.write_bytes(old.read_bytes())
        fingerprint = calculate_sampled_file_hash(old)
        old.unlink()
        with Session(self.engine) as session:
            stored = session.get(AudioItem, audio.id)
            stored.file_hash = fingerprint
            stored.is_missing = True
            session.add(stored)
            session.commit()
            preview = health_service.preview_safe_relink(session, audio.id, str(candidate))

        def fail_index(*args, **kwargs):
            raise RuntimeError("injected FTS failure")

        monkeypatch.setattr(health_service, "rebuild_audio_search_index", fail_index)
        with Session(self.engine) as session:
            with pytest.raises(RuntimeError, match="injected FTS failure"):
                health_service.commit_safe_relink(
                    session,
                    audio.id,
                    str(candidate),
                    **preview["confirmation"],
                )
        with Session(self.engine) as session:
            stored = session.get(AudioItem, audio.id)
            assert stored.file_path == str(old.resolve())
            assert stored.is_missing is True
