import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import type { AudioItem } from "../../types";
import { useDialog } from "../dialog/UnifiedDialog";

type UsePlayerControllerParams = {
  audio: AudioItem | null;
  canNext: boolean;
  onNext: () => void;
  onPositionSaved: (audioId: number, position: number) => void;
};

function shouldPromptRestart(audio: AudioItem): boolean {
  const saved = audio.last_position_seconds || 0;
  const total = audio.duration_seconds || 0;

  if (saved <= 0 || total <= 0) return false;
  if (saved >= total) return true;

  const remain = total - saved;
  const threshold = Math.max(10, total * 0.02);

  return remain <= threshold;
}

export function usePlayerController({
  audio,
  canNext,
  onNext,
  onPositionSaved
}: UsePlayerControllerParams) {
  const dialog = useDialog();

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastSavedRef = useRef<{ audioId: number; position: number } | null>(null);
  const endedAudioIdRef = useRef<number | null>(null);

  const [rate, setRate] = useState(Number(localStorage.getItem("playbackRate") || "1"));
  const [volume, setVolume] = useState(Number(localStorage.getItem("volume") || "1"));
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);

  async function savePositionFor(audioId: number, position: number) {
    if (!Number.isFinite(position)) return;

    const normalized = Math.max(0, position);
    const last = lastSavedRef.current;

    if (
      last &&
      last.audioId === audioId &&
      Math.abs(last.position - normalized) < 0.5
    ) {
      return;
    }

    lastSavedRef.current = {
      audioId,
      position: normalized
    };

    await api.updatePlaybackPosition(audioId, normalized);
    onPositionSaved(audioId, normalized);
  }

  function saveCurrentPosition(positionOverride?: number) {
    const el = audioRef.current;
    if (!el || !audio) return;

    const position = positionOverride ?? el.currentTime;
    void savePositionFor(audio.id, position).catch(console.error);
  }

  useEffect(() => {
    const el = audioRef.current;
    const currentAudio = audio;

    if (!el) return;

    if (!currentAudio) {
      el.pause();
      el.removeAttribute("src");
      el.load();
      setCurrent(0);
      setDuration(0);
      setIsPlaying(false);
      return;
    }

    const activeAudio = currentAudio;
    const audioElement = el;
    let canceled = false;
    let startSeconds = activeAudio.last_position_seconds || 0;

    endedAudioIdRef.current = null;

    const onLoadedMetadataOnce = () => {
      try {
        audioElement.currentTime = startSeconds;
      } catch {
        // ignore
      }
    };

    async function prepareAndPlay() {
      if (shouldPromptRestart(activeAudio)) {
        const restart = await dialog.confirm({
          title: "从头播放？",
          message:
            "上次播放位置已接近结尾，是否从头播放？\n\n选择「从头播放」会把记忆位置重置为 0；选择「继续播放」会从上次位置继续。",
          confirmLabel: "从头播放",
          cancelLabel: "继续播放",
          tone: "warning"
        });

        if (canceled) return;

        if (restart) {
          startSeconds = 0;
          void savePositionFor(activeAudio.id, 0).catch(console.error);
        }
      }

      if (canceled) return;

      audioElement.src = api.audioFileUrl(activeAudio.id);
      audioElement.playbackRate = rate;
      audioElement.volume = volume;

      setCurrent(startSeconds);
      setDuration(0);

      audioElement.addEventListener("loadedmetadata", onLoadedMetadataOnce, { once: true });

      audioElement.play()
        .then(() => {
          if (!canceled) setIsPlaying(true);
        })
        .catch((err) => {
          console.error(err);
          if (!canceled) setIsPlaying(false);
        });
    }

    void prepareAndPlay();

    return () => {
      canceled = true;
      audioElement.removeEventListener("loadedmetadata", onLoadedMetadataOnce);

      if (endedAudioIdRef.current === activeAudio.id) return;

      const latestPosition = Number.isFinite(audioElement.currentTime)
        ? audioElement.currentTime
        : startSeconds;
      void savePositionFor(activeAudio.id, latestPosition).catch(console.error);
    };
  }, [audio?.id, dialog]);

  useEffect(() => {
    const el = audioRef.current;
    if (el) el.playbackRate = rate;

    localStorage.setItem("playbackRate", String(rate));
  }, [rate]);

  useEffect(() => {
    const el = audioRef.current;
    if (el) el.volume = volume;

    localStorage.setItem("volume", String(volume));
  }, [volume]);

  useEffect(() => {
    const timer = setInterval(() => {
      const el = audioRef.current;
      if (!el || !audio || el.paused) return;

      saveCurrentPosition(el.currentTime);
    }, 5000);

    return () => clearInterval(timer);
  }, [audio?.id]);

  function toggle() {
    const el = audioRef.current;
    if (!el) return;

    if (el.paused) {
      el.play().catch(console.error);
    } else {
      el.pause();
    }
  }

  function seek(value: number) {
    const el = audioRef.current;
    if (!el) return;

    el.currentTime = value;
    setCurrent(value);
  }

  async function handleEnded() {
    if (audio) {
      endedAudioIdRef.current = audio.id;
      await savePositionFor(audio.id, 0).catch(console.error);
    }

    setCurrent(0);

    if (canNext) {
      onNext();
    }
  }

  function handleAudioPause(position: number) {
    setIsPlaying(false);

    if (audio && endedAudioIdRef.current !== audio.id) {
      saveCurrentPosition(position);
    }
  }

  return {
    audioRef,
    current,
    duration,
    isPlaying,
    queueOpen,
    rate,
    volume,
    setRate,
    setVolume,
    setQueueOpen,
    toggle,
    seek,
    handleEnded,
    handleAudioPause,
    handleAudioPlay: () => setIsPlaying(true),
    handleTimeUpdate: setCurrent,
    handleLoadedMetadata: setDuration
  };
}
