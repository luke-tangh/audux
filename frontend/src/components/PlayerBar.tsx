import type { AudioItem } from "../types";
import PlaybackControls from "./player/PlaybackControls";
import PlayerNowCard from "./player/PlayerNowCard";
import PlayerOptions from "./player/PlayerOptions";
import { usePlayerController } from "./player/usePlayerController";

type Props = {
  audio: AudioItem | null;
  queue: AudioItem[];
  queueIndex: number;
  playRequestId: number;
  canPrevious: boolean;
  canNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onQueueSelect: (index: number) => void;
  onQueueRemove: (index: number) => void;
  onQueueMove: (sourceIndex: number, targetIndex: number) => void;
  onQueueClear: () => void;
  onPositionSaved: (audioId: number, position: number) => void;
};

export default function PlayerBar({
  audio,
  queue,
  queueIndex,
  playRequestId,
  canPrevious,
  canNext,
  onPrevious,
  onNext,
  onQueueSelect,
  onQueueRemove,
  onQueueMove,
  onQueueClear,
  onPositionSaved
}: Props) {
  const player = usePlayerController({
    audio,
    playRequestId,
    canNext,
    onNext,
    onPositionSaved
  });

  const safeDuration = Number.isFinite(player.duration) ? player.duration : 0;
  const progress =
    safeDuration > 0 ? Math.min(100, (player.current / safeDuration) * 100) : 0;

  return (
    <footer className="player-dock">
      <audio
        ref={player.audioRef}
        onPlay={player.handleAudioPlay}
        onPause={(event) => player.handleAudioPause(event.currentTarget.currentTime)}
        onTimeUpdate={(event) => player.handleTimeUpdate(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => player.handleLoadedMetadata(event.currentTarget.duration || 0)}
        onEnded={player.handleEnded}
      />

      <PlayerNowCard audio={audio} />

      <PlaybackControls
        hasAudio={Boolean(audio)}
        isPlaying={player.isPlaying}
        canPrevious={canPrevious}
        canNext={canNext}
        current={player.current}
        duration={safeDuration}
        progress={progress}
        onPrevious={onPrevious}
        onNext={onNext}
        onToggle={player.toggle}
        onStop={player.stop}
        onSeek={player.seek}
      />

      <PlayerOptions
        rate={player.rate}
        volume={player.volume}
        queue={queue}
        queueIndex={queueIndex}
        queueOpen={player.queueOpen}
        onRateChange={player.setRate}
        onVolumeChange={player.setVolume}
        onQueueOpenChange={player.setQueueOpen}
        onQueueSelect={onQueueSelect}
        onQueueRemove={onQueueRemove}
        onQueueMove={onQueueMove}
        onQueueClear={onQueueClear}
      />
    </footer>
  );
}
