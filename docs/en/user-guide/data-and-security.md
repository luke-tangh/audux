# Data, backup, and security

[User guide](README.md) · [English documentation home](../README.md) ·
[简体中文](../../zh-CN/user-guide/data-and-security.md)

Audux treats the database and application-generated content as user data. Automated tests must use
temporary directories and must never target a real `~/.audux/`.

## Data directory

```text
~/.audux/
├── database.sqlite
├── covers/
├── logs/
├── exports/
├── backups/
├── components/
├── models/
└── local_api_token
```

- `database.sqlite` stores library records, settings, transcripts, tasks, and audit state.
- `covers/`, `logs/`, `exports/`, and `backups/` contain generated covers, logs, exports, and
  snapshots.
- `components/` contains optional Whisper companions by version and platform.
- `models/` contains on-demand local model weights.
- `local_api_token` is a backend-generated random secret. Never log, commit, or copy it into a
  fixture.

A remote Whisper-component manifest must pass the embedded Ed25519 public-key check. A manifest
signature, ZIP size/hash, or executable size/hash mismatch stops installation before atomic
replacement. Audux rehashes an installed companion before launch to detect local replacement.

Original audio remains in the selected media roots. Audux neither copies it into `~/.audux/` nor
modifies it.

## Stable schema policy

Audux `1.0.0` freezes database schema v6. `0.9.0-beta.1` used the same schema, so no conversion is
needed. Older, newer, unmarked, or corrupt databases are rejected before table creation or writes;
the original file remains unchanged.

A future stable schema change must ship an explicit forward migration, verified pre-update
snapshot, failure rollback, and regression tests. Without a migration path, Audux continues to
reject safely. Keep a recoverable copy and use a separate test data directory when validating a new
build. Failure to open an unsupported schema is never permission to delete or rebuild user data.

## Database snapshots and restore

Settings > Maintenance > Database backup and restore can create, name, validate, and delete managed
snapshots. Restore preflight checks:

- SQLite integrity and the current schema;
- available disk space;
- active tasks or pending-approval organization runs that would be interrupted.

Submitting a restore first snapshots the current database. Tauri restarts and switches the database;
browser-lite records the request and asks for a manual restart. If the target fails to initialize,
Audux automatically switches back to the safety snapshot.

Snapshots do not contain original audio, model caches, or exports. A disaster-recovery backup must
also cover all of `~/.audux/` and the original media directories.

Before desktop update installation, Audux downloads and validates the updater artifact signature,
checks that scanning, ASR, AI, agent, health, and organization runs are idle, then creates a
`PRAGMA quick_check` and SHA-256-verified pre-update snapshot. Any failure aborts installation. An
unsupported schema remains a hard stop; update installation never bypasses schema validation.

## Portable archives and diagnostics

Archive format `audux-archive` v1 has a versioned manifest and SHA-256 checks. It includes metadata,
tags, playlists, saved views, transcript revisions, chapters, quality issues, and required agent
audit records. Import always starts with dry-run, accepts only the current schema, and writes
transactionally only into an empty library. Imported audio is marked missing until safely relinked.

Archives exclude audio files, credentials, the local API token, and absolute media-root paths.
Diagnostic bundles use a field allowlist and contain only versions, platform data, allowlisted
configuration, task summaries, and integrity results—not full transcripts, logs, credentials,
tokens, or user absolute paths.

## Local API

The standalone backend defaults to `127.0.0.1:8765`; Tauri and browser-lite use a dynamic loopback
port. Security controls are:

1. CORS allows only Tauri origins by default. Browser-lite uses the API's exact same origin;
   browser development origins must be explicitly listed in `AUDUX_ALLOWED_ORIGINS`.
2. `POST`, `PUT`, `PATCH`, and `DELETE` require `X-Audux-Client: audux`.
3. Except for `/health`, `/auth/token`, and API documentation, requests require `X-Audux-Token`.
4. Browser media, image, and download elements that cannot attach headers use
   `?access_token=<token>`.
5. Request bodies are capped at 70 MiB, with a stricter 10 MiB bounded read for cover uploads;
   public request fields also have domain-specific length limits.

The frontend obtains and attaches the token only through
[`frontend/src/api.ts`](../../../frontend/src/api.ts). For manual development debugging:

```bash
curl http://127.0.0.1:8765/auth/token \
  -H "X-Audux-Client: audux"

curl http://127.0.0.1:8765/library-roots \
  -H "X-Audux-Token: <token>"
```

Mutations also need `X-Audux-Client: audux`. For browser development, set an exact comma-separated
allowlist such as `AUDUX_ALLOWED_ORIGINS=http://127.0.0.1:5173`. Arbitrary localhost ports are not
trusted. `AUDUX_ALLOW_ALL_CORS=1` is for temporary development only; never use it in normal
operation or a release, and never weaken token, origin, CSP, or client header checks to solve a
development problem.

If the token file cannot be read, created, or restricted to the current user, the backend refuses
to start instead of falling back to an unstable temporary token. Fix ownership, permissions, or
disk problems under `~/.audux/` first.

## Provider and agent boundaries

- Remote ASR receives full audio or chunks; remote LLMs receive relevant metadata and transcripts.
- Non-loopback endpoints are rejected until explicitly allowed.
- The backend resolves and freezes agent scope; prompts do not control authorization. Transcript
  text and model output are untrusted inputs.
- MCP is read-only. Built-in low-risk writes require an exact plan, one-time approval, and a
  transaction.
- Agents cannot delete files, restore databases, modify providers, or access arbitrary paths,
  networks, shells, logs, or credentials.
