import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import type { AudioItem } from "../../types";
import { useDialog } from "../dialog/UnifiedDialog";
import { useTranslation } from "react-i18next";

type UsePlayerControllerParams = {
  audio: AudioItem | null;
  playRequestId: number;
  canNext: boolean;
  onNext: () => void;
  onPositionSaved: (audioId: number, position: number) => void;
};

type PlaybackTracker = {
  audioId: number;
  eventId: number | null;
  listenedSeconds: number;
  activeSinceMs: number | null;
  endPositionSeconds: number;
  finished: boolean;
  completed: boolean;
  endReason?: "paused" | "ended" | "track_change" | "closed";
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
  playRequestId,
  canNext,
  onNext,
  onPositionSaved
}: UsePlayerControllerParams) {
  const dialog = useDialog();
  const { t } = useTranslation();

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastSavedRef = useRef<{ audioId: number; position: number } | null>(null);
  const endedAudioIdRef = useRef<number | null>(null);
  const playbackTrackerRef = useRef<PlaybackTracker | null>(null);

  const [rate, setRate] = useState(Number(localStorage.getItem("playbackRate") || "1"));
  const [volume, setVolume] = useState(Number(localStorage.getItem("volume") || "1"));
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);

  function accrueListening(tracker: PlaybackTracker) {
    if (tracker.activeSinceMs === null) return;
    const now = Date.now();
    tracker.listenedSeconds += Math.max(0, (now - tracker.activeSinceMs) / 1000);
    tracker.activeSinceMs = now;
  }

  function syncPlaybackEvent(tracker: PlaybackTracker) {
    if (tracker.eventId === null) return;

    void api.updatePlaybackEvent(tracker.eventId, {
      listened_seconds: tracker.listenedSeconds,
      end_position_seconds: tracker.endPositionSeconds,
      completed: tracker.completed,
      finish: tracker.finished,
      end_reason: tracker.endReason
    }).catch(console.error);
  }

  function finishPlaybackEvent(
    reason: "ended" | "track_change" | "closed",
    completed = false,
    positionOverride?: number
  ) {
    const tracker = playbackTrackerRef.current;
    if (!tracker || tracker.finished) return;

    accrueListening(tracker);
    tracker.activeSinceMs = null;
    tracker.endPositionSeconds = Math.max(
      0,
      positionOverride ?? audioRef.current?.currentTime ?? tracker.endPositionSeconds
    );
    tracker.finished = true;
    tracker.completed = completed;
    tracker.endReason = reason;
    syncPlaybackEvent(tracker);

    if (playbackTrackerRef.current === tracker) {
      playbackTrackerRef.current = null;
    }
  }

  function startOrResumePlaybackEvent(audioId: number, position: number) {
    const currentTracker = playbackTrackerRef.current;
    if (currentTracker && currentTracker.audioId === audioId && !currentTracker.finished) {
      currentTracker.endPositionSeconds = Math.max(0, position);
      if (currentTracker.activeSinceMs === null) currentTracker.activeSinceMs = Date.now();
      return;
    }

    if (currentTracker && !currentTracker.finished) {
      finishPlaybackEvent("track_change", false, position);
    }

    const tracker: PlaybackTracker = {
      audioId,
      eventId: null,
      listenedSeconds: 0,
      activeSinceMs: Date.now(),
      endPositionSeconds: Math.max(0, position),
      finished: false,
      completed: false
    };
    playbackTrackerRef.current = tracker;

    void api.startPlaybackEvent(audioId, tracker.endPositionSeconds)
      .then((event) => {
        if (!event || !Number.isInteger(event.id)) {
          if (playbackTrackerRef.current === tracker) playbackTrackerRef.current = null;
          return;
        }
        tracker.eventId = event.id;
        syncPlaybackEvent(tracker);
      })
      .catch((error) => {
        console.error(error);
        if (playbackTrackerRef.current === tracker) playbackTrackerRef.current = null;
      });
  }

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
      const shouldAutoPlay = playRequestId > 0;

      if (shouldAutoPlay && shouldPromptRestart(activeAudio)) {
        const restart = await dialog.confirm({
          title: t("player.restartTitle"),
          message: t("player.restartMessage"),
          confirmLabel: t("player.restartConfirm"),
          cancelLabel: t("player.restartCancel"),
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

      if (shouldAutoPlay) {
        audioElement.play()
          .then(() => {
            if (!canceled) setIsPlaying(true);
          })
          .catch((err) => {
            console.error(err);
            if (!canceled) setIsPlaying(false);
          });
      } else {
        audioElement.load();
        setIsPlaying(false);
      }
    }

    void prepareAndPlay();

    return () => {
      canceled = true;
      audioElement.removeEventListener("loadedmetadata", onLoadedMetadataOnce);

      const tracker = playbackTrackerRef.current;
      if (tracker?.audioId === activeAudio.id) {
        finishPlaybackEvent("track_change", false, audioElement.currentTime);
      }

      if (endedAudioIdRef.current === activeAudio.id) return;

      const latestPosition = Number.isFinite(audioElement.currentTime)
        ? audioElement.currentTime
        : startSeconds;
      void savePositionFor(activeAudio.id, latestPosition).catch(console.error);
    };
  }, [audio?.id, playRequestId, dialog]);

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
      const tracker = playbackTrackerRef.current;
      if (tracker?.audioId === audio.id && !tracker.finished) {
        accrueListening(tracker);
        tracker.endPositionSeconds = Math.max(0, el.currentTime);
        syncPlaybackEvent(tracker);
      }
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
      finishPlaybackEvent("ended", true, audioRef.current?.currentTime);
      await savePositionFor(audio.id, 0).catch(console.error);
    }

    setCurrent(0);

    if (canNext) {
      onNext();
    }
  }

  function handleAudioPause(position: number) {
    setIsPlaying(false);

    const tracker = playbackTrackerRef.current;
    if (audio && tracker?.audioId === audio.id && !tracker.finished) {
      accrueListening(tracker);
      tracker.activeSinceMs = null;
      tracker.endPositionSeconds = Math.max(0, position);
      tracker.endReason = "paused";
      syncPlaybackEvent(tracker);
    }

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
    handleAudioPlay: () => {
      setIsPlaying(true);
      if (audio) {
        startOrResumePlaybackEvent(audio.id, audioRef.current?.currentTime || 0);
      }
    },
    handleTimeUpdate: (position: number) => {
      setCurrent(position);
      const tracker = playbackTrackerRef.current;
      if (audio && tracker?.audioId === audio.id) {
        tracker.endPositionSeconds = Math.max(0, position);
      }
    },
    handleLoadedMetadata: setDuration
  };
}
