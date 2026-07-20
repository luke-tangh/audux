import { useState } from "react";
import { api } from "../api";
import type { AudioItem } from "../types";
import { displayAuthor, displayTitle, formatDuration } from "../types";

type TranscriptFilter = "all" | "yes" | "no";
type MissingFilter = "all" | "available" | "missing";

type Props = {
  title: string;
  q: string;
  setQ: (q: string) => void;
  missingDescriptionOnly: boolean;
  setMissingDescriptionOnly: (v: boolean) => void;
  hasTranscriptFilter: TranscriptFilter;
  setHasTranscriptFilter: (v: TranscriptFilter) => void;
  missingFilter: MissingFilter;
  setMissingFilter: (v: MissingFilter) => void;
  items: AudioItem[];
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
  canceled: "已取消"
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

        return (
          <mark
            key={index}
            style={{
              padding: "0 2px",
              borderRadius: 4,
              color: "#111827",
              background: "#fde68a"
            }}
          >
            {part}
          </mark>
        );
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
    <div className="row-status">
      {tags.slice(0, 6).map((tag) => (
        <span className="status-pill none" key={tag.id}>
          #<HighlightText text={tag.name} query={query} />
        </span>
      ))}

      {tags.length > 6 && (
        <span className="status-pill none">
          +{tags.length - 6}
        </span>
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
  const hits = item.search_hits || [];

  if (!query.trim() || hits.length === 0) return null;

  return (
    <div
      style={{
        display: "grid",
        gap: 6,
        marginTop: 8,
        padding: 8,
        border: "1px solid rgba(148,163,184,.16)",
        borderRadius: 12,
        background: "rgba(2,6,23,.24)"
      }}
    >
      {hits.map((hit, index) => (
        <div
          key={`${hit.field}-${index}`}
          style={{
            display: "grid",
            gridTemplateColumns: hit.start_seconds !== undefined ? "86px minmax(0,1fr)" : "72px minmax(0,1fr)",
            gap: 8,
            alignItems: "start",
            color: "#cbd5e1",
            fontSize: 12,
            lineHeight: 1.5
          }}
        >
          {hit.start_seconds !== undefined ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onPlayAt(item, hit.start_seconds || 0);
              }}
              style={{
                padding: "3px 7px",
                fontSize: 12,
                borderRadius: 999
              }}
              title="从该 transcript 命中位置播放"
            >
              {formatDuration(hit.start_seconds)}
            </button>
          ) : (
            <strong style={{ color: "#93c5fd" }}>{hit.label}</strong>
          )}

          <span>
            {hit.start_seconds !== undefined && (
              <strong style={{ color: "#93c5fd", marginRight: 6 }}>{hit.label}</strong>
            )}
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
  missingFilter
}: {
  q: string;
  missingDescriptionOnly: boolean;
  hasTranscriptFilter: TranscriptFilter;
  missingFilter: MissingFilter;
}) {
  const hasFilter =
    Boolean(q.trim()) ||
    missingDescriptionOnly ||
    hasTranscriptFilter !== "all" ||
    missingFilter !== "all";

  return (
    <div className="empty-state">
      <div className="empty-icon">🎧</div>

      <div className="empty-title">
        {hasFilter ? "没有找到匹配的音频" : "还没有导入音频"}
      </div>

      <div className="empty-subtitle">
        {hasFilter
          ? "可以尝试清空搜索关键词，或关闭筛选条件。"
          : "请进入设置添加媒体库目录，然后点击扫描。"}
      </div>
    </div>
  );
}

export default function AudioList({
  title,
  q,
  setQ,
  missingDescriptionOnly,
  setMissingDescriptionOnly,
  hasTranscriptFilter,
  setHasTranscriptFilter,
  missingFilter,
  setMissingFilter,
  items,
  selectedId,
  onSelect,
  onPlay,
  onPlayAt,
  onBatchTranscribe,
  onBatchAnalyze,
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
    <section className="audio-list">
      <div className="library-header">
        <div className="toolbar-title">
          <div>
            <span className="eyebrow">当前视图</span>
            <strong>{title}</strong>
          </div>

          <span className="count-chip">{items.length} 个音频</span>
        </div>

        <div className="toolbar-controls">
          <div className="search-box">
            <span aria-hidden="true">⌕</span>

            <input
              className="search-input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索标题、作者、描述、标签或转写文本"
            />
          </div>

          <label className="filter-pill">
            <input
              type="checkbox"
              checked={missingDescriptionOnly}
              onChange={(e) => setMissingDescriptionOnly(e.target.checked)}
            />
            只看缺描述
          </label>

          <select
            value={hasTranscriptFilter}
            onChange={(e) => setHasTranscriptFilter(e.target.value as TranscriptFilter)}
            title="按 transcript 状态筛选"
          >
            <option value="all">全部转写</option>
            <option value="yes">已有 transcript</option>
            <option value="no">未完成 transcript</option>
          </select>

          <select
            value={missingFilter}
            onChange={(e) => setMissingFilter(e.target.value as MissingFilter)}
            title="按文件缺失状态筛选"
          >
            <option value="all">全部文件</option>
            <option value="available">仅可播放</option>
            <option value="missing">仅缺失</option>
          </select>
        </div>

        <div className="toolbar-actions">
          <button
            className="ghost-button"
            onClick={onBatchTranscribe}
            disabled={items.length === 0}
          >
            批量转写
          </button>

          <button
            className="primary-soft-button"
            onClick={onBatchAnalyze}
            disabled={items.length === 0}
          >
            批量 AI 分析
          </button>
        </div>
      </div>

      <div className="list">
        {items.length === 0 && (
          <EmptyState
            q={q}
            missingDescriptionOnly={missingDescriptionOnly}
            hasTranscriptFilter={hasTranscriptFilter}
            missingFilter={missingFilter}
          />
        )}

        {items.map((item) => {
          const draggable = Boolean(isPlaylistView && item.playlist_item_id);

          return (
            <div
              key={isPlaylistView && item.playlist_item_id ? `${item.id}-${item.playlist_item_id}` : item.id}
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
                  draggedPlaylistItemId && draggedPlaylistItemId === item.playlist_item_id ? 0.62 : 1
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
                    <span className="status-pill none" title="拖拽可调整 playlist 顺序">
                      拖拽排序
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

                <RowTags item={item} query={q} />

                <div className="row-status">
                  <StatusPill label="转写" value={item.transcript_status} />
                  <StatusPill label="AI" value={item.ai_status} />
                </div>

                <SearchHits item={item} query={q} onPlayAt={onPlayAt} />
              </div>

              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  justifyContent: "flex-end"
                }}
              >
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
                      上移
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onMovePlaylistItem?.(item, "down");
                      }}
                      title="在当前 playlist 中下移"
                    >
                      下移
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
      </div>
    </section>
  );
}
