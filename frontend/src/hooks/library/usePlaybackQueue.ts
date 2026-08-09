import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { api } from "../../api";
import type { AudioItem } from "../../types";
import { useDialog } from "../../components/dialog/UnifiedDialog";
import type { ToastType } from "../useToast";
import { useTranslation } from "react-i18next";

type Notify = (message: string, type?: ToastType) => void;

type PlaybackSession = {
  version: 1;
  audio_ids: number[];
  current_audio_id: number | null;
};

type UsePlaybackQueueParams = {
  audioItems: AudioItem[];
  setAudioItems: Dispatch<SetStateAction<AudioItem[]>>;
  setPlaylistItemsRaw: Dispatch<SetStateAction<AudioItem[]>>;
  setSelected: Dispatch<SetStateAction<AudioItem | null>>;
  ensureBackendReady: () => Promise<void>;
  validationToken: number;
  notify: Notify;
};

export const PLAYBACK_SESSION_STORAGE_KEY = "local-audio-library-playback-session";
const MAX_PLAYBACK_QUEUE_SIZE = 500;

function readPlaybackSession(): PlaybackSession | null {
  try {
    const raw = window.localStorage.getItem(PLAYBACK_SESSION_STORAGE_KEY);
    if (!raw) return null;

    const value = JSON.parse(raw) as Partial<PlaybackSession>;
    if (value.version !== 1 || !Array.isArray(value.audio_ids)) return null;

    const audioIds = value.audio_ids.filter(
      (audioId): audioId is number => Number.isInteger(audioId) && audioId > 0
    ).slice(0, MAX_PLAYBACK_QUEUE_SIZE);
    const currentAudioId =
      Number.isInteger(value.current_audio_id) && Number(value.current_audio_id) > 0
        ? Number(value.current_audio_id)
        : null;

    return {
      version: 1,
      audio_ids: audioIds,
      current_audio_id: currentAudioId
    };
  } catch {
    return null;
  }
}

function writePlaybackSession(queue: AudioItem[], currentAudioId: number | null) {
  try {
    if (queue.length === 0) {
      window.localStorage.removeItem(PLAYBACK_SESSION_STORAGE_KEY);
      return;
    }

    const session: PlaybackSession = {
      version: 1,
      audio_ids: queue.map((item) => item.id),
      current_audio_id: currentAudioId
    };
    window.localStorage.setItem(PLAYBACK_SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch (error) {
    console.error("Failed to persist playback session", error);
  }
}

function restoredCurrentIndex(
  storedIds: number[],
  currentAudioId: number | null,
  resolved: AudioItem[]
): number {
  if (currentAudioId === null || resolved.length === 0) return -1;

  const exactIndex = resolved.findIndex((item) => item.id === currentAudioId);
  if (exactIndex >= 0) return exactIndex;

  const storedIndex = storedIds.indexOf(currentAudioId);
  if (storedIndex < 0) return -1;

  const resolvedIds = new Set(resolved.map((item) => item.id));
  const fallbackId =
    storedIds.slice(storedIndex + 1).find((audioId) => resolvedIds.has(audioId)) ??
    [...storedIds.slice(0, storedIndex)].reverse().find((audioId) => resolvedIds.has(audioId));

  return fallbackId === undefined
    ? -1
    : resolved.findIndex((item) => item.id === fallbackId);
}

export function usePlaybackQueue({
  audioItems,
  setAudioItems,
  setPlaylistItemsRaw,
  setSelected,
  ensureBackendReady,
  validationToken,
  notify
}: UsePlaybackQueueParams) {
  const dialog = useDialog();
  const { t } = useTranslation();
  const preserveStoredSessionOnceRef = useRef(false);

  const [playing, setPlaying] = useState<AudioItem | null>(null);
  const [playbackQueue, setPlaybackQueue] = useState<AudioItem[]>([]);
  const [playingIndex, setPlayingIndex] = useState(-1);
  const [playRequestId, setPlayRequestId] = useState(0);
  const [sessionHydrated, setSessionHydrated] = useState(false);
  const playbackQueueRef = useRef(playbackQueue);
  const playingRef = useRef(playing);

  playbackQueueRef.current = playbackQueue;
  playingRef.current = playing;

  useEffect(() => {
    const stored = readPlaybackSession();
    let canceled = false;

    if (!stored || stored.audio_ids.length === 0) {
      setSessionHydrated(true);
      return () => {
        canceled = true;
      };
    }

    async function restore() {
      try {
        await ensureBackendReady();
        const resolution = await api.resolvePlaybackQueue(stored!.audio_ids);
        if (canceled) return;

        const nextIndex = restoredCurrentIndex(
          stored!.audio_ids,
          stored!.current_audio_id,
          resolution.items
        );
        const current = nextIndex >= 0 ? resolution.items[nextIndex] : null;

        setPlaybackQueue(resolution.items);
        setPlayingIndex(nextIndex);
        setPlaying(current);
        setSessionHydrated(true);

        if (resolution.skipped.length > 0) {
          notify(
            t("queue.restoredSkipped", { count: resolution.skipped.length }),
            "info"
          );
        }
      } catch (error) {
        if (canceled) return;
        preserveStoredSessionOnceRef.current = true;
        setSessionHydrated(true);
        notify(
          t("queue.restoreFailed", { error: error instanceof Error ? error.message : String(error) }),
          "error"
        );
      }
    }

    void restore();

    return () => {
      canceled = true;
    };
  }, [ensureBackendReady, notify]);

  useEffect(() => {
    if (!sessionHydrated) return;

    const queueSnapshot = playbackQueueRef.current;
    if (queueSnapshot.length === 0) return;

    const storedIds = queueSnapshot.map((item) => item.id);
    const currentAudioId = playingRef.current?.id ?? null;
    let canceled = false;

    async function validateQueue() {
      try {
        await ensureBackendReady();
        const resolution = await api.resolvePlaybackQueue(storedIds);
        if (canceled) return;

        const currentIds = playbackQueueRef.current.map((item) => item.id);
        if (
          currentIds.length !== storedIds.length ||
          currentIds.some((audioId, index) => audioId !== storedIds[index])
        ) {
          return;
        }

        const nextIndex = restoredCurrentIndex(
          storedIds,
          currentAudioId,
          resolution.items
        );
        setPlaybackQueue(resolution.items);
        setPlayingIndex(nextIndex);
        setPlaying(nextIndex >= 0 ? resolution.items[nextIndex] : null);

        if (resolution.skipped.length > 0) {
          notify(
            t("queue.updatedSkipped", { count: resolution.skipped.length }),
            "info"
          );
        }
      } catch (error) {
        console.error("Failed to validate playback queue", error);
      }
    }

    void validateQueue();

    return () => {
      canceled = true;
    };
  }, [sessionHydrated, validationToken, ensureBackendReady, notify]);

  useEffect(() => {
    if (!sessionHydrated) return;

    if (preserveStoredSessionOnceRef.current) {
      preserveStoredSessionOnceRef.current = false;
      return;
    }

    writePlaybackSession(playbackQueue, playing?.id ?? null);
  }, [sessionHydrated, playbackQueue, playing?.id]);

  function handlePlaybackPositionSaved(audioId: number, position: number) {
    const lastPlayedAt = new Date().toISOString();

    const patch = (item: AudioItem): AudioItem =>
      item.id === audioId
        ? {
            ...item,
            last_position_seconds: position,
            last_played_at: lastPlayedAt
          }
        : item;

    setAudioItems((rows) => rows.map(patch));
    setPlaylistItemsRaw((rows) => rows.map(patch));
    setPlaybackQueue((rows) => rows.map(patch));
    setSelected((prev) => (prev ? patch(prev) : prev));
    setPlaying((prev) => (prev ? patch(prev) : prev));
  }

  async function playQueueIndex(index: number, queue: AudioItem[] = playbackQueue) {
    const item = queue[index];
    if (!item) return;

    setPlaybackQueue(queue);
    setPlayingIndex(index);
    setPlaying(item);
    setSelected(item);
    setPlayRequestId((value) => value + 1);

    await api.incrementPlayCount(item.id).catch(console.error);
  }

  async function playAudio(item: AudioItem, queue: AudioItem[] = audioItems) {
    const nextQueue = queue.length > 0 ? queue : [item];
    const index = Math.max(
      0,
      nextQueue.findIndex((row) => row.id === item.id)
    );

    await playQueueIndex(index, nextQueue);
  }

  async function playAudioAt(
    item: AudioItem,
    startSeconds: number,
    queue: AudioItem[] = audioItems
  ) {
    await playAudio(item, queue);

    window.setTimeout(() => {
      const audioEl = document.querySelector("audio");
      if (audioEl) {
        audioEl.currentTime = startSeconds;
        audioEl.play().catch(console.error);
      }
    }, 160);
  }

  function addToQueue(item: AudioItem) {
    if (playbackQueue.some((row) => row.id === item.id)) {
      notify(t("queue.alreadyAdded"), "info");
      return;
    }

    if (playbackQueue.length >= MAX_PLAYBACK_QUEUE_SIZE) {
      notify(t("queue.maximum", { count: MAX_PLAYBACK_QUEUE_SIZE }), "info");
      return;
    }

    setPlaybackQueue((rows) => [...rows, item]);
    notify(t("queue.added"), "success");
  }

  function playNextAudio(item: AudioItem) {
    if (playing?.id === item.id) {
      notify(t("queue.playing"), "info");
      return;
    }

    if (
      playbackQueue.length >= MAX_PLAYBACK_QUEUE_SIZE &&
      !playbackQueue.some((row) => row.id === item.id)
    ) {
      notify(t("queue.maximum", { count: MAX_PLAYBACK_QUEUE_SIZE }), "info");
      return;
    }

    const currentAudioId = playing?.id;
    const nextQueue = playbackQueue.filter((row) => row.id !== item.id);
    const currentIndex =
      currentAudioId === undefined
        ? -1
        : nextQueue.findIndex((row) => row.id === currentAudioId);
    const insertionIndex = currentIndex >= 0 ? currentIndex + 1 : 0;

    nextQueue.splice(insertionIndex, 0, item);
    setPlaybackQueue(nextQueue);
    setPlayingIndex(
      currentAudioId === undefined
        ? -1
        : nextQueue.findIndex((row) => row.id === currentAudioId)
    );
    notify(t("queue.playNext"), "success");
  }

  function playPrevious() {
    if (playingIndex <= 0) return;
    void playQueueIndex(playingIndex - 1, playbackQueue);
  }

  function playNext() {
    if (playingIndex < 0 || playingIndex >= playbackQueue.length - 1) return;
    void playQueueIndex(playingIndex + 1, playbackQueue);
  }

  async function removeQueueItem(index: number) {
    if (index < 0 || index >= playbackQueue.length) return;

    const nextQueue = playbackQueue.filter((_, rowIndex) => rowIndex !== index);

    if (index === playingIndex) {
      if (nextQueue.length === 0) {
        setPlaybackQueue([]);
        setPlayingIndex(-1);
        setPlaying(null);
        notify(t("queue.cleared"), "info");
        return;
      }

      const nextIndex = Math.min(index, nextQueue.length - 1);
      await playQueueIndex(nextIndex, nextQueue);
      notify(t("queue.removedCurrent"), "info");
      return;
    }

    setPlaybackQueue(nextQueue);

    if (index < playingIndex) {
      setPlayingIndex((value) => value - 1);
    }

    notify(t("queue.removed"), "success");
  }

  async function clearQueue() {
    if (playbackQueue.length === 0) return;

    const ok = await dialog.confirm({
      title: t("queue.clearTitle"),
      message: t("queue.clearMessage"),
      confirmLabel: t("queue.clearConfirm"),
      cancelLabel: t("common.actions.cancel"),
      tone: "warning"
    });

    if (!ok) return;

    setPlaybackQueue([]);
    setPlayingIndex(-1);
    setPlaying(null);
    notify(t("queue.cleared"), "info");
  }

  function moveQueueItem(sourceIndex: number, targetIndex: number) {
    if (
      sourceIndex < 0 ||
      targetIndex < 0 ||
      sourceIndex >= playbackQueue.length ||
      targetIndex >= playbackQueue.length ||
      sourceIndex === targetIndex
    ) {
      return;
    }

    const nextQueue = [...playbackQueue];
    const [moved] = nextQueue.splice(sourceIndex, 1);
    nextQueue.splice(targetIndex, 0, moved);

    let nextPlayingIndex = playingIndex;

    if (sourceIndex === playingIndex) {
      nextPlayingIndex = targetIndex;
    } else if (sourceIndex < playingIndex && targetIndex >= playingIndex) {
      nextPlayingIndex = playingIndex - 1;
    } else if (sourceIndex > playingIndex && targetIndex <= playingIndex) {
      nextPlayingIndex = playingIndex + 1;
    }

    setPlaybackQueue(nextQueue);
    setPlayingIndex(nextPlayingIndex);
    notify(t("queue.orderUpdated"), "success");
  }

  function handleAudioDeleted(audioId: number) {
    setSelected((prev) => (prev?.id === audioId ? null : prev));

    const removedIndex = playbackQueue.findIndex((item) => item.id === audioId);
    const currentWasDeleted =
      playing?.id === audioId ||
      (playingIndex >= 0 && playbackQueue[playingIndex]?.id === audioId);

    if (removedIndex >= 0) {
      const nextQueue = playbackQueue.filter((item) => item.id !== audioId);
      setPlaybackQueue(nextQueue);

      if (currentWasDeleted) {
        const nextIndex = nextQueue.length > 0
          ? Math.min(removedIndex, nextQueue.length - 1)
          : -1;
        setPlayingIndex(nextIndex);
        setPlaying(nextIndex >= 0 ? nextQueue[nextIndex] : null);
      } else {
        setPlayingIndex((prevIndex) => {
          if (prevIndex < 0) return -1;
          if (removedIndex < prevIndex) return prevIndex - 1;
          if (prevIndex >= nextQueue.length) return nextQueue.length - 1;
          return prevIndex;
        });
      }
    }

    if (playing?.id === audioId && removedIndex < 0) {
      setPlaying(null);
      setPlayingIndex(-1);
    }
  }

  return {
    playing,
    playbackQueue,
    playingIndex,
    playRequestId,
    playAudio,
    playAudioAt,
    addToQueue,
    playNextAudio,
    playPrevious,
    playNext,
    removeQueueItem,
    moveQueueItem,
    clearQueue,
    handlePlaybackPositionSaved,
    handleAudioDeleted
  };
}
