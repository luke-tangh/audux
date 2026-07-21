import { useEffect, useRef, useState } from "react";
import { API_BASE, api } from "../api";
import type { AudioItem } from "../types";
import { displayAuthor, displayTitle, formatDuration } from "../types";

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
  onPositionSaved: () => void;
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
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [rate, setRate] = useState(Number(localStorage.getItem("playbackRate") || "1"));
  const [volume, setVolume] = useState(Number(localStorage.getItem("volume") || "1"));
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    if (!audio) {
      el.pause();
      el.removeAttribute("src");
      el.load();
      setCurrent(0);
      setDuration(0);
      setIsPlaying(false);
      return;
    }

    let startSeconds = audio.last_position_seconds || 0;

    if (shouldPromptRestart(audio)) {
      const ok = window.confirm(
        "上次播放位置已接近结尾，是否从头播放？\n\n确定：从头播放\n取消：从上次位置继续"
      );

      if (ok) {
        startSeconds = 0;
        api.updatePlaybackPosition(audio.id, 0).then(onPositionSaved).catch(console.error);
      }
    }

    el.src = `${API_BASE}/audio-items/${audio.id}/file`;
    el.playbackRate = rate;
    el.volume = volume;
    el.currentTime = startSeconds;

    setCurrent(startSeconds);
    setDuration(0);

    el.play()
      .then(() => setIsPlaying(true))
      .catch((err) => {
        console.error(err);
        setIsPlaying(false);
      });
  }, [audio?.id]);

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

      api
        .updatePlaybackPosition(audio.id, el.currentTime)
        .then(onPositionSaved)
        .catch(console.error);
    }, 5000);

    return () => clearInterval(timer);
  }, [audio?.id, onPositionSaved]);

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

  function stopAndReset() {
    const el = audioRef.current;
    if (!el) return;

    el.pause();
    el.currentTime = 0;
    setCurrent(0);

    if (audio) {
      api.updatePlaybackPosition(audio.id, 0).then(onPositionSaved).catch(console.error);
    }
  }

  async function handleEnded() {
    if (audio) {
      await api.updatePlaybackPosition(audio.id, 0).catch(console.error);
      onPositionSaved();
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
        onPause={() => setIsPlaying(false)}
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
            <span>♪</span>
          )}
        </div>

        <div className="player-now-text">
          <span className="eyebrow">正在播放</span>
          <strong>{audio ? displayTitle(audio) : "选择一个音频开始播放"}</strong>
          <em>{audio ? displayAuthor(audio) || "Unknown" : "播放队列为空"}</em>
        </div>
      </div>

      <div className="player-center">
        <div className="player-controls">
          <button className="icon-button" onClick={onPrevious} disabled={!audio || !canPrevious}>
            ‹
          </button>

          <button className="play-toggle" onClick={toggle} disabled={!audio}>
            {isPlaying ? "暂停" : "播放"}
          </button>

          <button className="icon-button" onClick={onNext} disabled={!audio || !canNext}>
            ›
          </button>

          <button className="stop-button" onClick={stopAndReset} disabled={!audio}>
            停止
          </button>
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
              background: `linear-gradient(90deg, #38bdf8 0%, #8b5cf6 ${progress}%, rgba(51, 65, 85, 0.9) ${progress}%, rgba(51, 65, 85, 0.9) 100%)`
            }}
          />

          <span>{formatDuration(safeDuration)}</span>
        </div>
      </div>

      <div className="player-options">
        <label>
          <span>速度</span>
          <select value={rate} onChange={(e) => setRate(Number(e.target.value))}>
            {[0.75, 1, 1.25, 1.5, 2].map((r) => (
              <option key={r} value={r}>
                {r}x
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>音量</span>
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
          <button
            className="queue-toggle-button"
            onClick={() => setQueueOpen((v) => !v)}
            disabled={queue.length === 0}
          >
            队列 {queue.length > 0 ? `${queueIndex + 1}/${queue.length}` : ""}
          </button>

          {queueOpen && (
            <div className="queue-popover">
              <div className="queue-popover-header">
                <strong>播放队列</strong>

                <button
                  onClick={() => {
                    onQueueClear();
                    setQueueOpen(false);
                  }}
                  disabled={queue.length === 0}
                >
                  清空
                </button>
              </div>

              {queue.length === 0 && <div className="queue-empty">空队列</div>}

              {queue.length > 0 && (
                <div className="queue-list">
                  {queue.map((item, index) => (
                    <div
                      key={`${item.id}-${index}`}
                      className={`queue-row ${index === queueIndex ? "active" : ""}`}
                    >
                      <button
                        className="queue-row-main"
                        onClick={() => selectQueueItem(index)}
                        title={displayTitle(item)}
                      >
                        <span className="queue-index">
                          {index === queueIndex ? "▶" : index + 1}
                        </span>

                        <span className="queue-title">{displayTitle(item)}</span>
                      </button>

                      <button
                        className="queue-remove"
                        onClick={() => onQueueRemove(index)}
                        title="从队列移除"
                      >
                        ×
                      </button>
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
