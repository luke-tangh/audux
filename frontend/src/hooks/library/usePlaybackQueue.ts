import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { api } from "../../api";
import type { AudioItem } from "../../types";
import { useDialog } from "../../components/dialog/UnifiedDialog";
import type { ToastType } from "../useToast";

type Notify = (message: string, type?: ToastType) => void;

type UsePlaybackQueueParams = {
  audioItems: AudioItem[];
  setAudioItems: Dispatch<SetStateAction<AudioItem[]>>;
  setPlaylistItemsRaw: Dispatch<SetStateAction<AudioItem[]>>;
  setSelected: Dispatch<SetStateAction<AudioItem | null>>;
  notify: Notify;
};

export function usePlaybackQueue({
  audioItems,
  setAudioItems,
  setPlaylistItemsRaw,
  setSelected,
  notify
}: UsePlaybackQueueParams) {
  const dialog = useDialog();

  const [playing, setPlaying] = useState<AudioItem | null>(null);
  const [playbackQueue, setPlaybackQueue] = useState<AudioItem[]>([]);
  const [playingIndex, setPlayingIndex] = useState(-1);

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
        notify("播放队列已清空", "info");
        return;
      }

      const nextIndex = Math.min(index, nextQueue.length - 1);
      await playQueueIndex(nextIndex, nextQueue);
      notify("已移除当前音频并播放下一条", "info");
      return;
    }

    setPlaybackQueue(nextQueue);

    if (index < playingIndex) {
      setPlayingIndex((value) => value - 1);
    }

    notify("已从播放队列移除", "success");
  }

  async function clearQueue() {
    if (playbackQueue.length === 0) return;

    const ok = await dialog.confirm({
      title: "清空播放队列？",
      message: "确认清空播放队列并停止播放？",
      confirmLabel: "清空队列",
      cancelLabel: "取消",
      tone: "warning"
    });

    if (!ok) return;

    setPlaybackQueue([]);
    setPlayingIndex(-1);
    setPlaying(null);
    notify("播放队列已清空", "info");
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
    notify("播放队列顺序已更新", "success");
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
        setPlaying(null);
        setPlayingIndex(-1);
      } else {
        setPlayingIndex((prevIndex) => {
          if (prevIndex < 0) return -1;
          if (removedIndex < prevIndex) return prevIndex - 1;
          if (prevIndex >= nextQueue.length) return nextQueue.length - 1;
          return prevIndex;
        });
      }
    }

    if (playing?.id === audioId) {
      setPlaying(null);
      setPlayingIndex(-1);
    }
  }

  return {
    playing,
    playbackQueue,
    playingIndex,
    playAudio,
    playAudioAt,
    playPrevious,
    playNext,
    removeQueueItem,
    moveQueueItem,
    clearQueue,
    handlePlaybackPositionSaved,
    handleAudioDeleted
  };
}
