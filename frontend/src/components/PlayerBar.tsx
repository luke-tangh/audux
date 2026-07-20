import { useEffect, useRef, useState } from "react";
import { API_BASE, api } from "../api";
import type { AudioItem } from "../types";
import { displayTitle, formatDuration } from "../types";

type Props = {
  audio: AudioItem | null;
  canPrevious: boolean;
  canNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onPositionSaved: () => void;
};

export default function PlayerBar({
  audio,
  canPrevious,
  canNext,
  onPrevious,
  onNext,
  onPositionSaved
}: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [rate, setRate] = useState(Number(localStorage.getItem("playbackRate") || "1"));
  const [volume, setVolume] = useState(Number(localStorage.getItem("volume") || "1"));
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

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

    el.src = `${API_BASE}/audio-items/${audio.id}/file`;
    el.playbackRate = rate;
    el.volume = volume;
    el.currentTime = audio.last_position_seconds || 0;

    setCurrent(audio.last_position_seconds || 0);
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
      api
        .updatePlaybackPosition(audio.id, 0)
        .then(onPositionSaved)
        .catch(console.error);
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

  const safeDuration = Number.isFinite(duration) ? duration : 0;
  const progress = safeDuration > 0 ? Math.min(100, (current / safeDuration) * 100) : 0;

  return (
    <footer className="player-bar">
      <audio
        ref={audioRef}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onEnded={handleEnded}
      />

      <div className="player-track-card">
        <span className="eyebrow">正在播放</span>

        <div className="now-playing">
          {audio ? displayTitle(audio) : "选择一个音频开始播放"}
        </div>
      </div>

      <div className="player-controls">
        <button
          className="icon-button"
          onClick={onPrevious}
          disabled={!audio || !canPrevious}
          title="上一首"
        >
          ‹
        </button>

        <button
          className="play-toggle"
          onClick={toggle}
          disabled={!audio}
          title={isPlaying ? "暂停" : "播放"}
        >
          {isPlaying ? "暂停" : "播放"}
        </button>

        <button
          className="icon-button"
          onClick={onNext}
          disabled={!audio || !canNext}
          title="下一首"
        >
          ›
        </button>

        <button
          className="stop-button"
          onClick={stopAndReset}
          disabled={!audio}
          title="停止并重置播放位置"
        >
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
            background: `linear-gradient(90deg, #60a5fa 0%, #8b5cf6 ${progress}%, rgba(51, 65, 85, 0.9) ${progress}%, rgba(51, 65, 85, 0.9) 100%)`
          }}
        />

        <span>{formatDuration(safeDuration)}</span>
      </div>

      <div className="player-options">
        <label>
          速度
          <select value={rate} onChange={(e) => setRate(Number(e.target.value))}>
            {[0.75, 1, 1.25, 1.5, 2].map((r) => (
              <option key={r} value={r}>
                {r}x
              </option>
            ))}
          </select>
        </label>

        <label className="volume-control">
          音量
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
          />
        </label>
      </div>
    </footer>
  );
}
