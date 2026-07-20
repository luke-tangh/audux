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

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !audio) return;

    el.src = `${API_BASE}/audio-items/${audio.id}/file`;
    el.playbackRate = rate;
    el.volume = volume;
    el.currentTime = audio.last_position_seconds || 0;

    setCurrent(audio.last_position_seconds || 0);

    el.play().catch(console.error);
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

  return (
    <footer className="player-bar">
      <audio
        ref={audioRef}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onEnded={handleEnded}
      />

      <div className="now-playing">
        {audio ? displayTitle(audio) : "未播放"}
      </div>

      <button onClick={onPrevious} disabled={!audio || !canPrevious}>
        上一首
      </button>

      <button onClick={toggle} disabled={!audio}>
        播放/暂停
      </button>

      <button onClick={onNext} disabled={!audio || !canNext}>
        下一首
      </button>

      <button onClick={stopAndReset} disabled={!audio}>
        停止
      </button>

      <span>{formatDuration(current)}</span>

      <input
        type="range"
        min={0}
        max={duration || 0}
        value={Math.min(current, duration || current || 0)}
        onChange={(e) => seek(Number(e.target.value))}
      />

      <span>{formatDuration(duration)}</span>

      <select value={rate} onChange={(e) => setRate(Number(e.target.value))}>
        {[0.75, 1, 1.25, 1.5, 2].map((r) => (
          <option key={r} value={r}>
            {r}x
          </option>
        ))}
      </select>

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
    </footer>
  );
}
