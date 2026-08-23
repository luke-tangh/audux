import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

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

const TERMINAL = new Set(["done", "partial", "failed", "canceled", "interrupted"]);
const DEFAULT_OPTIONS: OrganizationRunOptions = {
  transcribe_missing: false,
  generate_corrections: true,
  generate_tags: true,
  generate_description: true,
  generate_chapters: true
};

function scopeValue(scope: AgentScope) {
  return JSON.stringify(scope);
}

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

  const scopeOptions = useMemo(() => {
    const values = [{ value: scopeValue({ kind: "library" }), label: t("agent.scope.library") }];
    if (props.selected) {
      values.push({
        value: scopeValue({ kind: "audio", audio_id: props.selected.id }),
        label: t("agent.scope.audio", { title: props.selected.title_user || props.selected.title_original || props.selected.file_name })
      });
    }
    if (props.selectedAudioIds.size) {
      values.push({
        value: scopeValue({ kind: "selection", audio_ids: [...props.selectedAudioIds].sort((a, b) => a - b) }),
        label: t("agent.scope.selection", { count: props.selectedAudioIds.size })
      });
    }
    if (props.selectedPlaylistId) {
      const playlist = props.playlists.find((row) => row.id === props.selectedPlaylistId);
      values.push({
        value: scopeValue({ kind: "playlist", playlist_id: props.selectedPlaylistId }),
        label: t("agent.scope.playlist", { name: playlist?.name || props.selectedPlaylistId })
      });
    }
    if (props.activeSavedViewId) {
      const view = props.savedViews.find((row) => row.id === props.activeSavedViewId);
      values.push({
        value: scopeValue({ kind: "saved_view", saved_view_id: props.activeSavedViewId }),
        label: t("agent.scope.savedView", { name: view?.name || props.activeSavedViewId })
      });
    }
    const tag = props.tags.find((row) => row.name === props.selectedTag);
    if (tag) values.push({ value: scopeValue({ kind: "tag", tag_id: tag.id }), label: t("agent.scope.tag", { name: tag.name }) });
    if (props.selectedLibraryRootId) {
      const root = props.roots.find((row) => row.id === props.selectedLibraryRootId);
      values.push({
        value: scopeValue({ kind: "library_root", library_root_id: props.selectedLibraryRootId }),
        label: t("agent.scope.root", { path: root?.path || props.selectedLibraryRootId })
      });
    }
    if (!values.some((option) => option.value === scopeValue(scope))) {
      values.push({ value: scopeValue(scope), label: t("agent.scope.current") });
    }
    return values;
  }, [props, scope, t]);

  async function loadRuns(preferredId?: number) {
    const rows = await api.listOrganizationRuns();
    setRuns(rows);
    const runId = preferredId ?? active?.id ?? rows[0]?.id;
    if (runId) setActive(await api.getOrganizationRun(runId));
    else setActive(null);
  }

  useEffect(() => {
    loadRuns()
      .catch((error) => props.notify(error instanceof Error ? error.message : String(error), "error"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!active || TERMINAL.has(active.status) || active.status === "awaiting_review") return;
    const timer = window.setInterval(() => {
      api.getOrganizationRun(active.id)
        .then((run) => {
          setActive(run);
          if (TERMINAL.has(run.status) || run.status === "awaiting_review") void loadRuns(run.id);
        })
        .catch((error) => props.notify(error instanceof Error ? error.message : String(error), "error"));
    }, 1200);
    return () => window.clearInterval(timer);
  }, [active?.id, active?.status]);

  async function createRun() {
    if (busy) return;
    setBusy(true);
    try {
      const run = await api.createOrganizationRun(scope, options);
      setActive(run);
      await loadRuns(run.id);
      props.notify(t("organization.created"), "success");
    } catch (error) {
      props.notify(error instanceof Error ? error.message : String(error), "error");
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
    setBusy(true);
    try {
      await api.decideOrganizationProposal(proposal.id, decision, decision === "accepted" ? editedValue(proposal) : undefined);
      setActive(await api.getOrganizationRun(proposal.run_id));
    } catch (error) {
      props.notify(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(false);
    }
  }

  async function applyCategory(kind: OrganizationProposalKind) {
    if (!active) return;
    setBusy(true);
    try {
      const run = await api.applyOrganizationRun(active.id, [kind]);
      setActive(run);
      await loadRuns(run.id);
      props.notify(t("organization.applied"), "success");
    } catch (error) {
      props.notify(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(false);
    }
  }

  async function runAction(action: "cancel" | "retry") {
    if (!active) return;
    setBusy(true);
    try {
      const run = action === "cancel"
        ? await api.cancelOrganizationRun(active.id)
        : await api.retryOrganizationRun(active.id);
      setActive(await api.getOrganizationRun(run.id));
      await loadRuns(run.id);
    } catch (error) {
      props.notify(error instanceof Error ? error.message : String(error), "error");
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
              value={scopeValue(scope)}
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
                <Button preserveChildren key={run.id} className={active?.id === run.id ? "organization-run active" : "organization-run"} onClick={() => void api.getOrganizationRun(run.id).then(setActive)}>
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
                    {!TERMINAL.has(active.status) && <Button size="sm" variant="text" disabled={busy} onClick={() => void runAction("cancel")}>{t("common.actions.cancel")}</Button>}
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
