import { MaterialIcon } from "../ui";

export default function DetailEmptyState() {
  return (
    <aside className="inspector-panel empty-inspector">
      <div className="empty-detail-card">
        <div className="empty-detail-icon">
          <MaterialIcon name="music_note" size={38} />
        </div>

        <span className="eyebrow">Inspector</span>

        <h2>选择一个音频开始整理</h2>

        <p>
          在中间列表中选择音频后，可以查看封面、metadata、播放记录、标签、AI 建议和 transcript。
        </p>

        <div className="detail-empty-steps">
          <div>
            <strong>1</strong>
            <span>添加媒体库目录</span>
          </div>

          <div>
            <strong>2</strong>
            <span>扫描并导入音频</span>
          </div>

          <div>
            <strong>3</strong>
            <span>转写、AI 分析、整理标签</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
