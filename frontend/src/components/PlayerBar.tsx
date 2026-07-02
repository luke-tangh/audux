import { useEffect, useRef, useState } from "react";
import { API_BASE, api } from "../api";
import type { AudioItem } from "../types";
import { displayTitle, formatDuration } from "../types";

type Props = {
  audio: AudioItem | null;
  onPositionSaved: () => void;
};

export default function PlayerBar({ audio, onPositionSaved }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [rate, setRate] = useState(Number(localStorage.getItem("playbackRate") || "1"));
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !audio) return;

    el.src = `${API_BASE}/audio-items/${audio.id}/file`;
    el.playbackRate = rate;
    el.currentTime = audio.last_position_seconds || 0;
    el.play().catch(console.error);
  }, [audio?.id]);

  useEffect(() => {
    const el = audioRef.current;
    if (el) el.playbackRate = rate;
    localStorage.setItem("playbackRate", String(rate));
  }, [rate]);

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
  }, [audio?.id]);

  function toggle() {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) el.play();
    else el.pause();
  }

  function seek(value: number) {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = value;
    setCurrent(value);
  }

  return (
    <footer className="player-bar">
      <audio
        ref={audioRef}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onEnded={() => {
          if (audio) api.updatePlaybackPosition(audio.id, 0).catch(console.error);
        }}
      />

      <div className="now-playing">
        {audio ? displayTitle(audio) : "未播放"}
      </div>

      <button onClick={toggle} disabled={!audio}>
        播放/暂停
      </button>

      <span>{formatDuration(current)}</span>

      <input
        type="range"
        min={0}
        max={duration || 0}
        value={current}
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
    </footer>
  );
}
