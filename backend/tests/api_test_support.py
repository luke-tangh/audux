import asyncio
import tempfile
from pathlib import Path
from unittest.mock import patch

import httpx
from sqlalchemy import event, text
from sqlmodel import SQLModel, Session, create_engine


# Importing app.main initializes the normal data directories and logger. Resolve
# those module-level paths under a process-lifetime temporary directory so API
# tests never touch the user's ~/.local_audio_library data.
TEST_RUNTIME_DIR = tempfile.TemporaryDirectory(prefix="local-audio-library-tests-")

with patch("pathlib.Path.home", return_value=Path(TEST_RUNTIME_DIR.name)):
    from app import local_security, tasks
    from app.db import get_session
    from app.main import app
    from app.models import AudioItem, LibraryRoot, Setting


class AsgiTestClient:
    def request(self, method: str, url: str, **kwargs) -> httpx.Response:
        async def send() -> httpx.Response:
            transport = httpx.ASGITransport(app=app)

            async with httpx.AsyncClient(
                transport=transport,
                base_url="http://testserver",
            ) as client:
                return await client.request(method, url, **kwargs)

        return asyncio.run(send())

    def get(self, url: str, **kwargs) -> httpx.Response:
        return self.request("GET", url, **kwargs)

    def post(self, url: str, **kwargs) -> httpx.Response:
        return self.request("POST", url, **kwargs)

    def put(self, url: str, **kwargs) -> httpx.Response:
        return self.request("PUT", url, **kwargs)

    def close(self):
        return None


async def run_sync_endpoint_inline(function, *args, **kwargs):
    return function(*args, **kwargs)


class ApiIntegrationTestCase:
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="local-audio-api-test-")
        self.root_path = Path(self.tmp.name)
        self.db_path = self.root_path / "test.sqlite"
        self.engine = create_engine(
            f"sqlite:///{self.db_path}",
            connect_args={
                "check_same_thread": False,
                "timeout": 30,
            },
        )

        @event.listens_for(self.engine, "connect")
        def set_sqlite_pragma(dbapi_connection, connection_record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA busy_timeout=30000")
            cursor.close()

        SQLModel.metadata.create_all(self.engine)

        with self.engine.begin() as connection:
            connection.execute(
                text(
                    """
                    CREATE VIRTUAL TABLE search_index USING fts5(
                        audio_id UNINDEXED,
                        title,
                        author,
                        description,
                        tags,
                        transcript
                    )
                    """
                )
            )
            connection.execute(
                text(
                    """
                    CREATE UNIQUE INDEX ux_ai_tasks_active
                    ON ai_tasks(audio_id, task_type)
                    WHERE status IN ('pending', 'running', 'cancel_requested')
                    """
                )
            )
            connection.execute(
                text(
                    """
                    CREATE UNIQUE INDEX ux_scan_tasks_active_root
                    ON scan_tasks(root_id)
                    WHERE status IN ('pending', 'running', 'cancel_requested')
                    """
                )
            )

        async def get_test_session():
            with Session(self.engine) as session:
                yield session

        app.dependency_overrides[get_session] = get_test_session

        self.token_file_patch = patch.object(
            local_security,
            "LOCAL_TOKEN_FILE",
            self.root_path / "local_api_token",
        )
        self.token_file_patch.start()

        self.task_engine_patch = patch.object(tasks, "engine", self.engine)
        self.task_engine_patch.start()

        # The test transport already owns an event loop. Running synchronous
        # endpoints inline avoids an extra worker thread without changing route,
        # middleware, dependency or transaction behavior under test.
        self.threadpool_patch = patch(
            "fastapi.routing.run_in_threadpool",
            new=run_sync_endpoint_inline,
        )
        self.threadpool_patch.start()

        self.client = AsgiTestClient()
        token_response = self.client.get(
            "/auth/token",
            headers={
                local_security.LOCAL_CLIENT_HEADER_NAME:
                    local_security.LOCAL_CLIENT_HEADER_VALUE,
            },
        )
        if token_response.status_code != 200:
            raise AssertionError(token_response.text)

        self.token = token_response.json()["token"]

    def tearDown(self):
        self.client.close()
        app.dependency_overrides.pop(get_session, None)
        self.threadpool_patch.stop()
        self.task_engine_patch.stop()
        self.token_file_patch.stop()
        self.engine.dispose()
        self.tmp.cleanup()

    def auth_headers(
        self,
        *,
        include_client: bool = False,
        origin: str | None = None,
    ) -> dict[str, str]:
        headers = {
            local_security.LOCAL_TOKEN_HEADER_NAME: self.token,
        }

        if include_client:
            headers[local_security.LOCAL_CLIENT_HEADER_NAME] = (
                local_security.LOCAL_CLIENT_HEADER_VALUE
            )

        if origin:
            headers["Origin"] = origin

        return headers

    def add_library_root(self, path: Path, *, enabled: bool = True) -> LibraryRoot:
        path.mkdir(parents=True, exist_ok=True)

        with Session(self.engine) as session:
            root = LibraryRoot(
                path=str(path.resolve()),
                is_enabled=enabled,
            )
            session.add(root)
            session.commit()
            session.refresh(root)
            return root

    def add_audio(
        self,
        path: Path,
        *,
        root_id: int | None,
        transcript_status: str = "none",
        ai_status: str = "none",
    ) -> AudioItem:
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists():
            path.write_bytes(b"test-audio-content")

        with Session(self.engine) as session:
            audio = AudioItem(
                file_path=str(path.resolve()),
                file_name=path.name,
                file_ext=path.suffix.lower(),
                file_size=path.stat().st_size,
                library_root_id=root_id,
                transcript_status=transcript_status,
                ai_status=ai_status,
            )
            session.add(audio)
            session.commit()
            session.refresh(audio)
            return audio

    def add_setting(self, key: str, value: str) -> Setting:
        with Session(self.engine) as session:
            setting = Setting(key=key, value=value)
            session.add(setting)
            session.commit()
            session.refresh(setting)
            return setting

    def put_setting(self, key: str, value: str):
        return self.client.put(
            "/settings",
            headers=self.auth_headers(include_client=True),
            json={
                "key": key,
                "value": value,
            },
        )
