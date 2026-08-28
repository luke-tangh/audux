# Audux

English | [简体中文](docs/zh-CN/README.md)

Audux is a local-first desktop application for building a private audio knowledge base. It brings
local audio scanning, playback and organization, transcripts, full-text search, and controlled AI
workflows into one library without modifying the original audio files.

## Highlights

- **Local library:** scan MP3, M4A, FLAC, WAV, and OGG files; read metadata and cover art; perform
  incremental scans; diagnose missing files; and safely relink moved media.
- **Playback and organization:** queues, playback speed, position history, tags, manual and smart
  playlists, saved views, explicit multi-selection, and batch organization.
- **Trustworthy transcripts:** a local Whisper companion or external ASR, immutable revisions,
  segment evidence anchors, chapters, quality issues, segment-level corrections, and TXT/JSON/SRT
  exports.
- **Search and agents:** SQLite FTS5, playable citations, backend-enforced scopes, read-only Q&A,
  and low-risk writes gated by before/after previews and one-time approval.
- **Organization workbench:** recoverable eight-stage runs for transcription, validation,
  evidence-backed proposals, human approval, transactional writes, and revalidation.
- **Local-first integrations:** OpenAI-compatible LLMs, a read-only MCP stdio server, portable
  archives, redacted diagnostics, and Tauri or browser-lite desktop distributions.

See the [product roadmap](docs/en/project/roadmap.md),
[v1 compatibility contract](docs/en/reference/compatibility.md), and
[v1.0.0 release notes](docs/en/releases/v1.0.0.md) for the exact release boundaries.

## Quick start for development

Development requires Python 3.12, [uv](https://docs.astral.sh/uv/), and a supported Node.js
version: 22.22.2+ in the 22.x line, 24.15.0+ in the 24.x line, or 26+.

```bash
uv sync --locked --group test

cd frontend
npm ci
```

Start the backend and frontend in separate terminals from the repository root:

```bash
# Terminal 1
uv run --locked python backend/run.py

# Terminal 2
cd frontend
npm run dev
```

Open `http://127.0.0.1:5173`. The standalone development backend defaults to
`127.0.0.1:8765`; Tauri and browser-lite select a backend port dynamically, so frontend business
logic must not depend on the default port.

To start Tauri development mode:

```bash
cd frontend
npm run tauri:dev
```

## Documentation

| Document | Purpose |
| --- | --- |
| [English documentation](docs/en/README.md) | Task-oriented documentation index |
| [Getting started](docs/en/user-guide/getting-started.md) | Distribution modes, first launch, and basic workflow |
| [AI, ASR, and MCP configuration](docs/en/user-guide/configuration.md) | Whisper, external ASR, LLMs, long-audio chunking, and MCP |
| [Data, backup, and security](docs/en/user-guide/data-and-security.md) | Data locations, backup and restore, archives, API, and privacy |
| [v1 compatibility contract](docs/en/reference/compatibility.md) | Supported platforms, stable formats, providers, deprecation, and rollback |
| [Development and testing](docs/en/contributing/development.md) | Architecture, dependencies, tests, and change validation |
| [Build and release validation](docs/en/contributing/building.md) | Sidecars, browser-lite, Tauri, signing, and release builds |
| [Troubleshooting](docs/en/user-guide/troubleshooting.md) | Tokens, backend startup, providers, indexes, and task recovery |
| [Product roadmap](docs/en/project/roadmap.md) | Completed milestones, v1 boundaries, and candidate enhancements |
| [v1 release checklist](docs/en/contributing/release-checklist.md) | Three-platform release and long-running validation |

## Repository layout

```text
.
├── backend/                 # FastAPI, SQLite, scanning, tasks, ASR, and agents
├── frontend/                # React 19, TypeScript, Vite, and the Tauri host
│   ├── src/
│   ├── src-tauri/
│   └── tests/visual/
├── docs/
│   ├── en/                 # English documentation
│   └── zh-CN/              # Simplified Chinese documentation
├── pyproject.toml
├── uv.lock
└── VERSION
```

## Data and security principles

- Runtime data defaults to `~/.audux/`; automated tests must never use that directory.
- The backend binds only to `127.0.0.1`. Sensitive API routes are protected by a random local
  token, origin checks, and a client header for unsafe methods.
- Remote ASR receives audio; remote LLMs receive relevant metadata and transcript text. Both
  require explicit opt-in.
- v1.0 freezes database schema v6. An unsupported schema is rejected without modifying the
  database unless an explicit migration exists.
- Agents do not receive arbitrary file, network, or shell access. Persistent changes require a
  frozen scope, preview, and approval.

Read [Data, backup, and security](docs/en/user-guide/data-and-security.md) before integrating with
the local API or a remote provider.
