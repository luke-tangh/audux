# AGENTS.md

## Scope

These instructions apply to the entire repository.

Audux is a local-first desktop application with three layers:

- `frontend/`: React 19, TypeScript, Vite, and the browser-facing API client.
- `backend/`: FastAPI, SQLModel/SQLite, audio scanning, transcription, and AI tasks.
- `frontend/src-tauri/`: Tauri 2 host, native dialogs, backend process lifecycle, and packaging.

Keep changes within the layer that owns the behavior. When a feature crosses layers,
update the API schema/types, implementation, and verification together.

## Repository map

- `frontend/src/App.tsx`: top-level UI composition.
- `frontend/src/api.ts`: HTTP client, dynamic backend URL, local-token handling.
- `frontend/src/tauri.ts`: Tauri command wrappers.
- `frontend/src/components/`: UI and feature components.
- `frontend/src/hooks/`: application and library state/controllers.
- `frontend/src/styles/`: global tokens, layout, and component CSS.
- `frontend/src/**/*.test.ts(x)`: Vitest unit and logic tests colocated with source.
- `frontend/vitest.config.ts`: jsdom and V8 coverage configuration.
- `frontend/tests/visual/`: Playwright behavior, accessibility, and screenshot tests.
- `backend/app/main.py`: FastAPI app, middleware, startup, and security guard.
- `backend/app/api_routes.py`: top-level API router assembly.
- `backend/app/routes/`: HTTP request/response layer.
- `backend/app/services/`: feature/business logic.
- `backend/app/models.py` and `schemas.py`: persistence and API models.
- `backend/app/db.py`: SQLite setup, current schema initialization, and FTS.
- `backend/app/tasks.py`: background task lifecycle.
- `backend/tests/`: pytest unit and API integration tests.
- `backend/build_backend.py`: PyInstaller sidecar builder.
- `frontend/src-tauri/src/lib.rs`: Tauri commands and backend process management.
- `frontend/src-tauri/build.rs`: target-specific sidecar validation/placeholder.
- `frontend/src-tauri/tauri.conf.json`: Tauri build, CSP, window, and bundle config.

## Environment setup

Use platform-native tools. In WSL/Linux, do not invoke Windows `node.exe`, `npm`,
`cargo.exe`, or reuse a Windows-generated `node_modules`.

Frontend:

```bash
cd frontend
npm ci
```

Backend:

```bash
uv sync --locked
uv sync --locked --group test
```

In sandboxed or managed environments, the default uv cache under `~/.cache/uv`
may be read-only and fail with `Could not acquire lock` or `Read-only file
system`. Set `UV_CACHE_DIR=/tmp/audux-uv-cache` for `uv sync` and
`uv run` commands in that environment. The `/tmp` cache is disposable; this
cache error is not a reason to skip tests.

Use `uv sync --locked --extra asr` when ASR/faster-whisper behavior must be
tested. Use `uv sync --locked --extra asr --group build` for a full release
sidecar. These environments are substantially heavier than the base dependencies.

Linux Tauri development also requires WebKitGTK 4.1, AppIndicator, librsvg,
patchelf, and a native Rust toolchain. Install `fonts-noto-cjk` when validating
Chinese UI text on a minimal Linux installation.

## Common commands

Run commands from the directory shown.

Backend development and tests:

```bash
cd backend
uv run --locked python run.py
uv run --locked --group test python -m pytest tests
uv run --locked --group test python -m pytest tests \
  --cov=app --cov-branch \
  --cov-report=term-missing:skip-covered --cov-report=xml \
  --cov-fail-under=70
```

Frontend development and verification:

```bash
cd frontend
npm run dev
npm test
npm run test:coverage
npm run typecheck
npm run build
```

Tauri:

```bash
cd frontend
npm run tauri:dev
npm run tauri:build
```

Visual tests:

```bash
cd frontend
npm run test:visual
```

Rust-only check:

```bash
cd frontend/src-tauri
cargo check --locked
```

`npm run tauri:build` automatically builds the current platform's backend
sidecar before compiling the frontend and Tauri bundle. To build only the
sidecar:

```bash
cd frontend
npm run build:backend
```

For a lightweight sidecar without ASR:

```bash
AUDUX_BUILD_WITH_ASR=0 npm run build:backend
```

## Architecture and behavior constraints

### Pre-v1.0 compatibility

- The product has not been released. Do not add backward-compatibility code
  before v1.0. Remove this subsection after v1.0 is released.

### Local API and security

- Keep the backend bound to `127.0.0.1`.
- Do not weaken origin checks, CSP, token checks, or unsafe-method client-header
  checks to work around a development problem.
- All non-exempt API requests require the local API token. Mutating requests
  also require `X-Audux-Client: audux`.
- Media, cover, and download URLs may use the access token query parameter
  because those browser elements cannot attach custom headers.
- `AUDUX_ALLOW_ALL_CORS=1` is development-only and must not become
  a production default.
- Never log, commit, expose, or place real LLM API keys or the local API token in
  fixtures, screenshots, or error messages.

### Backend port and process lifecycle

- Do not hardcode port `8765` in new frontend behavior.
- Tauri selects an available backend port and exposes it through the
  `backend_base_url` command; frontend requests must go through `src/api.ts`.
- Debug Tauri runs `backend/run.py` with a platform-appropriate Python.
- Release Tauri runs the target-specific PyInstaller sidecar from
  `src-tauri/binaries`.
- Preserve clean backend shutdown when changing Tauri window/process behavior.

### Database and user data

- Runtime data lives under `~/.audux/`.
- Treat the database, covers, logs, exports, and API token as user data. Do not
  delete or reset them during tests or schema changes.
- Before v1.0, update the current schema directly and increment its schema marker.
  Do not add migrations or automatically transform databases from earlier builds;
  reject schema mismatches without modifying the database.
- Preserve SQLite foreign keys, WAL mode, busy timeout, and FTS index behavior.

### Frontend

- Keep shared API payload shapes in `frontend/src/types.ts`.
- Centralize HTTP/auth/error handling in `frontend/src/api.ts`; components
  should not implement parallel fetch/token logic.
- Reuse components from `frontend/src/components/ui/` before adding a new
  one-off control.
- Keep Material Design color, typography, shape, and state values in
  `frontend/src/styles/tokens.css`.
- Put component-specific CSS in the matching file under
  `frontend/src/styles/components/`.
- Preserve the CJK-capable font fallbacks in `frontend/src/styles/base.css`.
- Maintain keyboard focus states, labels, and disabled/loading behavior when
  changing controls.

### Backend

- Keep route handlers thin. Put reusable feature logic in `backend/app/services/`.
- Use dependency-provided SQLModel sessions and explicit transactions where
  related writes must succeed or fail together.
- Validate filesystem access against configured library roots; do not accept
  arbitrary client-provided local paths.
- Keep long-running scan, transcription, and AI work out of request handlers.
- Preserve cancellation and interrupted-task recovery semantics.

### Tests

- Backend tests must use temporary databases, media roots, covers, logs, and
  token files. Never point automated tests at `~/.audux/`.
- `backend/tests/conftest.py` establishes a process-wide temporary home before
  test collection. Do not bypass this isolation when creating alternate test
  entry points; API tests should also use `tests.api_test_support` for their
  temporary database, token, and dependency overrides.
- Backend coverage uses branch coverage over `backend/app`. CI enforces a 70%
  minimum; do not lower the threshold to accommodate untested changes.
- Keep frontend Vitest tests colocated as `*.test.ts` or `*.test.tsx`. Prefer
  Vitest for API/auth, pure helpers, hooks, storage, and deterministic component
  behavior.
- Frontend CI runs V8 coverage with minimum global thresholds of 10% statements,
  8% branches, 10% functions, and 10% lines. Treat these as a ratcheting floor;
  review coverage in changed modules rather than optimizing only the global
  number.
- Use Playwright under `frontend/tests/visual/` for browser workflows, keyboard
  and focus behavior, responsive layout, and screenshots. Mock local API calls
  unless the test is explicitly designed as a real-backend integration test.
- Do not place real API keys, local API tokens, user media, or user database
  copies in fixtures, snapshots, coverage output, or failure artifacts.

### Tauri and packaging

- Keep platform-specific behavior behind Rust `cfg` checks or explicit target
  detection.
- Tauri `externalBin` filenames must match
  `audux-backend-<target-triple>[.exe]`.
- Never ship the debug sidecar placeholder in a release bundle.
- Do not commit files from `frontend/src-tauri/binaries/`,
  `frontend/src-tauri/target/`, `frontend/dist/`, `frontend/node_modules/`,
  or PyInstaller `build/` and `dist/` directories.
- Build native sidecars on their target OS. Do not copy a Windows PyInstaller
  executable into a Linux or macOS bundle.

## Coding conventions

- Follow the style of the surrounding file; the repository has no global
  formatter/linter configuration.
- TypeScript uses ESM, React function components, and semicolons.
- Avoid `any` in new TypeScript code when an API or state shape is known.
- Python uses type hints where they improve public/service boundaries and keeps
  imports package-relative inside `backend/app`.
- Rust should remain `cargo fmt` compatible and avoid panics in runtime process
  management; build-time configuration errors may fail clearly.
- Keep user-facing UI text consistent with the existing Chinese interface.
- Comments should explain invariants or non-obvious constraints, not restate
  code.

## Verification expectations

Run the smallest relevant checks first, then broaden for cross-layer changes.

- Backend-only change: relevant unit test(s), then the full backend pytest suite
  with branch coverage. The result must satisfy the 70% CI threshold.
- Frontend logic change: relevant Vitest test(s), then `npm test`,
  `npm run typecheck`, and `npm run build`.
- Frontend style-only change: `npm run typecheck` and `npm run build`.
- Frontend coverage work or new testable logic: also run
  `npm run test:coverage` and review the changed modules, not only the global
  percentage.
- Significant UI/layout change: also run `npm run test:visual`.
- Rust/Tauri change: relevant `cargo test --locked` tests plus
  `cargo check --locked`.
- API contract change: backend tests plus frontend Vitest, typecheck, and build.
- Database, task-state, security, path-validation, or token change: add or update
  focused regression tests.
- Release/sidecar change: build the sidecar and run `npm run tauri:build` on the
  target OS when dependencies are available.

If an environment lacks a required native dependency, report the exact skipped
check and still run all checks that remain meaningful. Do not claim a full Tauri
build passed when only the frontend or `cargo check` was run.

## Change hygiene

- Inspect `git status` before editing and preserve unrelated user changes.
- Do not edit generated artifacts or dependency lockfiles unless the task
  requires a dependency change.
- Keep patches focused; avoid opportunistic refactors in security, schema handling,
  task recovery, or packaging code.
- Update README/CI/build scripts when a workflow or platform prerequisite
  changes.
- Before handoff, run `git diff --check` and summarize modified files, completed
  checks, and any remaining platform-specific validation.
