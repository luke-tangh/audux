# Development and testing

[Development and contribution](README.md) · [English documentation home](../README.md) ·
[简体中文](../../zh-CN/contributing/development.md)

Audux has three layers: a React frontend, FastAPI backend, and Tauri host. Implement behavior in the
owning layer. Cross-layer work updates API schemas, shared TypeScript types, implementation, and
tests together.

## Repository layers

| Path | Responsibility |
| --- | --- |
| `frontend/src/` | React UI, hooks, shared types, and HTTP through `api.ts` |
| `frontend/tests/visual/` | Playwright workflows, accessibility, and screenshots |
| `backend/app/routes/` | Thin HTTP request/response layer |
| `backend/app/services/` | Reusable business logic and security boundaries |
| `backend/app/tasks.py` | Background-task lifecycle, cancellation, and recovery |
| `backend/tests/` | pytest unit and API integration tests |
| `frontend/src-tauri/` | Native commands, backend process lifecycle, and packaging |

See the repository [`AGENTS.md`](../../../AGENTS.md) for detailed ownership and coding constraints.

## Install dependencies

```bash
# Repository root: backend and test dependencies
uv sync --locked --group test

# Only when testing faster-whisper directly
uv sync --locked --extra asr --group test

# Frontend
cd frontend
npm ci
```

Set `UV_CACHE_DIR=/tmp/audux-uv-cache` for uv commands in a managed environment with a read-only
default cache. Do not install the larger ASR and PyInstaller environments for unrelated changes.

## Development servers

```bash
# Backend; defaults to 127.0.0.1:8765
AUDUX_ALLOWED_ORIGINS=http://127.0.0.1:5173 \
  uv run --locked python backend/run.py

# Frontend; defaults to 127.0.0.1:5173
cd frontend
npm run dev

# Tauri; requires native dependencies
cd frontend
npm run tauri:dev
```

`AUDUX_API_PORT` changes the standalone backend port. `AUDUX_ALLOWED_ORIGINS` is an exact,
comma-separated browser-development allowlist; do not replace it with every localhost port.
Frontend code must continue to obtain the actual URL through `src/api.ts` and Tauri's dynamic
backend URL, never a hardcoded `8765`.

## Backend validation

Run from `backend/`:

```bash
uv run --locked --group test python -m pytest tests

uv run --locked --group test python -m pytest tests \
  --cov=app --cov-branch \
  --cov-report=term-missing:skip-covered --cov-report=xml \
  --cov-fail-under=70
```

Test infrastructure establishes a process-wide temporary home before collection. API tests reuse
`tests.api_test_support` and must not bypass temporary database, media-root, cover, log, or token
isolation.

## Frontend validation

Run from `frontend/`:

```bash
npm test
npm run test:coverage
npm run typecheck
npm run build
```

Deterministic logic tests are colocated `*.test.ts(x)` Vitest files. Significant UI, responsive
layout, keyboard focus, or accessibility changes also require:

```bash
npm run test:visual
```

Visual tests mock the local API by default. Failure artifacts must not contain real tokens, API
keys, user media, or databases.

## Rust and Tauri validation

Run from `frontend/src-tauri/`:

```bash
cargo test --locked
cargo check --locked

# Requires cargo-deny; CI runs the same pinned gate
cd ../..
cargo deny --manifest-path frontend/src-tauri/Cargo.toml --locked check advisories
```

These commands are not a full Tauri package build. If WebKitGTK or another native dependency is
missing, report the skipped package build precisely and continue meaningful frontend and Rust
checks. Every `deny.toml` exception needs a [risk record](../reference/security-advisories.md),
review deadline, and tracking issue; never add an open-ended ignore to pass a gate.

## Validation by change type

| Change | Minimum validation |
| --- | --- |
| Backend | Focused pytest, then complete backend branch coverage |
| Frontend logic | Focused Vitest, `npm test`, typecheck, and build |
| Frontend styles | Typecheck and build; Playwright for significant layout |
| API contract | Backend tests plus frontend Vitest, typecheck, and build |
| Database, tasks, security, paths, or tokens | Focused regression plus complete backend coverage |
| Rust/Tauri | Focused Rust tests and `cargo check --locked` |
| Release/sidecar | Build the sidecar and Tauri bundle on the target OS |

Before committing, run `git diff --check`. Do not commit `frontend/dist/`,
`frontend/node_modules/`, `frontend/src-tauri/binaries/`, `frontend/src-tauri/target/`, or
PyInstaller `build/` and `dist/` output.
