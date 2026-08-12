import { useId } from "react";
import type { AudioItem, Playlist, Tag } from "../../types";
import { formatDuration } from "../../types";
import {
  Button,
  CheckboxField,
  IconButton,
  MaterialIcon,
  PanelCard,
  SelectField,
  TextareaField,
  TextField
} from "../ui";
import type { EditingPatch, NumericSelection } from "./types";
import { useTranslation } from "react-i18next";

type OverviewTabProps = {
  audio: AudioItem;
  editing: Partial<AudioItem>;
  onEditingChange: (patch: EditingPatch) => void;

  tags: Tag[];
  availableExistingTags: Tag[];
  tagInput: string;
  onTagInputChange: (value: string) => void;
  onAddTags: () => void;
  onRemoveTag: (tagId: number) => void;

  playlists: Playlist[];
  selectedPlaylist: NumericSelection;
  onSelectedPlaylistChange: (value: NumericSelection) => void;
  selectedPlaylistId?: number | null;
  onAddToPlaylist: () => void;
  onExportPlaylist: (format: "json" | "m3u") => void;
  transcriptLanguage?: string;
  isSaving: boolean;
};

const LANGUAGE_SUGGESTIONS = [
  ["zh-CN", "简体中文"],
  ["zh-TW", "繁體中文"],
  ["yue", "粤语"],
  ["en", "English"],
  ["ja", "日本語"],
  ["ko", "한국어"],
  ["fr", "Français"],
  ["de", "Deutsch"],
  ["es", "Español"],
  ["pt", "Português"],
  ["ru", "Русский"]
] as const;

export default function OverviewTab({
  audio,
  editing,
  onEditingChange,
  tags,
  availableExistingTags,
  tagInput,
  onTagInputChange,
  onAddTags,
  onRemoveTag,
  playlists,
  selectedPlaylist,
  onSelectedPlaylistChange,
  selectedPlaylistId,
  onAddToPlaylist,
  onExportPlaylist,
  transcriptLanguage,
  isSaving
}: OverviewTabProps) {
  const { t } = useTranslation();
  const tagSuggestionsId = useId();
  const languageSuggestionsId = useId();
  const customDescription = String(editing.description_user || "").trim();
  const effectiveDescription =
    customDescription || audio.description_ai || audio.description_original || "";
  const descriptionSource = customDescription
    ? t("detail.overview.sourceUser")
    : audio.description_ai
      ? t("detail.overview.sourceAi")
      : audio.description_original
        ? t("detail.overview.sourceFile")
        : t("detail.overview.sourceNone");
  const hasCustomMetadata = [
    editing.title_user,
    editing.author_user,
    editing.album_user,
    editing.description_user
  ].some((value) => String(value || "").trim());
  const canAddTags = tagInput
    .split(",")
    .some((value) => value.trim());
  const detectedLanguage = transcriptLanguage?.trim() || "";
  const canUseDetectedLanguage =
    Boolean(detectedLanguage) && detectedLanguage !== String(editing.language || "").trim();

  function originalValue(value?: string) {
    return value
      ? t("detail.overview.fileValue", { value })
      : t("detail.overview.noFileValue");
  }

  function clearCustomMetadata() {
    onEditingChange({
      title_user: "",
      author_user: "",
      album_user: "",
      description_user: ""
    });
  }

  return (
    <div className="inspector-section-stack">
      <PanelCard
        title={t("detail.overview.editableMetadata")}
        actions={
          <Button
            size="sm"
            variant="text"
            onClick={clearCustomMetadata}
            disabled={!hasCustomMetadata || isSaving}
          >
            {t("detail.overview.clearCustom")}
          </Button>
        }
      >
        <div className="field-grid">
          <TextField
            wide
            label={t("detail.overview.customTitle")}
            value={(editing.title_user as string) || ""}
            helperText={
              audio.title_original
                ? originalValue(audio.title_original)
                : t("detail.overview.fileNameFallback", { value: audio.file_name })
            }
            disabled={isSaving}
            onValueChange={(value) => onEditingChange({ title_user: value })}
          />

          <TextField
            label={t("detail.overview.customAuthor")}
            value={(editing.author_user as string) || ""}
            helperText={originalValue(audio.author_original)}
            disabled={isSaving}
            onValueChange={(value) => onEditingChange({ author_user: value })}
          />

          <TextField
            label={t("detail.overview.customAlbum")}
            value={(editing.album_user as string) || ""}
            helperText={originalValue(audio.album_original)}
            disabled={isSaving}
            onValueChange={(value) => onEditingChange({ album_user: value })}
          />

          <div className="language-field">
            <TextField
              label={t("detail.overview.language")}
              value={(editing.language as string) || ""}
              list={languageSuggestionsId}
              placeholder={t("detail.overview.languagePlaceholder")}
              helperText={t("detail.overview.languageHelper")}
              disabled={isSaving}
              onValueChange={(value) => onEditingChange({ language: value })}
            />
            {canUseDetectedLanguage ? (
              <Button
                size="sm"
                variant="text"
                disabled={isSaving}
                onClick={() => onEditingChange({ language: detectedLanguage })}
              >
                {t("detail.overview.useDetectedLanguage", { language: detectedLanguage })}
              </Button>
            ) : null}
          </div>
          <datalist id={languageSuggestionsId}>
            {LANGUAGE_SUGGESTIONS.map(([value, label]) => (
              <option key={value} value={value} label={`${label} (${value})`} />
            ))}
          </datalist>

          <CheckboxField
            label={t("detail.overview.favorite")}
            description={t("detail.overview.favoriteHelper")}
            checked={Boolean(editing.is_favorite)}
            disabled={isSaving}
            onCheckedChange={(checked) => onEditingChange({ is_favorite: checked })}
          />

          <TextareaField
            wide
            rows={3}
            label={t("detail.overview.customDescription")}
            value={(editing.description_user as string) || ""}
            helperText={t("detail.overview.descriptionHelper")}
            disabled={isSaving}
            onValueChange={(value) => onEditingChange({ description_user: value })}
          />

          <div className="effective-description ui-field-group-wide">
            <div className="effective-description-heading">
              <strong>{t("detail.overview.effectiveDescription")}</strong>
              <span>{descriptionSource}</span>
            </div>
            <p>{effectiveDescription || t("detail.overview.noDescription")}</p>
          </div>

          <div
            className="metadata-file-summary ui-field-group-wide"
            aria-label={t("detail.overview.fileSummary")}
          >
            <strong>{t("detail.overview.fileSummary")}</strong>
            <span>{audio.file_ext || t("common.media.audio")}</span>
            <span>{formatDuration(audio.duration_seconds)}</span>
            {audio.bitrate ? <span>{Math.round(audio.bitrate / 1000)} kbps</span> : null}
            {audio.sample_rate ? <span>{audio.sample_rate} Hz</span> : null}
            {audio.channels ? (
              <span>{t("detail.overview.channels", { count: audio.channels })}</span>
            ) : null}
          </div>
        </div>
      </PanelCard>

      <PanelCard title={t("common.technical.tags")}>
        <div className="tag-list">
          {tags.map((tag) => (
            <span className="tag" key={tag.id}>
              #{tag.name}
              <IconButton label={t("detail.overview.removeTag", { name: tag.name })} onClick={() => onRemoveTag(tag.id)}>
                <MaterialIcon name="close" size={16} />
              </IconButton>
            </span>
          ))}
          {tags.length === 0 && (
            <span className="muted">{t("detail.overview.noTags")}</span>
          )}
        </div>

        <div className="inline-form">
          <TextField
            wrapperClassName="inline-field"
            hideLabel
            label={t("detail.overview.addTag")}
            value={tagInput}
            list={tagSuggestionsId}
            placeholder={t("detail.overview.newTagPlaceholder")}
            disabled={isSaving}
            onValueChange={onTagInputChange}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || !canAddTags) return;
              event.preventDefault();
              onAddTags();
            }}
          />
          <datalist id={tagSuggestionsId}>
            {availableExistingTags.map((tag) => (
              <option key={tag.id} value={tag.name} />
            ))}
          </datalist>
          <Button
            variant="text"
            onClick={onAddTags}
            disabled={!canAddTags || isSaving}
          >
            {t("common.actions.add")}
          </Button>
        </div>
      </PanelCard>

      <PanelCard className="organization-card">
        <details>
          <summary>
            <span>{t("detail.overview.organization")}</span>
            <span className="organization-summary-count">
              {t("detail.overview.playlistAvailability", { count: playlists.length })}
            </span>
          </summary>

          <div className="organization-content">
            <div className="inline-form">
              <SelectField
                value={selectedPlaylist === "" ? "" : String(selectedPlaylist)}
                aria-label={t("detail.overview.selectPlaylist")}
                options={[
                  { value: "", label: t("detail.overview.selectPlaylist") },
                  ...playlists.map((playlist) => ({
                    value: String(playlist.id),
                    label: playlist.name
                  }))
                ]}
                disabled={isSaving}
                onValueChange={(value) =>
                  onSelectedPlaylistChange(value ? Number(value) : "")
                }
              />

              <Button
                variant="text"
                onClick={onAddToPlaylist}
                disabled={!selectedPlaylist || isSaving}
              >
                {t("detail.overview.join")}
              </Button>
            </div>

            {selectedPlaylistId && (
              <div className="section-actions">
                <Button variant="outlined" onClick={() => onExportPlaylist("json")}>
                  {t("detail.overview.exportJson")}
                </Button>
                <Button variant="outlined" onClick={() => onExportPlaylist("m3u")}>
                  {t("detail.overview.exportM3u")}
                </Button>
              </div>
            )}
          </div>
        </details>
      </PanelCard>
    </div>
  );
}
