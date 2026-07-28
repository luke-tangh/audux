import type { AudioItem, Playlist, Tag } from "../../types";
import { displayDescription } from "../../types";
import { Button, CheckboxField, IconButton, MaterialIcon, SelectField, TextareaField, TextField } from "../ui";
import type { EditingPatch, NumericSelection } from "./types";

type OverviewTabProps = {
  audio: AudioItem;
  editing: Partial<AudioItem>;
  onEditingChange: (patch: EditingPatch) => void;
  onSave: () => void;

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
  onSave,
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
  return (
    <div className="inspector-section-stack">
      <section className="panel-card">
        <h3>Metadata</h3>

        <div className="field-grid">
          <TextField
            label="用户标题"
            value={(editing.title_user as string) || ""}
            onValueChange={(value) => onEditingChange({ title_user: value })}
          />

          <TextField
            label="作者"
            value={(editing.author_user as string) || ""}
            onValueChange={(value) => onEditingChange({ author_user: value })}
          />

          <TextField
            label="专辑"
            value={(editing.album_user as string) || ""}
            onValueChange={(value) => onEditingChange({ album_user: value })}
          />

          <TextField
            label="语言"
            value={(editing.language as string) || ""}
            onValueChange={(value) => onEditingChange({ language: value })}
          />

          <CheckboxField
            wide
            label="收藏"
            checked={Boolean(editing.is_favorite)}
            onCheckedChange={(checked) => onEditingChange({ is_favorite: checked })}
          />

          <TextareaField
            wide
            label="用户描述"
            value={(editing.description_user as string) || ""}
            onValueChange={(value) => onEditingChange({ description_user: value })}
          />
        </div>

        <div className="section-actions">
          <Button variant="filled" onClick={onSave}>
            保存 metadata
          </Button>
        </div>
      </section>

      <section className="panel-card">
        <h3>Tags</h3>

        <div className="tag-list">
          {tags.map((tag) => (
            <span className="tag" key={tag.id}>
              #{tag.name}
              <IconButton label={`移除标签 ${tag.name}`} onClick={() => onRemoveTag(tag.id)}>
                <MaterialIcon name="close" size={16} />
              </IconButton>
            </span>
          ))}
        </div>

        <div className="inline-form">
          <TextField
            wrapperClassName="inline-field"
            hideLabel
            label="新标签"
            value={tagInput}
            placeholder="新标签，可用逗号分隔"
            onValueChange={onTagInputChange}
          />
          <Button variant="text" onClick={onAddTags}>
            添加
          </Button>
        </div>

        <div className="inline-form">
          <SelectField
            value={selectedExistingTag === "" ? "" : String(selectedExistingTag)}
            aria-label="选择已有标签"
            options={[
              { value: "", label: "选择已有标签" },
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
            添加已有标签
          </Button>
        </div>
      </section>

      <section className="panel-card">
        <h3>Playlist</h3>

        <div className="inline-form">
          <SelectField
            value={selectedPlaylist === "" ? "" : String(selectedPlaylist)}
            aria-label="选择 playlist"
            options={[
              { value: "", label: "选择 playlist" },
              ...playlists.map((playlist) => ({
                value: String(playlist.id),
                label: playlist.name
              }))
            ]}
            onValueChange={(value) => onSelectedPlaylistChange(value ? Number(value) : "")}
          />

          <Button variant="text" onClick={onAddToPlaylist}>
            加入
          </Button>
        </div>

        {selectedPlaylistId && (
          <div className="section-actions">
            <Button variant="outlined" onClick={() => onExportPlaylist("json")}>
              导出当前 JSON
            </Button>
            <Button variant="outlined" onClick={() => onExportPlaylist("m3u")}>
              导出当前 M3U
            </Button>
          </div>
        )}
      </section>

      <section className="panel-card">
        <h3>当前描述</h3>
        <p>{displayDescription(audio) || "暂无描述"}</p>
      </section>
    </div>
  );
}
