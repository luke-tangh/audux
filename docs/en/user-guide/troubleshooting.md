# Troubleshooting

[User guide](README.md) · [English documentation home](../README.md) ·
[简体中文](../../zh-CN/user-guide/troubleshooting.md)

Start with the startup recovery screen or the global activity center. Logs and diagnostic bundles
can help, but never expose API keys, the local API token, absolute media paths, or user transcripts
in an issue, screenshot, or chat.

## The API reports an invalid token

The frontend requests `/auth/token` automatically. For manual curl requests:

```bash
curl http://127.0.0.1:8765/auth/token \
  -H "X-Audux-Client: audux"

curl http://127.0.0.1:8765/library-roots \
  -H "X-Audux-Token: <token>"
```

Mutating methods also require `X-Audux-Client: audux`. A Tauri backend may not use port `8765`;
inspect its actual backend base URL instead of hardcoding the development default.

If startup reports `Failed to initialize local API token`, the backend stops safely. Confirm that
`~/.audux/` is writable and `local_api_token` is readable and can be restricted to the current
user. Do not delete the entire data directory or reset the database.

## The backend does not start

From the repository root:

```bash
uv run --locked python backend/run.py
```

Check `http://127.0.0.1:8765/health`. Set `AUDUX_API_PORT` after a port conflict; Tauri selects a
free port automatically.

An incompatible schema without a migration is intentionally rejected without modification. Use a
compatible application version or matching snapshot; do not delete the database. See
[Deprecation, backup, and rollback](../reference/compatibility.md#deprecation-backup-and-rollback).

## Local Whisper is unavailable

Install the Whisper companion under Settings > ASR. In a source checkout:

```bash
uv sync --locked --extra asr
```

Model weights download on first use. Cache them in advance or configure a local model path for
offline use.

Do not disable validation after a manifest-key, signature, size, or checksum error. Confirm that the
Release contains both `whisper-components.json` and `whisper-components.json.sig`, that the embedded
public key matches the release signing key, and that a proxy or mirror did not alter the component.

## External ASR fails

Check, in order:

- the provider is `external`;
- the endpoint is an API base such as `http://127.0.0.1:8000/v1`, not a complete
  `/audio/transcriptions` URL;
- model name, API key, and service status are correct;
- the service accepts multipart `file` and `response_format=verbose_json` and returns `text`;
- `required` timestamp mode returns segments or application chunking is enabled;
- a non-loopback endpoint has explicit consent;
- both `ffmpeg` and `ffprobe` are on the backend `PATH` for chunking;
- concurrency fits the model server; reduce it to 2 or 1 after CUDA OOM.

See the [external ASR contract](configuration.md#external-asr).

## The LLM connection test fails

Check whether the endpoint needs `/v1`, whether the model exists and service is running, whether an
API key is required, and whether a firewall or proxy blocks the request. Non-loopback endpoints
also require explicit consent. A provider that connects but lacks tool calling supports ordinary
generation only, not agent tools.

## Search returns nothing after scanning

Run Rebuild search index under Settings > Maintenance. If only some media is missing, inspect the
library health center and use safe relinking instead of editing database paths directly.

## A task remains running

On normal startup, the backend recovers persisted task state: interrupted `running` tasks become
failed, `cancel_requested` becomes canceled, and executing organization-run stages become
interrupted. Inspect the activity center and retry explicitly.

If recovery does not occur, check for a second backend process or a database held by another
instance. Shut down the extra instance normally; do not delete the database, WAL, or task records.

## The uv cache is read-only

In a sandbox or managed environment:

```bash
cd backend
UV_CACHE_DIR=/tmp/audux-uv-cache uv run --locked --group test python -m pytest tests
```

The `/tmp` cache is disposable. Cache locks and read-only defaults are not reasons to skip tests.
