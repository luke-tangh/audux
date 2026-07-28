import type { LibraryRoot, ScanTask } from "../../types";
import { Button, CheckboxField, PanelCard, TextField } from "../ui";
import { scanProgress } from "./settingsUtils";

type LibrarySettingsTabProps = {
  roots: LibraryRoot[];
  scanTasks: ScanTask[];
  path: string;
  scanResult: string;
  playlistName: string;
  onPathChange: (value: string) => void;
  onChooseFolder: () => void;
  onAddRoot: () => void;
  onToggleRoot: (root: LibraryRoot, isEnabled: boolean) => void;
  onScan: (rootId: number) => void;
  onCancelScan: (task: ScanTask) => void;
  onPlaylistNameChange: (value: string) => void;
  onCreatePlaylist: () => void;
};

export default function LibrarySettingsTab({
  roots,
  scanTasks,
  path,
  scanResult,
  playlistName,
  onPathChange,
  onChooseFolder,
  onAddRoot,
  onToggleRoot,
  onScan,
  onCancelScan,
  onPlaylistNameChange,
  onCreatePlaylist
}: LibrarySettingsTabProps) {
  return (
    <div className="settings-grid-layout">
      <PanelCard title="媒体库目录">
        <div className="inline-form">
          <TextField
            wrapperClassName="inline-field"
            hideLabel
            label="媒体库路径"
            value={path}
            placeholder="输入或选择本地目录路径"
            onValueChange={onPathChange}
          />
          <Button variant="outlined" onClick={onChooseFolder}>
            选择文件夹
          </Button>
          <Button variant="filled" onClick={onAddRoot}>
            添加目录
          </Button>
        </div>

        {roots.length === 0 && <p className="muted">暂无媒体库目录。</p>}

        {roots.map((root) => (
          <div key={root.id} className={`root-card ${root.is_enabled ? "" : "disabled"}`}>
            <div>
              <strong>{root.path}</strong>
              <span>{root.is_enabled ? "启用中" : "已禁用"}</span>
            </div>

            <CheckboxField
              wrapperClassName="root-toggle"
              label={root.is_enabled ? "启用" : "禁用"}
              checked={root.is_enabled}
              onCheckedChange={(checked) => onToggleRoot(root, checked)}
            />

            <Button variant="text" onClick={() => onScan(root.id)}>
              扫描
            </Button>
          </div>
        ))}

        {scanResult && <p className="test-result">{scanResult}</p>}
      </PanelCard>

      <PanelCard title="扫描任务">
        {scanTasks.length === 0 && <p className="muted">暂无扫描任务</p>}

        {scanTasks.map((task) => (
          <div key={task.id} className="scan-task-row">
            <div className="scan-task-top">
              <strong>#{task.id}</strong>
              <span>root: {task.root_id}</span>
              <span className={`status-pill ${task.status}`}>{task.status}</span>
            </div>

            <div
              className="progress-line"
              role="progressbar"
              aria-label={`扫描任务 #${task.id} 进度`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={scanProgress(task)}
            >
              <div style={{ width: `${scanProgress(task)}%` }} />
            </div>

            <div className="scan-task-meta">
              {task.processed_files}/{task.total_files} · imported {task.imported} · updated{" "}
              {task.updated} · missing {task.missing}
            </div>

            {task.error_message && <div className="task-error">{task.error_message}</div>}

            {(task.status === "pending" || task.status === "running") && (
              <Button variant="text" onClick={() => onCancelScan(task)}>
                取消
              </Button>
            )}
          </div>
        ))}
      </PanelCard>

      <PanelCard title="创建 Playlist">
        <div className="inline-form">
          <TextField
            wrapperClassName="inline-field"
            hideLabel
            label="Playlist 名称"
            value={playlistName}
            placeholder="Playlist 名称"
            onValueChange={onPlaylistNameChange}
          />
          <Button variant="filled" onClick={onCreatePlaylist}>
            创建
          </Button>
        </div>
      </PanelCard>
    </div>
  );
}
