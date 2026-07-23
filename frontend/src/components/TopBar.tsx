type TranscriptFilter = "all" | "yes" | "no";
type MissingFilter = "all" | "available" | "missing";

type Props = {
  title: string;
  subtitle?: string;
  totalCount: number;
  q: string;
  setQ: (value: string) => void;
  isLoading?: boolean;

  hasActiveFilter: boolean;
  onClearFilters: () => void;

  missingDescriptionOnly: boolean;
  setMissingDescriptionOnly: (value: boolean) => void;

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
  q,
  setQ,
  isLoading = false,
  hasActiveFilter,
  onClearFilters,
  missingDescriptionOnly,
  setMissingDescriptionOnly,
  hasTranscriptFilter,
  setHasTranscriptFilter,
  missingFilter,
  setMissingFilter,
  onBatchTranscribe,
  onBatchAnalyze,
  onOpenSettings
}: Props) {
  return (
    <header className="top-command-bar">
      <div className="top-title-block">
        <div>
          <span className="eyebrow">Local Audio Studio</span>
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>

        <div className="top-count-card">
          <strong>{isLoading ? "同步中" : totalCount}</strong>
          <span>{isLoading ? "正在更新结果" : "个音频"}</span>
        </div>
      </div>

      <div className="top-action-row">
        <div className="global-search">
          <span className="global-search-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <path
                d="M10.5 4.75a5.75 5.75 0 1 0 0 11.5 5.75 5.75 0 0 0 0-11.5ZM3.25 10.5a7.25 7.25 0 1 1 12.78 4.67l4.15 4.15a.75.75 0 1 1-1.06 1.06l-4.15-4.15A7.25 7.25 0 0 1 3.25 10.5Z"
                fill="currentColor"
              />
            </svg>
          </span>

          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索标题、作者、标签、描述或 transcript"
            aria-label="搜索标题、作者、标签、描述或 transcript"
          />

          {q.trim() && (
            <button className="search-clear-button" onClick={() => setQ("")}>
              ×
            </button>
          )}
        </div>

        <div className="top-toolbar-controls">
          <div className="filter-group" aria-label="资料库筛选">
            <label className={missingDescriptionOnly ? "filter-chip active" : "filter-chip"}>
              <input
                type="checkbox"
                checked={missingDescriptionOnly}
                onChange={(e) => setMissingDescriptionOnly(e.target.checked)}
              />
              缺描述
            </label>

            <label className="select-filter" title="按 transcript 状态筛选">
              <span>转写</span>
              <select
                value={hasTranscriptFilter}
                onChange={(e) => setHasTranscriptFilter(e.target.value as TranscriptFilter)}
                aria-label="按 transcript 状态筛选"
              >
                <option value="all">全部转写</option>
                <option value="yes">已有 transcript</option>
                <option value="no">未完成 transcript</option>
              </select>
            </label>

            <label className="select-filter" title="按文件状态筛选">
              <span>文件</span>
              <select
                value={missingFilter}
                onChange={(e) => setMissingFilter(e.target.value as MissingFilter)}
                aria-label="按文件状态筛选"
              >
                <option value="all">全部文件</option>
                <option value="available">仅可播放</option>
                <option value="missing">仅缺失</option>
              </select>
            </label>
          </div>

          <div className="top-buttons">
            {hasActiveFilter && (
              <button className="ghost-button" onClick={onClearFilters}>
                清空
              </button>
            )}

            <button
              className="ghost-button"
              onClick={onBatchTranscribe}
              disabled={totalCount === 0}
            >
              批量转写
            </button>

            <button
              className="primary-button"
              onClick={onBatchAnalyze}
              disabled={totalCount === 0}
            >
              批量 AI
            </button>

            <button className="icon-soft-button" onClick={onOpenSettings} title="设置">
              ⚙
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
