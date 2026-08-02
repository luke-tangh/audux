import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { AudioItem } from "../types";
import { useBackendReady } from "./useBackendReady";
import { useToast } from "./useToast";
import {
  buildAudioListParams as buildAudioListParamsForState,
  buildPlaylistListParams as buildPlaylistListParamsForState,
  isBusyStatus,
  isSmartView,
  listCopyForView
} from "./library/filters";
import { useBatchTasks } from "./library/useBatchTasks";
import { useDebouncedValue } from "./library/useDebouncedValue";
import { useNavigationData } from "./library/useNavigationData";
import { usePlaybackQueue } from "./library/usePlaybackQueue";
import { usePlaylistActions } from "./library/usePlaylistActions";
import type {
  AudioListParams,
  MissingFilter,
  PlaylistListParams,
  TranscriptFilter,
  ViewMode
} from "./library/types";

export type { MissingFilter, TranscriptFilter, ViewMode } from "./library/types";

const AUDIO_PAGE_LIMIT = 120;

export function useLibraryController() {
  const [view, setView] = useState<ViewMode>("library");
  const [audioItems, setAudioItems] = useState<AudioItem[]>([]);
  const [audioTotal, setAudioTotal] = useState(0);
  const [audioHasMore, setAudioHasMore] = useState(false);
  const [searchLimited, setSearchLimited] = useState(false);
  const [searchLimit, setSearchLimit] = useState<number | null>(null);
  const [selected, setSelected] = useState<AudioItem | null>(null);

  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q, 240);
  const [selectedTag, setSelectedTag] = useState<string | undefined>();
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<number | null>(null);

  const [hasTranscriptFilter, setHasTranscriptFilter] = useState<TranscriptFilter>("all");
  const [missingFilter, setMissingFilter] = useState<MissingFilter>("all");

  const [playlistItemsRaw, setPlaylistItemsRaw] = useState<AudioItem[]>([]);
  const [refreshToken, setRefreshToken] = useState(0);

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState("");

  const loadSeqRef = useRef(0);
  const hasLoadedListRef = useRef(false);

  const { ensureBackendReady } = useBackendReady();
  const { toasts, notify, closeToast } = useToast();
  const { tags, playlists, loadNavigation } = useNavigationData();

  function refresh() {
    setRefreshToken((value) => value + 1);
  }

  function currentAudioListParams(): AudioListParams {
    return buildAudioListParamsForState({
      view,
      debouncedQ,
      selectedTag,
      hasTranscriptFilter,
      missingFilter
    });
  }

  function currentPlaylistListParams(): PlaylistListParams {
    return buildPlaylistListParamsForState({
      debouncedQ,
      selectedTag,
      hasTranscriptFilter,
      missingFilter
    });
  }

  async function load() {
    const loadSeq = ++loadSeqRef.current;
    const isListView = view !== "settings";

    if (isListView) {
      if (hasLoadedListRef.current) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
    } else {
      setLoading(false);
      setRefreshing(false);
    }

    setLoadError("");

    try {
      await ensureBackendReady();
      await loadNavigation();

      if (loadSeq !== loadSeqRef.current) return;

      if (view === "settings") {
        hasLoadedListRef.current = false;
        setAudioItems([]);
        setPlaylistItemsRaw([]);
        setAudioTotal(0);
        setAudioHasMore(false);
        setSearchLimited(false);
        setSearchLimit(null);
        return;
      }

      let items: AudioItem[] = [];
      let total = 0;
      let hasMore = false;
      let nextSearchLimited = false;
      let nextSearchLimit: number | null = null;

      if (view === "playlist") {
        if (!selectedPlaylistId) {
          setPlaylistItemsRaw([]);
          setAudioItems([]);
          setAudioTotal(0);
          setAudioHasMore(false);
          setSearchLimited(false);
          setSearchLimit(null);
          setSelected(null);
          return;
        }

        const [detail, page] = await Promise.all([
          api.getPlaylist(selectedPlaylistId, { include_disabled_roots: true }),
          api.listPlaylistItems(selectedPlaylistId, {
            ...currentPlaylistListParams(),
            limit: AUDIO_PAGE_LIMIT,
            offset: 0
          })
        ]);

        const rawItems: AudioItem[] = detail.items.map((row) => ({
          ...row.audio,
          playlist_item_id: row.playlist_item.id,
          playlist_order_index: row.playlist_item.order_index
        }));

        setPlaylistItemsRaw(rawItems);

        items = page.items;
        total = page.total;
        hasMore = page.has_more;
        nextSearchLimited = Boolean(page.search_limited);
        nextSearchLimit = page.search_limit ?? null;
      } else {
        setPlaylistItemsRaw([]);

        const page = await api.listAudioItems({
          ...currentAudioListParams(),
          limit: AUDIO_PAGE_LIMIT,
          offset: 0
        });

        items = page.items;
        total = page.total;
        hasMore = page.has_more;
        nextSearchLimited = Boolean(page.search_limited);
        nextSearchLimit = page.search_limit ?? null;
      }

      if (loadSeq !== loadSeqRef.current) return;

      setAudioItems(items);
      setAudioTotal(total);
      setAudioHasMore(hasMore);
      setSearchLimited(nextSearchLimited);
      setSearchLimit(nextSearchLimit);
      hasLoadedListRef.current = true;

      setSelected((prev) => {
        if (items.length === 0) return null;

        if (prev) {
          const found = items.find((item) => item.id === prev.id);
          if (found) return found;
        }

        return items[0];
      });
    } catch (err) {
      if (loadSeq !== loadSeqRef.current) return;

      const message = err instanceof Error ? err.message : String(err);
      setLoadError(message);
      throw err;
    } finally {
      if (loadSeq === loadSeqRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }

  async function loadMoreAudioItems() {
    if (view === "settings" || loadingMore || !audioHasMore) {
      return;
    }

    if (view === "playlist" && !selectedPlaylistId) {
      return;
    }

    setLoadingMore(true);

    try {
      await ensureBackendReady();

      if (view === "playlist" && selectedPlaylistId) {
        const page = await api.listPlaylistItems(selectedPlaylistId, {
          ...currentPlaylistListParams(),
          limit: AUDIO_PAGE_LIMIT,
          offset: audioItems.length
        });

        setAudioItems((rows) => [...rows, ...page.items]);
        setAudioTotal(page.total);
        setAudioHasMore(page.has_more);
        setSearchLimited(Boolean(page.search_limited));
        setSearchLimit(page.search_limit ?? null);
      } else {
        const page = await api.listAudioItems({
          ...currentAudioListParams(),
          limit: AUDIO_PAGE_LIMIT,
          offset: audioItems.length
        });

        setAudioItems((rows) => [...rows, ...page.items]);
        setAudioTotal(page.total);
        setAudioHasMore(page.has_more);
        setSearchLimited(Boolean(page.search_limited));
        setSearchLimit(page.search_limit ?? null);
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    load().catch((err) => {
      console.error(err);
      notify(err instanceof Error ? err.message : String(err), "error");
    });
  }, [
    view,
    debouncedQ,
    selectedTag,
    selectedPlaylistId,
    hasTranscriptFilter,
    missingFilter,
    refreshToken
  ]);

  const hasBusyVisibleTask =
    audioItems.some(
      (item) => isBusyStatus(item.ai_status) || isBusyStatus(item.transcript_status)
    ) ||
    Boolean(
      selected &&
        (isBusyStatus(selected.ai_status) || isBusyStatus(selected.transcript_status))
    );

  useEffect(() => {
    if (view === "settings") return;
    if (!hasBusyVisibleTask) return;

    const timer = window.setInterval(() => {
      refresh();
    }, 3000);

    return () => window.clearInterval(timer);
  }, [
    view,
    hasBusyVisibleTask,
    selected?.id,
    selected?.ai_status,
    selected?.transcript_status,
    audioItems.length
  ]);

  function clearFilters() {
    setQ("");
    setSelectedTag(undefined);
    setHasTranscriptFilter("all");
    setMissingFilter("all");

    if (isSmartView(view)) {
      setView("library");
    }
  }

  function openSettings() {
    setView("settings");
    setSelectedTag(undefined);
    setSelectedPlaylistId(null);
  }

  const playback = usePlaybackQueue({
    audioItems,
    setAudioItems,
    setPlaylistItemsRaw,
    setSelected,
    notify
  });

  const batchTasks = useBatchTasks({
    view,
    selectedPlaylistId,
    searchLimited,
    searchLimit,
    debouncedQ,
    ensureBackendReady,
    buildAudioListParams: currentAudioListParams,
    buildPlaylistListParams: currentPlaylistListParams,
    notify,
    refresh
  });

  const playlistActions = usePlaylistActions({
    selectedPlaylistId,
    playlistItemsRaw,
    setPlaylistItemsRaw,
    setAudioItems,
    setAudioTotal,
    selected,
    setSelected,
    notify,
    refresh
  });

  function handleAudioDeleted(audioId: number) {
    playback.handleAudioDeleted(audioId);
    refresh();
  }

  const { listTitle, listSubtitle } = listCopyForView(
    view,
    playlists,
    selectedPlaylistId
  );

  const hasActiveFilter =
    Boolean(q.trim()) ||
    Boolean(selectedTag) ||
    hasTranscriptFilter !== "all" ||
    missingFilter !== "all" ||
    isSmartView(view);

  return {
    view,
    setView,

    audioItems,
    audioTotal,
    audioHasMore,
    searchLimited,
    searchLimit,
    selected,
    setSelected,

    playing: playback.playing,
    playbackQueue: playback.playbackQueue,
    playingIndex: playback.playingIndex,

    q,
    setQ,
    selectedTag,
    setSelectedTag,
    selectedPlaylistId,
    setSelectedPlaylistId,

    hasTranscriptFilter,
    setHasTranscriptFilter,
    missingFilter,
    setMissingFilter,

    tags,
    playlists,

    loading,
    refreshing,
    loadingMore,
    loadError,

    listTitle,
    listSubtitle,
    hasActiveFilter,

    toasts,
    notify,
    closeToast,

    refresh,
    clearFilters,
    openSettings,
    loadMoreAudioItems,

    playAudio: playback.playAudio,
    playAudioAt: playback.playAudioAt,
    playPrevious: playback.playPrevious,
    playNext: playback.playNext,
    removeQueueItem: playback.removeQueueItem,
    moveQueueItem: playback.moveQueueItem,
    clearQueue: playback.clearQueue,
    handlePlaybackPositionSaved: playback.handlePlaybackPositionSaved,

    batchTranscribeCurrentList: batchTasks.batchTranscribeCurrentList,
    batchAnalyzeCurrentList: batchTasks.batchAnalyzeCurrentList,

    removeFromCurrentPlaylist: playlistActions.removeFromCurrentPlaylist,
    movePlaylistItem: playlistActions.movePlaylistItem,
    movePlaylistItemTo: playlistActions.movePlaylistItemTo,
    handleAudioDeleted
  };
}
