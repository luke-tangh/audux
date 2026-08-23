import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { api } from "../api";
import type {
  AgentConversation,
  AgentRun,
  AgentScope,
  AudioItem,
  LibraryRoot,
  Playlist,
  SavedView,
  Tag
} from "../types";
import { formatDuration } from "../types";
import { Button, IconButton, MaterialIcon, SelectField, TextField, TextareaField } from "./ui";
import { usePolling } from "../hooks/usePolling";
import { serializeAgentScope, useAgentScopeOptions } from "../hooks/useAgentScopeOptions";

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
  onPlayCitation: (audioId: number, seconds: number) => Promise<void>;
};

const TERMINAL_RUN_STATUSES = new Set(["done", "failed", "canceled"]);

export default function AgentPanel(props: Props) {
  const { t } = useTranslation();
  const [conversations, setConversations] = useState<AgentConversation[]>([]);
  const [active, setActive] = useState<AgentConversation | null>(null);
  const [scope, setScope] = useState<AgentScope>({ kind: "library" });
  const [question, setQuestion] = useState("");
  const [activeRun, setActiveRun] = useState<AgentRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [planAction, setPlanAction] = useState<"approve" | "reject" | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);

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
    roots: props.roots,
    currentLabel: active?.scope_label
  });

  const runBusy = Boolean(
    activeRun && (
      !TERMINAL_RUN_STATUSES.has(activeRun.status) ||
      activeRun.operation_plan?.status === "awaiting_approval"
    )
  );

  async function loadConversation(id: number) {
    const detail = await api.getAgentConversation(id);
    setActive(detail);
    setScope(detail.scope);
    setTitle(detail.title);
    const latest = [...(detail.runs || [])].reverse()[0];
    setActiveRun(
      latest && (
        (latest.status !== "done" && latest.status !== "canceled") ||
        Boolean(latest.operation_plan)
      ) ? latest : null
    );
    return detail;
  }

  async function loadConversations(preferredId?: number | null) {
    const rows = await api.listAgentConversations();
    setConversations(rows);
    const id = preferredId === null ? rows[0]?.id : preferredId ?? active?.id ?? rows[0]?.id;
    if (id) await loadConversation(id);
    else {
      setActive(null);
      setActiveRun(null);
    }
  }

  useEffect(() => {
    loadConversations()
      .catch((error) => props.notify(error instanceof Error ? error.message : String(error), "error"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (typeof messageEndRef.current?.scrollIntoView === "function") {
      messageEndRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [active?.messages?.length, activeRun?.status]);

  useEffect(() => {
    setConfirmDelete(false);
    setEditingTitle(false);
  }, [active?.id]);

  usePolling({
    enabled: Boolean(activeRun && !TERMINAL_RUN_STATUSES.has(activeRun.status)),
    intervalMs: 1000,
    task: async () => {
      if (!activeRun) return;
      const run = await api.getAgentRun(activeRun.id);
      setActiveRun(run);
      if (TERMINAL_RUN_STATUSES.has(run.status)) {
        await loadConversation(run.conversation_id);
        await loadConversations(run.conversation_id);
        setActiveRun(run);
      }
    },
    onError: (error) =>
      props.notify(error instanceof Error ? error.message : String(error), "error")
  });

  async function changeScope(value: string) {
    const next = JSON.parse(value) as AgentScope;
    if (!active) {
      setScope(next);
      return;
    }
    try {
      const updated = await api.updateAgentConversation(active.id, { scope: next });
      setScope(updated.scope);
      setActive((current) => current ? { ...current, ...updated } : current);
      await loadConversations(updated.id);
    } catch (error) {
      props.notify(error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function send() {
    const content = question.trim();
    if (!content || sending || runBusy) return;
    setSending(true);
    try {
      let conversation = active;
      if (!conversation) {
        conversation = await api.createAgentConversation({ scope });
        setActive(conversation);
        setTitle(conversation.title);
      }
      const run = await api.createAgentRun(conversation.id, content);
      setQuestion("");
      setActiveRun(run);
      await loadConversation(conversation.id);
      await loadConversations(conversation.id);
    } catch (error) {
      props.notify(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setSending(false);
    }
  }

  async function saveTitle() {
    if (!active || !title.trim()) return;
    try {
      await api.updateAgentConversation(active.id, { title: title.trim() });
      setEditingTitle(false);
      await loadConversations(active.id);
    } catch (error) {
      props.notify(error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function removeConversation() {
    if (!active) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    try {
      await api.deleteAgentConversation(active.id);
      setActive(null);
      setActiveRun(null);
      setConfirmDelete(false);
      await loadConversations(null);
    } catch (error) {
      props.notify(error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function decideOperationPlan(decision: "approve" | "reject") {
    const plan = activeRun?.operation_plan;
    if (!plan || plan.status !== "awaiting_approval" || planAction) return;
    setPlanAction(decision);
    try {
      const updated = decision === "approve"
        ? await api.approveAgentOperationPlan(plan.id, plan.fingerprint)
        : await api.rejectAgentOperationPlan(plan.id);
      setActiveRun((current) => current ? { ...current, operation_plan: updated } : current);
      props.notify(
        decision === "approve" ? t("agent.plan.executed") : t("agent.plan.rejected"),
        decision === "approve" ? "success" : "info"
      );
      if (active) await loadConversations(active.id);
    } catch (error) {
      props.notify(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setPlanAction(null);
    }
  }

  return (
    <main className="workspace agent-workspace">
      <section className="agent-panel" aria-labelledby="agent-title">
        <header className="agent-header">
          <div>
            <p className="agent-eyebrow"><MaterialIcon name="verified" size={17} /> {t("agent.readOnly")}</p>
            <h1 id="agent-title">{t("agent.title")}</h1>
            <p>{t("agent.subtitle")}</p>
          </div>
          <Button variant="tonal" leadingIcon={<MaterialIcon name="add_comment" size={18} />} onClick={() => {
            setActive(null);
            setActiveRun(null);
            setScope({ kind: "library" });
            setQuestion("");
            setEditingTitle(false);
          }}>{t("agent.newConversation")}</Button>
        </header>

        <div className="agent-body">
          <aside className="agent-conversations" aria-label={t("agent.conversations")}>
            {loading && <p className="agent-empty">{t("common.status.running")}</p>}
            {!loading && conversations.length === 0 && <p className="agent-empty">{t("agent.noConversations")}</p>}
            {conversations.map((conversation) => (
              <button
                type="button"
                key={conversation.id}
                className={active?.id === conversation.id ? "agent-conversation active" : "agent-conversation"}
                aria-current={active?.id === conversation.id ? "page" : undefined}
                onClick={() => void loadConversation(conversation.id)}
              >
                <strong>{conversation.title}</strong>
                <span>{conversation.scope_label}</span>
              </button>
            ))}
          </aside>

          <div className="agent-chat">
            <div className="agent-toolbar">
              {editingTitle && active ? (
                <form onSubmit={(event) => { event.preventDefault(); void saveTitle(); }} className="agent-title-form">
                  <TextField hideLabel label={t("agent.rename")} value={title} onValueChange={setTitle} />
                  <Button size="sm" variant="filled" type="submit">{t("common.actions.save")}</Button>
                </form>
              ) : (
                <strong>{active?.title || t("agent.newConversation")}</strong>
              )}
              {active && !editingTitle && <div className="agent-actions">
                <IconButton size="sm" label={t("agent.rename")} onClick={() => setEditingTitle(true)}><MaterialIcon name="edit" size={18} /></IconButton>
                <a className="agent-export" href={api.agentConversationExportUrl(active.id)} target="_blank" rel="noreferrer" aria-label={t("agent.export")}><MaterialIcon name="download" size={18} /></a>
                <IconButton size="sm" variant={confirmDelete ? "danger" : "plain"} label={confirmDelete ? t("agent.confirmDelete") : t("agent.delete")} onClick={() => void removeConversation()}><MaterialIcon name="delete" size={18} /></IconButton>
              </div>}
            </div>

            <div className="agent-messages" aria-live="polite">
              {!active?.messages?.length && <div className="agent-welcome"><MaterialIcon name="travel_explore" size={36} /><h2>{t("agent.welcomeTitle")}</h2><p>{t("agent.welcomeBody")}</p></div>}
              {active?.messages?.map((message) => (
                <article key={message.id} className={`agent-message ${message.role}`}>
                  <span className="agent-message-role">{message.role === "user" ? t("agent.you") : t("agent.name")}</span>
                  <p>{message.content}</p>
                  {message.citations.length > 0 && <div className="agent-citations">
                    {message.citations.map((citation) => (
                      <button type="button" key={citation.id} className="agent-citation" onClick={() => void props.onPlayCitation(citation.audio_id, citation.start_seconds || 0)}>
                        <span>[{citation.label}] {citation.audio_title} · {formatDuration(citation.start_seconds || 0)}</span>
                        <q>{citation.quote}</q>
                      </button>
                    ))}
                  </div>}
                </article>
              ))}
              {activeRun?.operation_plan && (
                <section className="agent-operation-plan" aria-label={t("agent.plan.title")}>
                  <div className="agent-operation-plan-heading">
                    <div>
                      <strong>{t("agent.plan.title")}</strong>
                      <p>{activeRun.operation_plan.summary}</p>
                    </div>
                    <span className={`agent-plan-status ${activeRun.operation_plan.status}`}>
                      {t(`agent.plan.status.${activeRun.operation_plan.status}`, { defaultValue: activeRun.operation_plan.status })}
                    </span>
                  </div>
                  <p className="agent-plan-warning">{t("agent.plan.warning")}</p>
                  <div className="agent-operation-items">
                    {activeRun.operation_plan.items.map((item) => (
                      <article key={item.id} className="agent-operation-item">
                        <strong>{t(`agent.plan.tool.${item.tool_name}`, { defaultValue: item.tool_name })}</strong>
                        {item.audio_id && <span>audio_id: {item.audio_id}</span>}
                        <div className="agent-operation-diff">
                          <code>{JSON.stringify(item.before)}</code>
                          <MaterialIcon name="arrow_forward" size={16} />
                          <code>{JSON.stringify(item.after)}</code>
                        </div>
                      </article>
                    ))}
                  </div>
                  {activeRun.operation_plan.status === "awaiting_approval" && (
                    <div className="agent-plan-actions">
                      <Button variant="outlined" disabled={planAction !== null} onClick={() => void decideOperationPlan("reject")}>
                        {t("agent.plan.reject")}
                      </Button>
                      <Button variant="filled" disabled={planAction !== null} onClick={() => void decideOperationPlan("approve")}>
                        {t("agent.plan.approve")}
                      </Button>
                    </div>
                  )}
                  {activeRun.operation_plan.error_message && <p className="agent-error">{activeRun.operation_plan.error_message}</p>}
                </section>
              )}
              {activeRun && !TERMINAL_RUN_STATUSES.has(activeRun.status) && <div className="agent-running"><span className="activity-spinner" /> {t("agent.running")} <Button size="sm" onClick={() => void api.cancelAgentRun(activeRun.id).then(setActiveRun).catch((error) => props.notify(error instanceof Error ? error.message : String(error), "error"))}>{t("common.actions.cancel")}</Button></div>}
              {activeRun?.status === "failed" && <div className="agent-error" role="alert">{activeRun.error_message || t("agent.failed")}</div>}
              <div ref={messageEndRef} />
            </div>

            <form className="agent-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
              <div className="agent-composer-surface">
                <div className="agent-composer-context">
                  <div className="agent-scope-control">
                    <MaterialIcon name="filter_list" size={17} />
                    <SelectField
                      hideLabel
                      label={t("agent.scopeLabel")}
              value={serializeAgentScope(scope)}
                      options={scopeOptions}
                      onValueChange={(value) => void changeScope(value)}
                      disabled={runBusy}
                      controlSize="mini"
                      controlMinWidth={180}
                      controlMaxWidth="min(100%, 360px)"
                      variant="outlined"
                    />
                  </div>
                  <p className="agent-mode"><MaterialIcon name="search" size={16} /> {t("agent.retrievalMode", { mode: activeRun?.retrieval_mode?.toUpperCase() || "FTS" })}</p>
                </div>
                <div className="agent-question-row">
                  <TextareaField
                    hideLabel
                    wrapperClassName="agent-question-field"
                    label={t("agent.question")}
                    placeholder={t("agent.placeholder")}
                    value={question}
                    onValueChange={setQuestion}
                    disabled={runBusy || sending}
                    rows={3}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void send();
                      }
                    }}
                  />
                  <Button className="agent-send" type="submit" variant="filled" disabled={!question.trim() || runBusy || sending} leadingIcon={<MaterialIcon name="send" size={18} />}>{t("agent.send")}</Button>
                </div>
              </div>
              <p className="agent-composer-hint">{t("agent.inputHint")}</p>
            </form>
          </div>
        </div>
      </section>
    </main>
  );
}
