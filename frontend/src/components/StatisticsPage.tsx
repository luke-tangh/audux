import { useState } from "react";
import { useTranslation } from "react-i18next";

import { formatDateTime } from "../i18n/format";
import { useStatistics } from "../hooks/useStatistics";
import type { StatisticsOverview } from "../types";
import { Button, MaterialIcon } from "./ui";

type Props = {
  onOpenMissing: () => void;
  onOpenUntranscribed: () => void;
  onOpenMissingDescription: () => void;
  onOpenAiFailed: () => void;
  onOpenSettings: () => void;
};

const PERIOD_OPTIONS = [7, 30, 90, 365] as const;

function percent(count: number, total: number): number {
  return total > 0 ? Math.round((count / total) * 100) : 0;
}

function maxValue(values: number[]): number {
  return Math.max(1, ...values);
}

function DistributionRows({
  rows
}: {
  rows: Array<{ key: string; label: string; count: number; detail?: string }>;
}) {
  const maximum = maxValue(rows.map((row) => row.count));

  return (
    <div className="statistics-distribution-list">
      {rows.map((row) => (
        <div className="statistics-distribution-row" key={row.key}>
          <div className="statistics-row-copy">
            <strong>{row.label}</strong>
            <span>{row.detail || row.count}</span>
          </div>
          <div className="statistics-bar" aria-hidden="true">
            <span style={{ width: `${(row.count / maximum) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function StatisticsPage({
  onOpenMissing,
  onOpenUntranscribed,
  onOpenMissingDescription,
  onOpenAiFailed,
  onOpenSettings
}: Props) {
  const { t, i18n } = useTranslation();
  const [days, setDays] = useState(30);
  const [showDetails, setShowDetails] = useState(false);
  const { data, loading, error, refresh } = useStatistics(days);
  const number = new Intl.NumberFormat(i18n.resolvedLanguage);
  const compactNumber = new Intl.NumberFormat(i18n.resolvedLanguage, {
    notation: "compact",
    maximumFractionDigits: 1
  });

  function formatBytes(bytes: number) {
    if (bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${new Intl.NumberFormat(i18n.resolvedLanguage, { maximumFractionDigits: 1 }).format(bytes / 1024 ** index)} ${units[index]}`;
  }

  function formatHours(seconds: number) {
    const hours = seconds / 3600;
    return t("statistics.value.hours", {
      count: new Intl.NumberFormat(i18n.resolvedLanguage, {
        maximumFractionDigits: hours < 10 ? 1 : 0
      }).format(hours)
    });
  }

  if (loading && !data) {
    return (
      <section className="statistics-page statistics-state" aria-busy="true">
        <MaterialIcon name="bar_chart" size={34} />
        <h1>{t("statistics.title")}</h1>
        <p>{t("statistics.loading")}</p>
      </section>
    );
  }

  if (error && !data) {
    return (
      <section className="statistics-page statistics-state" role="alert">
        <MaterialIcon name="error" size={34} />
        <h1>{t("statistics.loadFailed")}</h1>
        <p>{error}</p>
        <Button variant="filled" onClick={refresh}>{t("common.actions.retry")}</Button>
      </section>
    );
  }

  if (!data) return null;

  if (data.library.total_items === 0) {
    return (
      <section className="statistics-page statistics-state">
        <MaterialIcon name="library_music" size={40} />
        <h1>{t("statistics.emptyTitle")}</h1>
        <p>{t("statistics.emptyDescription")}</p>
        <Button variant="filled" onClick={onOpenSettings}>{t("statistics.openLibrarySettings")}</Button>
      </section>
    );
  }

  const coverageRows = Object.entries(data.coverage).map(([key, value]) => ({
    key,
    ...value,
    percentage: percent(value.count, value.total)
  }));
  const formatRows = data.formats.slice(0, 8).map((row) => ({
    key: row.format,
    label: row.format.toUpperCase(),
    count: row.count,
    detail: t("statistics.itemsAndSize", {
      count: number.format(row.count),
      size: formatBytes(row.size_bytes)
    })
  }));
  const durationRows = data.duration_buckets.map((row) => ({
    key: row.key,
    label: t(`statistics.duration.${row.key}`),
    count: row.count,
    detail: t("statistics.itemCount", { count: number.format(row.count) })
  }));
  const ingestMax = maxValue(data.ingest_timeline.map((row) => row.count));
  const dailyMax = maxValue(data.listening.daily.map((row) => row.listened_seconds));
  const pendingActions = [
    { key: "missing", count: data.library.missing_items, action: onOpenMissing },
    {
      key: "transcript",
      count: data.coverage.transcript.total - data.coverage.transcript.count,
      action: onOpenUntranscribed
    },
    {
      key: "description",
      count: data.coverage.description.total - data.coverage.description.count,
      action: onOpenMissingDescription
    },
    { key: "aiFailed", count: data.library.ai_failed_items, action: onOpenAiFailed }
  ];

  return (
    <section className="statistics-page" aria-labelledby="statistics-title">
      <header className="statistics-header">
        <div>
          <p className="statistics-eyebrow">{t("statistics.eyebrow")}</p>
          <h1 id="statistics-title">{t("statistics.title")}</h1>
          <p>{t("statistics.description")}</p>
        </div>
        <div className="statistics-refresh">
          <span>{t("statistics.generatedAt", {
            time: formatDateTime(data.generated_at, i18n.resolvedLanguage || "zh-CN")
          })}</span>
          <Button size="sm" disabled={loading} onClick={refresh}>
            <MaterialIcon name="refresh" size={18} />
            {loading ? t("common.actions.refreshing") : t("common.actions.refresh")}
          </Button>
        </div>
      </header>

      <div className="statistics-kpi-grid">
        {([
          ["music_note", number.format(data.library.total_items), t("statistics.kpi.audio")],
          ["schedule", formatHours(data.library.total_duration_seconds), t("statistics.kpi.duration")],
          ["hard_drive", formatBytes(data.library.total_size_bytes), t("statistics.kpi.size")],
          ["play_circle", number.format(data.library.total_play_count), t("statistics.kpi.plays")]
        ] as const).map(([icon, value, label]) => (
          <article className="statistics-kpi" key={String(label)}>
            <MaterialIcon name={icon} size={23} />
            <strong>{value}</strong>
            <span>{label}</span>
          </article>
        ))}
      </div>

      <div className="statistics-detail-toggle">
        <Button
          size="sm"
          variant="text"
          aria-expanded={showDetails}
          onClick={() => setShowDetails((value) => !value)}
        >
          <MaterialIcon name={showDetails ? "expand_less" : "expand_more"} size={18} />
          {t(showDetails ? "statistics.hideDetails" : "statistics.showDetails")}
        </Button>
      </div>

      <div className={`statistics-dashboard-grid ${showDetails ? "show-secondary" : ""}`}>
        <article className="statistics-card statistics-coverage-card">
          <div className="statistics-card-heading">
            <div><h2>{t("statistics.coverage.title")}</h2><p>{t("statistics.coverage.subtitle")}</p></div>
          </div>
          <div className="statistics-coverage-list">
            {coverageRows.map((row) => (
              <div className="statistics-coverage-row" key={row.key}>
                <div className="statistics-row-copy">
                  <strong>{t(`statistics.coverage.${row.key}`)}</strong>
                  <span>{t("statistics.coverage.value", {
                    count: number.format(row.count), total: number.format(row.total), percent: row.percentage
                  })}</span>
                </div>
                <progress value={row.count} max={Math.max(1, row.total)}>{row.percentage}%</progress>
              </div>
            ))}
          </div>
        </article>

        <article className="statistics-card statistics-pending-card">
          <div className="statistics-card-heading">
            <div><h2>{t("statistics.pending.title")}</h2><p>{t("statistics.pending.subtitle")}</p></div>
          </div>
          <div className="statistics-action-list">
            {pendingActions.map((row) => (
              <Button preserveChildren key={row.key} onClick={row.action}>
                <span><strong>{number.format(row.count)}</strong>{t(`statistics.pending.${row.key}`)}</span>
                <MaterialIcon name="arrow_forward" size={19} />
              </Button>
            ))}
          </div>
          <div className="statistics-availability">
            <span>{t("statistics.playable", { count: number.format(data.library.playable_items) })}</span>
            <span>{t("statistics.favorites", { count: number.format(data.library.favorite_items) })}</span>
          </div>
        </article>

        <article className="statistics-card statistics-secondary-card">
          <div className="statistics-card-heading"><div><h2>{t("statistics.formats.title")}</h2><p>{t("statistics.formats.description")}</p></div></div>
          <DistributionRows rows={formatRows} />
        </article>

        <article className="statistics-card statistics-secondary-card">
          <div className="statistics-card-heading"><div><h2>{t("statistics.duration.title")}</h2><p>{t("statistics.duration.description")}</p></div></div>
          <DistributionRows rows={durationRows} />
        </article>

        <article className="statistics-card statistics-card-wide statistics-secondary-card">
          <div className="statistics-card-heading"><div><h2>{t("statistics.ingest.title")}</h2><p>{t("statistics.ingest.description")}</p></div></div>
          {data.ingest_timeline.length ? (
            <div className="statistics-column-chart" role="img" aria-label={t("statistics.ingest.chartLabel")}>
              {data.ingest_timeline.map((row) => (
                <div className="statistics-column" key={row.period} title={`${row.period}: ${row.count}`}>
                  <span className="statistics-column-value">{compactNumber.format(row.count)}</span>
                  <span className="statistics-column-bar" style={{ height: `${Math.max(4, (row.count / ingestMax) * 100)}%` }} />
                  <span>{row.period.slice(5)}</span>
                </div>
              ))}
            </div>
          ) : <p className="statistics-empty-copy">{t("statistics.noData")}</p>}
        </article>

        <article className="statistics-card statistics-card-wide statistics-listening-card">
          <div className="statistics-card-heading statistics-listening-heading">
            <div><h2>{t("statistics.listening.title")}</h2><p>{t("statistics.listening.description")}</p></div>
            <div className="statistics-periods" role="group" aria-label={t("statistics.listening.periodLabel")}>
              {PERIOD_OPTIONS.map((option) => (
                <Button size="sm" variant={days === option ? "filled" : "text"} key={option} onClick={() => setDays(option)}>
                  {t("statistics.listening.days", { count: option })}
                </Button>
              ))}
            </div>
          </div>
          <div className="statistics-listening-kpis">
            <div><strong>{number.format(data.listening.event_count)}</strong><span>{t("statistics.listening.starts")}</span></div>
            <div><strong>{formatHours(data.listening.listened_seconds)}</strong><span>{t("statistics.listening.time")}</span></div>
            <div><strong>{number.format(data.listening.completed_count)}</strong><span>{t("statistics.listening.completed")}</span></div>
            <div><strong>{number.format(data.listening.active_days)}</strong><span>{t("statistics.listening.activeDays")}</span></div>
          </div>
          {data.listening.daily.length ? (
            <div className="statistics-column-chart statistics-daily-chart" role="img" aria-label={t("statistics.listening.chartLabel")}>
              {data.listening.daily.map((row) => (
                <div className="statistics-column" key={row.date} title={`${row.date}: ${formatHours(row.listened_seconds)}`}>
                  <span className="statistics-column-bar" style={{ height: `${Math.max(4, (row.listened_seconds / dailyMax) * 100)}%` }} />
                  <span>{row.date.slice(5)}</span>
                </div>
              ))}
            </div>
          ) : <p className="statistics-empty-copy">{t("statistics.listening.empty")}</p>}
        </article>

        <article className="statistics-card statistics-secondary-card">
          <div className="statistics-card-heading"><div><h2>{t("statistics.topAudio.title")}</h2><p>{t("statistics.topAudio.description")}</p></div></div>
          <ol className="statistics-ranking-list">
            {data.listening.top_audio.map((row) => (
              <li key={row.audio_id}>
                <span><strong>{row.title}</strong><em>{row.author || t("common.empty.unknownAuthor")}</em></span>
                <span>{formatHours(row.listened_seconds)}</span>
              </li>
            ))}
          </ol>
          {!data.listening.top_audio.length && <p className="statistics-empty-copy">{t("statistics.listening.empty")}</p>}
        </article>

        <article className="statistics-card statistics-secondary-card">
          <div className="statistics-card-heading"><div><h2>{t("statistics.recent.title")}</h2><p>{t("statistics.recent.description")}</p></div></div>
          <ul className="statistics-recent-list">
            {data.listening.recent_events.map((row) => (
              <li key={row.event_id}>
                <span><strong>{row.title}</strong><em>{formatDateTime(row.started_at, i18n.resolvedLanguage || "zh-CN")}</em></span>
                {row.completed && <span className="statistics-completed">{t("statistics.recent.completed")}</span>}
              </li>
            ))}
          </ul>
          {!data.listening.recent_events.length && <p className="statistics-empty-copy">{t("statistics.listening.empty")}</p>}
        </article>

        <article className="statistics-card statistics-secondary-card">
          <div className="statistics-card-heading"><div><h2>{t("statistics.roots.title")}</h2><p>{t("statistics.roots.description")}</p></div></div>
          <ul className="statistics-root-list">
            {data.roots.map((row) => (
              <li key={row.id}>
                <span><strong title={row.path}>{row.path}</strong><em>{t("statistics.roots.detail", { count: number.format(row.item_count), size: formatBytes(row.size_bytes) })}</em></span>
                <span className={row.is_enabled ? "statistics-root-enabled" : "statistics-root-disabled"}>
                  {t(row.is_enabled ? "statistics.roots.enabled" : "statistics.roots.disabled")}
                </span>
              </li>
            ))}
          </ul>
        </article>

        <article className="statistics-card statistics-secondary-card">
          <div className="statistics-card-heading"><div><h2>{t("statistics.tags.title")}</h2><p>{t("statistics.tags.description")}</p></div></div>
          <div className="statistics-tag-cloud">
            {data.top_tags.map((row) => <span key={row.id}>#{row.name}<em>{row.item_count}</em></span>)}
          </div>
          {!data.top_tags.length && <p className="statistics-empty-copy">{t("statistics.tags.empty")}</p>}
        </article>
      </div>
    </section>
  );
}
