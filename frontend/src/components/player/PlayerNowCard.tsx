import { api } from "../../api";
import { useTranslation } from "react-i18next";
import type { AudioItem } from "../../types";
import { displayAuthor, displayTitle } from "../../types";
import { MaterialIcon } from "../ui";

type PlayerNowCardProps = {
  audio: AudioItem | null;
};

export default function PlayerNowCard({ audio }: PlayerNowCardProps) {
  const { t } = useTranslation();
  const title = audio ? displayTitle(audio) : t("player.selectAudio");
  const author = audio
    ? displayAuthor(audio) || t("common.empty.unknownAuthor")
    : t("player.emptyQueue");

  return (
    <div className="player-now-card">
      <div className="player-cover">
        {audio?.cover_path ? (
          <img
            key={`${audio.id}-${audio.updated_at}`}
            src={api.coverUrl(audio.id, audio.updated_at)}
            alt=""
            onLoad={(e) => {
              e.currentTarget.style.display = "";
            }}
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        ) : (
          <MaterialIcon name="music_note" size={24} />
        )}
      </div>

      <div className="player-now-text">
        <span className="eyebrow">{t("player.nowPlaying")}</span>
        <strong title={title}>{title}</strong>
        <em title={author}>{author}</em>
      </div>
    </div>
  );
}
