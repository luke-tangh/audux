# Install and get started

[User guide](README.md) · [English documentation home](../README.md) ·
[简体中文](../../zh-CN/user-guide/getting-started.md)

Audux can run in three forms: browser development mode from source, the Tauri desktop
application, and packaged browser-lite. Regular users can download v1.0 installers for Linux,
Windows, or macOS from GitHub Releases without installing Python, Node.js, or Rust.

The desktop application checks for Tauri-updater-signed updates under Settings > Updates.
Browser-lite must be downloaded and replaced manually. Windows packages are not currently signed
with Authenticode, and macOS packages are not signed with Apple Developer ID or notarized, so the
operating system may show an unknown-publisher warning.

## Development requirements

- Python 3.12; the declared range is `>=3.12,<3.13`
- [uv](https://docs.astral.sh/uv/)
- Node.js 22.22.2+ in the 22.x line, 24.15.0+ in the 24.x line, or 26+
- Rust stable and platform-native dependencies for Tauri

Do not invoke Windows `node.exe`, `npm`, or `cargo.exe` from WSL/Linux, and do not reuse a
Windows-generated `node_modules` directory on Linux.

## Install dependencies

From the repository root, install the backend and test dependencies:

```bash
uv sync --locked --group test
```

To run faster-whisper directly from a source checkout:

```bash
uv sync --locked --extra asr
```

Install frontend dependencies with platform-native Node.js:

```bash
cd frontend
npm ci
```

If the default uv cache is read-only in a managed environment:

```bash
UV_CACHE_DIR=/tmp/audux-uv-cache uv sync --locked --group test
```

## Browser development mode

Start FastAPI from the repository root:

```bash
uv run --locked python backend/run.py
```

The default health endpoint is `http://127.0.0.1:8765/health`. In another terminal, start Vite:

```bash
cd frontend
npm run dev
```

Open `http://127.0.0.1:5173`. Port `8765` is only the standalone development default. Tauri
selects a free port and gives the actual backend URL to the frontend through a native command.

## Tauri development mode

After installing the platform-native dependencies:

```bash
cd frontend
npm run tauri:dev
```

Tauri starts Vite and the Python backend. Development mode finds Python in this order:

1. the interpreter named by `AUDUX_PYTHON`;
2. the active `VIRTUAL_ENV`;
3. the repository `.venv`;
4. `python` on Windows or `python3` on Linux and macOS.

See [Build and release validation](../contributing/building.md) for Linux dependencies and full
packaging instructions.

## First use

1. Select a local audio directory in the onboarding wizard.
2. Audux creates the library and scans in the background. Browse and play as soon as the first
   results appear.
3. Install the optional Whisper companion or configure external ASR/LLM providers in Settings.
4. Organize the library with tags, playlists, saved views, and batch actions.
5. Create a database snapshot under maintenance settings. Snapshots do not contain original audio.

Audux reads original media in place. Removing a library root, playlist, or the application must not
delete or modify the original files.

## Next steps

- [AI, ASR, and MCP configuration](configuration.md)
- [Data, backup, and security](data-and-security.md)
- [Troubleshooting](troubleshooting.md)
