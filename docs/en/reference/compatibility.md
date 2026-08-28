# v1 stability and compatibility contract

[Reference and stability](README.md) · [English documentation home](../README.md) ·
[简体中文](../../zh-CN/reference/compatibility.md)

This document defines the public compatibility boundary for Audux `1.0.0`. Versions follow SemVer:
patch releases fix defects without breaking these contracts, minor releases add compatible
capabilities, and breaking public-contract changes require a new major version.

## Supported platforms

Release packages are built natively on each target OS; sidecars are never copied across platforms.

| Platform | v1.0 support | Artifacts |
| --- | --- | --- |
| Linux | x86_64 on a modern distribution with WebKitGTK 4.1 | AppImage, DEB, RPM, browser-lite |
| Windows | Windows 10/11 x86_64 with WebView2 Runtime | NSIS, browser-lite |
| macOS | macOS 14 or newer on Apple Silicon | DMG, browser-lite |

v1.0 does not support Intel Macs and does not publish macOS x86_64 installers, browser-lite, or
Whisper components.

Windows packages are not currently Authenticode-signed; macOS packages are not Developer ID-signed
or notarized. The OS may warn about an unknown publisher. In-app Tauri updates still require a valid
project updater signature.

## Data and formats

- `1.0.x` uses database schema v6. `0.9.0-beta.1` used the same schema, so `1.0.0` opens that data
  unchanged and does not rewrite the database for a version-label change.
- The database must have one valid `app_schema` marker. Older, newer, unmarked, or corrupt databases
  are rejected before table creation or writes, leaving the original untouched.
- Portable archives are `audux-archive` v1 bound to schema v6. v1.0 imports only the current format,
  first through dry-run and then transactionally into an empty library.
- Saved-view queries, agent-session exports, restore requests, and Whisper component manifests are
  format v1 and remain strictly version-validated.

A future stable schema change must ship an explicit forward migration, verified pre-update
snapshot, failure rollback, and migration regression tests. A build without a migration path can
only reject safely; it must not guess or patch user data in place. Archive changes use a new format
version, with old-version support documented in release notes.

## Providers and MCP

- External ASR uses an OpenAI-compatible `POST /audio/transcriptions` multipart request. The
  response contains at least `text`, with optional `language`, `model`, and segment timestamps.
- LLMs use OpenAI-compatible Chat Completions. Agent tools are available only after native tool
  calling passes capability detection; ordinary generation receives no tool permissions.
- Preferred MCP is `2026-07-28`. The stdio server retains initialize fallbacks for `2025-11-25`,
  `2025-06-18`, and `2024-11-05`; every version exposes the same read-only tool set.
- Provider or MCP fields are announced in documentation and runtime results before deprecation and
  remain for at least the next minor version. Security fixes may tighten behavior immediately but
  must be identified in release notes.

Model accuracy, language coverage, structured output, and tool-calling quality are not application
compatibility guarantees. Audux always owns deterministic timeline checks, scope, citation
validation, approval, and transaction boundaries.

## Degraded and unavailable behavior

- Without a Whisper companion or ASR, only the corresponding local transcription task is disabled.
- If the LLM is unavailable or lacks tool calling, agent runs fail or fall back to ordinary
  generation without affecting playback, manual metadata/tags/playlists, transcript browsing, FTS,
  backup, or export.
- Without embeddings, retrieval reports `fts` and a fallback reason and continues with FTS5.
- Remote providers are off by default; non-loopback endpoints receive data only after explicit
  consent.

## Deprecation, backup, and rollback

Public-contract deprecations are recorded in release notes and here; fields are not silently
removed. A stable update that changes schema must first create and validate a `pre_update` snapshot.
Active tasks or a snapshot failure block installation.

Rollback procedure:

1. Exit Audux normally and preserve copies of all `~/.audux/` and the original media roots.
2. Install the target older version, but do not first open a newer-schema database with it.
3. Restore a compatible `pre_update` or manual snapshot. If the schema did not change, the existing
   database may be reused.
4. Run library health and rebuild FTS, then sample transcript revisions, tags, and playlists.

Database snapshots do not contain original audio, model caches, or ordinary exports. Browser-lite
does not replace itself; rollback requires manually replacing the executable.

## Known limitations

- No cloud sync, multi-user mode, mobile client, or general network/shell agent.
- Audux does not modify, move, or delete original audio. Removing a library record is not deleting
  the source file.
- Archives exclude original audio; imported records must be relinked inside trusted media roots.
- Embeddings are optional. SQLite FTS5 is the reproducible v1.0 retrieval baseline.
- ASR/LLM quality depends on the model and hardware. Unsupported model claims, tags, or corrections
  cannot bypass backend validation and user approval to become accepted content.
