# AI, ASR, and MCP configuration

[User guide](README.md) · [English documentation home](../README.md) ·
[简体中文](../../zh-CN/user-guide/configuration.md)

Core playback, manual editing, keyword search, and export do not require ASR, an LLM, or network
access. Provider configuration is stored locally. API keys are excluded from task payloads,
archives, and diagnostic bundles and must never appear in logs.

## Local Whisper

The default ASR settings are:

```text
asr.provider = faster_whisper
asr.model_name = small
asr.device = cpu
asr.compute_type = int8
asr.beam_size = 5
```

The main desktop package does not embed faster-whisper, CTranslate2, or PyAV. Install the Whisper
companion for the current platform from Settings > ASR. Before installation, Audux verifies the
manifest signature with its embedded Ed25519 public key, then checks the ZIP and executable version,
platform, size, and SHA-256.

Model weights such as `small`, `medium`, and `large-v3` are downloaded on first transcription to
`~/.audux/models/faster-whisper/`. Removing the companion does not remove the model cache.

Source checkouts can install the ASR extra directly:

```bash
uv sync --locked --extra asr
```

For a custom HTTPS or loopback manifest in source development, set
`AUDUX_WHISPER_MANIFEST_URL` and provide its Ed25519 public-key PEM through
`AUDUX_WHISPER_MANIFEST_PUBLIC_KEY`. A same-path `.sig` file is required. Packaged releases trust
only the public key embedded at build time and do not accept a runtime trust-root override.

For fully offline operation, install the companion and cache the model beforehand, or set
`asr.model_name` to a reachable local model directory.

## External ASR

An external provider receives media only after the path has passed library-root validation:

```text
asr.provider = external
asr.external.endpoint = http://127.0.0.1:8000/v1
asr.external.model_name = qwen3-asr-1.7b
asr.external.api_key =
asr.external.language = auto
asr.external.timestamp_policy = preferred
asr.external.timeout = 3600
asr.external.allow_remote_endpoint = false
asr.external.chunking_enabled = false
asr.external.chunk_seconds = 28
asr.external.chunk_overlap_seconds = 1
asr.external.chunk_concurrency = 1
asr.external.prefer_silence = true
asr.external.vad_threshold = 0.5
asr.external.minimum_silence_ms = 400
asr.external.formatting_enabled = true
asr.external.case_glossary =
```

The endpoint is an API base URL and must not contain credentials, a query, or a fragment. Audux
sends:

```text
POST {endpoint}/audio/transcriptions
Content-Type: multipart/form-data
```

The form contains `file`, `model`, and `response_format=verbose_json`, plus `language` and
`timestamp_granularities[]=segment` when configured. The service returns:

```json
{
  "text": "The complete transcript",
  "language": "en",
  "model": "qwen3-asr-1.7b",
  "segments": [
    {
      "id": 0,
      "start": 0.0,
      "end": 4.25,
      "text": "The first segment"
    }
  ]
}
```

`language`, `model`, and `segments` are optional. Timestamp policies mean:

- `off`: do not request timestamps; a transcript may have no segments.
- `preferred`: request segments, but accept a text-only response.
- `required`: without application chunking, fail if segments are missing; with chunking, Audux may
  derive a coarse timeline from chunk boundaries.

Qwen3-ASR and MiMo-V2.5-ASR Chat Completions audio examples are not direct implementations of this
endpoint. A server-side adapter must expose `/audio/transcriptions`. Qwen3-ASR can use a forced
aligner for timestamps; MiMo-V2.5-ASR can use `preferred` or `off` for text-only responses.

### Long-audio chunking and formatting

External-ASR chunking is off by default. When enabled, both `ffmpeg` and `ffprobe` must be available
to the backend process through `PATH`. The backend sidecar already contains the Silero VAD model
and ONNX Runtime CPU provider; Torch, CUDA, and a separate VAD-model download are not required.

- FFmpeg streams 16 kHz mono PCM; VAD does not load the entire audio file into memory.
- Audux prefers a non-speech boundary before the maximum chunk duration and hard-cuts only when
  necessary.
- Adjacent chunks may overlap; exact duplicate boundary text is removed conservatively.
- Concurrency is limited to 1-4 and should not exceed the model server's `MAX_NUM_SEQS`. Reduce it
  to 2 or 1 after a GPU out-of-memory error.
- Segment times are offset to the original timeline and committed in source-chunk order.

When `formatting_enabled` is true, Audux restores sentence-initial capitalization and uses only the
visible `case_glossary` to normalize casing. Each line may be `recognized text=Canonical Text` or a
canonical form alone. `#` comments are supported, up to 500 entries. Hard-cut boundaries and
overlapping VAD silences shorter than 0.7 seconds are treated as continuous speech to avoid keeping
a model-invented terminal period.

### External-ASR privacy boundary

- By default, only localhost, `127.0.0.0/8`, `::1`, and `.localhost` are accepted.
- Other addresses require explicit `asr.external.allow_remote_endpoint` consent.
- The external service receives the complete audio or chunked WAV data. Connect only to a trusted
  service.
- Tasks snapshot the provider, endpoint, model, language, and timestamp policy; retries reuse that
  snapshot.

## LLM

Audux uses an OpenAI-compatible Chat Completions API. Common local endpoints include Ollama at
`http://127.0.0.1:11434/v1` and LM Studio at `http://127.0.0.1:1234/v1`.

```text
llm.endpoint
llm.model_name
llm.api_key
llm.timeout
llm.max_tokens
llm.temperature
llm.allow_remote_endpoint
```

The connection test probes structured output and tool calling. A provider without tool calling can
still perform ordinary generation but cannot enter the agent tool-execution path. A non-loopback
endpoint requires explicit consent and receives relevant audio metadata and transcript text.

## Read-only MCP server

The v1.0 backend can run as a stdio MCP server. It reuses the internal Tool Registry and exposes
only restricted list, search, get, and statistics tools:

```bash
cd backend
uv run --locked python run.py --mcp
```

The packaged sidecar uses the same entry point:

```bash
audux-backend-<target-triple> --mcp
```

Optionally restrict the process to specific audio IDs:

```bash
AUDUX_MCP_AUDIO_IDS=1,2 audux-backend-<target-triple> --mcp
```

stdout is reserved for JSON-RPC. MCP never exposes write tools, API keys, the local API token,
logs, absolute paths, or out-of-scope audio. EOF terminates the process.

The server natively implements MCP `2026-07-28`. Modern clients include
`io.modelcontextprotocol/protocolVersion` and
`io.modelcontextprotocol/clientCapabilities` in each request's `params._meta`, then call
`server/discover`, `tools/list`, and `tools/call`; they do not need
`initialize`/`notifications/initialized`. Compatibility fallbacks remain for `2025-11-25`,
`2025-06-18`, and `2024-11-05`, but new integrations must not depend on the legacy lifecycle.
