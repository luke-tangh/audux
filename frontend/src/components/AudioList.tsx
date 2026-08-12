import { useState } from "react";
import { api } from "../api";
import type { AudioItem } from "../types";
import { displayAuthor, displayDescription, displayTitle, formatDuration } from "../types";
import { ActionMenu, Button, StatusPill, MaterialIcon } from "./ui";
import { useTranslation } from "react-i18next";
import { formatLanguageName } from "../i18n/format";

const MAX_BATCH_SELECTION = 500;

type Props = {
  title: string;
  q: string;
  isLoading?: boolean;
  isRefreshing?: boolean;
  loadError?: string;
  onOpenSettings: () => void;
  onClearFilters: () => void;
  hasActiveFilter: boolean;
  items: AudioItem[];
  totalCount?: number;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
  selectedId?: number;
  selectionMode: boolean;
  selectedAudioIds: ReadonlySet<number>;
  onSelect: (item: AudioItem) => void;
  onPlay: (item: AudioItem) => void;
  onPlayAt: (item: AudioItem, startSeconds: number) => void;
  onAddToQueue: (item: AudioItem) => void;
  onPlayNext: (item: AudioItem) => void;
  isPlaylistView?: boolean;
  onRemoveFromPlaylist?: (item: AudioItem) => void;
  onMovePlaylistItem?: (item: AudioItem, direction: "up" | "down") => void;
  onMovePlaylistItemTo?: (source: AudioItem, target: AudioItem) => void;
  onEnterSelectionMode: () => void;
  onExitSelectionMode: () => void;
  onToggleAudioSelection: (audioId: number) => void;
  onToggleSelectAllLoaded: () => void;
  onClearAudioSelection: () => void;
  onBatchAddTags: () => void;
  onBatchRemoveTag: () => void;
  onBatchAddToPlaylist: () => void;
  onBatchSetFavorite: (isFavorite: boolean) => void;
  onBatchTranscribe: () => void;
  onBatchAnalyze: () => void;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function HighlightText({
  text,
  query
}: {
  text?: string;
  query: string;
}) {
  const value = text || "";
  const tokens = query
    .trim()
    .split(/\s+/)
    .map((x) => x.trim())
    .filter(Boolean);

  if (!value || tokens.length === 0) {
    return <>{value}</>;
  }

  const pattern = new RegExp(`(${tokens.map(escapeRegExp).join("|")})`, "gi");
  const parts = value.split(pattern);

  return (
    <>
      {parts.map((part, index) => {
        const matched = tokens.some((token) => part.toLowerCase() === token.toLowerCase());

        if (!matched) {
          return <span key={index}>{part}</span>;
        }

        return <mark key={index}>{part}</mark>;
      })}
    </>
  );
}

function CoverThumb({ item }: { item: AudioItem }) {
  return (
    <div className={`cover-thumb ${item.is_missing ? "missing" : ""}`}>
      <MaterialIcon name="music_note" size={24} />

      {item.cover_path && (
        <img
          key={`${item.id}-${item.updated_at}`}
          src={api.coverUrl(item.id, item.updated_at)}
          alt=""
          onLoad={(e) => {
            e.currentTarget.style.display = "";
          }}
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      )}
    </div>
  );
}

function RowTags({
  item,
  query,
  limit
}: {
  item: AudioItem;
  query: string;
  limit: number;
}) {
  const tags = item.tags || [];

  if (tags.length === 0) return null;

  return (
    <div className="row-tags">
      {tags.slice(0, limit).map((tag) => (
        <span className="mini-tag" key={tag.id}>
          #<HighlightText text={tag.name} query={query} />
        </span>
      ))}

      {tags.length > limit && (
        <span className="mini-tag muted-tag">+{tags.length - limit}</span>
      )}
    </div>
  );
}

function SearchHits({
  item,
  query,
  onPlayAt
}: {
  item: AudioItem;
  query: string;
  onPlayAt: (item: AudioItem, startSeconds: number) => void;
}) {
  const { t } = useTranslation();
  const hits = item.search_hits || [];
  const hitLabel = (field: string, fallback: string) =>
    field === "transcript" ? t("common.technical.transcript") : fallback;

  if (!query.trim() || hits.length === 0) return null;

  return (
    <div className="search-hits">
      {hits.map((hit, index) => (
        <div
          key={`${hit.field}-${index}`}
          className={hit.start_seconds !== undefined ? "search-hit timed" : "search-hit"}
        >
          {hit.start_seconds !== undefined ? (
            <Button preserveChildren
              type="button"
              aria-label={t("audioList.playFromHit", { time: formatDuration(hit.start_seconds), title: displayTitle(item) })}
              onClick={(e) => {
                e.stopPropagation();
                onPlayAt(item, hit.start_seconds || 0);
              }}
              title={t("audioList.playFromHitTitle")}
            >
              {formatDuration(hit.start_seconds)}
            </Button>
          ) : (
            <strong>{hitLabel(hit.field, hit.label)}</strong>
          )}

          <span className="search-hit-content">
            {hit.context_before && (
              <span className="search-hit-context">
                <HighlightText text={hit.context_before} query={query} />
              </span>
            )}
            <span className="search-hit-match">
            {hit.start_seconds !== undefined && (
              <strong>{hitLabel(hit.field, hit.label)}</strong>
            )}
            <HighlightText text={hit.text} query={query} />
            </span>
            {hit.context_after && (
              <span className="search-hit-context">
                <HighlightText text={hit.context_after} query={query} />
              </span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  hasActiveFilter,
  onOpenSettings,
  onClearFilters
}: {
  hasActiveFilter: boolean;
  onOpenSettings: () => void;
  onClearFilters: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="empty-state">
      <div className="empty-illustration" aria-hidden="true">
        <MaterialIcon name="music_note" size={42} />
      </div>

      <div className="empty-title">
        {hasActiveFilter ? t("audioList.noMatches") : t("audioList.noAudio")}
      </div>

      <div className="empty-subtitle">
        {hasActiveFilter
          ? t("audioList.noMatchesDescription")
          : t("audioList.noAudioDescription")}
      </div>

      <div className="empty-actions">
        {hasActiveFilter ? (
          <Button variant="filled" onClick={onClearFilters}>
            {t("audioList.clearFilters")}
          </Button>
        ) : (
          <Button variant="filled" onClick={onOpenSettings}>
            {t("audioList.addLibrary")}
          </Button>
        )}

        <Button variant="outlined" onClick={onOpenSettings}>
          {t("audioList.openSettings")}
        </Button>
      </div>

      <div className="empty-support">
        {t("audioList.supportedFormats")}
      </div>
    </div>
  );
}

function ListSkeleton() {
  const { t } = useTranslation();
  return (
    <div className="list-skeleton" aria-label={t("audioList.loadingLabel")}>
      {Array.from({ length: 7 }).map((_, index) => (
        <div className="skeleton-row" key={index}>
          <span className="skeleton-cover" />
          <span className="skeleton-content">
            <span className="skeleton-line long" />
            <span className="skeleton-line medium" />
            <span className="skeleton-line short" />
          </span>
          <span className="skeleton-action" />
        </div>
      ))}
    </div>
  );
}

export default function AudioList({
  title,
  q,
  isLoading = false,
  isRefreshing = false,
  loadError,
  onOpenSettings,
  onClearFilters,
  hasActiveFilter,
  items,
  totalCount,
  hasMore,
  isLoadingMore,
  onLoadMore,
  selectedId,
  selectionMode,
  selectedAudioIds,
  onSelect,
  onPlay,
  onPlayAt,
  onAddToQueue,
  onPlayNext,
  isPlaylistView,
  onRemoveFromPlaylist,
  onMovePlaylistItem,
  onMovePlaylistItemTo,
  onEnterSelectionMode,
  onExitSelectionMode,
  onToggleAudioSelection,
  onToggleSelectAllLoaded,
  onClearAudioSelection,
  onBatchAddTags,
  onBatchRemoveTag,
  onBatchAddToPlaylist,
  onBatchSetFavorite,
  onBatchTranscribe,
  onBatchAnalyze
}: Props) {
  const { t, i18n } = useTranslation();
  const [draggedPlaylistItemId, setDraggedPlaylistItemId] = useState<number | null>(null);
  const [density, setDensity] = useState<"compact" | "comfortable">(() => {
    try {
      const storedDensity = window.localStorage.getItem(
        "local-audio-library-list-density"
      );
      if (storedDensity === "comfortable" || storedDensity === "compact") {
        return storedDensity;
      }
      return window.matchMedia("(min-width: 1180px)").matches
        ? "comfortable"
        : "compact";
    } catch {
      return "compact";
    }
  });
  const canReorderPlaylist = Boolean(
    isPlaylistView && onMovePlaylistItem && onMovePlaylistItemTo
  );

  function findDraggedItem(): AudioItem | undefined {
    if (!draggedPlaylistItemId) return undefined;
    return items.find((item) => item.playlist_item_id === draggedPlaylistItemId);
  }

  const selectedRowIndex =
    selectedId !== undefined ? items.findIndex((item) => item.id === selectedId) : -1;
  const selectedCount = selectedAudioIds.size;
  const selectableItems = items.slice(0, MAX_BATCH_SELECTION);
  const allLoadedSelected =
    selectableItems.length > 0 &&
    selectableItems.every((item) => selectedAudioIds.has(item.id));

  function focusAudioRow(index: number) {
    const row = document.querySelector<HTMLElement>(
      `[data-audio-row-index="${index}"]`
    );
    row?.focus();
  }

  function toggleDensity() {
    const nextDensity = density === "compact" ? "comfortable" : "compact";
    setDensity(nextDensity);
    try {
      window.localStorage.setItem("local-audio-library-list-density", nextDensity);
    } catch {
      // The visual preference remains active for this session when storage is unavailable.
    }
  }

  return (
    <section
      className={`audio-list-panel density-${density}`}
      aria-busy={isLoading || isRefreshing}
    >
      {loadError && (
        <div className="list-error">
          <strong>{t("audioList.loadFailed")}</strong>
          <span>{loadError}</span>
          <Button preserveChildren onClick={onClearFilters}>{t("audioList.clearAndRetry")}</Button>
        </div>
      )}

      {isRefreshing && (
        <div className="list-refresh-indicator" aria-hidden="true">
          <span />
        </div>
      )}

      {isLoading && items.length === 0 && <ListSkeleton />}

      {!isLoading && !loadError && items.length === 0 && (
        <EmptyState
          hasActiveFilter={hasActiveFilter}
          onOpenSettings={onOpenSettings}
          onClearFilters={onClearFilters}
        />
      )}

      {!isLoading && !loadError && items.length > 0 && (
        <div
          className={`batch-selection-toolbar ${selectionMode ? "active" : ""}`}
          aria-label={t("audioList.batchOrganize")}
        >
          {!selectionMode ? (
            <>
              <Button variant="outlined" size="sm" onClick={onEnterSelectionMode}>
                {t("audioList.multiSelect")}
              </Button>
              <ActionMenu
                className="list-process-menu"
                size="sm"
                variant="tonal"
                label={t("topbar.processResults", { count: totalCount || items.length })}
                buttonText={t("topbar.processResultsShort", { count: totalCount || items.length })}
                buttonIcon="auto_awesome"
                items={[
                  {
                    id: "transcribe",
                    label: t("topbar.transcribeResults", { count: totalCount || items.length }),
                    icon: "subtitles",
                    onSelect: onBatchTranscribe
                  },
                  {
                    id: "analyze",
                    label: t("topbar.analyzeResults", { count: totalCount || items.length }),
                    icon: "auto_awesome",
                    onSelect: onBatchAnalyze
                  }
                ]}
              />
              <span className="batch-toolbar-spacer" />
              <span
                className="batch-toolbar-count"
                title={t("audioList.loadedCount", {
                  loaded: items.length,
                  total: typeof totalCount === "number" ? ` / ${totalCount}` : ""
                })}
              >
                {typeof totalCount === "number" ? `${items.length} / ${totalCount}` : items.length}
              </span>
              <Button
                variant="text"
                size="sm"
                className="density-toggle"
                aria-label={
                  density === "compact"
                    ? t("audioList.useComfortableDensity")
                    : t("audioList.useCompactDensity")
                }
                title={
                  density === "compact"
                    ? t("audioList.useComfortableDensity")
                    : t("audioList.useCompactDensity")
                }
                onClick={toggleDensity}
                leadingIcon={
                  <MaterialIcon
                    name={density === "compact" ? "view_list" : "view_agenda"}
                    size={18}
                  />
                }
              >
                {t(
                  density === "compact"
                    ? "audioList.densityCompact"
                    : "audioList.densityComfortable"
                )}
              </Button>
            </>
          ) : (
            <>
              <strong aria-live="polite">{t("audioList.selectedCount", { count: selectedCount })}</strong>
              <Button variant="text" size="sm" onClick={onToggleSelectAllLoaded}>
                {allLoadedSelected
                  ? t("audioList.deselectAll")
                  : items.length > MAX_BATCH_SELECTION
                    ? t("audioList.selectFirst", { count: MAX_BATCH_SELECTION })
                    : t("audioList.selectAllLoaded", { count: items.length })}
              </Button>
              <Button
                variant="text"
                size="sm"
                onClick={onClearAudioSelection}
                disabled={selectedCount === 0}
              >
                {t("audioList.clearSelection")}
              </Button>
              <span className="batch-selection-divider" aria-hidden="true" />
              <Button size="sm" onClick={onBatchAddTags} disabled={selectedCount === 0}>
                {t("audioList.addTags")}
              </Button>
              <Button size="sm" onClick={onBatchRemoveTag} disabled={selectedCount === 0}>
                {t("audioList.removeTags")}
              </Button>
              <Button
                size="sm"
                onClick={onBatchAddToPlaylist}
                disabled={selectedCount === 0}
              >
                {t("audioList.addPlaylist")}
              </Button>
              <ActionMenu
                size="sm"
                variant="tonal"
                label={t("audioList.favoriteState")}
                buttonText={t("audioList.favoriteState")}
                buttonIcon="star"
                disabled={selectedCount === 0}
                items={[
                  {
                    id: "favorite",
                    label: t("audioList.favorite"),
                    icon: "star",
                    onSelect: () => onBatchSetFavorite(true)
                  },
                  {
                    id: "unfavorite",
                    label: t("audioList.unfavorite"),
                    icon: "star_outline",
                    onSelect: () => onBatchSetFavorite(false)
                  }
                ]}
              />
              <Button variant="outlined" size="sm" onClick={onExitSelectionMode}>
                {t("audioList.done")}
              </Button>
            </>
          )}
        </div>
      )}

      <div className="audio-scroll-list" role="list" aria-label={t("audioList.listLabel", { title })}>
        <div className="list-column-header" aria-hidden="true">
          <span>{t("audioList.columnAudio")}</span>
          <span>{t("audioList.columnStatus")}</span>
          <span>{t("audioList.columnActions")}</span>
        </div>
        {items.map((item, index) => {
          const draggable = Boolean(
            !selectionMode && canReorderPlaylist && item.playlist_item_id
          );
          const description = displayDescription(item);
          const rowIsSelected = selectedId === item.id;
          const rowIsBatchSelected = selectedAudioIds.has(item.id);
          const rowIsTabbable =
            rowIsSelected || (selectedRowIndex < 0 && index === 0);
          const transcriptStatus = item.transcript_status || "none";
          const aiStatus = item.ai_status || "none";
          const hasProcessingStatus =
            transcriptStatus !== "none" || aiStatus !== "none";

          return (
            <div
              key={
                isPlaylistView && item.playlist_item_id
                  ? `${item.id}-${item.playlist_item_id}`
                  : item.id
              }
              className={[
                "audio-row",
                rowIsSelected ? "selected" : "",
                selectionMode ? "selection-mode" : "",
                rowIsBatchSelected ? "batch-selected" : ""
              ].filter(Boolean).join(" ")}
              role="listitem"
              aria-label={t("audioList.audioLabel", { title: displayTitle(item) })}
              draggable={draggable}
              onDragStart={(e) => {
                if (!draggable || !item.playlist_item_id) return;
                setDraggedPlaylistItemId(item.playlist_item_id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                if (!draggable) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }}
              onDrop={(e) => {
                if (!draggable) return;
                e.preventDefault();

                const source = findDraggedItem();
                if (source) {
                  onMovePlaylistItemTo?.(source, item);
                }

                setDraggedPlaylistItemId(null);
              }}
              onDragEnd={() => setDraggedPlaylistItemId(null)}
              style={{
                opacity:
                  draggedPlaylistItemId && draggedPlaylistItemId === item.playlist_item_id
                    ? 0.62
                    : 1
              }}
            >
              {selectionMode && (
                <label
                  className="batch-row-checkbox"
                  onClick={(event) => event.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={rowIsBatchSelected}
                    aria-label={t("audioList.selectAudio", { title: displayTitle(item) })}
                    onChange={() => onToggleAudioSelection(item.id)}
                  />
                </label>
              )}

              <button
                type="button"
                className="audio-row-primary"
                tabIndex={rowIsTabbable ? 0 : -1}
                aria-current={rowIsSelected ? "true" : undefined}
                aria-label={t("audioList.openDetails", { title: displayTitle(item) })}
                aria-keyshortcuts="Enter Space ArrowUp ArrowDown Home End"
                data-audio-row="true"
                data-audio-row-index={index}
                onClick={() =>
                  selectionMode ? onToggleAudioSelection(item.id) : onSelect(item)
                }
                onDoubleClick={() => {
                  if (!selectionMode) onPlay(item);
                }}
                onKeyDown={(e) => {
                  if (selectionMode && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    onToggleAudioSelection(item.id);
                    return;
                  }

                  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    const nextIndex = e.key === "ArrowDown"
                      ? Math.min(items.length - 1, index + 1)
                      : Math.max(0, index - 1);
                    const nextItem = items[nextIndex];
                    if (nextItem && nextIndex !== index) {
                      onSelect(nextItem);
                      focusAudioRow(nextIndex);
                    }
                    return;
                  }

                  if (e.key === "Home" || e.key === "End") {
                    e.preventDefault();
                    const nextIndex = e.key === "Home" ? 0 : items.length - 1;
                    const nextItem = items[nextIndex];
                    if (nextItem && nextIndex !== index) {
                      onSelect(nextItem);
                      focusAudioRow(nextIndex);
                    }
                    return;
                  }

                  if (e.key === " ") {
                    e.preventDefault();
                    onPlay(item);
                  }
                }}
              >
                <CoverThumb item={item} />

                <div className="audio-info">
                <div className="title-line">
                  {item.is_favorite && (
                    <span className="favorite-marker" title={t("audioList.favorite")}>
                      <MaterialIcon name="star" size={15} />
                    </span>
                  )}
                  <div className="title">
                    <HighlightText text={displayTitle(item)} query={q} />
                  </div>

                  {item.is_missing ? <span className="badge danger">{t("audioList.missingBadge")}</span> : null}

                  {draggable && (
                    <span className="drag-hint" title={t("audioList.dragHint")}>
                      <MaterialIcon name="drag_indicator" size={18} />
                    </span>
                  )}
                </div>

                <div className="meta-line">
                  <span>
                    <HighlightText
                      text={displayAuthor(item) || t("common.empty.unknownAuthor")}
                      query={q}
                    />
                  </span>
                  <span className="meta-dot">·</span>
                  <span>{formatDuration(item.duration_seconds)}</span>
                  {item.language && (
                    <>
                      <span className="meta-dot">·</span>
                      <span>{formatLanguageName(item.language, i18n.resolvedLanguage || "zh-CN")}</span>
                    </>
                  )}
                </div>

                {description && (density === "comfortable" || rowIsSelected || q.trim()) && (
                  <div className="description-line">
                    <HighlightText text={description} query={q} />
                  </div>
                )}

                <RowTags
                  item={item}
                  query={q}
                  limit={density === "comfortable" ? 5 : 2}
                />

                </div>

                <span className="row-detail-hint" aria-hidden="true">
                  <MaterialIcon name="chevron_right" size={20} />
                </span>
              </button>

              <div className="row-status" aria-label={t("audioList.processingStatus")}>
                {hasProcessingStatus ? (
                  <>
                    {transcriptStatus !== "none" && (
                      <StatusPill label={t("audioList.transcript")} value={transcriptStatus} />
                    )}
                    {aiStatus !== "none" && (
                      <StatusPill label={t("common.technical.ai")} value={aiStatus} />
                    )}
                  </>
                ) : (
                  <span className="processing-idle">{t("audioList.notProcessed")}</span>
                )}
              </div>

              <div className="row-actions">
                <Button
                  type="button"
                  variant="tonal"
                  className="row-play-button"
                  leadingIcon={<MaterialIcon name="play_arrow" size={18} />}
                  aria-label={t("audioList.playLabel", { title: displayTitle(item) })}
                  disabled={item.is_missing}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPlay(item);
                  }}
                >
                  {t("audioList.play")}
                </Button>

                <ActionMenu
                  className="row-more-menu"
                  label={t("audioList.moreActions", { title: displayTitle(item) })}
                  items={[
                    {
                      id: "next",
                      label: t("audioList.playNext"),
                      icon: "playlist_play",
                      disabled: item.is_missing,
                      onSelect: () => onPlayNext(item)
                    },
                    {
                      id: "queue",
                      label: t("audioList.addQueue"),
                      icon: "queue_music",
                      disabled: item.is_missing,
                      onSelect: () => onAddToQueue(item)
                    },
                    ...(isPlaylistView && item.playlist_item_id && canReorderPlaylist
                      ? [
                          {
                            id: "up",
                            label: t("audioList.moveUp"),
                            icon: "keyboard_arrow_up" as const,
                            onSelect: () => onMovePlaylistItem?.(item, "up")
                          },
                          {
                            id: "down",
                            label: t("audioList.moveDown"),
                            icon: "keyboard_arrow_down" as const,
                            onSelect: () => onMovePlaylistItem?.(item, "down")
                          }
                        ]
                      : []),
                    ...(isPlaylistView && item.playlist_item_id
                      ? [
                          {
                            id: "remove",
                            label: t("audioList.removePlaylist"),
                            icon: "remove_circle_outline" as const,
                            danger: true,
                            onSelect: () => onRemoveFromPlaylist?.(item)
                          }
                        ]
                      : [])
                  ]}
                />
              </div>

              {q.trim() && (item.search_hits?.length || 0) > 0 && (
                <div className="audio-row-search-hits">
                  <SearchHits item={item} query={q} onPlayAt={onPlayAt} />
                </div>
              )}
            </div>
          );
        })}

        {items.length > 0 && (
          <div className="audio-list-footer">
            {hasMore ? (
              <Button variant="outlined" onClick={onLoadMore} disabled={isLoadingMore}>
                {isLoadingMore ? t("audioList.loadingMore") : t("audioList.loadMore")}
              </Button>
            ) : (
              <span>{t("audioList.allResultsShown", { count: items.length })}</span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
