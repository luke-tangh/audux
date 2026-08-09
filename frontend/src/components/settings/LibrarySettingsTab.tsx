import type { LibraryRoot, Playlist, ScanTask } from "../../types";
import { Button, CheckboxField, PanelCard, TextField } from "../ui";
import { scanProgress } from "./settingsUtils";
import { useTranslation } from "react-i18next";
import { localizedStoredError } from "../../i18n/errors";

type LibrarySettingsTabProps = {
  roots: LibraryRoot[];
  scanTasks: ScanTask[];
  path: string;
  scanResult: string;
  playlistName: string;
  playlists: Playlist[];
  onPathChange: (value: string) => void;
  onChooseFolder: () => void;
  onAddRoot: () => void;
  onToggleRoot: (root: LibraryRoot, isEnabled: boolean) => void;
  onRemoveRoot: (root: LibraryRoot) => void;
  onScan: (rootId: number) => void;
  onCancelScan: (task: ScanTask) => void;
  onPlaylistNameChange: (value: string) => void;
  onCreatePlaylist: () => void;
  onRenamePlaylist: (playlist: Playlist) => void;
  onDeletePlaylist: (playlist: Playlist) => void;
};

export default function LibrarySettingsTab({
  roots,
  scanTasks,
  path,
  scanResult,
  playlistName,
  playlists,
  onPathChange,
  onChooseFolder,
  onAddRoot,
  onToggleRoot,
  onRemoveRoot,
  onScan,
  onCancelScan,
  onPlaylistNameChange,
  onCreatePlaylist,
  onRenamePlaylist,
  onDeletePlaylist
}: LibrarySettingsTabProps) {
  const { t } = useTranslation();
  return (
    <div className="settings-grid-layout">
      <PanelCard title={t("settings.library.roots")}>
        <div className="inline-form">
          <TextField
            wrapperClassName="inline-field"
            hideLabel
            label={t("settings.library.path")}
            value={path}
            placeholder={t("settings.library.pathPlaceholder")}
            onValueChange={onPathChange}
          />
          <Button variant="outlined" onClick={onChooseFolder}>
            {t("settings.library.chooseFolder")}
          </Button>
          <Button variant="filled" onClick={onAddRoot}>
            {t("settings.library.addFolder")}
          </Button>
        </div>

        {roots.length === 0 && <p className="muted">{t("settings.library.noRoots")}</p>}

        {roots.map((root) => (
          <div key={root.id} className={`root-card ${root.is_enabled ? "" : "disabled"}`}>
            <div>
              <strong>{root.path}</strong>
              <span>{root.is_enabled ? t("settings.library.enabled") : t("settings.library.disabled")}</span>
            </div>

            <CheckboxField
              wrapperClassName="root-toggle"
              label={root.is_enabled ? t("settings.library.enable") : t("settings.library.disable")}
              checked={root.is_enabled}
              onCheckedChange={(checked) => onToggleRoot(root, checked)}
            />

            <Button variant="text" onClick={() => onScan(root.id)}>
              {t("settings.library.scan")}
            </Button>

            <Button variant="danger" onClick={() => onRemoveRoot(root)}>
              {t("common.actions.remove")}
            </Button>
          </div>
        ))}

        {scanResult && <p className="test-result">{scanResult}</p>}
      </PanelCard>

      <PanelCard title={t("settings.library.scanTasks")}>
        {scanTasks.length === 0 && <p className="muted">{t("settings.library.noScanTasks")}</p>}

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
              aria-label={t("settings.library.scanProgress", { id: task.id })}
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

            {(task.error_message || task.error_code) && (
              <div className="task-error">
                {localizedStoredError(t, task.error_code, task.error_params, task.error_message)}
              </div>
            )}

            {(task.status === "pending" || task.status === "running") && (
              <Button variant="text" onClick={() => onCancelScan(task)}>
                {t("common.actions.cancel")}
              </Button>
            )}
          </div>
        ))}
      </PanelCard>

      <PanelCard title={t("settings.library.createPlaylist")}>
        <div className="inline-form">
          <TextField
            wrapperClassName="inline-field"
            hideLabel
            label={t("settings.library.playlistName")}
            value={playlistName}
            placeholder={t("settings.library.playlistName")}
            onValueChange={onPlaylistNameChange}
          />
          <Button variant="filled" onClick={onCreatePlaylist}>
            {t("settings.library.create")}
          </Button>
        </div>

        {playlists.length === 0 && <p className="muted">{t("settings.library.noPlaylists")}</p>}

        <div className="playlist-maintenance-list">
          {playlists.map((playlist) => (
            <div key={playlist.id} className="playlist-maintenance-row">
              <div>
                <strong>{playlist.name}</strong>
                {playlist.description && <span>{playlist.description}</span>}
              </div>

              <Button variant="text" onClick={() => onRenamePlaylist(playlist)}>
                {t("settings.library.rename")}
              </Button>
              <Button variant="danger" onClick={() => onDeletePlaylist(playlist)}>
                {t("common.actions.delete")}
              </Button>
            </div>
          ))}
        </div>
      </PanelCard>
    </div>
  );
}
