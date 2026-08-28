import asyncio

import pytest
from sqlalchemy import event
from sqlmodel import Session, select

from app.models import AudioItem, LibraryRoot, ScanTask, Tag
from app import task_heartbeat
from app.models import AITask
from app.services import audio_service, library_service, tag_service
from app.worker_supervisor import run_supervised_loop, worker_state_snapshot
from tests.api_test_support import ApiIntegrationTest


class TestAtomicDerivedState(ApiIntegrationTest):
    @pytest.fixture(autouse=True)
    def setup_audio(self, api_test_context):
        self.library = self.root_path / "library"
        self.root = self.add_library_root(self.library)
        self.audio = self.add_audio(
            self.library / "reliability.mp3",
            root_id=self.root.id,
        )
        with Session(self.engine) as session:
            audio = session.get(AudioItem, self.audio.id)
            audio.title_user = "original"
            session.add(audio)
            session.commit()

    @staticmethod
    def _fail_index(*args, **kwargs):
        raise RuntimeError("injected FTS failure")

    def test_audio_update_rolls_back_when_fts_update_fails(self, monkeypatch):
        monkeypatch.setattr(audio_service, "rebuild_audio_search_index", self._fail_index)

        with pytest.raises(RuntimeError, match="injected FTS failure"):
            with Session(self.engine) as session:
                audio_service.update_audio_item(
                    session,
                    int(self.audio.id),
                    {"title_user": "not persisted"},
                )

        with Session(self.engine) as session:
            assert session.get(AudioItem, self.audio.id).title_user == "original"

    def test_tag_rename_rolls_back_when_fts_update_fails(self, monkeypatch):
        with Session(self.engine) as session:
            [tag] = tag_service.add_tags_to_audio(session, int(self.audio.id), ["before"])
            tag_id = int(tag.id)

        monkeypatch.setattr(tag_service, "rebuild_audio_search_index", self._fail_index)
        with pytest.raises(RuntimeError, match="injected FTS failure"):
            with Session(self.engine) as session:
                tag_service.update_tag(session, tag_id, "after")

        with Session(self.engine) as session:
            assert session.get(Tag, tag_id).name == "before"

    def test_tag_removal_rolls_back_when_fts_update_fails(self, monkeypatch):
        with Session(self.engine) as session:
            [tag] = tag_service.add_tags_to_audio(session, int(self.audio.id), ["kept"])
            tag_id = int(tag.id)

        monkeypatch.setattr(tag_service, "rebuild_audio_search_index", self._fail_index)
        with pytest.raises(RuntimeError, match="injected FTS failure"):
            with Session(self.engine) as session:
                tag_service.remove_audio_tag(session, int(self.audio.id), tag_id)

        with Session(self.engine) as session:
            assert session.get(Tag, tag_id) is not None
            assert session.get(AudioItem, self.audio.id) is not None

    def test_library_import_rolls_back_root_when_task_insert_fails(self):
        import_path = self.root_path / "atomic-import"
        import_path.mkdir()

        with Session(self.engine) as session:
            def fail_scan_task_flush(current_session, flush_context, instances):
                if any(isinstance(row, ScanTask) for row in current_session.new):
                    raise RuntimeError("injected scan task failure")

            event.listen(session, "before_flush", fail_scan_task_flush)
            with pytest.raises(RuntimeError, match="injected scan task failure"):
                library_service.create_library_import(session, str(import_path))

        with Session(self.engine) as session:
            assert session.exec(
                select(LibraryRoot).where(LibraryRoot.path == str(import_path.resolve()))
            ).first() is None


@pytest.mark.anyio
async def test_supervisor_recovers_after_iteration_failure():
    attempts = 0
    recovered = asyncio.Event()

    async def iteration() -> None:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise RuntimeError("transient claim failure")
        recovered.set()

    task = asyncio.create_task(
        run_supervised_loop(
            "test-recovery",
            iteration,
            poll_interval=0,
            failure_backoff=0,
        )
    )
    await asyncio.wait_for(recovered.wait(), timeout=1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    state = worker_state_snapshot()["test-recovery"]
    assert attempts >= 2
    assert state["running"] is False
    assert state["failure_count"] == 1
    assert state["consecutive_failures"] == 0
    assert state["last_error"] == "transient claim failure"


class TestTaskHeartbeat(ApiIntegrationTest):
    def test_touch_updates_running_task_and_stops_for_terminal_task(self, monkeypatch):
        monkeypatch.setattr(task_heartbeat.db, "engine", self.engine)
        library = self.root_path / "heartbeat-library"
        root = self.add_library_root(library)
        audio = self.add_audio(library / "heartbeat.mp3", root_id=root.id)
        with Session(self.engine) as session:
            task = AITask(
                audio_id=int(audio.id),
                task_type="test",
                status="running",
                updated_at="2000-01-01T00:00:00Z",
            )
            session.add(task)
            session.commit()
            session.refresh(task)
            task_id = int(task.id)

        assert task_heartbeat.touch_task_heartbeat(task_id) is True
        with Session(self.engine) as session:
            task = session.get(AITask, task_id)
            assert task.updated_at != "2000-01-01T00:00:00Z"
            task.status = "done"
            session.add(task)
            session.commit()

        assert task_heartbeat.touch_task_heartbeat(task_id) is False

    @pytest.mark.anyio
    async def test_run_with_heartbeat_cleans_up_on_success_and_failure(self, monkeypatch):
        stopped = asyncio.Event()

        async def heartbeat_loop(task_id, stop_event):
            assert task_id == 17
            try:
                await stop_event.wait()
            finally:
                stopped.set()

        monkeypatch.setattr(task_heartbeat, "task_heartbeat_loop", heartbeat_loop)

        assert await task_heartbeat.run_with_task_heartbeat(17, asyncio.sleep(0, result="ok")) == "ok"
        await asyncio.wait_for(stopped.wait(), timeout=1)

        stopped.clear()

        async def fail():
            await asyncio.sleep(0)
            raise RuntimeError("operation failed")

        with pytest.raises(RuntimeError, match="operation failed"):
            await task_heartbeat.run_with_task_heartbeat(17, fail())
        await asyncio.wait_for(stopped.wait(), timeout=1)
