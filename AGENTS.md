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

- `frontend/src/`: React UI, hooks, API client, Tauri wrappers, colocated Vitest
  tests, and styles. Browser workflow and screenshot tests are in
  `frontend/tests/visual/`.
- `backend/app/`: FastAPI routes, services, models, database, scanning,
  transcription, AI, and task lifecycle. Tests are in `backend/tests/`.
- `frontend/src-tauri/`: Rust host, native commands, backend process lifecycle,
  target sidecars, CSP, and packaging configuration.
- `docs/`: Language entry point and locale-specific user, reference,
  contributing, project, release, and history documentation. Simplified Chinese
  documentation is in `docs/zh-CN/`; specialized README files stay colocated
  with the scripts or fixtures they explain.
- `.github/workflows/`: CI, quality gates, release, and visual-baseline jobs.

## Setup and common commands

Use platform-native tools. In WSL/Linux, do not invoke Windows executables or
reuse Windows-generated `node_modules`.

```bash
# From frontend/
npm ci
npm test
npm run test:coverage
npm run typecheck
npm run build
npm run test:visual

# From backend/
uv sync --locked --group test
uv run --locked --group test python -m pytest tests
uv run --locked --group test python -m pytest tests \
  --cov=app --cov-branch --cov-report=term-missing:skip-covered \
  --cov-report=xml --cov-fail-under=70

# From frontend/src-tauri/
cargo check --locked
```

In managed environments, set `UV_CACHE_DIR=/tmp/audux-uv-cache` for `uv sync`
and `uv run` if the default cache is read-only; do not skip tests for that
reason. ASR validation uses `uv sync --locked --extra asr`; companion builds add
`--group build`. Embedded-ASR sidecars require `AUDUX_BUILD_WITH_ASR=1`.

Run Tauri from `frontend` with `npm run tauri:dev` or `npm run tauri:build`.
The build creates the platform sidecar automatically; use `npm run build:backend`
for only the sidecar and prefix it with `AUDUX_BUILD_WITH_ASR=0` for the
lightweight variant. Linux Tauri needs WebKitGTK 4.1, AppIndicator, librsvg,
patchelf, and Rust; minimal systems also need `fonts-noto-cjk` for Chinese UI.

## Critical constraints

### Compatibility and user data

- Schema v6, archive format v1, and documented Provider/MCP contracts are public
  v1.0 boundaries. Contract changes need a compatibility plan, deprecation
  notice, and regression coverage.
- Runtime data under `~/.audux/` is user data. Tests and migrations must never
  delete, reset, or target it.
- Never update a stable schema in place. Require a forward migration, verified
  backup, rollback on failure, and focused tests; otherwise reject the mismatch
  without modifying the database.
- Preserve SQLite foreign keys, WAL, busy timeout, and FTS behavior.

### Local API and process security

- Keep the backend on `127.0.0.1`. Do not weaken origin, CSP, token, CORS, or
  unsafe-method client-header checks. `AUDUX_ALLOW_ALL_CORS=1` is development
  only.
- Non-exempt requests require the local token; mutations also require
  `X-Audux-Client: audux`. Query tokens are allowed only for browser media,
  cover, and download elements that cannot attach headers.
- Never expose API keys or local tokens in logs, fixtures, screenshots, errors,
  or commits.
- Do not hardcode port `8765`. Tauri supplies `backend_base_url`; frontend HTTP
  goes through `frontend/src/api.ts`. Preserve clean backend shutdown.

### Layer ownership

- Frontend payload types belong in `types.ts`; HTTP/auth/error handling belongs
  in `api.ts`. Reuse shared UI controls and style tokens, preserve CJK fonts,
  focus states, labels, and loading/disabled behavior.
- Keep backend routes thin and reusable logic in `services/`. Validate paths
  against library roots, use explicit transactions for related writes, and keep
  long-running work out of request handlers. Preserve cancellation and recovery.
- Keep platform behavior behind Rust `cfg` or explicit target detection.
  `externalBin` must be `audux-backend-<target-triple>[.exe]`; build sidecars on
  their target OS and never ship the debug placeholder.
- Do not commit generated binaries, `node_modules`, frontend/Tauri build output,
  or PyInstaller `build/` and `dist/` directories.
- Keep localized project documentation under `docs/<locale>/` with the same
  reader-oriented sections. When public compatibility, security, Provider/MCP,
  build, or release facts change, update every published language in the same
  change. Keep `docs/README.md` as the language entry point.

### Test isolation and coverage

- Backend tests use the temporary home established by
  `backend/tests/conftest.py`; API tests use `tests.api_test_support`. Never use
  real user data or token files.
- Backend branch coverage must remain at least 70%. Frontend V8 floors are 40%
  statements, 41% branches, 39% functions, and 41% lines; review changed-module
  coverage rather than only global totals.
- Keep deterministic frontend tests colocated as `*.test.ts(x)`. Use Playwright
  for workflows, accessibility, focus, responsive layout, and screenshots, with
  mocked local APIs unless explicitly testing a real backend.
- Never put secrets, user media, or user database copies in test artifacts.

## Coding conventions

- Follow surrounding style. TypeScript uses ESM, React functions, semicolons,
  and known types instead of `any`.
- Use useful Python type hints and package-relative imports in `backend/app`.
  Keep Rust `cargo fmt` compatible and avoid runtime process-management panics.
- Keep UI text consistent with the Chinese interface. Comments should explain
  invariants, not restate code.

## Repository protection and contribution workflow

Unless the user explicitly requests local-only work or an earlier stopping
point, use this delivery workflow:

1. Fetch and prune `origin`, switch to `main`, fast-forward it from
   `origin/main`, and run `python3 scripts/clean_local_branches.py --delete`
   before creating a new focused topic branch. The cleanup only removes local
   branches whose exact GitHub PR head was merged into `origin/main`; it skips
   checked-out worktrees and branches without matching merge evidence. Do not
   reuse a branch that already has an unrelated pull request.
2. Complete the requested change and its tests without unrelated refactors.
3. Run the applicable local checks from this document, broadening them in
   proportion to risk. Resolve failures before delivery.
4. Review `git status` and the full diff, run `git diff --check`, then commit and
   push only the intended files.
5. Open a pull request to `main` summarizing the change, completed checks,
   skipped validation, platform limits, and material risks.
6. Enable squash auto-merge on the pull request and report its URL. Required
   GitHub checks remain the authority for the final merge; fix failures on the
   topic branch rather than weakening a gate.
7. After the pull request is confirmed merged, switch to `main`, fast-forward
   it from `origin/main`, and run
   `python3 scripts/clean_local_branches.py --delete`. If cleanup cannot run at
   the end of the current session, the next task's first step must perform it.

`main` is protected for administrators too: never push directly, force-push,
delete, or bypass protection. Pull-request branches must be current with `main`;
all six quality gates must pass: backend, frontend, visual/accessibility, and
Tauri on Linux, Windows, and macOS. Resolve every review conversation and
preserve linear history. Before other remote actions, verify the repository,
branch, commit range, and exact PR targets/authors; closing, reopening, or
changing protection still requires explicit user authorization.

## Verification expectations

Run the smallest relevant checks first, then broaden for cross-layer changes.

- Backend: relevant tests, then full pytest with branch coverage.
- Frontend logic: relevant Vitest, then `npm test`, `npm run typecheck`, and
  `npm run build`; include coverage for new testable logic.
- Frontend style-only change: `npm run typecheck` and `npm run build`.
- Significant UI/layout: also run Playwright visual tests.
- Rust/Tauri: relevant `cargo test --locked` plus `cargo check --locked`.
- API contract change: backend tests plus frontend Vitest, typecheck, and build.
- Database, task-state, security, path-validation, or token change: add or update
  focused regression tests.
- Release/sidecar: build the sidecar and Tauri bundle on the target OS.

Run every meaningful check available. Report exact skips caused by missing
native dependencies; do not claim a full Tauri build from frontend or Cargo-only
checks.

## Change hygiene

- Inspect `git status` before editing and preserve unrelated user changes.
- Do not edit generated artifacts or lockfiles unless required. Keep patches
  focused, especially around security, schemas, recovery, and packaging.
- Update documentation/CI/build scripts when workflows or prerequisites change.
- Before handoff, run `git diff --check` and report modified files, checks, and
  remaining platform validation.
