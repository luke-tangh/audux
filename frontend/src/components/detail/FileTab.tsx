import type { AudioItem } from "../../types";
import { formatDuration } from "../../types";
import { Button, PanelCard, TextField } from "../ui";
import { useTranslation } from "react-i18next";
import { useLocale } from "../../i18n/LocaleProvider";
import { formatDateTime } from "../../i18n/format";

type FileTabProps = {
  audio: AudioItem;
  relocatePath: string;
  onRelocatePathChange: (value: string) => void;
  onChooseRelocateFile: () => void;
  onRelocate: () => void;
  onUploadCover: (file?: File) => void;
  onDeleteCover: () => void;
  onDeleteFromDatabase: () => void;
};

export default function FileTab({
  audio,
  relocatePath,
  onRelocatePathChange,
  onChooseRelocateFile,
  onRelocate,
  onUploadCover,
  onDeleteCover,
  onDeleteFromDatabase
}: FileTabProps) {
  const { t } = useTranslation();
  const { resolvedLanguage } = useLocale();
  return (
    <div className="inspector-section-stack">
      <PanelCard title={t("detail.file.info")} className="file-info-card">
        <dl>
          <dt>{t("detail.file.name")}</dt>
          <dd>{audio.file_name}</dd>

          <dt>{t("detail.file.path")}</dt>
          <dd>{audio.file_path}</dd>

          <dt>{t("detail.file.format")}</dt>
          <dd>{audio.file_ext || "-"}</dd>

          <dt>{t("detail.file.duration")}</dt>
          <dd>{formatDuration(audio.duration_seconds)}</dd>

          <dt>{t("detail.file.size")}</dt>
          <dd>{audio.file_size ? `${Math.round(audio.file_size / 1024 / 1024)} MB` : "-"}</dd>

          <dt>{t("detail.file.modified")}</dt>
          <dd>{formatDateTime(audio.file_mtime, resolvedLanguage)}</dd>

          <dt>{t("detail.file.bitrate")}</dt>
          <dd>{audio.bitrate || "-"}</dd>

          <dt>{t("detail.file.sampleRate")}</dt>
          <dd>{audio.sample_rate || "-"}</dd>

          <dt>{t("detail.file.channels")}</dt>
          <dd>{audio.channels || "-"}</dd>

          <dt>{t("detail.file.position")}</dt>
          <dd>{formatDuration(audio.last_position_seconds)}</dd>

          <dt>{t("detail.file.playCount")}</dt>
          <dd>{audio.play_count}</dd>

          <dt>{t("detail.file.lastPlayed")}</dt>
          <dd>{formatDateTime(audio.last_played_at, resolvedLanguage)}</dd>
        </dl>
      </PanelCard>

      <PanelCard title={t("detail.file.relocate")}>
        <div className="inline-form">
          <TextField
            wrapperClassName="inline-field"
            hideLabel
            label={t("detail.file.newPath")}
            value={relocatePath}
            placeholder={t("detail.file.newPath")}
            onValueChange={onRelocatePathChange}
          />
          <Button variant="outlined" onClick={onChooseRelocateFile}>
            {t("common.actions.select")}
          </Button>
        </div>

        <Button className="section-button" variant="filled" onClick={onRelocate}>
          {t("detail.file.relocateFile")}
        </Button>
      </PanelCard>

      <PanelCard title={t("detail.file.cover") }>
        <p className="muted">{t("detail.file.coverDescription")}</p>
        <div className="section-actions">
          <label className="upload-button">
            {t("detail.file.chooseCover")}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => onUploadCover(event.currentTarget.files?.[0])}
            />
          </label>
          <Button
            variant="outlined"
            onClick={onDeleteCover}
            disabled={!audio.cover_path}
          >
            {t("detail.file.deleteCover")}
          </Button>
        </div>
      </PanelCard>

      <PanelCard title={t("detail.file.danger")} className="danger-zone">
        <p>{t("detail.file.dangerDescription")}</p>

        <div className="section-actions">
          <Button variant="danger" onClick={onDeleteFromDatabase}>
            {t("detail.file.removeDatabase")}
          </Button>
        </div>
      </PanelCard>
    </div>
  );
}
