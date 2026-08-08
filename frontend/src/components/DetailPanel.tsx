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
import { Tabs } from "./ui";
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

type Props = {
  audio: AudioItem | null;
  refresh: () => void;
  onPlay: (a: AudioItem) => void;
  playlists: Playlist[];
  selectedPlaylistId?: number | null;
  onDeleted: (audioId: number) => void;
  notify?: (message: string, type?: ToastType) => void;
};

export default function DetailPanel({
  audio,
  refresh,
  onPlay,
  playlists,
  selectedPlaylistId,
  onDeleted,
  notify
}: Props) {
  const dialog = useDialog();

  const [activeTab, setActiveTab] = useState<InspectorTab>("overview");

  const [tags, setTags] = useState<Tag[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [selectedExistingTag, setSelectedExistingTag] = useState<NumericSelection>("");
  const [editing, setEditing] = useState<Partial<AudioItem>>({});
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

  useEffect(() => {
    let canceled = false;

    async function load() {
      setTranscript(null);
      setAiSuggestions(null);

      if (!audio) {
        setTags([]);
        setAllTags([]);
        setEditing({});
        setRelocatePath("");
        setSelectedExistingTag("");
        setTagInput("");
        setSelectedPlaylist("");
        lastLoadedAudioIdRef.current = null;
        return;
      }

      const audioIdChanged = lastLoadedAudioIdRef.current !== audio.id;
      lastLoadedAudioIdRef.current = audio.id;

      if (audioIdChanged) {
        setRelocatePath("");
        setSelectedExistingTag("");
        setTagInput("");
        setSelectedPlaylist("");
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

      setTags(detail.tags);
      setAllTags(tagRows);
      setTranscript(transcriptValue);
      setAiSuggestions(suggestionsValue);

      if (audioIdChanged) {
        setEditing({
          title_user: detail.audio.title_user || "",
          author_user: detail.audio.author_user || "",
          album_user: detail.audio.album_user || "",
          description_user: detail.audio.description_user || "",
          language: detail.audio.language || "",
          is_favorite: detail.audio.is_favorite
        });
      }
    }

    load().catch((err) => {
      if (canceled) return;
      console.error(err);
      notify?.(err instanceof Error ? err.message : String(err), "error");
    });

    return () => {
      canceled = true;
    };
  }, [
    audio?.id,
    audio?.updated_at,
    audio?.ai_status,
    audio?.transcript_status
  ]);

  if (!audio) {
    return <DetailEmptyState />;
  }

  function updateEditing(patch: EditingPatch) {
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
    try {
      await api.updateAudio(audio!.id, editing);
      notify?.("Metadata 已保存", "success");
      refresh();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
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
      notify?.("标签已添加", "success");
      refresh();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function addExistingTag() {
    if (!selectedExistingTag) return;

    const tag = allTags.find((row) => row.id === Number(selectedExistingTag));
    if (!tag) return;

    try {
      await api.addTags(audio!.id, [tag.name], "user");
      setSelectedExistingTag("");

      await reloadTagsAndSuggestions();
      notify?.("已有标签已添加", "success");
      refresh();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function removeTag(tagId: number) {
    try {
      await api.removeTag(audio!.id, tagId);

      await reloadTagsAndSuggestions();
      notify?.("标签已移除", "success");
      refresh();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function transcribe() {
    try {
      await api.transcribe(audio!.id);
      refresh();
      notify?.("已创建转写任务，可在设置中心的任务页查看状态。", "success");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function loadLatestTranscriptAfterConflict() {
    const latest = await api.getTranscript(audio!.id).catch(() => null);
    if (latest) setTranscript(latest);
    notify?.("检测到较新的 Transcript，当前草稿尚未保存。请加载最新版本后重新检查。", "error");
  }

  async function saveTranscriptEdit(
    fullText: string,
    expectedUpdatedAt: string
  ): Promise<"saved" | "conflict" | "error"> {
    if (!transcript) return "error";

    if (transcript.segments.length > 0) {
      const ok = await dialog.confirm({
        title: "保存 Transcript 修订？",
        message:
          `当前 transcript 包含 ${transcript.segments.length} 个时间轴分段。` +
          "保存全文修订后会清除这些分段，避免时间戳与文字不一致。",
        confirmLabel: "保存并清除分段",
        cancelLabel: "取消",
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
          ? `Transcript 已保存，并清除 ${updated.cleared_segments} 个旧分段`
          : "Transcript 已保存",
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
      notify?.(`已保存 ${updated.updated_segments || segments.length} 个分段修订`, "success");
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
        notify?.("请先在设置中心配置本地 LLM endpoint 和 model_name。", "error");
        return;
      }

      const warning = endpointPrivacyWarning(endpoint);
      if (warning) {
        const ok = await dialog.confirm({
          title: "确认使用非本机 LLM endpoint？",
          message: `${warning}\n\n确认继续发起 AI 分析？`,
          confirmLabel: "继续分析",
          cancelLabel: "取消",
          tone: "privacy"
        });

        if (!ok) return;
      }

      const task = await api.analyze(audio!.id);

      if (task.privacy_warning) {
        notify?.(task.privacy_warning, "error");
      }

      refresh();
      notify?.("已创建 AI 分析任务。完成后会显示 AI 建议描述和标签。", "success");
      setActiveTab("ai");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function addToPlaylist() {
    if (!selectedPlaylist) return;

    try {
      await api.addToPlaylist(Number(selectedPlaylist), audio!.id);
      notify?.("已添加到 playlist", "success");
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
      notify?.("AI 描述已接受为用户描述", "success");
      refresh();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function acceptAiTag(tagName: string) {
    try {
      await api.addTags(audio!.id, [tagName], "ai");

      await reloadTagsAndSuggestions();
      notify?.(`已接受标签：${tagName}`, "success");
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
      notify?.(`已接受 ${names.length} 个 AI 标签`, "success");
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
      notify?.("封面已上传", "success");
      refresh();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function deleteCover() {
    const ok = await dialog.confirm({
      title: "删除当前封面？",
      message: "确认删除当前封面？此操作会移除应用管理的封面文件。",
      confirmLabel: "删除封面",
      cancelLabel: "取消",
      tone: "danger",
      destructive: true
    });

    if (!ok) return;

    try {
      await api.deleteCover(audio!.id);
      setCoverVersion(Date.now());
      notify?.("封面已删除", "success");
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
      notify?.("文件已重新定位", "success");
      refresh();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function deleteFromDatabase() {
    const ok = await dialog.confirm({
      title: "从数据库移除音频？",
      message: "确认从应用数据库中移除该条目？不会删除本地音频文件。",
      confirmLabel: "移除条目",
      cancelLabel: "取消",
      tone: "danger",
      destructive: true
    });

    if (!ok) return;

    try {
      await api.deleteAudio(audio!.id, false);
      notify?.("音频条目已从数据库移除", "success");
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
    <aside className="inspector-panel">
      <DetailHero
        audio={audio}
        coverVersion={coverVersion}
        onPlay={onPlay}
        onTranscribe={transcribe}
        onAnalyze={analyze}
        onUploadCover={uploadCover}
      />

      <Tabs
        className="inspector-tabs"
        items={INSPECTOR_TABS}
        activeId={activeTab}
        onChange={setActiveTab}
        ariaLabel="音频详情分类"
        idPrefix="inspector"
      />

      <div
        className="inspector-body"
        role="tabpanel"
        id={`inspector-panel-${activeTab}`}
        aria-labelledby={`inspector-tab-${activeTab}`}
      >
        {activeTab === "overview" && (
          <OverviewTab
            audio={audio}
            editing={editing}
            onEditingChange={updateEditing}
            onSave={save}
            tags={tags}
            availableExistingTags={availableExistingTags}
            tagInput={tagInput}
            onTagInputChange={setTagInput}
            selectedExistingTag={selectedExistingTag}
            onSelectedExistingTagChange={setSelectedExistingTag}
            onAddTags={addTags}
            onAddExistingTag={addExistingTag}
            onRemoveTag={removeTag}
            playlists={playlists}
            selectedPlaylist={selectedPlaylist}
            onSelectedPlaylistChange={setSelectedPlaylist}
            selectedPlaylistId={selectedPlaylistId}
            onAddToPlaylist={addToPlaylist}
            onExportPlaylist={exportPlaylist}
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
            onDeleteCover={deleteCover}
            onDeleteFromDatabase={deleteFromDatabase}
          />
        )}
      </div>
    </aside>
  );
}
