from pathlib import Path

import pytest
from sqlmodel import Session, select

from tests.api_test_support import ApiIntegrationTest
from app import scanner
from app.models import AudioItem, LibraryRoot, ScanTask


class TestScannerFullFlow(ApiIntegrationTest):
    @pytest.fixture(autouse=True)
    def setup_library(self, api_test_context):
        self.library = self.root_path / "library"
        self.root = self.add_library_root(self.library)

    def scan(self) -> dict:
        with Session(self.engine) as session:
            return scanner.scan_library_root(session, self.root.id)

    def test_scan_imports_updates_marks_missing_and_restores_files(self):
        first_path = self.library / "first.mp3"
        second_path = self.library / "nested" / "second.wav"
        first_path.write_bytes(b"first-audio")
        second_path.parent.mkdir()
        second_path.write_bytes(b"second-audio")
        (self.library / "ignored.txt").write_text("not audio", encoding="utf-8")

        assert self.scan() == {"imported": 2, "updated": 0, "missing": 0}
        assert self.scan() == {"imported": 0, "updated": 0, "missing": 0}

        first_path.write_bytes(b"first-audio-with-a-new-size")
        second_path.unlink()

        assert self.scan() == {"imported": 0, "updated": 1, "missing": 1}

        with Session(self.engine) as session:
            rows = session.exec(select(AudioItem).order_by(AudioItem.file_name)).all()
            assert len(rows) == 2
            assert rows[0].file_name == "first.mp3"
            assert rows[0].file_size == first_path.stat().st_size
            assert rows[0].is_missing is False
            assert rows[1].file_name == "second.wav"
            assert rows[1].is_missing is True

        second_path.write_bytes(b"second-audio")
        restored = self.scan()
        assert restored["imported"] == 0
        assert restored["updated"] == 1
        assert restored["missing"] == 0

        with Session(self.engine) as session:
            second = session.exec(
                select(AudioItem).where(AudioItem.file_name == "second.wav")
            ).one()
            assert second.is_missing is False

    def test_scan_detects_a_move_and_preserves_the_existing_record(self):
        original_path = self.library / "original.mp3"
        original_path.write_bytes(b"same-content-after-move")
        assert self.scan()["imported"] == 1

        with Session(self.engine) as session:
            item = session.exec(select(AudioItem)).one()
            item_id = item.id
            item.title_user = "用户标题"
            item.play_count = 4
            session.add(item)
            session.commit()

        moved_path = self.library / "moved" / "renamed.mp3"
        moved_path.parent.mkdir()
        original_path.rename(moved_path)

        assert self.scan() == {"imported": 0, "updated": 1, "missing": 0}

        with Session(self.engine) as session:
            rows = session.exec(select(AudioItem)).all()
            assert len(rows) == 1
            assert rows[0].id == item_id
            assert rows[0].file_path == str(moved_path.resolve())
            assert rows[0].title_user == "用户标题"
            assert rows[0].play_count == 4
            assert rows[0].is_missing is False

    def test_scan_rejects_file_symlinks_that_escape_the_library_root(self):
        outside = self.root_path / "outside.mp3"
        outside.write_bytes(b"outside-audio")
        escaped = self.library / "escaped.mp3"
        escaped.symlink_to(outside)

        assert self.scan() == {"imported": 0, "updated": 0, "missing": 0}

        with Session(self.engine) as session:
            assert session.exec(select(AudioItem)).all() == []

        assert outside.read_bytes() == b"outside-audio"

    def test_precanceled_scan_finishes_without_enumerating_files(self, monkeypatch):
        (self.library / "pending.mp3").write_bytes(b"audio")
        with Session(self.engine) as session:
            task = ScanTask(root_id=self.root.id, status="cancel_requested")
            session.add(task)
            session.commit()
            session.refresh(task)
            task_id = task.id

        enumerated = False

        def unexpected_enumeration(root_path: Path):
            nonlocal enumerated
            enumerated = True
            return iter(())

        monkeypatch.setattr(scanner, "_iter_audio_candidates", unexpected_enumeration)

        with Session(self.engine) as session:
            result = scanner.scan_library_root(session, self.root.id, task_id)

        assert result == {"imported": 0, "updated": 0, "missing": 0}
        assert enumerated is False
        with Session(self.engine) as session:
            task = session.get(ScanTask, task_id)
            assert task.status == "canceled"
            assert task.finished_at is not None

    def test_interrupted_scan_recovery_distinguishes_cancel_requests(self, monkeypatch):
        other_paths = [self.root_path / "other-a", self.root_path / "other-b"]
        for path in other_paths:
            path.mkdir()

        with Session(self.engine) as session:
            roots = [LibraryRoot(path=str(path.resolve())) for path in other_paths]
            session.add_all(roots)
            session.commit()
            for root in roots:
                session.refresh(root)

            tasks = [
                ScanTask(root_id=self.root.id, status="pending"),
                ScanTask(root_id=roots[0].id, status="running"),
                ScanTask(root_id=roots[1].id, status="cancel_requested"),
            ]
            session.add_all(tasks)
            session.commit()
            task_ids = [task.id for task in tasks]

        monkeypatch.setattr(scanner, "engine", self.engine)
        assert scanner.recover_interrupted_scan_tasks() == 3

        with Session(self.engine) as session:
            recovered = [session.get(ScanTask, task_id) for task_id in task_ids]
            assert [task.status for task in recovered] == ["failed", "failed", "canceled"]
            assert recovered[0].error_code == "scan.interrupted"
            assert recovered[1].error_message == "Scan interrupted by backend restart"
            assert recovered[2].error_message is None
            assert all(task.finished_at is not None for task in recovered)
