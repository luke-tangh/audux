import { useTranslation } from "react-i18next";

import { formatDateTime } from "../../i18n/format";
import { useLocale } from "../../i18n/LocaleProvider";
import type {
  LibraryDuplicateGroup,
  LibraryHealthSummary,
  LibraryHealthTask,
  MissingAudioHealthItem,
  SafeRelinkCandidate
} from "../../types";
import { Button, PanelCard, StatusPill } from "../ui";
import { formatFileSize } from "./settingsUtils";
import { isActiveTaskStatus } from "../../constants";

type Props = {
  summary: LibraryHealthSummary | null;
  tasks: LibraryHealthTask[];
  candidates: Record<number, SafeRelinkCandidate[]>;
  action: string | null;
  onRefresh: () => void;
  onStartCheck: () => void;
  onCancelTask: (task: LibraryHealthTask) => void;
  onRetryTask: (task: LibraryHealthTask) => void;
  onConfirmDuplicates: (group: LibraryDuplicateGroup) => void;
  onFindCandidates: (audio: MissingAudioHealthItem) => void;
  onRelink: (audio: MissingAudioHealthItem, candidate: SafeRelinkCandidate) => void;
};

function taskProgress(task: LibraryHealthTask): number {
  if (task.status === "done") return 100;
  if (task.total_items <= 0) return 0;
  return Math.min(100, Math.round((task.processed_items / task.total_items) * 100));
}

export default function HealthSettingsTab({
  summary,
  tasks,
  candidates,
  action,
  onRefresh,
  onStartCheck,
  onCancelTask,
  onRetryTask,
  onConfirmDuplicates,
  onFindCandidates,
  onRelink
}: Props) {
  const { t } = useTranslation();
  const { resolvedLanguage } = useLocale();
  const totals = summary?.totals;

  return (
    <div className="settings-grid-layout health-settings">
      <PanelCard
        title={t("settings.health.title")}
        className="settings-card-wide"
        actions={
          <>
            <Button variant="outlined" disabled={action !== null} onClick={onRefresh}>
              {t("common.actions.refresh")}
            </Button>
            <Button variant="filled" disabled={action !== null} onClick={onStartCheck}>
              {t("settings.health.checkNow")}
            </Button>
          </>
        }
      >
        <p className="muted">{t("settings.health.description")}</p>
        <div className="health-metrics" aria-label={t("settings.health.summary")}> 
          {([
            ["available", totals?.available ?? 0],
            ["missing", totals?.missing ?? 0],
            ["unsupported", totals?.unsupported ?? 0],
            ["failures", totals?.scan_failures ?? 0],
            ["duplicates", totals?.duplicate_groups ?? 0]
          ] as const).map(([key, value]) => (
            <div className={`health-metric ${key}`} key={key}>
              <strong>{value}</strong>
              <span>{t(`settings.health.metric.${key}`)}</span>
            </div>
          ))}
        </div>
        {summary?.generated_at && (
          <p className="muted">
            {t("settings.health.generatedAt", {
              time: formatDateTime(summary.generated_at, resolvedLanguage)
            })}
          </p>
        )}
      </PanelCard>

      <PanelCard title={t("settings.health.roots")}>
        {!summary && <p className="muted">{t("settings.health.loading")}</p>}
        {summary?.roots.length === 0 && <p className="muted">{t("settings.health.noRoots")}</p>}
        <div className="health-root-list">
          {summary?.roots.map((row) => (
            <article className="health-root-row" key={row.root.id}>
              <div className="health-row-heading">
                <strong>{row.root.path}</strong>
                <StatusPill value={row.path_available ? "done" : "failed"}>
                  {row.path_available
                    ? t("settings.health.rootAvailable")
                    : t("settings.health.rootUnavailable")}
                </StatusPill>
              </div>
              <p>
                {t("settings.health.rootCounts", {
                  available: row.available,
                  missing: row.missing,
                  unsupported: row.unsupported_count ?? "—"
                })}
              </p>
              <p>
                {row.latest_scan
                  ? t("settings.health.latestScan", {
                      status: row.latest_scan.status,
                      time: formatDateTime(row.latest_scan.updated_at, resolvedLanguage)
                    })
                  : t("settings.health.noRecentScan")}
              </p>
              {row.failed_scan_count > 0 && (
                <p className="task-error">
                  {t("settings.health.scanFailures", { count: row.failed_scan_count })}
                </p>
              )}
            </article>
          ))}
        </div>
      </PanelCard>

      <PanelCard title={t("settings.health.tasks")}>
        {tasks.length === 0 && <p className="muted">{t("settings.health.noTasks")}</p>}
        <div className="health-task-list">
          {tasks.map((task) => (
            <article className="health-task-row" key={task.id}>
              <div className="health-row-heading">
                <strong>
                  #{task.id} · {t(`settings.health.taskType.${task.task_type}`)}
                </strong>
                <StatusPill value={task.status} />
              </div>
              <div
                className="progress-line"
                role="progressbar"
                aria-label={t("settings.health.taskProgress", { id: task.id })}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={taskProgress(task)}
              >
                <div style={{ width: `${taskProgress(task)}%` }} />
              </div>
              <p>{task.processed_items}/{task.total_items}</p>
              {task.error_message && <p className="task-error">{task.error_message}</p>}
              {task.task_type === "duplicate_hash" && task.status === "done" && (
                <div className="health-hash-result" role="status">
                  <strong>
                    {task.result?.confirmed_groups?.length
                      ? t("settings.health.hashConfirmed", {
                          count: task.result.confirmed_groups.length
                        })
                      : t("settings.health.hashNoMatches")}
                  </strong>
                  {task.result?.confirmed_groups?.map((group) => (
                    <p key={group.hash_prefix}>
                      {group.audio_items.map((item) => item.file_path).join(" · ")}
                    </p>
                  ))}
                </div>
              )}
              <div className="health-row-actions">
                {isActiveTaskStatus(task.status) && (
                  <Button variant="text" onClick={() => onCancelTask(task)}>
                    {t("common.actions.cancel")}
                  </Button>
                )}
                {["failed", "canceled"].includes(task.status) && (
                  <Button variant="text" onClick={() => onRetryTask(task)}>
                    {t("common.actions.retry")}
                  </Button>
                )}
              </div>
            </article>
          ))}
        </div>
      </PanelCard>

      <PanelCard title={t("settings.health.missing")} className="settings-card-wide">
        {summary?.missing_audio.length === 0 && (
          <p className="muted">{t("settings.health.noMissing")}</p>
        )}
        <div className="health-missing-list">
          {summary?.missing_audio.map((audio) => (
            <article className="health-missing-row" key={audio.id}>
              <div className="health-missing-main">
                <strong>{audio.title}</strong>
                <span>{audio.file_path}</span>
                <span>{audio.file_size == null ? "—" : formatFileSize(audio.file_size)}</span>
              </div>
              <Button
                variant="outlined"
                disabled={action !== null}
                onClick={() => onFindCandidates(audio)}
              >
                {t("settings.health.findCandidates")}
              </Button>
              {candidates[audio.id] && (
                <div className="health-candidate-list">
                  {candidates[audio.id].length === 0 && (
                    <p className="muted">{t("settings.health.noCandidates")}</p>
                  )}
                  {candidates[audio.id].map((candidate) => (
                    <div className="health-candidate-row" key={candidate.path}>
                      <div>
                        <strong>{candidate.path}</strong>
                        <span>
                          {t("settings.health.candidateChecks", {
                            size: candidate.checks.size ? "✓" : "—",
                            duration: candidate.checks.duration ? "✓" : "—",
                            metadata: candidate.checks.metadata ? "✓" : "—",
                            fingerprint: candidate.checks.fingerprint ? "✓" : "—"
                          })}
                        </span>
                      </div>
                      <StatusPill value={candidate.eligible ? "done" : "failed"}>
                        {t(`settings.health.confidence.${candidate.confidence}`)}
                      </StatusPill>
                      <Button
                        variant="filled"
                        disabled={!candidate.eligible || action !== null}
                        onClick={() => onRelink(audio, candidate)}
                      >
                        {t("settings.health.previewRelink")}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      </PanelCard>

      <PanelCard title={t("settings.health.duplicates")} className="settings-card-wide">
        {summary?.duplicate_groups.length === 0 && (
          <p className="muted">{t("settings.health.noDuplicates")}</p>
        )}
        <div className="health-duplicate-list">
          {summary?.duplicate_groups.map((group) => (
            <article className="health-duplicate-row" key={group.candidate_key || group.hash_prefix}>
              <div>
                <strong>{group.title || t("settings.health.duplicateGroup")}</strong>
                <p>{group.audio_items.map((item) => item.file_path).join(" · ")}</p>
              </div>
              <Button
                variant="outlined"
                disabled={action !== null}
                onClick={() => onConfirmDuplicates(group)}
              >
                {t("settings.health.confirmHash")}
              </Button>
            </article>
          ))}
        </div>
        <p className="muted">{t("settings.health.hashOnDemand")}</p>
      </PanelCard>
    </div>
  );
}
