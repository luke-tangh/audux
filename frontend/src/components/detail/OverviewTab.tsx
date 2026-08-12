import type { AudioItem, Playlist, Tag } from "../../types";
import { displayDescription } from "../../types";
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
  selectedExistingTag: NumericSelection;
  onSelectedExistingTagChange: (value: NumericSelection) => void;
  onAddTags: () => void;
  onAddExistingTag: () => void;
  onRemoveTag: (tagId: number) => void;

  playlists: Playlist[];
  selectedPlaylist: NumericSelection;
  onSelectedPlaylistChange: (value: NumericSelection) => void;
  selectedPlaylistId?: number | null;
  onAddToPlaylist: () => void;
  onExportPlaylist: (format: "json" | "m3u") => void;
};

export default function OverviewTab({
  audio,
  editing,
  onEditingChange,
  tags,
  availableExistingTags,
  tagInput,
  onTagInputChange,
  selectedExistingTag,
  onSelectedExistingTagChange,
  onAddTags,
  onAddExistingTag,
  onRemoveTag,
  playlists,
  selectedPlaylist,
  onSelectedPlaylistChange,
  selectedPlaylistId,
  onAddToPlaylist,
  onExportPlaylist
}: OverviewTabProps) {
  const { t } = useTranslation();
  return (
    <div className="inspector-section-stack">
      <PanelCard title={t("common.technical.metadata")}>
        <div className="field-grid">
          <TextField
            label={t("detail.overview.userTitle")}
            value={(editing.title_user as string) || ""}
            onValueChange={(value) => onEditingChange({ title_user: value })}
          />

          <TextField
            label={t("detail.overview.author")}
            value={(editing.author_user as string) || ""}
            onValueChange={(value) => onEditingChange({ author_user: value })}
          />

          <TextField
            label={t("detail.overview.album")}
            value={(editing.album_user as string) || ""}
            onValueChange={(value) => onEditingChange({ album_user: value })}
          />

          <TextField
            label={t("detail.overview.language")}
            value={(editing.language as string) || ""}
            onValueChange={(value) => onEditingChange({ language: value })}
          />

          <CheckboxField
            wide
            label={t("detail.overview.favorite")}
            checked={Boolean(editing.is_favorite)}
            onCheckedChange={(checked) => onEditingChange({ is_favorite: checked })}
          />

          <TextareaField
            wide
            label={t("detail.overview.userDescription")}
            value={(editing.description_user as string) || ""}
            onValueChange={(value) => onEditingChange({ description_user: value })}
          />
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
        </div>

        <div className="inline-form">
          <TextField
            wrapperClassName="inline-field"
            hideLabel
            label={t("detail.overview.newTag")}
            value={tagInput}
            placeholder={t("detail.overview.newTagPlaceholder")}
            onValueChange={onTagInputChange}
          />
          <Button variant="text" onClick={onAddTags}>
            {t("common.actions.add")}
          </Button>
        </div>

        <div className="inline-form">
          <SelectField
            value={selectedExistingTag === "" ? "" : String(selectedExistingTag)}
            aria-label={t("detail.overview.selectTag")}
            options={[
              { value: "", label: t("detail.overview.selectTag") },
              ...availableExistingTags.map((tag) => ({
                value: String(tag.id),
                label: `#${tag.name}`
              }))
            ]}
            onValueChange={(value) =>
              onSelectedExistingTagChange(value ? Number(value) : "")
            }
          />
          <Button variant="text" onClick={onAddExistingTag} disabled={!selectedExistingTag}>
            {t("detail.overview.addExistingTag")}
          </Button>
        </div>
      </PanelCard>

      <PanelCard title={t("common.technical.playlist")}>
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
            onValueChange={(value) => onSelectedPlaylistChange(value ? Number(value) : "")}
          />

          <Button variant="text" onClick={onAddToPlaylist}>
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
      </PanelCard>

      <PanelCard title={t("detail.overview.currentDescription")}>
        <p>{displayDescription(audio) || t("detail.overview.noDescription")}</p>
      </PanelCard>
    </div>
  );
}
