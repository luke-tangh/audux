import { Button, IconButton, SearchField, SelectField, MaterialIcon } from "./ui";

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

const TRANSCRIPT_FILTER_OPTIONS = [
  { value: "all", label: "全部转写" },
  { value: "yes", label: "已有 transcript" },
  { value: "no", label: "未完成 transcript" }
];

const FILE_FILTER_OPTIONS = [
  { value: "all", label: "全部文件" },
  { value: "available", label: "仅可播放" },
  { value: "missing", label: "仅缺失" }
];

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
  const hasItems = totalCount > 0;

  return (
    <header className="top-command-bar">
      <div className="top-title-block">
        <div>
          <span className="eyebrow">Local Audio Studio</span>
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
          {searchLimited && (
            <p className="search-limit-warning">
              搜索命中较多，当前仅展示前 {searchLimit || 200} 条。请缩小关键词以获得更精确结果。
            </p>
          )}
        </div>

        <div className="top-count-card">
          <strong>{isLoading ? "同步中" : totalCount}</strong>
          <span>{isLoading ? "正在更新结果" : "个音频"}</span>
        </div>
      </div>

      <div className="top-action-row">
        <SearchField
          wrapperClassName="top-command-search"
          value={q}
          onValueChange={setQ}
          placeholder="搜索标题、作者、标签、描述或 transcript"
          aria-label="搜索标题、作者、标签、描述或 transcript"
        />

        <div className="top-toolbar-controls">
          <div
            className="filter-group top-filter-controls"
            role="group"
            aria-label="资料库筛选"
          >
            <SelectField
              density="compact"
              wrapperClassName="topbar-select-field"
              controlSize="toolbar"
              controlWidth={152}
              controlMinWidth={152}
              label="转写"
              value={hasTranscriptFilter}
              options={TRANSCRIPT_FILTER_OPTIONS}
              aria-label="按 transcript 状态筛选"
              title="按 transcript 状态筛选"
              onValueChange={(value) => setHasTranscriptFilter(value as TranscriptFilter)}
            />

            <SelectField
              density="compact"
              wrapperClassName="topbar-select-field"
              controlSize="toolbar"
              controlWidth={136}
              controlMinWidth={136}
              label="文件"
              value={missingFilter}
              options={FILE_FILTER_OPTIONS}
              aria-label="按文件状态筛选"
              title="按文件状态筛选"
              onValueChange={(value) => setMissingFilter(value as MissingFilter)}
            />

            <Button
              variant={missingDescriptionOnly ? "tonal" : "outlined"}
              className="top-quick-action top-missing-description-action"
              aria-pressed={missingDescriptionOnly}
              title={
                missingDescriptionOnly
                  ? "关闭缺描述筛选"
                  : "只看缺少描述的音频"
              }
              onClick={() => setMissingDescriptionOnly(!missingDescriptionOnly)}
            >
              缺描述
            </Button>
          </div>

          <div
            className="top-toolbar-actions"
            role="group"
            aria-label="快捷操作"
          >
            <div
              className="top-batch-group"
              role="group"
              aria-label="批处理"
            >
              <Button
                variant="outlined"
                className="top-quick-action top-batch-action top-batch-transcribe-action"
                aria-label="批量转写当前筛选结果"
                title="批量转写当前筛选结果"
                onClick={onBatchTranscribe}
                disabled={!hasItems}
              >
                转写
              </Button>

              <Button
                variant="filled"
                className="top-quick-action top-batch-action top-batch-ai-action"
                aria-label="批量 AI 分析当前筛选结果"
                title="批量 AI 分析当前筛选结果"
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
                title="清空所有筛选条件"
                onClick={onClearFilters}
              >
                重置
              </Button>
            )}
          </div>

          <IconButton
            className="top-settings-button"
            variant="soft"
            label="打开设置"
            onClick={onOpenSettings}
          >
            <MaterialIcon name="settings" size={20} />
          </IconButton>
        </div>
      </div>
    </header>
  );
}
