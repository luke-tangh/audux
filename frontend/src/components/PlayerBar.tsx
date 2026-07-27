import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { AudioItem } from "../types";
import { displayAuthor, displayTitle, formatDuration } from "../types";
import { useDialog } from "./dialog/UnifiedDialog";
import { Button, MaterialIcon, SelectField } from "./ui";

type Props = {
  audio: AudioItem | null;
  queue: AudioItem[];
  queueIndex: number;
  canPrevious: boolean;
  canNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onQueueSelect: (index: number) => void;
  onQueueRemove: (index: number) => void;
  onQueueClear: () => void;
  onPositionSaved: (audioId: number, position: number) => void;
};

const PLAYBACK_RATE_OPTIONS = [0.75, 1, 1.25, 1.5, 2].map((value) => ({
  value: String(value),
  label: `${value}x`
}));

function shouldPromptRestart(audio: AudioItem): boolean {
  const saved = audio.last_position_seconds || 0;
  const total = audio.duration_seconds || 0;

  if (saved <= 0 || total <= 0) return false;
  if (saved >= total) return true;

  const remain = total - saved;
  const threshold = Math.max(10, total * 0.02);

  return remain <= threshold;
}

export default function PlayerBar({
  audio,
  queue,
  queueIndex,
  canPrevious,
  canNext,
  onPrevious,
  onNext,
  onQueueSelect,
  onQueueRemove,
  onQueueClear,
  onPositionSaved
}: Props) {
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

    let canceled = false;
    let startSeconds = currentAudio.last_position_seconds || 0;

    endedAudioIdRef.current = null;

    const onLoadedMetadataOnce = () => {
      try {
        el.currentTime = startSeconds;
      } catch {
        // ignore
      }
    };

    async function prepareAndPlay() {
      if (shouldPromptRestart(currentAudio)) {
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
          void savePositionFor(currentAudio.id, 0).catch(console.error);
        }
      }

      if (canceled) return;

      el.src = api.audioFileUrl(currentAudio.id);
      el.playbackRate = rate;
      el.volume = volume;

      setCurrent(startSeconds);
      setDuration(0);

      el.addEventListener("loadedmetadata", onLoadedMetadataOnce, { once: true });

      el.play()
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
      el.removeEventListener("loadedmetadata", onLoadedMetadataOnce);

      if (!currentAudio) return;
      if (endedAudioIdRef.current === currentAudio.id) return;

      const latestPosition = Number.isFinite(el.currentTime) ? el.currentTime : startSeconds;
      void savePositionFor(currentAudio.id, latestPosition).catch(console.error);
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

  function selectQueueItem(index: number) {
    onQueueSelect(index);
    setQueueOpen(false);
  }

  const safeDuration = Number.isFinite(duration) ? duration : 0;
  const progress = safeDuration > 0 ? Math.min(100, (current / safeDuration) * 100) : 0;

  return (
    <footer className="player-dock">
      <audio
        ref={audioRef}
        onPlay={() => setIsPlaying(true)}
        onPause={(e) => {
          setIsPlaying(false);

          if (audio && endedAudioIdRef.current !== audio.id) {
            saveCurrentPosition(e.currentTarget.currentTime);
          }
        }}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onEnded={handleEnded}
      />

      <div className="player-now-card">
        <div className="player-cover">
          {audio?.cover_path ? (
            <img
              src={api.coverUrl(audio.id, audio.updated_at)}
              alt=""
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          ) : (
            <MaterialIcon name="music_note" size={24} />
          )}
        </div>

        <div className="player-now-text">
          <span className="eyebrow">正在播放</span>
          <strong>{audio ? displayTitle(audio) : "选择一个音频开始播放"}</strong>
          <em>{audio ? displayAuthor(audio) || "Unknown" : "播放队列为空"}</em>
        </div>
      </div>

      <div className="player-center">
        <div className="player-controls" aria-label="播放器控制">
          <Button preserveChildren
            type="button"
            className="icon-button"
            onClick={onPrevious}
            disabled={!audio || !canPrevious}
            aria-label="播放上一条"
            title="播放上一条"
          >
            <MaterialIcon name="skip_previous" size={24} />
          </Button>

          <Button preserveChildren
            type="button"
            className="play-toggle"
            onClick={toggle}
            disabled={!audio}
            aria-label={isPlaying ? "暂停播放" : "开始播放"}
            title={isPlaying ? "暂停" : "播放"}
          >
            <span className="play-toggle-icon" aria-hidden="true">
              {isPlaying ? <MaterialIcon name="pause" size={26} /> : <MaterialIcon name="play_arrow" size={28} />}
            </span>
          </Button>

          <Button preserveChildren
            type="button"
            className="icon-button"
            onClick={onNext}
            disabled={!audio || !canNext}
            aria-label="播放下一条"
            title="播放下一条"
          >
            <MaterialIcon name="skip_next" size={24} />
          </Button>
        </div>

        <div className="player-progress">
          <span>{formatDuration(current)}</span>

          <input
            type="range"
            min={0}
            max={safeDuration || 0}
            value={Math.min(current, safeDuration || current || 0)}
            onChange={(e) => seek(Number(e.target.value))}
            style={{
              background: `linear-gradient(90deg, var(--md-sys-color-primary) 0%, var(--md-sys-color-tertiary) ${progress}%, var(--md-sys-color-surface-container-highest) ${progress}%, var(--md-sys-color-surface-container-highest) 100%)`
            }}
          />

          <span>{formatDuration(safeDuration)}</span>
        </div>
      </div>

      <div className="player-options">
        <SelectField
          density="compact"
          wrapperClassName="player-rate-select"
          menuClassName="player-rate-menu"
          menuWidth="control"
          menuMinWidth={92}
          label="速度"
          value={String(rate)}
          options={PLAYBACK_RATE_OPTIONS}
          aria-label="播放速度"
          title="播放速度"
          onValueChange={(value) => setRate(Number(value))}
        />

        <label className="player-volume-control">
          <span className="player-volume-icon" aria-hidden="true">
            <MaterialIcon name="volume_up" size={18} />
          </span>

          <span className="sr-only">音量</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
          />
        </label>

        <div className="queue-control">
          <Button preserveChildren
            type="button"
            className="queue-toggle-button"
            aria-label="打开播放队列"
            aria-haspopup="dialog"
            aria-expanded={queueOpen}
            aria-controls="player-queue-popover"
            onClick={() => setQueueOpen((v) => !v)}
            disabled={queue.length === 0}
          >
            队列 {queue.length > 0 ? `${queueIndex + 1}/${queue.length}` : ""}
          </Button>

          {queueOpen && (
            <div
              id="player-queue-popover"
              className="queue-popover"
              role="dialog"
              aria-label="播放队列"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setQueueOpen(false);
                }
              }}
            >
              <div className="queue-popover-header">
                <strong>播放队列</strong>

                <Button preserveChildren
                  type="button"
                  aria-label="清空播放队列"
                  onClick={() => {
                    onQueueClear();
                    setQueueOpen(false);
                  }}
                  disabled={queue.length === 0}
                >
                  清空
                </Button>
              </div>

              {queue.length === 0 && <div className="queue-empty">空队列</div>}

              {queue.length > 0 && (
                <div className="queue-list" role="list">
                  {queue.map((item, index) => (
                    <div
                      key={`${item.id}-${index}`}
                      className={`queue-row ${index === queueIndex ? "active" : ""}`}
                      role="listitem"
                    >
                      <Button preserveChildren
                        type="button"
                        className="queue-row-main"
                        aria-current={index === queueIndex ? "true" : undefined}
                        onClick={() => selectQueueItem(index)}
                        title={displayTitle(item)}
                      >
                        <span className="queue-index">
                          {index === queueIndex ? <MaterialIcon name="play_arrow" size={14} /> : index + 1}
                        </span>

                        <span className="queue-title">{displayTitle(item)}</span>
                      </Button>

                      <Button preserveChildren
                        type="button"
                        className="queue-remove"
                        aria-label={`从队列移除 ${displayTitle(item)}`}
                        onClick={() => onQueueRemove(index)}
                        title="从队列移除"
                      >
                        <MaterialIcon name="close" size={16} />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </footer>
  );
}
