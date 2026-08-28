import run


def test_api_port_environment_accepts_atomic_ephemeral_binding(monkeypatch):
    monkeypatch.setenv(run.API_PORT_ENV, "0")
    assert run._api_port_from_env() == 0

    class Listener:
        def __init__(self):
            self.calls = []

        def setsockopt(self, *args):
            self.calls.append(("setsockopt", args))

        def bind(self, address):
            self.calls.append(("bind", address))

        def listen(self, backlog):
            self.calls.append(("listen", backlog))

        def close(self):
            self.calls.append(("close",))

    fake_listener = Listener()
    monkeypatch.setattr(run.socket, "socket", lambda *_: fake_listener)
    listener = run._bind_api_listener(0)

    assert listener is fake_listener
    assert ("bind", ("127.0.0.1", 0)) in fake_listener.calls
    assert ("listen", 2048) in fake_listener.calls
    assert ("close",) not in fake_listener.calls


def test_api_port_file_is_published_atomically(monkeypatch, tmp_path):
    port_file = tmp_path / "runtime" / "backend.port"
    monkeypatch.setenv(run.API_PORT_FILE_ENV, str(port_file))

    assert run._publish_api_port(49152) == port_file
    assert port_file.read_text(encoding="utf-8") == "49152"
    assert not port_file.with_name(f".{port_file.name}.tmp").exists()
