import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toErrorMessage } from "../i18n/errors";

import { api } from "../api";
import type {
  AgentScope,
  AudioItem,
  LibraryRoot,
  OrganizationProposal,
  OrganizationProposalKind,
  OrganizationRun,
  OrganizationRunOptions,
  Playlist,
  SavedView,
  Tag
} from "../types";
import {
  Button,
  CheckboxField,
  MaterialIcon,
  SelectField,
  StatusPill,
  TextField,
  TextareaField
} from "./ui";
import { usePolling } from "../hooks/usePolling";
import { serializeAgentScope, useAgentScopeOptions } from "../hooks/useAgentScopeOptions";
import { TERMINAL_ORGANIZATION_STATUSES } from "../constants";

type Props = {
  selected: AudioItem | null;
  selectedAudioIds: Set<number>;
  selectedPlaylistId: number | null;
  activeSavedViewId: number | null;
  selectedTag?: string;
  selectedLibraryRootId?: number;
  playlists: Playlist[];
  savedViews: SavedView[];
  tags: Tag[];
  roots: LibraryRoot[];
  notify: (message: string, tone?: "info" | "success" | "error") => void;
  onPlayEvidence: (audioId: number, seconds: number) => Promise<void>;
};

const DEFAULT_OPTIONS: OrganizationRunOptions = {
  transcribe_missing: false,
  generate_corrections: true,
  generate_tags: true,
  generate_description: true,
  generate_chapters: true
};

function objectValue(value: unknown, key: string): string {
  if (!value || typeof value !== "object") return "";
  const result = (value as Record<string, unknown>)[key];
  return result === undefined || result === null ? "" : String(result);
}

function proposalSummary(proposal: OrganizationProposal): string {
  if (proposal.kind === "tag") return `#${objectValue(proposal.proposed_value, "name")}`;
  if (proposal.kind === "chapter") {
    return `${objectValue(proposal.proposed_value, "title")} · ${objectValue(proposal.proposed_value, "start_seconds")}–${objectValue(proposal.proposed_value, "end_seconds")}s`;
  }
  return objectValue(proposal.proposed_value, "text");
}

export default function OrganizationPanel(props: Props) {
  const { t } = useTranslation();
  const [runs, setRuns] = useState<OrganizationRun[]>([]);
  const [active, setActive] = useState<OrganizationRun | null>(null);
  const [scope, setScope] = useState<AgentScope>({ kind: "library" });
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const runRequestSeqRef = useRef(0);
  const activeRunIdRef = useRef<number | null>(null);

  const scopeOptions = useAgentScopeOptions({
    scope,
    selected: props.selected,
    selectedAudioIds: props.selectedAudioIds,
    selectedPlaylistId: props.selectedPlaylistId,
    activeSavedViewId: props.activeSavedViewId,
    selectedTag: props.selectedTag,
    selectedLibraryRootId: props.selectedLibraryRootId,
    playlists: props.playlists,
    savedViews: props.savedViews,
    tags: props.tags,
    roots: props.roots
  });

  async function selectRun(id: number, requestSeq?: number) {
    const seq = requestSeq ?? ++runRequestSeqRef.current;
    if (requestSeq === undefined) activeRunIdRef.current = id;
    const run = await api.getOrganizationRun(id);
    if (
      seq !== runRequestSeqRef.current ||
      activeRunIdRef.current !== id
    ) return null;
    setActive(run);
    return run;
  }

  async function loadRuns(preferredId?: number) {
    const seq = ++runRequestSeqRef.current;
    const rows = await api.listOrganizationRuns();
    if (seq !== runRequestSeqRef.current) return;
    setRuns(rows);
    const runId = preferredId ?? activeRunIdRef.current ?? active?.id ?? rows[0]?.id;
    activeRunIdRef.current = runId ?? null;
    if (runId) await selectRun(runId, seq);
    else setActive(null);
  }

  useEffect(() => {
    loadRuns()
      .catch((error) => props.notify(toErrorMessage(error), "error"))
      .finally(() => setLoading(false));
  }, []);

  usePolling({
    enabled: Boolean(
      active &&
        !TERMINAL_ORGANIZATION_STATUSES.has(active.status) &&
        active.status !== "awaiting_review"
    ),
    intervalMs: 1200,
    task: async () => {
      if (!active) return;
      const expectedRunId = active.id;
      const expectedSeq = runRequestSeqRef.current;
      const run = await api.getOrganizationRun(expectedRunId);
      if (
        expectedSeq !== runRequestSeqRef.current ||
        activeRunIdRef.current !== expectedRunId
      ) return;
      setActive(run);
      if (
        TERMINAL_ORGANIZATION_STATUSES.has(run.status) ||
        run.status === "awaiting_review"
      ) {
        await loadRuns(run.id);
      }
    },
    onError: (error) =>
      props.notify(toErrorMessage(error), "error")
  });

  async function createRun() {
    if (busy) return;
    const expectedSeq = runRequestSeqRef.current;
    setBusy(true);
    try {
      const run = await api.createOrganizationRun(scope, options);
      if (expectedSeq !== runRequestSeqRef.current) return;
      await loadRuns(run.id);
      props.notify(t("organization.created"), "success");
    } catch (error) {
      props.notify(toErrorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  }

  function editedValue(proposal: OrganizationProposal): unknown {
    const draft = drafts[proposal.id];
    if (draft === undefined) return undefined;
    if (proposal.kind === "tag") return { ...(proposal.proposed_value as object), name: draft };
    if (proposal.kind === "correction" || proposal.kind === "description") {
      return { ...(proposal.proposed_value as object), text: draft };
    }
    return undefined;
  }

  async function decide(proposal: OrganizationProposal, decision: "accepted" | "rejected" | "skipped") {
    const runId = proposal.run_id;
    setBusy(true);
    try {
      await api.decideOrganizationProposal(proposal.id, decision, decision === "accepted" ? editedValue(proposal) : undefined);
      if (activeRunIdRef.current !== runId) return;
      await selectRun(runId);
    } catch (error) {
      props.notify(toErrorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  }

  async function applyCategory(kind: OrganizationProposalKind) {
    if (!active) return;
    const runId = active.id;
    setBusy(true);
    try {
      const run = await api.applyOrganizationRun(runId, [kind]);
      if (activeRunIdRef.current !== runId) return;
      await loadRuns(run.id);
      props.notify(t("organization.applied"), "success");
    } catch (error) {
      props.notify(toErrorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  }

  async function runAction(action: "cancel" | "retry") {
    if (!active) return;
    const runId = active.id;
    setBusy(true);
    try {
      const run = action === "cancel"
        ? await api.cancelOrganizationRun(runId)
        : await api.retryOrganizationRun(runId);
      if (activeRunIdRef.current !== runId) return;
      await loadRuns(run.id);
    } catch (error) {
      props.notify(toErrorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  }

  const proposalsByKind = (active?.proposals || []).reduce<Record<string, OrganizationProposal[]>>((groups, proposal) => {
    (groups[proposal.kind] ||= []).push(proposal);
    return groups;
  }, {});

  return (
    <main className="workspace organization-workspace">
      <section className="organization-panel" aria-labelledby="organization-title">
        <header className="organization-header">
          <div>
            <p className="organization-eyebrow"><MaterialIcon name="task_alt" size={17} /> {t("organization.eyebrow")}</p>
            <h1 id="organization-title">{t("organization.title")}</h1>
            <p>{t("organization.subtitle")}</p>
          </div>
        </header>

        <div className="organization-layout">
          <aside className="organization-runs" aria-label={t("organization.runs") }>
            <SelectField
              label={t("organization.scope")}
              value={serializeAgentScope(scope)}
              options={scopeOptions}
              onValueChange={(value) => setScope(JSON.parse(value) as AgentScope)}
              disabled={busy}
            />
            <div className="organization-options">
              {(Object.keys(options) as Array<keyof OrganizationRunOptions>).map((key) => (
                <CheckboxField
                  key={key}
                  checked={options[key]}
                  label={t(`organization.options.${key}`)}
                  onCheckedChange={(checked) => setOptions((current) => ({ ...current, [key]: checked }))}
                  disabled={busy}
                />
              ))}
            </div>
            <Button variant="filled" onClick={() => void createRun()} disabled={busy}>
              {t("organization.create")}
            </Button>
            <div className="organization-run-list">
              {loading && <p className="muted">{t("activities.loading")}</p>}
              {!loading && runs.length === 0 && <p className="muted">{t("organization.emptyRuns")}</p>}
              {runs.map((run) => (
                <Button preserveChildren key={run.id} className={active?.id === run.id ? "organization-run active" : "organization-run"} onClick={() => void selectRun(run.id).catch((error) => props.notify(toErrorMessage(error), "error"))}>
                  <span><strong>#{run.id}</strong><em>{run.current_stage}</em></span>
                  <StatusPill value={run.status} />
                </Button>
              ))}
            </div>
          </aside>

          <div className="organization-review">
            {!active ? <div className="organization-empty">{t("organization.emptyReview")}</div> : (
              <>
                <div className="organization-summary">
                  <div><h2>{t("organization.runTitle", { id: active.id })}</h2><p>{t("organization.counts", { targets: active.target_count, failed: active.failed_count, review: active.pending_review_count })}</p></div>
                  <div className="organization-run-actions">
                    {!TERMINAL_ORGANIZATION_STATUSES.has(active.status) && <Button size="sm" variant="text" disabled={busy} onClick={() => void runAction("cancel")}>{t("common.actions.cancel")}</Button>}
                    {(["failed", "canceled", "interrupted"].includes(active.status)) && <Button size="sm" variant="tonal" disabled={busy} onClick={() => void runAction("retry")}>{t("common.actions.retry")}</Button>}
                    <StatusPill value={active.status} />
                  </div>
                </div>
                <p className="organization-privacy">{t("organization.remoteCharacters", { count: active.remote_characters })}</p>
                {(active.targets || []).some((target) => target.error_message) && (
                  <div className="organization-target-errors" role="status">
                    {(active.targets || []).filter((target) => target.error_message).map((target) => (
                      <p key={target.id}><strong>{target.title}</strong> · {target.error_message}</p>
                    ))}
                  </div>
                )}
                <ol className="organization-steps">
                  {(active.steps || []).map((step) => (
                    <li key={step.stage} className={step.stage === active.current_stage ? "current" : ""}>
                      <span>{t(`organization.stages.${step.stage}`)}</span>
                      <StatusPill value={step.status} />
                      <small>{step.processed_count || step.failed_count ? `${step.processed_count} / ${step.failed_count}` : ""}</small>
                    </li>
                  ))}
                </ol>

                {(["correction", "tag", "description", "chapter"] as OrganizationProposalKind[]).map((kind) => {
                  const rows = proposalsByKind[kind] || [];
                  if (!rows.length) return null;
                  const accepted = rows.some((row) => row.status === "accepted");
                  return (
                    <section className="organization-proposal-group" key={kind}>
                      <header><h3>{t(`organization.kinds.${kind}`)}</h3>{accepted && <Button size="sm" variant="tonal" disabled={busy} onClick={() => void applyCategory(kind)}>{t("organization.applyCategory")}</Button>}</header>
                      {rows.map((proposal) => (
                        <article className="organization-proposal" key={proposal.id}>
                          <div className="organization-proposal-heading"><strong>{proposalSummary(proposal)}</strong><StatusPill value={proposal.status} /></div>
                          <small className="organization-confidence">{t("organization.confidence", { value: proposal.confidence })}</small>
                          {proposal.kind === "correction" && <p className="organization-original"><del>{objectValue(proposal.original_value, "text")}</del></p>}
                          {proposal.kind === "correction" && proposal.diff.length > 0 && (
                            <div className="organization-diff" aria-label={t("organization.exactDiff")}>
                              {proposal.diff.map((change, index) => (
                                <span key={`${proposal.id}-diff-${index}`}>
                                  {change.before && <del>{change.before}</del>}
                                  {change.after && <ins>{change.after}</ins>}
                                </span>
                              ))}
                            </div>
                          )}
                          {proposal.status === "pending" && (proposal.kind === "correction" || proposal.kind === "description") && (
                            <TextareaField label={t("organization.editProposal")} value={drafts[proposal.id] ?? objectValue(proposal.proposed_value, "text")} onValueChange={(value) => setDrafts((current) => ({ ...current, [proposal.id]: value }))} />
                          )}
                          {proposal.status === "pending" && proposal.kind === "tag" && (
                            <TextField label={t("organization.editProposal")} value={drafts[proposal.id] ?? objectValue(proposal.proposed_value, "name")} onValueChange={(value) => setDrafts((current) => ({ ...current, [proposal.id]: value }))} />
                          )}
                          {proposal.rationale && <p>{proposal.rationale}</p>}
                          <div className="organization-evidence">
                            {proposal.evidence.map((evidence, index) => (
                              <Button key={`${proposal.id}-${index}`} size="sm" variant="text" onClick={() => void props.onPlayEvidence(proposal.audio_id, evidence.start_seconds || 0)}>
                                <MaterialIcon name="play_arrow" size={16} /> {evidence.quote || t("organization.playEvidence")}
                              </Button>
                            ))}
                          </div>
                          {proposal.status === "pending" && <div className="organization-decisions">
                            <Button size="sm" variant="filled" disabled={busy} onClick={() => void decide(proposal, "accepted")}>{t("organization.accept")}</Button>
                            <Button size="sm" variant="outlined" disabled={busy} onClick={() => void decide(proposal, "rejected")}>{t("organization.reject")}</Button>
                            <Button size="sm" variant="text" disabled={busy} onClick={() => void decide(proposal, "skipped")}>{t("organization.skip")}</Button>
                          </div>}
                        </article>
                      ))}
                    </section>
                  );
                })}
              </>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
