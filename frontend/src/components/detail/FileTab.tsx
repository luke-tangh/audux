import type { AudioItem } from "../../types";
import { formatDuration } from "../../types";
import { Button, TextField } from "../ui";

type FileTabProps = {
  audio: AudioItem;
  relocatePath: string;
  onRelocatePathChange: (value: string) => void;
  onChooseRelocateFile: () => void;
  onRelocate: () => void;
  onDeleteCover: () => void;
  onDeleteFromDatabase: () => void;
};

export default function FileTab({
  audio,
  relocatePath,
  onRelocatePathChange,
  onChooseRelocateFile,
  onRelocate,
  onDeleteCover,
  onDeleteFromDatabase
}: FileTabProps) {
  return (
    <div className="inspector-section-stack">
      <section className="panel-card file-info-card">
        <h3>文件信息</h3>

        <dl>
          <dt>文件名</dt>
          <dd>{audio.file_name}</dd>

          <dt>路径</dt>
          <dd>{audio.file_path}</dd>

          <dt>格式</dt>
          <dd>{audio.file_ext || "-"}</dd>

          <dt>时长</dt>
          <dd>{formatDuration(audio.duration_seconds)}</dd>

          <dt>大小</dt>
          <dd>{audio.file_size ? `${Math.round(audio.file_size / 1024 / 1024)} MB` : "-"}</dd>

          <dt>修改时间</dt>
          <dd>{audio.file_mtime || "-"}</dd>

          <dt>Bitrate</dt>
          <dd>{audio.bitrate || "-"}</dd>

          <dt>Sample Rate</dt>
          <dd>{audio.sample_rate || "-"}</dd>

          <dt>Channels</dt>
          <dd>{audio.channels || "-"}</dd>

          <dt>播放位置</dt>
          <dd>{formatDuration(audio.last_position_seconds)}</dd>

          <dt>播放次数</dt>
          <dd>{audio.play_count}</dd>

          <dt>上次播放</dt>
          <dd>{audio.last_played_at || "-"}</dd>
        </dl>
      </section>

      <section className="panel-card">
        <h3>重新定位</h3>

        <div className="inline-form">
          <TextField
            wrapperClassName="inline-field"
            hideLabel
            label="新的音频文件路径"
            value={relocatePath}
            placeholder="新的音频文件路径"
            onValueChange={onRelocatePathChange}
          />
          <Button variant="outlined" onClick={onChooseRelocateFile}>
            选择
          </Button>
        </div>

        <Button className="section-button" variant="filled" onClick={onRelocate}>
          重新定位文件
        </Button>
      </section>

      <section className="panel-card danger-zone">
        <h3>危险操作</h3>
        <p>这些操作会影响数据库记录或封面文件，请谨慎使用。</p>

        <div className="section-actions">
          <Button
            preserveChildren
            variant="outlined"
            onClick={onDeleteCover}
            disabled={!audio.cover_path}
          >
            删除封面
          </Button>

          <Button variant="danger" onClick={onDeleteFromDatabase}>
            从数据库移除
          </Button>
        </div>
      </section>
    </div>
  );
}
