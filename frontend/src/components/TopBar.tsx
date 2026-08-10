import { Button, IconButton, SearchField, SelectField, MaterialIcon } from "./ui";
import { useTranslation } from "react-i18next";
import type { SortMode } from "../hooks/library/types";

type TranscriptFilter = "all" | "yes" | "no";
type MissingFilter = "all" | "available" | "missing" | "aiFailed";
type LibraryFileFilter = MissingFilter | "transcriptYes" | "transcriptNo";

type Props = {
  title: string;
  subtitle?: string;
  totalCount: number;
  searchLimited?: boolean;
  searchLimit?: number | null;
  q: string;
  setQ: (value: string) => void;
  isLoading?: boolean;
  queryLocked?: boolean;

  hasActiveFilter: boolean;
  onClearFilters: () => void;

  hasTranscriptFilter: TranscriptFilter;
  setHasTranscriptFilter: (value: TranscriptFilter) => void;

  missingFilter: MissingFilter;
  setMissingFilter: (value: MissingFilter) => void;

  sortMode: SortMode;
  setSortMode: (value: SortMode) => void;

  activeSavedViewName?: string;
  savedViewDirty: boolean;
  canSaveView: boolean;
  onSaveView: () => void;
  onUpdateSavedView: () => void;

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
  queryLocked = false,
  hasActiveFilter,
  onClearFilters,
  hasTranscriptFilter,
  setHasTranscriptFilter,
  missingFilter,
  setMissingFilter,
  sortMode,
  setSortMode,
  activeSavedViewName,
  savedViewDirty,
  canSaveView,
  onSaveView,
  onUpdateSavedView,
  onBatchTranscribe,
  onBatchAnalyze,
  onOpenSettings
}: Props) {
  const { t } = useTranslation();
  const hasItems = totalCount > 0;
  const fileFilterOptions = [
    { value: "all", label: t("topbar.fileAll") },
    { value: "available", label: t("topbar.fileAvailable") },
    { value: "missing", label: t("topbar.fileMissing") },
    { value: "transcriptYes", label: t("topbar.transcriptYes") },
    { value: "transcriptNo", label: t("topbar.transcriptNo") },
    { value: "aiFailed", label: t("topbar.fileAiFailed") }
  ];
  const sortOptions = [
    { value: "default", label: t("topbar.sortDefault") },
    { value: "title_asc", label: t("topbar.sortTitleAsc") },
    { value: "title_desc", label: t("topbar.sortTitleDesc") },
    { value: "author_asc", label: t("topbar.sortAuthorAsc") },
    { value: "created_desc", label: t("topbar.sortCreatedDesc") },
    { value: "updated_desc", label: t("topbar.sortUpdatedDesc") },
    { value: "duration_asc", label: t("topbar.sortDurationAsc") },
    { value: "duration_desc", label: t("topbar.sortDurationDesc") },
    { value: "play_count_desc", label: t("topbar.sortPlayCountDesc") }
  ];
  const libraryFileFilter: LibraryFileFilter =
    hasTranscriptFilter === "yes"
      ? "transcriptYes"
      : hasTranscriptFilter === "no"
        ? "transcriptNo"
        : missingFilter;

  function setLibraryFileFilter(value: LibraryFileFilter) {
    if (value === "transcriptYes" || value === "transcriptNo") {
      setMissingFilter("all");
      setHasTranscriptFilter(value === "transcriptYes" ? "yes" : "no");
      return;
    }

    setHasTranscriptFilter("all");
    setMissingFilter(value);
  }

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
        <div className="top-query-row">
          <SearchField
            wrapperClassName="top-command-search"
            value={q}
            onValueChange={setQ}
            placeholder={t("topbar.searchPlaceholder")}
            aria-label={t("topbar.searchPlaceholder")}
            disabled={queryLocked}
          />
        </div>

        <div className="top-toolbar-controls">
          <div
            className="filter-group top-filter-controls"
            role="group"
            aria-label={t("topbar.filterGroup")}
          >
            <SelectField
              density="compact"
              wrapperClassName="topbar-select-field top-file-field"
              controlSize="toolbar"
              controlWidth="100%"
              controlMinWidth={0}
              label={t("topbar.file")}
              value={libraryFileFilter}
              options={fileFilterOptions}
              aria-label={t("topbar.fileFilter")}
              title={t("topbar.fileFilter")}
              disabled={queryLocked}
              onValueChange={(value) =>
                setLibraryFileFilter(value as LibraryFileFilter)
              }
            />

            <SelectField
              density="compact"
              wrapperClassName="topbar-select-field top-sort-field"
              controlSize="toolbar"
              controlWidth="100%"
              controlMinWidth={0}
              label={t("topbar.sort")}
              value={sortMode}
              options={sortOptions}
              aria-label={t("topbar.sortLabel")}
              title={t("topbar.sortLabel")}
              disabled={queryLocked}
              onValueChange={(value) => setSortMode(value as SortMode)}
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
                disabled={!hasItems || queryLocked}
              >
                {t("topbar.transcript")}
              </Button>

              <Button
                variant="filled"
                className="top-quick-action top-batch-action top-batch-ai-action"
                aria-label={t("topbar.batchAnalyze")}
                title={t("topbar.batchAnalyze")}
                onClick={onBatchAnalyze}
                disabled={!hasItems || queryLocked}
              >
                AI
              </Button>
            </div>

            <Button
              variant="outlined"
              className="top-save-view-button"
              disabled={!canSaveView}
              title={
                canSaveView
                  ? t("savedViews.saveCurrentHint")
                  : t("savedViews.unsupportedView")
              }
              onClick={onSaveView}
            >
              {t("savedViews.saveCurrent")}
            </Button>

            {activeSavedViewName && (
              <Button
                variant="tonal"
                className="top-update-view-button"
                disabled={!savedViewDirty}
                title={t("savedViews.updateHint", { name: activeSavedViewName })}
                onClick={onUpdateSavedView}
              >
                {t("savedViews.updateCurrent")}
              </Button>
            )}

            {hasActiveFilter && !queryLocked && (
              <Button
                variant="text"
                className="top-clear-filter-button"
                title={t("topbar.clearFilters")}
                onClick={onClearFilters}
              >
                {t("topbar.reset")}
              </Button>
            )}

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
      </div>
    </header>
  );
}
