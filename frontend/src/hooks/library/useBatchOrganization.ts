import { api } from "../../api";
import type {
  BatchOrganizationPayload,
  BatchOrganizationResult,
  Playlist,
  Tag
} from "../../types";
import { useDialog } from "../../components/dialog/UnifiedDialog";
import type { ToastType } from "../useToast";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

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

function resultMessage(t: TFunction, label: string, result: BatchOrganizationResult): string {
  return t("batch.organization.result", {
    label,
    changed: result.changed_count,
    unchanged: result.unchanged_count,
    duplicates: result.duplicate_count > 0 ? t("batch.organization.duplicates", { count: result.duplicate_count }) : "",
    errors: result.errors.length > 0 ? t("batch.organization.errors", { count: result.errors.length }) : ""
  });
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
  const { t } = useTranslation();

  async function execute(payload: BatchOrganizationPayload, label: string) {
    try {
      const result = await api.organizeAudioBatch(payload);
      notify(
        resultMessage(t, label, result),
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
      title: t("batch.organization.addTags"),
      message: t("batch.organization.addTagsMessage", { count: selectedAudioIds.length }),
      inputLabel: t("batch.organization.tagNames"),
      placeholder: t("batch.organization.tagPlaceholder"),
      required: true,
      confirmLabel: t("audioList.addTags"),
      cancelLabel: t("common.actions.cancel"),
      validate: (input) =>
        input.split(",").some((name) => name.trim()) ? null : t("batch.organization.tagRequired")
    });

    if (value === null) return;
    const tagNames = value
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);

    await execute(
      { audio_ids: selectedAudioIds, action: "add_tags", tag_names: tagNames },
      t("batch.organization.addTags")
    );
  }

  async function removeTag() {
    if (selectedAudioIds.length === 0) return;
    if (tags.length === 0) {
      notify(t("batch.organization.noTags"), "info");
      return;
    }

    const value = await dialog.prompt({
      title: t("batch.organization.removeTag"),
      message: t("batch.organization.removeTagMessage", { count: selectedAudioIds.length }),
      details: t("batch.organization.availableTags", { tags: tags.map((tag) => `#${tag.name}`).join(", ") }),
      inputLabel: t("batch.organization.fullTagName"),
      placeholder: tags[0]?.name,
      required: true,
      confirmLabel: t("audioList.removeTags"),
      cancelLabel: t("common.actions.cancel"),
      tone: "warning",
      validate: (input) =>
        tags.some((tag) => tag.name === input.trim())
          ? null
          : t("batch.organization.tagMissing")
    });

    if (value === null) return;
    const tag = tags.find((candidate) => candidate.name === value.trim());
    if (!tag) return;

    await execute(
      { audio_ids: selectedAudioIds, action: "remove_tags", tag_ids: [tag.id] },
      t("batch.organization.removeTag")
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
      notify(t("batch.organization.noPlaylists"), "info");
      return;
    }

    const value = await dialog.prompt({
      title: t("batch.organization.addPlaylist"),
      message: t("batch.organization.addPlaylistMessage", { count: selectedAudioIds.length }),
      details: t("batch.organization.availablePlaylists", { playlists: playlists
        .map((playlist) => `#${playlist.id} ${playlist.name}`)
        .join(", ") }),
      inputLabel: t("batch.organization.playlistInput"),
      placeholder: playlists[0]?.name,
      required: true,
      confirmLabel: t("audioList.addPlaylist"),
      cancelLabel: t("common.actions.cancel"),
      validate: (input) =>
        playlistFromInput(input)
          ? null
          : t("batch.organization.playlistMissing")
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
      t("batch.organization.addPlaylist")
    );
  }

  async function setFavorite(isFavorite: boolean) {
    if (selectedAudioIds.length === 0) return;

    const label = isFavorite ? t("batch.organization.favorite") : t("batch.organization.unfavorite");
    const ok = await dialog.confirm({
      title: `${label}？`,
      message: t("batch.organization.favoriteMessage", {
        action: isFavorite ? t("batch.organization.favoriteAction") : t("batch.organization.unfavoriteAction"),
        count: selectedAudioIds.length
      }),
      confirmLabel: isFavorite ? t("batch.organization.favoriteConfirm") : t("audioList.unfavorite"),
      cancelLabel: t("common.actions.cancel"),
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
