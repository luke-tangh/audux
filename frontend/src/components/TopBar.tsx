import {
  Button,
  MaterialIcon,
  SearchField,
  SelectField
} from "./ui";
import { useState } from "react";
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
  onUpdateSavedView
}: Props) {
  const { t } = useTranslation();
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const fileFilterOptions = [
    { value: "all", label: t("topbar.statusAll") },
    { value: "available", label: t("topbar.statusFileAvailable") },
    { value: "missing", label: t("topbar.statusFileMissing") },
    { value: "transcriptYes", label: t("topbar.statusTranscriptYes") },
    { value: "transcriptNo", label: t("topbar.statusTranscriptNo") },
    { value: "aiFailed", label: t("topbar.statusAiFailed") }
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
  const statusLabel = fileFilterOptions.find(
    (option) => option.value === libraryFileFilter
  )?.label;
  const sortLabel = sortOptions.find((option) => option.value === sortMode)?.label;
  const visibleFilterCount = [
    q.trim() ? "search" : "",
    libraryFileFilter !== "all" ? "status" : "",
    sortMode !== "default" ? "sort" : ""
  ].filter(Boolean).length || (hasActiveFilter ? 1 : 0);

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
          <div className="top-heading-line">
            <h1>{title}</h1>
            <span className="top-inline-count">
              {isLoading
                ? t("topbar.syncing")
                : t("topbar.countInline", { count: totalCount })}
            </span>
          </div>
          {subtitle && <p>{subtitle}</p>}
          {searchLimited && (
            <p className="search-limit-warning">
              {t("topbar.searchLimited", { count: searchLimit || 200 })}
            </p>
          )}
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

        <Button
          variant="outlined"
          className="top-filter-toggle"
          aria-expanded={filtersExpanded}
          aria-controls="library-filter-controls"
          leadingIcon={<MaterialIcon name="filter_list" size={18} />}
          trailingIcon={
            <MaterialIcon name={filtersExpanded ? "expand_less" : "expand_more"} size={18} />
          }
          onClick={() => setFiltersExpanded((current) => !current)}
        >
          {t("topbar.filtersAndSort", { count: visibleFilterCount })}
        </Button>

        <div
          id="library-filter-controls"
          className={`top-toolbar-controls ${filtersExpanded ? "expanded" : ""}`.trim()}
        >
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
              controlHeight={42}
              label={t("topbar.status")}
              value={libraryFileFilter}
              options={fileFilterOptions}
              aria-label={t("topbar.statusFilter")}
              title={t("topbar.statusFilter")}
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
              controlHeight={42}
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
            {hasActiveFilter && !activeSavedViewName && (
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
            )}

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

          </div>
        </div>
      </div>

      {(q.trim() || libraryFileFilter !== "all" || sortMode !== "default" || activeSavedViewName) && (
        <div className="active-filter-chips" aria-label={t("topbar.activeFilters")}>
          {activeSavedViewName && (
            <span className="active-filter-chip saved-view-chip">
              <MaterialIcon name="menu_book" size={16} />
              {activeSavedViewName}
            </span>
          )}
          {q.trim() && (
            <Button
              preserveChildren
              size="sm"
              className="active-filter-chip"
              aria-label={t("topbar.removeSearchFilter", { value: q.trim() })}
              disabled={queryLocked}
              onClick={() => setQ("")}
            >
              <MaterialIcon name="search" size={16} />
              <span>{q.trim()}</span>
              <MaterialIcon name="close" size={15} />
            </Button>
          )}
          {libraryFileFilter !== "all" && (
            <Button
              preserveChildren
              size="sm"
              className="active-filter-chip"
              aria-label={t("topbar.removeStatusFilter", { value: statusLabel })}
              disabled={queryLocked}
              onClick={() => setLibraryFileFilter("all")}
            >
              <span>{statusLabel}</span>
              <MaterialIcon name="close" size={15} />
            </Button>
          )}
          {sortMode !== "default" && (
            <Button
              preserveChildren
              size="sm"
              className="active-filter-chip"
              aria-label={t("topbar.removeSort", { value: sortLabel })}
              disabled={queryLocked}
              onClick={() => setSortMode("default")}
            >
              <span>{sortLabel}</span>
              <MaterialIcon name="close" size={15} />
            </Button>
          )}
        </div>
      )}
    </header>
  );
}
