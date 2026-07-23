import { useState } from "react";
import { api } from "../api";
import type { AudioItem } from "../types";
import { displayAuthor, displayDescription, displayTitle, formatDuration } from "../types";

type TranscriptFilter = "all" | "yes" | "no";
type MissingFilter = "all" | "available" | "missing";

type Props = {
  title: string;
  q: string;
  setQ: (q: string) => void;
  isLoading?: boolean;
  loadError?: string;
  onOpenSettings: () => void;
  onClearFilters: () => void;
  missingDescriptionOnly: boolean;
  setMissingDescriptionOnly: (v: boolean) => void;
  hasTranscriptFilter: TranscriptFilter;
  setHasTranscriptFilter: (v: TranscriptFilter) => void;
  missingFilter: MissingFilter;
  setMissingFilter: (v: MissingFilter) => void;
  items: AudioItem[];
  totalCount?: number;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
  selectedId?: number;
  onSelect: (item: AudioItem) => void;
  onPlay: (item: AudioItem) => void;
  onPlayAt: (item: AudioItem, startSeconds: number) => void;
  onBatchTranscribe: () => void;
  onBatchAnalyze: () => void;
  isPlaylistView?: boolean;
  onRemoveFromPlaylist?: (item: AudioItem) => void;
  onMovePlaylistItem?: (item: AudioItem, direction: "up" | "down") => void;
  onMovePlaylistItemTo?: (source: AudioItem, target: AudioItem) => void;
};

const STATUS_TEXT: Record<string, string> = {
  none: "未开始",
  pending: "等待中",
  running: "进行中",
  done: "已完成",
  failed: "失败",
  canceled: "已取消",
  cancel_requested: "取消中"
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

function statusClass(value?: string): string {
  return (value || "none").toLowerCase().replace(/[^a-z0-9_-]/g, "") || "none";
}

function StatusPill({
  label,
  value
}: {
  label: string;
  value?: string;
}) {
  const cls = statusClass(value);
  const text = STATUS_TEXT[cls] || value || "未开始";

  return (
    <span className={`status-pill ${cls}`}>
      <span>{label}</span>
      {text}
    </span>
  );
}

function CoverThumb({ item }: { item: AudioItem }) {
  return (
    <div className={`cover-thumb ${item.is_missing ? "missing" : ""}`}>
      <span aria-hidden="true">♪</span>

      {item.cover_path && (
        <img
          src={api.coverUrl(item.id, item.updated_at)}
          alt=""
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
  query
}: {
  item: AudioItem;
  query: string;
}) {
  const tags = item.tags || [];

  if (tags.length === 0) return null;

  return (
    <div className="row-tags">
      {tags.slice(0, 5).map((tag) => (
        <span className="mini-tag" key={tag.id}>
          #<HighlightText text={tag.name} query={query} />
        </span>
      ))}

      {tags.length > 5 && <span className="mini-tag muted-tag">+{tags.length - 5}</span>}
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
  const hits = item.search_hits || [];

  if (!query.trim() || hits.length === 0) return null;

  return (
    <div className="search-hits">
      {hits.map((hit, index) => (
        <div
          key={`${hit.field}-${index}`}
          className={hit.start_seconds !== undefined ? "search-hit timed" : "search-hit"}
        >
          {hit.start_seconds !== undefined ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onPlayAt(item, hit.start_seconds || 0);
              }}
              title="从该 transcript 命中位置播放"
            >
              {formatDuration(hit.start_seconds)}
            </button>
          ) : (
            <strong>{hit.label}</strong>
          )}

          <span>
            {hit.start_seconds !== undefined && <strong>{hit.label}</strong>}
            <HighlightText text={hit.text} query={query} />
          </span>
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  q,
  missingDescriptionOnly,
  hasTranscriptFilter,
  missingFilter,
  onOpenSettings,
  onClearFilters
}: {
  q: string;
  missingDescriptionOnly: boolean;
  hasTranscriptFilter: TranscriptFilter;
  missingFilter: MissingFilter;
  onOpenSettings: () => void;
  onClearFilters: () => void;
}) {
  const hasFilter =
    Boolean(q.trim()) ||
    missingDescriptionOnly ||
    hasTranscriptFilter !== "all" ||
    missingFilter !== "all";

  return (
    <div className="empty-state">
      <div className="empty-illustration">🎧</div>

      <div className="empty-title">
        {hasFilter ? "没有找到匹配的音频" : "还没有导入音频"}
      </div>

      <div className="empty-subtitle">
        {hasFilter
          ? "当前搜索或筛选条件没有命中结果。可以清空筛选后重新浏览。"
          : "添加本地媒体库目录后，系统会自动读取 metadata、封面，并支持转写和 AI 标签整理。"}
      </div>

      <div className="empty-actions">
        {hasFilter ? (
          <button className="primary-button" onClick={onClearFilters}>
            清空筛选
          </button>
        ) : (
          <button className="primary-button" onClick={onOpenSettings}>
            添加媒体库
          </button>
        )}

        <button className="ghost-button" onClick={onOpenSettings}>
          打开设置
        </button>
      </div>

      <div className="empty-support">
        支持 MP3 / M4A / FLAC / WAV / OGG · 可转写 · 可 AI 生成描述和标签
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="list-skeleton" aria-label="正在加载音频列表">
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
  q,
  isLoading = false,
  loadError,
  onOpenSettings,
  onClearFilters,
  missingDescriptionOnly,
  hasTranscriptFilter,
  missingFilter,
  items,
  totalCount,
  hasMore,
  isLoadingMore,
  onLoadMore,
  selectedId,
  onSelect,
  onPlay,
  onPlayAt,
  isPlaylistView,
  onRemoveFromPlaylist,
  onMovePlaylistItem,
  onMovePlaylistItemTo
}: Props) {
  const [draggedPlaylistItemId, setDraggedPlaylistItemId] = useState<number | null>(null);

  function findDraggedItem(): AudioItem | undefined {
    if (!draggedPlaylistItemId) return undefined;
    return items.find((item) => item.playlist_item_id === draggedPlaylistItemId);
  }

  return (
    <section className="audio-list-panel" aria-busy={isLoading}>
      {loadError && (
        <div className="list-error">
          <strong>列表加载失败</strong>
          <span>{loadError}</span>
          <button onClick={onClearFilters}>清空筛选后重试</button>
        </div>
      )}

      {isLoading && items.length > 0 && (
        <div className="list-loading-bar">正在更新结果…</div>
      )}

      {isLoading && items.length === 0 && <ListSkeleton />}

      {!isLoading && !loadError && items.length === 0 && (
        <EmptyState
          q={q}
          missingDescriptionOnly={missingDescriptionOnly}
          hasTranscriptFilter={hasTranscriptFilter}
          missingFilter={missingFilter}
          onOpenSettings={onOpenSettings}
          onClearFilters={onClearFilters}
        />
      )}

      <div className="audio-scroll-list">
        {items.map((item) => {
          const draggable = Boolean(isPlaylistView && item.playlist_item_id);
          const description = displayDescription(item);

          return (
            <div
              key={
                isPlaylistView && item.playlist_item_id
                  ? `${item.id}-${item.playlist_item_id}`
                  : item.id
              }
              className={`audio-row ${selectedId === item.id ? "selected" : ""}`}
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
              onClick={() => onSelect(item)}
              onDoubleClick={() => onPlay(item)}
              style={{
                opacity:
                  draggedPlaylistItemId && draggedPlaylistItemId === item.playlist_item_id
                    ? 0.62
                    : 1
              }}
            >
              <CoverThumb item={item} />

              <div className="audio-info">
                <div className="title-line">
                  <div className="title">
                    {item.is_favorite ? "★ " : ""}
                    <HighlightText text={displayTitle(item)} query={q} />
                  </div>

                  {item.is_missing ? <span className="badge danger">missing</span> : null}

                  {draggable && (
                    <span className="drag-hint" title="拖拽可调整 playlist 顺序">
                      ⠿
                    </span>
                  )}
                </div>

                <div className="meta-line">
                  <span>
                    <HighlightText text={displayAuthor(item) || "Unknown"} query={q} />
                  </span>
                  <span className="meta-dot">·</span>
                  <span>{formatDuration(item.duration_seconds)}</span>
                  {item.language && (
                    <>
                      <span className="meta-dot">·</span>
                      <span>{item.language}</span>
                    </>
                  )}
                </div>

                {description && (
                  <div className="description-line">
                    <HighlightText text={description} query={q} />
                  </div>
                )}

                <RowTags item={item} query={q} />

                <div className="row-status">
                  <StatusPill label="转写" value={item.transcript_status} />
                  <StatusPill label="AI" value={item.ai_status} />
                </div>

                <SearchHits item={item} query={q} onPlayAt={onPlayAt} />
              </div>

              <div className="row-actions">
                <button
                  className="row-play-button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPlay(item);
                  }}
                >
                  播放
                </button>

                {isPlaylistView && item.playlist_item_id && (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onMovePlaylistItem?.(item, "up");
                      }}
                      title="在当前 playlist 中上移"
                    >
                      ↑
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onMovePlaylistItem?.(item, "down");
                      }}
                      title="在当前 playlist 中下移"
                    >
                      ↓
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveFromPlaylist?.(item);
                      }}
                      title="从当前 playlist 移除"
                    >
                      移除
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}

        {items.length > 0 && (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              gap: 12,
              padding: "18px 8px 28px",
              color: "var(--text-muted)",
              fontSize: 13
            }}
          >
            <span>
              已加载 {items.length}
              {typeof totalCount === "number" ? ` / ${totalCount}` : ""} 个音频
            </span>

            {hasMore && (
              <button onClick={onLoadMore} disabled={isLoadingMore}>
                {isLoadingMore ? "加载中..." : "加载更多"}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
