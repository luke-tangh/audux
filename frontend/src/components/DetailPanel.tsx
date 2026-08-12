import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api, endpointPrivacyWarning } from "../api";
import type {
  AISuggestions,
  AudioItem,
  Playlist,
  Tag,
  Transcript,
  TranscriptSegmentEdit
} from "../types";
import { pickAudioFile } from "../tauri";
import { Button, PanelCard, Tabs } from "./ui";
import { useDialog } from "./dialog/UnifiedDialog";
import AiTab from "./detail/AiTab";
import DetailEmptyState from "./detail/DetailEmptyState";
import DetailHero from "./detail/DetailHero";
import FileTab from "./detail/FileTab";
import OverviewTab from "./detail/OverviewTab";
import TranscriptTab from "./detail/TranscriptTab";
import {
  INSPECTOR_TABS,
  type EditingPatch,
  type InspectorTab,
  type NumericSelection,
  type ToastType
} from "./detail/types";
import { useTranslation } from "react-i18next";
import { localizedPrivacyWarning } from "../i18n/errors";

type Props = {
  audio: AudioItem | null;
  refresh: () => void;
  onPlay: (a: AudioItem) => void;
  onAddToQueue: (a: AudioItem) => void;
  onPlayNext: (a: AudioItem) => void;
  playlists: Playlist[];
  selectedPlaylistId?: number | null;
  onDeleted: (audioId: number) => void;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  notify?: (message: string, type?: ToastType) => void;
};

export default function DetailPanel({
  audio,
  refresh,
  onPlay,
  onAddToQueue,
  onPlayNext,
  playlists,
  selectedPlaylistId,
  onDeleted,
  onClose,
  onDirtyChange,
  notify
}: Props) {
  const dialog = useDialog();
  const { t } = useTranslation();

  const [activeTab, setActiveTab] = useState<InspectorTab>("overview");

  const [tags, setTags] = useState<Tag[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [editing, setEditing] = useState<Partial<AudioItem>>({});
  const [metadataBaseline, setMetadataBaseline] = useState<Partial<AudioItem>>({});
  const [metadataLoaded, setMetadataLoaded] = useState(false);
  const [metadataLoadError, setMetadataLoadError] = useState("");
  const [detailLoadAttempt, setDetailLoadAttempt] = useState(0);
  const [isSavingMetadata, setIsSavingMetadata] = useState(false);
  const [metadataSaveError, setMetadataSaveError] = useState("");
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<AISuggestions | null>(null);
  const [selectedPlaylist, setSelectedPlaylist] = useState<NumericSelection>("");
  const [relocatePath, setRelocatePath] = useState("");
  const [coverVersion, setCoverVersion] = useState(Date.now());

  const lastLoadedAudioIdRef = useRef<number | null>(null);

  const acceptedTagNames = useMemo(() => {
    return new Set(tags.map((tag) => tag.name));
  }, [tags]);

  const availableExistingTags = useMemo(() => {
    return allTags.filter((tag) => !acceptedTagNames.has(tag.name));
  }, [allTags, acceptedTagNames]);

  const metadataDirty = [
    "title_user",
    "author_user",
    "album_user",
    "description_user",
    "language",
    "is_favorite"
  ].some((key) => editing[key as keyof AudioItem] !== metadataBaseline[key as keyof AudioItem]);

  useEffect(() => {
    onDirtyChange?.(metadataDirty);
    return () => onDirtyChange?.(false);
  }, [metadataDirty, onDirtyChange]);

  useEffect(() => {
    let canceled = false;

    async function load() {
      setTranscript(null);
      setAiSuggestions(null);

      if (!audio) {
        setTags([]);
        setAllTags([]);
        setEditing({});
        setMetadataLoaded(false);
        setMetadataLoadError("");
        setRelocatePath("");
        setTagInput("");
        setSelectedPlaylist("");
        setMetadataSaveError("");
        lastLoadedAudioIdRef.current = null;
        return;
      }

      const audioIdChanged = lastLoadedAudioIdRef.current !== audio.id;
      setMetadataLoadError("");

      if (audioIdChanged) {
        setMetadataLoaded(false);
        setRelocatePath("");
        setTagInput("");
        setSelectedPlaylist("");
        setMetadataSaveError("");
        setActiveTab("overview");
        setCoverVersion(Date.now());
      }

      const [detail, tagRows, transcriptValue, suggestionsValue] = await Promise.all([
        api.getAudioDetail(audio.id),
        api.listTags().catch(() => []),
        api.getTranscript(audio.id).catch(() => null),
        api.getAiSuggestions(audio.id).catch(() => null)
      ]);

      if (canceled) return;

      lastLoadedAudioIdRef.current = audio.id;
      setTags(detail.tags);
      setAllTags(tagRows);
      setTranscript(transcriptValue);
      setAiSuggestions(suggestionsValue);

      if (audioIdChanged) {
        const metadata = {
          title_user: detail.audio.title_user || "",
          author_user: detail.audio.author_user || "",
          album_user: detail.audio.album_user || "",
          description_user: detail.audio.description_user || "",
          language: detail.audio.language || "",
          is_favorite: detail.audio.is_favorite
        };
        setEditing(metadata);
        setMetadataBaseline(metadata);
        setMetadataLoaded(true);
      }
    }

    load().catch((err) => {
      if (canceled) return;
      console.error(err);
      const message = err instanceof Error ? err.message : String(err);
      setMetadataLoadError(message);
      notify?.(message, "error");
    });

    return () => {
      canceled = true;
    };
  }, [
    audio?.id,
    audio?.updated_at,
    audio?.ai_status,
    audio?.transcript_status,
    detailLoadAttempt
  ]);

  if (!audio) {
    return <DetailEmptyState />;
  }

  function updateEditing(patch: EditingPatch) {
    setMetadataSaveError("");
    setEditing((current) => ({
      ...current,
      ...patch
    }));
  }

  async function reloadTagsAndSuggestions() {
    const [detail, tagRows] = await Promise.all([
      api.getAudioDetail(audio!.id),
      api.listTags().catch(() => [])
    ]);

    setTags(detail.tags);
    setAllTags(tagRows);

    const suggestions = await api.getAiSuggestions(audio!.id).catch(() => null);
    setAiSuggestions(suggestions);
  }

  async function save() {
    if (isSavingMetadata) return;

    setIsSavingMetadata(true);
    setMetadataSaveError("");

    try {
      await api.updateAudio(audio!.id, editing);
      setMetadataBaseline({ ...editing });
      notify?.(t("detail.notifications.metadataSaved"), "success");
      refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setMetadataSaveError(message);
      notify?.(message, "error");
    } finally {
      setIsSavingMetadata(false);
    }
  }

  function discardMetadataChanges() {
    setEditing({ ...metadataBaseline });
    setMetadataSaveError("");
  }

  async function addTags() {
    const names = tagInput
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    if (names.length === 0) return;

    try {
      await api.addTags(audio!.id, names, "user");
      setTagInput("");

      await reloadTagsAndSuggestions();
      notify?.(t("detail.notifications.tagsAdded"), "success");
      refresh();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function removeTag(tagId: number) {
    try {
      await api.removeTag(audio!.id, tagId);

      await reloadTagsAndSuggestions();
      notify?.(t("detail.notifications.tagRemoved"), "success");
      refresh();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function transcribe() {
    try {
      await api.transcribe(audio!.id);
      refresh();
      notify?.(t("detail.notifications.transcribeCreated"), "success");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function loadLatestTranscriptAfterConflict() {
    const latest = await api.getTranscript(audio!.id).catch(() => null);
    if (latest) setTranscript(latest);
    notify?.(t("detail.notifications.transcriptConflict"), "error");
  }

  async function saveTranscriptEdit(
    fullText: string,
    expectedUpdatedAt: string
  ): Promise<"saved" | "conflict" | "error"> {
    if (!transcript) return "error";

    if (transcript.segments.length > 0) {
      const ok = await dialog.confirm({
        title: t("detail.saveTranscript.title"),
        message: t("detail.saveTranscript.message", { count: transcript.segments.length }),
        confirmLabel: t("detail.saveTranscript.confirm"),
        cancelLabel: t("common.actions.cancel"),
        tone: "warning"
      });

      if (!ok) return "error";
    }

    try {
      const updated = await api.updateTranscript(
        audio!.id,
        fullText,
        expectedUpdatedAt
      );
      setTranscript(updated);
      refresh();
      notify?.(
        updated.cleared_segments
          ? t("detail.notifications.transcriptSavedCleared", { count: updated.cleared_segments })
          : t("detail.notifications.transcriptSaved"),
        "success"
      );
      return "saved";
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        await loadLatestTranscriptAfterConflict();
        return "conflict";
      }

      notify?.(err instanceof Error ? err.message : String(err), "error");
      return "error";
    }
  }

  async function saveTranscriptSegments(
    segments: TranscriptSegmentEdit[],
    expectedUpdatedAt: string
  ): Promise<"saved" | "conflict" | "error"> {
    if (!transcript || segments.length === 0) return "error";

    try {
      const updated = await api.updateTranscriptSegments(
        audio!.id,
        segments,
        expectedUpdatedAt
      );
      setTranscript(updated);
      refresh();
      notify?.(t("detail.notifications.segmentsSaved", { count: updated.updated_segments || segments.length }), "success");
      return "saved";
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        await loadLatestTranscriptAfterConflict();
        return "conflict";
      }

      notify?.(err instanceof Error ? err.message : String(err), "error");
      return "error";
    }
  }

  async function analyze() {
    try {
      const settings = await api.listSettings();
      const endpoint = settings.find((setting) => setting.key === "llm.endpoint")?.value;
      const modelName = settings.find((setting) => setting.key === "llm.model_name")?.value;

      if (!endpoint || !modelName) {
        notify?.(t("detail.notifications.llmRequired"), "error");
        return;
      }

      const warning = endpointPrivacyWarning(endpoint);
      if (warning) {
        const ok = await dialog.confirm({
          title: t("detail.analyze.remoteTitle"),
          message: t("detail.analyze.remoteMessage", { warning }),
          confirmLabel: t("detail.analyze.continue"),
          cancelLabel: t("common.actions.cancel"),
          tone: "privacy"
        });

        if (!ok) return;
      }

      const task = await api.analyze(audio!.id);

      if (task.privacy_warning) {
        notify?.(
          localizedPrivacyWarning(t, task.privacy_warning_code, task.privacy_warning),
          "error"
        );
      }

      refresh();
      notify?.(t("detail.notifications.analyzeCreated"), "success");
      setActiveTab("ai");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function addToPlaylist() {
    if (!selectedPlaylist) return;

    try {
      await api.addToPlaylist(Number(selectedPlaylist), audio!.id);
      notify?.(t("detail.notifications.playlistAdded"), "success");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function acceptAiDescription() {
    const description = aiSuggestions?.description || audio?.description_ai;
    if (!description) return;

    try {
      await api.updateAudio(audio!.id, {
        description_user: description
      });

      updateEditing({ description_user: description });
      notify?.(t("detail.notifications.descriptionAccepted"), "success");
      refresh();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function acceptAiTag(tagName: string) {
    try {
      await api.addTags(audio!.id, [tagName], "ai");

      await reloadTagsAndSuggestions();
      notify?.(t("detail.notifications.tagAccepted", { name: tagName }), "success");
      refresh();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function acceptAllAiTags() {
    const names =
      aiSuggestions?.tags
        .map((value) => value.trim())
        .filter((value) => value && !acceptedTagNames.has(value)) || [];

    if (names.length === 0) return;

    try {
      await api.addTags(audio!.id, names, "ai");

      await reloadTagsAndSuggestions();
      notify?.(t("detail.notifications.tagsAccepted", { count: names.length }), "success");
      refresh();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  function jumpToSegment(startSeconds: number) {
    onPlay(audio!);

    setTimeout(() => {
      const audioEl = document.querySelector("audio");
      if (audioEl) {
        audioEl.currentTime = startSeconds;
        audioEl.play().catch(console.error);
      }
    }, 120);
  }

  async function uploadCover(file?: File) {
    if (!file) return;

    try {
      await api.uploadCover(audio!.id, file);
      setCoverVersion(Date.now());
      notify?.(t("detail.notifications.coverUploaded"), "success");
      refresh();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function deleteCover() {
    const ok = await dialog.confirm({
      title: t("detail.deleteCover.title"),
      message: t("detail.deleteCover.message"),
      confirmLabel: t("detail.file.deleteCover"),
      cancelLabel: t("common.actions.cancel"),
      tone: "danger",
      destructive: true
    });

    if (!ok) return;

    try {
      await api.deleteCover(audio!.id);
      setCoverVersion(Date.now());
      notify?.(t("detail.notifications.coverDeleted"), "success");
      refresh();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function chooseRelocateFile() {
    const selected = await pickAudioFile();
    if (selected) {
      setRelocatePath(selected);
    }
  }

  async function relocate() {
    const path = relocatePath.trim();
    if (!path) return;

    try {
      await api.relocateAudio(audio!.id, path);
      setRelocatePath("");
      notify?.(t("detail.notifications.relocated"), "success");
      refresh();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function deleteFromDatabase() {
    const ok = await dialog.confirm({
      title: t("detail.deleteAudio.title"),
      message: t("detail.deleteAudio.message"),
      confirmLabel: t("detail.deleteAudio.confirm"),
      cancelLabel: t("common.actions.cancel"),
      tone: "danger",
      destructive: true
    });

    if (!ok) return;

    try {
      await api.deleteAudio(audio!.id, false);
      notify?.(t("detail.notifications.audioRemoved"), "success");
      onDeleted(audio!.id);
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  function exportTranscript(format: "txt" | "json" | "srt") {
    window.open(api.transcriptExportUrl(audio!.id, format), "_blank");
  }

  function exportPlaylist(format: "json" | "m3u") {
    if (!selectedPlaylistId) return;
    window.open(api.playlistExportUrl(selectedPlaylistId, format), "_blank");
  }

  const aiDescription = aiSuggestions?.description || audio.description_ai;
  const aiTags = aiSuggestions?.tags || [];
  return (
    <aside
      className="inspector-panel"
      aria-label={t("detail.panelLabel")}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <DetailHero
        audio={audio}
        coverVersion={coverVersion}
        onPlay={onPlay}
        onAddToQueue={onAddToQueue}
        onPlayNext={onPlayNext}
        onTranscribe={transcribe}
        onAnalyze={analyze}
        onClose={onClose}
      />

      <Tabs
        className="inspector-tabs"
        items={INSPECTOR_TABS.map((id) => ({
          id,
          label: (
            <span className="inspector-tab-label">
              {t(`detail.tabs.${id}`)}
              {id === "overview" && metadataDirty ? (
                <span className="inspector-tab-dirty" aria-hidden="true" />
              ) : null}
            </span>
          )
        }))}
        activeId={activeTab}
        onChange={setActiveTab}
        ariaLabel={t("detail.tabsLabel")}
        idPrefix="inspector"
      />

      <div
        className="inspector-body"
        role="tabpanel"
        id={`inspector-panel-${activeTab}`}
        aria-labelledby={`inspector-tab-${activeTab}`}
      >
        {activeTab === "overview" && !metadataLoaded && (
          <PanelCard title={t("common.technical.metadata")}>
            {metadataLoadError ? (
              <div className="detail-load-error" role="alert">
                <p>{metadataLoadError}</p>
                <Button variant="outlined" onClick={() => setDetailLoadAttempt((value) => value + 1)}>
                  {t("common.actions.retry")}
                </Button>
              </div>
            ) : (
              <p className="muted" role="status">{t("detail.overview.loading")}</p>
            )}
          </PanelCard>
        )}

        {activeTab === "overview" && metadataLoaded && (
          <OverviewTab
            audio={audio}
            editing={editing}
            onEditingChange={updateEditing}
            tags={tags}
            availableExistingTags={availableExistingTags}
            tagInput={tagInput}
            onTagInputChange={setTagInput}
            onAddTags={addTags}
            onRemoveTag={removeTag}
            playlists={playlists}
            selectedPlaylist={selectedPlaylist}
            onSelectedPlaylistChange={setSelectedPlaylist}
            selectedPlaylistId={selectedPlaylistId}
            onAddToPlaylist={addToPlaylist}
            onExportPlaylist={exportPlaylist}
            transcriptLanguage={transcript?.transcript.language}
            isSaving={isSavingMetadata}
          />
        )}

        {activeTab === "ai" && (
          <AiTab
            description={aiDescription}
            aiTags={aiTags}
            acceptedTagNames={acceptedTagNames}
            rawContent={aiSuggestions?.raw_content}
            onAnalyze={analyze}
            onAcceptDescription={acceptAiDescription}
            onAcceptTag={acceptAiTag}
            onAcceptAllTags={acceptAllAiTags}
          />
        )}

        {activeTab === "transcript" && (
          <TranscriptTab
            transcript={transcript}
            onTranscribe={transcribe}
            onExportTranscript={exportTranscript}
            onJumpToSegment={jumpToSegment}
            onSaveFullTranscript={saveTranscriptEdit}
            onSaveTranscriptSegments={saveTranscriptSegments}
            canEdit={!["pending", "running", "cancel_requested"].includes(
              audio.transcript_status
            )}
          />
        )}

        {activeTab === "file" && (
          <FileTab
            audio={audio}
            relocatePath={relocatePath}
            onRelocatePathChange={setRelocatePath}
            onChooseRelocateFile={chooseRelocateFile}
            onRelocate={relocate}
            onUploadCover={uploadCover}
            onDeleteCover={deleteCover}
            onDeleteFromDatabase={deleteFromDatabase}
          />
        )}
      </div>

      {metadataDirty && (
        <div className="detail-save-bar" role="status">
          <div className="detail-save-message">
            <span>{t("detail.overview.unsavedChanges")}</span>
            {metadataSaveError ? <span role="alert">{metadataSaveError}</span> : null}
          </div>
          <div className="detail-save-actions">
            <Button
              variant="text"
              onClick={discardMetadataChanges}
              disabled={isSavingMetadata}
            >
              {t("detail.overview.discardChanges")}
            </Button>
            <Button variant="filled" onClick={save} disabled={isSavingMetadata}>
              {isSavingMetadata
                ? t("detail.overview.saving")
                : t("detail.overview.saveMetadata")}
            </Button>
          </div>
        </div>
      )}
    </aside>
  );
}
