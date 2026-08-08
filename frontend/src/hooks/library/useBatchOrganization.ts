import { api } from "../../api";
import type {
  BatchOrganizationPayload,
  BatchOrganizationResult,
  Playlist,
  Tag
} from "../../types";
import { useDialog } from "../../components/dialog/UnifiedDialog";
import type { ToastType } from "../useToast";

type Notify = (message: string, type?: ToastType) => void;

type UseBatchOrganizationParams = {
  selectedAudioIds: number[];
  tags: Tag[];
  playlists: Playlist[];
  clearSelection: () => void;
  loadNavigation: () => Promise<void>;
  refresh: () => void;
  notify: Notify;
};

function resultMessage(label: string, result: BatchOrganizationResult): string {
  const parts = [
    `${label}完成：修改 ${result.changed_count} 个`,
    `未变化 ${result.unchanged_count} 个`
  ];

  if (result.duplicate_count > 0) {
    parts.push(`重复 ID ${result.duplicate_count} 个`);
  }

  if (result.errors.length > 0) {
    parts.push(`错误 ${result.errors.length} 个`);
  }

  return `${parts.join("，")}。`;
}

export function useBatchOrganization({
  selectedAudioIds,
  tags,
  playlists,
  clearSelection,
  loadNavigation,
  refresh,
  notify
}: UseBatchOrganizationParams) {
  const dialog = useDialog();

  async function execute(payload: BatchOrganizationPayload, label: string) {
    try {
      const result = await api.organizeAudioBatch(payload);
      notify(
        resultMessage(label, result),
        result.errors.length > 0 ? "info" : "success"
      );
      clearSelection();
      await loadNavigation();
      refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function addTags() {
    if (selectedAudioIds.length === 0) return;

    const value = await dialog.prompt({
      title: "批量添加标签",
      message: `将为已选 ${selectedAudioIds.length} 个音频添加标签。多个标签请用逗号分隔。`,
      inputLabel: "标签名称",
      placeholder: "学习, 待整理",
      required: true,
      confirmLabel: "添加标签",
      cancelLabel: "取消",
      validate: (input) =>
        input.split(",").some((name) => name.trim()) ? null : "请至少输入一个标签"
    });

    if (value === null) return;
    const tagNames = value
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);

    await execute(
      { audio_ids: selectedAudioIds, action: "add_tags", tag_names: tagNames },
      "批量添加标签"
    );
  }

  async function removeTag() {
    if (selectedAudioIds.length === 0) return;
    if (tags.length === 0) {
      notify("当前没有可移除的标签。", "info");
      return;
    }

    const value = await dialog.prompt({
      title: "批量移除标签",
      message: `将从已选 ${selectedAudioIds.length} 个音频移除一个现有标签。`,
      details: `可用标签：${tags.map((tag) => `#${tag.name}`).join("、")}`,
      inputLabel: "标签完整名称",
      placeholder: tags[0]?.name,
      required: true,
      confirmLabel: "移除标签",
      cancelLabel: "取消",
      tone: "warning",
      validate: (input) =>
        tags.some((tag) => tag.name === input.trim())
          ? null
          : "标签不存在，请输入现有标签的完整名称"
    });

    if (value === null) return;
    const tag = tags.find((candidate) => candidate.name === value.trim());
    if (!tag) return;

    await execute(
      { audio_ids: selectedAudioIds, action: "remove_tags", tag_ids: [tag.id] },
      "批量移除标签"
    );
  }

  function playlistFromInput(value: string): Playlist | undefined {
    const normalized = value.trim();
    const idMatch = normalized.match(/^#(\d+)$/);
    if (idMatch) {
      return playlists.find((playlist) => playlist.id === Number(idMatch[1]));
    }

    const matches = playlists.filter((playlist) => playlist.name === normalized);
    return matches.length === 1 ? matches[0] : undefined;
  }

  async function addToPlaylist() {
    if (selectedAudioIds.length === 0) return;
    if (playlists.length === 0) {
      notify("请先创建 Playlist。", "info");
      return;
    }

    const value = await dialog.prompt({
      title: "批量加入 Playlist",
      message: `将把已选 ${selectedAudioIds.length} 个音频加入一个 Playlist。`,
      details: `可用 Playlist：${playlists
        .map((playlist) => `#${playlist.id} ${playlist.name}`)
        .join("、")}`,
      inputLabel: "Playlist 名称或 #ID",
      placeholder: playlists[0]?.name,
      required: true,
      confirmLabel: "加入 Playlist",
      cancelLabel: "取消",
      validate: (input) =>
        playlistFromInput(input)
          ? null
          : "Playlist 不存在或名称不唯一，请输入列表中的 #ID"
    });

    if (value === null) return;
    const playlist = playlistFromInput(value);
    if (!playlist) return;

    await execute(
      {
        audio_ids: selectedAudioIds,
        action: "add_to_playlist",
        playlist_id: playlist.id
      },
      "批量加入 Playlist"
    );
  }

  async function setFavorite(isFavorite: boolean) {
    if (selectedAudioIds.length === 0) return;

    const label = isFavorite ? "批量收藏" : "批量取消收藏";
    const ok = await dialog.confirm({
      title: `${label}？`,
      message: `将${isFavorite ? "收藏" : "取消收藏"}已选 ${selectedAudioIds.length} 个音频。`,
      confirmLabel: isFavorite ? "设为收藏" : "取消收藏",
      cancelLabel: "取消",
      tone: "warning"
    });
    if (!ok) return;

    await execute(
      {
        audio_ids: selectedAudioIds,
        action: "set_favorite",
        is_favorite: isFavorite
      },
      label
    );
  }

  return {
    addTags,
    removeTag,
    addToPlaylist,
    setFavorite
  };
}
