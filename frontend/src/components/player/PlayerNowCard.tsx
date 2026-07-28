import { api } from "../../api";
import type { AudioItem } from "../../types";
import { displayAuthor, displayTitle } from "../../types";
import { MaterialIcon } from "../ui";

type PlayerNowCardProps = {
  audio: AudioItem | null;
};

export default function PlayerNowCard({ audio }: PlayerNowCardProps) {
  return (
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
  );
}
