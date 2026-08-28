# Audux product roadmap

[Project planning](README.md) · [English documentation home](../README.md) ·
[简体中文](../../zh-CN/project/roadmap.md)

> Updated 2026-08-28. The current stable version is `1.0.0`, database schema v6, archive format v1.
> v0.x versions are retained as internal beta history. The
> [compatibility contract](../reference/compatibility.md) defines the public v1 boundary.

## Current assessment

The internal v0.5-v0.9 stages converged into the first public stable release, v1.0.0. Every later
public tag still requires the three-platform installation, recovery, provider, MCP, archive, and
long-running gates; manual workflows create internal validation artifacts only.

Audux does not treat chapters, semantic retrieval, Q&A, and AI organization as isolated features.
They form a constrained local agent loop that is inspectable, pausable, and recoverable:

> Within a library scope explicitly selected by the user, controlled tools perform retrieval,
> transcription orchestration, quality validation, content proposals, and correction collaboration,
> retaining source, evidence, and approval for every conclusion and write.

This is not a general agent with arbitrary network, shell, or file access.

## Product flows

### Retrieval and answer flow

```text
question / current audio / playlist / saved view / explicit selection
  -> backend resolves and enforces scope
  -> metadata + FTS + optional embedding retrieval
  -> evidence with audio / transcript revision / segment / timestamp
  -> agent composes an answer
  -> backend revalidates citation existence and scope
  -> UI shows answer, evidence, and playable seek targets
```

Retrieved units are evidence, not an unstructured full transcript pasted into a prompt. When
evidence is insufficient, sources conflict, or a transcript fails its minimum quality threshold,
the agent must stop inference or recommend transcription/correction first.

### Transcription and organization flow

```text
selected audio and scope
  -> transcription preflight and privacy disclosure
  -> raw ASR transcript
  -> deterministic structural validation
  -> optional suspicious-window review
  -> transcript issues and correction proposals
  -> user accept / edit / reject
  -> new accepted transcript revision
  -> tag / description / chapter proposals from that revision
  -> user-approved writes
  -> rebuild FTS / embeddings / chapters
  -> revalidate and resolve or retain issues
```

Asking the same model twice is not independent validation. Validation layers are:

1. deterministic timestamp monotonicity, bounds, overlaps, empty segments, full-text consistency,
   encoding, and revision binding;
2. source provenance with provider, model, language, confidence when available, glossary, and task
   configuration snapshot;
3. optional second decode/configuration comparison or user listening for suspicious windows only;
4. human review of original text, proposal, rationale, and audio time for every accepted correction
   or tag;
5. evidence and source-revision binding for descriptions, tags, chapters, and answers.

## Non-negotiable principles

1. Recoverability outranks agent capability. Every persistent write defines preflight, transaction,
   rollback, version conflict, and deletion semantics first.
2. Local capability is the default. Remote providers require explicit enablement and disclose audio
   scope, transcript character count, and data types sent for each run.
3. The backend enforces agent scope; prompts cannot expand directories, playlists, saved views, or
   selected audio.
4. Transcripts, metadata, filenames, and model output are untrusted and cannot alter policy, tool
   permissions, or approval requirements.
5. Raw ASR, accepted content, proposals, and rebuildable indexes remain separate. Proposals never
   silently become trusted content.
6. AI output is inspectable, rejectable, editable, and regenerable. Rejecting one item does not block
   others.
7. Agent tools call existing service boundaries, never direct SQL, arbitrary paths, keys, logs, or
   the local API token.
8. Playback, manual editing, keyword search, and export remain usable without LLMs, embeddings, or
   network access.
9. Each milestone delivers its data model, API, frontend, current schema, regression tests, and user
   documentation together.
10. Hidden model reasoning is neither stored nor displayed. Auditable facts include user input,
    visible answers, tool calls/results, citations, approvals, and errors.

## Trusted content and derived data

| Layer | Examples | Trust meaning | Change mechanism |
| --- | --- | --- | --- |
| Raw source | Audio, scanned metadata, raw ASR | Immutable provenance, not assumed accurate | New scan or transcription version |
| Accepted content | Current transcript revision, user metadata, accepted tags | Current trusted state | User edit or explicit proposal approval |
| Agent proposal | Correction, tag, description, chapter, batch plan | Untrusted suggestion | Accept, edit, reject, or regenerate |
| Quality record | Issue, validation, confidence, review result | Supporting evidence, not truth itself | Validator/user append |
| Rebuildable data | FTS, embeddings, chunks, cached summaries | Never a source of truth | Invalidate and rebuild after source change |
| Agent audit | Session, run, step, call, citation, approval | Auditable event | Append, cancel, export, or session delete |

Every transcript has a stable revision ID. Segments, chapters, retrieval chunks, citations,
corrections, and AI proposals bind to one revision. After retranscription or accepted correction,
history remains readable but cannot act as current answer evidence.

## Agent permission model

| Level | Behavior | Default policy |
| --- | --- | --- |
| `read` | Search, details, transcript segments, statistics | Automatic inside backend scope |
| `propose` | Corrections, tags, descriptions, chapters, plans | Writes only to proposal state |
| `execute` | Accept tags, metadata, playlist joins, corrections | One-time approval after exact diff |
| `restricted` | File deletion, database restore, root/provider changes, arbitrary path/network/shell | Not exposed in v1.0 |

Approval binds `run + step + tool + parameter summary`. Any parameter, source revision, or scope
change invalidates old approval.

## Technical approach

The implementation uses deterministic workflows with a thin agent layer, not unconstrained model
planning.

| Layer | Approach |
| --- | --- |
| Runtime | Small persistent backend state machine; read-only tool choice for Q&A, fixed stages for organization |
| Recovery | SQLModel/SQLite for runs, steps, calls, proposals, approvals, and citations; existing cancellation/interruption semantics |
| Models | OpenAI-compatible client with structured output, native tool calling, and capability detection; ordinary-generation fallback |
| Tools | Pydantic input/output, Tool Registry over `services/`, backend-injected scope and permissions |
| Retrieval | Mandatory SQLite FTS5; optional rebuildable embeddings only after language quality, size, and three-platform packaging validation |
| Resources | Separate ASR, indexing, and agent queues with limits; database polling before Redis/Celery/external orchestration |
| Frontend | Agent panel, playable citations, organization activity, correction diff; centralized API and shared payload types |
| External access | Read-only MCP stdio adapter over the same Tool Registry and service/scope/audit limits |

The early roadmap intentionally avoided LangGraph, Pydantic AI, and Temporal as runtime
dependencies. Framework adoption would require a fixed-run replacement evaluation rather than
allowing framework data models to redefine product data.

## Reference projects and boundaries

| Project | Useful ideas | Boundary not copied |
| --- | --- | --- |
| [Khoj](https://github.com/khoj-ai/khoj) | Local/self-hosted personal retrieval, agents, multiple models | Network research, autonomous tasks, general documents |
| [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm) | Desktop agents, workspace RAG, providers, MCP | Broad tools, multi-user, arbitrary ingestion; its [security history](https://github.com/Mintplex-Labs/anything-llm/security/advisories/GHSA-24qj-pw4h-3jmm) reinforces strict local API/tool defaults |
| [Audiobookshelf](https://github.com/advplyr/audiobookshelf) | Audio scanning, chapters, progress, metadata backup | Server/multi-user model and embedded-file metadata writes |
| [WhisperX](https://github.com/m-bain/whisperX) | Word alignment, VAD, diarization prototypes | GPU/model size, language coverage, alignment error as mandatory default |
| [LangGraph interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts) | Checkpoints, approval pauses, recovery | Full graph runtime before read-only agents were validated |
| [Pydantic AI tools](https://pydantic.dev/docs/ai/tools-toolsets/tools/) | Typed tools, dynamic tool sets, approval | Framework ownership of database/filesystem capabilities |
| [MCP 2026-07-28 tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) | Stateless discovery, structured calls/results, cache hints | MCP as authorization or internal business logic |

## Milestone overview

| Stage | Outcome | Status |
| --- | --- | --- |
| v0.5 | Core workflow baseline | Complete |
| v0.6 | Agent-ready trusted-content foundation | Complete |
| v0.7 | Evidence retrieval and read-only agent | Complete |
| v0.8 | Transcription, validation, tags, and correction loop | Complete |
| v0.9 | Safe operation agent, MCP, archives, and release hardening | Complete |
| v1.0 | Stable agent-native local audio knowledge base | Released |
| v1.0.x | Stability, upgrades, and platform trust | Planned |
| v1.1 | Optional hybrid semantic retrieval | Planned |
| v1.2 | Bookmarks, clips, and personal notes | Planned |
| v1.3 | Transcript Studio | Candidate |
| v1.4 | Continuous ingestion and evidence-backed outputs | Candidate |

## v0.5: core workflow baseline

- Explicit multi-select and batch organization.
- Fidelity-preserving transcript revision, search context, and edit-conflict protection.
- Playback queue and session continuity.
- Strict schema, local API, browser-lite, optional Whisper companion, and three-platform build base.

Ongoing gates cover clean installation on all targets, safe schema rejection, port conflicts,
last-window exit, cancellation, and internal artifacts without public v0.x releases.

## v0.6: trusted-content foundation

Completed recovery and organization foundations: managed snapshots and rollback, versioned saved
views, smart playlists over saved-view rules, library health, duplicate confirmation, and safe
relinking.

Transcript work added immutable revisions with provider/model/language/configuration/glossary/quality
provenance; stable segment evidence; revision-bound manual chapters; structured issues for timeline,
text, language, and confidence; and explicit invalidation semantics.

Provider work added minimal `ASRProvider`, `LLMProvider`, and `EmbeddingProvider` boundaries,
capability probing, a Pydantic Tool Registry, backend-injected scope, and no model-supplied roots.
Privacy-free bilingual fixtures cover names, numbers, homophones, silence, broken timestamps,
missing transcripts, conflicts, and prompt injection.

Exit conditions required full citation traceability, no stale derived data after revision changes,
stable deterministic issue codes, no agent path without tool calling, and a realistic snapshot >
revision change > restore drill.

## v0.7: evidence retrieval and read-only agent

- Unified segment FTS with field provenance, scope, audio, revision, segment, timestamps, context,
  and score across library search, agents, views, playlists, and future MCP.
- Optional hybrid retrieval designed only after an FTS baseline, with exact metadata hits protected
  from semantic drowning and embeddings treated as cancellable/rebuildable derived data.
- Persistent sessions, runs, steps, calls, and citations on a separately limited agent queue.
- Read-only tools for scoped search, audio/transcript, tags/playlists, issues, and statistics.
- UI scope selection, citation seek, source/summary/uncertainty distinction, cancellation, rename,
  delete, and export.

Exit gates measured Recall@k, latency, citation coverage, unsupported answers, zero scope leakage,
10,000-audio interaction and resources, and preservation of keyword search/transcript browsing when
LLMs, embeddings, or providers fail. Writes, internet access, uncited open chat, and multi-agent
collaboration were excluded.

## v0.8: transcription and organization loop

- Recoverable runs freeze explicit target IDs and move through the eight persisted stages, allowing
  per-audio failure, cancellation, retry, and restart interruption.
- Deterministic validation always follows ASR. Severe structure issues block enrichment but preserve
  raw output; optional redecoding targets suspicious windows only.
- Correction proposals bind revision/segment and show text, diff, reason, evidence, impact, and
  audio time. Accept, edit, reject, skip, and listen are independent; accepted corrections use
  expected revision and create a new immutable revision.
- Tag, description, and chapter proposals use only the accepted revision, carry evidence, prefer
  existing normalized tags, and require category-specific approval.
- Apply changes current revision, full text, FTS, and accepted organization data transactionally;
  source changes stale old embeddings, proposals, chapters, and citations before revalidation.

Exit gates required exact approved diffs/audit, no partial state under failure or conflict,
repeatable correction/tag metrics without unbounded duplicates, current-revision-only downstream
data, and explicit disclosure of remote scope and character counts.

## v0.9: controlled operations, MCP, archives, and hardening

- Low-risk execute tools for in-app metadata, tags, manual playlists, saved views, and queued
  transcription use exact before/after plans, frozen targets, per-item results, and transactions.
- Read-only MCP reuses the Tool Registry for list/search/get/statistics and exposes no secrets,
  paths, logs, or unauthorized scope.
- Versioned archives cover accepted library content and necessary audit without credentials; dry-run
  reports schema, missing media, conflicts, and merge policy before a transaction.
- Diagnostics contain only redacted settings, versions, task/agent summaries, and integrity.
- Resource queues, long-running/suspend/port/provider tests, target-OS packaging, and independent
  tool/scope/injection/replay/redaction/path review form release hardening.

Exit gates require no approval bypass, scope expansion, or partial writes; matching built-in and
MCP results through a real stdio seam; complete archive export/import; and realistic long-running,
cancellation, recovery, and exit evidence on every platform.

## v1.0: stable local audio knowledge base (released)

v1.0 is a quality and compatibility gate, not another feature pile. It requires documented platform,
database, archive, provider, and MCP versions; migration/deprecation policy; tested backup, restore,
import/export, revision, and audit deletion; published retrieval/citation/correction/tag quality and
model failure modes; core offline operation after optional-provider failure; reviewed privacy,
credentials, redaction, deletion, remote disclosure, and approval; and repeatable three-platform
build/rollback evidence.

Implementation freezes schema v6, archive v1, Provider/MCP contracts, offline degradation, and
deletion semantics. The [compatibility contract](../reference/compatibility.md) and
[release checklist](../contributing/release-checklist.md) govern public tagging.

## Post-v1.0 release line

The release line follows this order: establish trust, improve retrieval, deepen personal knowledge,
refine transcripts, then automate ingestion. Version numbers express outcomes and dependency order,
not precommitted dates. Before implementation, every minor release still needs an ADR for its data
model, compatibility path, resource budget, and acceptance dataset.

### v1.0.x: stability, upgrades, and platform trust

- Prioritize public-release defects in installation, first launch, upgrades, rollback,
  suspend/resume, process exit, and provider compatibility instead of adding major features.
- Generalize the release workflow from `v1.0.*` to a v1.x flow that strictly validates the version,
  main ancestry, release notes, signatures, and assembled artifacts.
- Improve startup, scanning, search, playback, and task resource limits for large libraries while
  keeping diagnostics local and redacted by default.
- Add Windows Authenticode and Apple Developer ID signing/notarization once project identity and
  secure key management are available; platform signing does not replace Tauri updater signatures.
- Patch releases retain database schema v6, archive format v1, and the published Provider/MCP
  contracts.

Exit gate: patch builds complete installation, in-app upgrade, and documented rollback on all three
targets, with no known data corruption, undisclosed remote sending, or broken degradation path.

### v1.1: optional hybrid semantic retrieval

- Ship an optional local embedding component with model, dimension, chunking, source revision, and
  index-version provenance. Embeddings and vector indexes remain deletable, rebuildable derivatives.
- Fuse FTS, metadata filters, and vector similarity without allowing semantic results to bury exact
  title, tag, author, or keyword matches.
- Support incremental indexing, cancellation, restart recovery, model replacement, and full repair;
  an index failure never blocks playback, manual organization, or FTS.
- Show `FTS`, `Hybrid`, and fallback reasons in search and agent UI. Backend scope enforcement,
  result limits, and citation/revision validation remain authoritative.
- Target no change to trusted user data or the archive format. If the implementation requires a
  stable-schema change, it must first provide the same snapshot, migration, and rollback evidence
  required for v1.2.

Exit gate: fixed bilingual evaluations meet predefined Recall@k, ranking, and citation-coverage
improvements without regressing exact FTS queries; latency, disk, and memory budgets pass with
10,000 audio items on every target; uninstalling embeddings returns losslessly to FTS.

### v1.2: bookmarks, clips, and personal notes

- Add bookmarks, clips, and personal notes bound to audio, time ranges, and optional transcript
  revisions/segments. Every record seeks to playback and displays source context.
- Add waveform preview, clip-review cache, and clip export without editing, cutting, or overwriting
  original audio files.
- Include bookmarks and notes in unified retrieval and agent evidence. Agents are read-only by
  default; create, edit, or delete operations require an exact plan and one-time approval.
- Bring richer local tag taxonomy, synonyms, and user terminology into search and export with this
  knowledge layer.
- As the first planned stable minor that changes trusted user data, ship an explicit migration from
  schema v6, a verified `pre_update` snapshot, and rollback on failure. A new archive format must
  continue importing v1 and fully cover the added content.

Exit gate: create, edit, search, playback, export, archive import, and database restore never lose or
misbind notes; failed upgrades restore the old schema; legacy import and new-format round trips pass
at realistic scale.

### v1.3: Transcript Studio

- Add word timestamps, manual timeline edits, and realignment of affected ranges after accepted text
  correction.
- Add optional speaker diarization, speaker renaming, and speaker-aware search, citation, chapters,
  and notes.
- Deliver alignment and diarization models as optional components. Missing components, insufficient
  hardware, or low quality retain the segment workflow and show an explicit fallback reason.
- Keep raw ASR, automatic alignment, automatic speaker output, and user-accepted content separate.
  Realignment or rediarization never silently overwrites user edits.

Exit gate: fixed multilingual fixtures record alignment-boundary and speaker quality; every automatic
result is playable, editable, rejectable, and rebuildable; no stale word, speaker, or time anchor acts
as current evidence after a revision change.

### v1.4: continuous ingestion and evidence-backed outputs

- Folder watchers turn changes under trusted library roots into debounced, cancellable, recoverable
  incremental scans. Event storms, renames, moves, temporary disconnects, and platform differences
  must not create duplicates or false deletions.
- Automatic organization retains explicit scope, concurrency/time/disk budgets, and pausable runs.
  Remote-provider use follows a user-selected policy and discloses the send scope before execution;
  a new file never causes silent network access.
- Generate study outlines, show notes, and cross-audio topic reports from current audio, playlists,
  saved views, or explicit selections. Factual passages require playable citations and export to a
  stable portable format.
- Neither automated ingestion nor reporting receives file deletion, move, overwrite, arbitrary
  network, or shell capabilities.

Exit gate: every target passes long-running watch, suspend/resume, event-storm, and task-restart tests;
automatic runs cannot expand frozen scope or cause undisclosed remote sending; report citations are
revalidated before export and seek to the current revision.

### Ordering and compatibility

1. v1.1 delivers rebuildable derived data first, keeping retrieval experiments separate from the
   first user-data migration.
2. v1.2 uses bookmarks and notes to validate stable migration, archive evolution, and rollback as a
   template for later schema changes.
3. v1.3 keeps alignment and speaker features optional because model size, hardware, and quality vary.
4. v1.4 adds cross-platform file events and automatic runs only after retrieval, the knowledge layer,
   and recovery semantics are stable.
5. v1.x minor releases add compatible capabilities. A schema, archive, Provider/MCP, or local
   single-user trust-boundary break requires a compatible migration or a new-major proposal.

## Boundaries retained throughout v1.x

- A general agent with internet, shell, arbitrary files, or arbitrary HTTP endpoints.
- Multi-agent swarms, invisible delegation, or unauditable autonomous loops.
- Unapproved batch writes to metadata, tags, playlists, transcripts, or files.
- Automatic modification, rename, move, overwrite, or deletion of original audio.
- Model self-reflection as factual verification or definitive answers without transcript evidence.
- Cloud/multi-device sync, shared sessions, mobile clients, or a built-in model store.

These change the local single-user trusted-library boundary and do not enter scope merely because a
post-v1 release line exists. Cloud sync, collaboration, mobile clients, general agents, write MCP,
and a model store each require an independent proposal; a public-contract change belongs in a new
major version.

## Current priorities

1. Maintain the v1.0.x patch rhythm, validate real upgrade/rollback paths, and safely extend the
   release workflow to later v1.x tags.
2. Fix the v1.1 embedding candidate, hybrid ranking algorithm, three-platform size/resource budgets,
   and bilingual retrieval gates without weakening FTS or offline operation.
3. Write the v1.2 schema/archive ADR and migration rehearsal before implementing bookmark, clip, and
   note UI.
4. Continue retrieval, citation, correction, and tag evaluations and record compatibility, security,
   and resource regressions from public builds.
