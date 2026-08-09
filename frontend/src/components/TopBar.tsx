import { Button, IconButton, SearchField, SelectField, MaterialIcon } from "./ui";
import { useTranslation } from "react-i18next";

type TranscriptFilter = "all" | "yes" | "no";
type MissingFilter = "all" | "available" | "missing";

type Props = {
  title: string;
  subtitle?: string;
  totalCount: number;
  searchLimited?: boolean;
  searchLimit?: number | null;
  q: string;
  setQ: (value: string) => void;
  isLoading?: boolean;

  hasActiveFilter: boolean;
  onClearFilters: () => void;

  hasTranscriptFilter: TranscriptFilter;
  setHasTranscriptFilter: (value: TranscriptFilter) => void;

  missingFilter: MissingFilter;
  setMissingFilter: (value: MissingFilter) => void;

  onBatchTranscribe: () => void;
  onBatchAnalyze: () => void;
  onOpenSettings: () => void;
};

export default function TopBar({
  title,
  subtitle,
  totalCount,
  searchLimited = false,
  searchLimit,
  q,
  setQ,
  isLoading = false,
  hasActiveFilter,
  onClearFilters,
  hasTranscriptFilter,
  setHasTranscriptFilter,
  missingFilter,
  setMissingFilter,
  onBatchTranscribe,
  onBatchAnalyze,
  onOpenSettings
}: Props) {
  const { t } = useTranslation();
  const hasItems = totalCount > 0;
  const transcriptFilterOptions = [
    { value: "all", label: t("topbar.transcriptAll") },
    { value: "yes", label: t("topbar.transcriptYes") },
    { value: "no", label: t("topbar.transcriptNo") }
  ];
  const fileFilterOptions = [
    { value: "all", label: t("topbar.fileAll") },
    { value: "available", label: t("topbar.fileAvailable") },
    { value: "missing", label: t("topbar.fileMissing") }
  ];

  return (
    <header className="top-command-bar">
      <div className="top-title-block">
        <div>
          <span className="eyebrow">Local Audio Studio</span>
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
          {searchLimited && (
            <p className="search-limit-warning">
              {t("topbar.searchLimited", { count: searchLimit || 200 })}
            </p>
          )}
        </div>

        <div className="top-count-card">
          <strong>{isLoading ? t("topbar.syncing") : totalCount}</strong>
          <span>{isLoading ? t("topbar.updating") : t("topbar.audioCount")}</span>
        </div>
      </div>

      <div className="top-action-row">
        <SearchField
          wrapperClassName="top-command-search"
          value={q}
          onValueChange={setQ}
          placeholder={t("topbar.searchPlaceholder")}
          aria-label={t("topbar.searchPlaceholder")}
        />

        <div className="top-toolbar-controls">
          <div
            className="filter-group top-filter-controls"
            role="group"
            aria-label={t("topbar.filterGroup")}
          >
            <SelectField
              density="compact"
              wrapperClassName="topbar-select-field"
              controlSize="toolbar"
              controlWidth={152}
              controlMinWidth={152}
              label={t("topbar.transcript")}
              value={hasTranscriptFilter}
              options={transcriptFilterOptions}
              aria-label={t("topbar.transcriptFilter")}
              title={t("topbar.transcriptFilter")}
              onValueChange={(value) => setHasTranscriptFilter(value as TranscriptFilter)}
            />

            <SelectField
              density="compact"
              wrapperClassName="topbar-select-field"
              controlSize="toolbar"
              controlWidth={136}
              controlMinWidth={136}
              label={t("topbar.file")}
              value={missingFilter}
              options={fileFilterOptions}
              aria-label={t("topbar.fileFilter")}
              title={t("topbar.fileFilter")}
              onValueChange={(value) => setMissingFilter(value as MissingFilter)}
            />

          </div>

          <div
            className="top-toolbar-actions"
            role="group"
            aria-label={t("topbar.quickActions")}
          >
            <div
              className="top-batch-group"
              role="group"
              aria-label={t("topbar.batch")}
            >
              <Button
                variant="outlined"
                className="top-quick-action top-batch-action top-batch-transcribe-action"
                aria-label={t("topbar.batchTranscribe")}
                title={t("topbar.batchTranscribe")}
                onClick={onBatchTranscribe}
                disabled={!hasItems}
              >
                {t("topbar.transcript")}
              </Button>

              <Button
                variant="filled"
                className="top-quick-action top-batch-action top-batch-ai-action"
                aria-label={t("topbar.batchAnalyze")}
                title={t("topbar.batchAnalyze")}
                onClick={onBatchAnalyze}
                disabled={!hasItems}
              >
                AI
              </Button>
            </div>

            {hasActiveFilter && (
              <Button
                variant="text"
                className="top-clear-filter-button"
                title={t("topbar.clearFilters")}
                onClick={onClearFilters}
              >
                {t("topbar.reset")}
              </Button>
            )}
          </div>

          <IconButton
            className="top-settings-button"
            variant="soft"
            label={t("topbar.openSettings")}
            onClick={onOpenSettings}
          >
            <MaterialIcon name="settings" size={20} />
          </IconButton>
        </div>
      </div>
    </header>
  );
}
