import type { Dispatch, SetStateAction } from "react";
import { api } from "../../api";
import type { AudioItem } from "../../types";
import { displayTitle } from "../../types";
import { useDialog } from "../../components/dialog/UnifiedDialog";
import type { ToastType } from "../useToast";
import { useTranslation } from "react-i18next";

type Notify = (message: string, type?: ToastType) => void;

type UsePlaylistActionsParams = {
  selectedPlaylistId: number | null;
  playlistItemsRaw: AudioItem[];
  setPlaylistItemsRaw: Dispatch<SetStateAction<AudioItem[]>>;
  setAudioItems: Dispatch<SetStateAction<AudioItem[]>>;
  setAudioTotal: Dispatch<SetStateAction<number>>;
  selected: AudioItem | null;
  setSelected: Dispatch<SetStateAction<AudioItem | null>>;
  notify: Notify;
  refresh: () => void;
};

export function usePlaylistActions({
  selectedPlaylistId,
  playlistItemsRaw,
  setPlaylistItemsRaw,
  setAudioItems,
  setAudioTotal,
  selected,
  setSelected,
  notify,
  refresh
}: UsePlaylistActionsParams) {
  const dialog = useDialog();
  const { t } = useTranslation();

  async function removeFromCurrentPlaylist(item: AudioItem) {
    if (!selectedPlaylistId || !item.playlist_item_id) return;

    const ok = await dialog.confirm({
      title: t("playlist.remove.title"),
      message: t("playlist.remove.message", { title: displayTitle(item) }),
      confirmLabel: t("common.actions.remove"),
      cancelLabel: t("common.actions.cancel"),
      tone: "warning"
    });

    if (!ok) return;

    try {
      await api.removePlaylistItem(selectedPlaylistId, item.playlist_item_id);

      setPlaylistItemsRaw((rows) =>
        rows.filter((row) => row.playlist_item_id !== item.playlist_item_id)
      );

      setAudioItems((rows) =>
        rows.filter((row) => row.playlist_item_id !== item.playlist_item_id)
      );

      setAudioTotal((value) => Math.max(0, value - 1));

      if (selected?.id === item.id) {
        setSelected(null);
      }

      notify(t("playlist.removed"), "success");
      refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function persistPlaylistOrder(nextRaw: AudioItem[]) {
    if (!selectedPlaylistId) return;

    const itemIds = nextRaw
      .map((item) => item.playlist_item_id)
      .filter((id): id is number => typeof id === "number");

    if (itemIds.length !== nextRaw.length) return;

    await api.reorderPlaylistItems(selectedPlaylistId, itemIds);

    const normalized = nextRaw.map((item, index) => ({
      ...item,
      playlist_order_index: index
    }));

    setPlaylistItemsRaw(normalized);

    const orderByPlaylistItemId = new Map<number, number>();

    normalized.forEach((item, index) => {
      if (typeof item.playlist_item_id === "number") {
        orderByPlaylistItemId.set(item.playlist_item_id, index);
      }
    });

    setAudioItems((rows) =>
      [...rows].sort((a, b) => {
        const left =
          typeof a.playlist_item_id === "number"
            ? orderByPlaylistItemId.get(a.playlist_item_id) ?? Number.MAX_SAFE_INTEGER
            : Number.MAX_SAFE_INTEGER;

        const right =
          typeof b.playlist_item_id === "number"
            ? orderByPlaylistItemId.get(b.playlist_item_id) ?? Number.MAX_SAFE_INTEGER
            : Number.MAX_SAFE_INTEGER;

        return left - right;
      })
    );
  }

  async function movePlaylistItem(item: AudioItem, direction: "up" | "down") {
    if (!selectedPlaylistId || !item.playlist_item_id) return;

    const currentIndex = playlistItemsRaw.findIndex(
      (row) => row.playlist_item_id === item.playlist_item_id
    );

    if (currentIndex < 0) return;

    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= playlistItemsRaw.length) return;

    const nextRaw = [...playlistItemsRaw];
    const tmp = nextRaw[currentIndex];
    nextRaw[currentIndex] = nextRaw[targetIndex];
    nextRaw[targetIndex] = tmp;

    try {
      await persistPlaylistOrder(nextRaw);
      notify(t("playlist.orderUpdated"), "success");
      refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function movePlaylistItemTo(source: AudioItem, target: AudioItem) {
    if (!selectedPlaylistId || !source.playlist_item_id || !target.playlist_item_id) return;
    if (source.playlist_item_id === target.playlist_item_id) return;

    const sourceIndex = playlistItemsRaw.findIndex(
      (row) => row.playlist_item_id === source.playlist_item_id
    );

    const targetIndex = playlistItemsRaw.findIndex(
      (row) => row.playlist_item_id === target.playlist_item_id
    );

    if (sourceIndex < 0 || targetIndex < 0) return;

    const nextRaw = [...playlistItemsRaw];
    const [moved] = nextRaw.splice(sourceIndex, 1);
    nextRaw.splice(targetIndex, 0, moved);

    try {
      await persistPlaylistOrder(nextRaw);
      notify(t("playlist.orderUpdated"), "success");
      refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  }

  return {
    removeFromCurrentPlaylist,
    movePlaylistItem,
    movePlaylistItemTo
  };
}
