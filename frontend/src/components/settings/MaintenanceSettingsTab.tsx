import { api } from "../../api";
import type { Tag } from "../../types";
import { Button } from "../ui";

type MaintenanceSettingsTabProps = {
  maintenanceTags: Tag[];
  onRebuildSearch: () => void;
  onCleanupTags: () => void;
  onLoadTags: () => void;
  onRenameTag: (tag: Tag) => void;
  onDeleteTag: (tag: Tag) => void;
};

export default function MaintenanceSettingsTab({
  maintenanceTags,
  onRebuildSearch,
  onCleanupTags,
  onLoadTags,
  onRenameTag,
  onDeleteTag
}: MaintenanceSettingsTabProps) {
  return (
    <div className="settings-grid-layout">
      <section className="panel-card">
        <h3>导出与索引</h3>

        <div className="section-actions">
          <Button variant="outlined" onClick={() => window.open(api.metadataExportUrl("json"), "_blank")}>
            导出 Metadata JSON
          </Button>

          <Button variant="outlined" onClick={() => window.open(api.metadataExportUrl("csv"), "_blank")}>
            导出 Metadata CSV
          </Button>

          <Button variant="outlined" onClick={onRebuildSearch}>
            重建搜索索引
          </Button>
        </div>
      </section>

      <section className="panel-card">
        <h3>标签维护</h3>

        <p className="muted">可重命名标签，或清理没有关联任何音频的 orphan tags。</p>

        <div className="section-actions">
          <Button variant="outlined" onClick={onCleanupTags}>
            清理未使用标签
          </Button>
          <Button variant="outlined" onClick={onLoadTags}>
            刷新标签
          </Button>
        </div>

        {maintenanceTags.length === 0 && <p className="muted">暂无标签</p>}

        <div className="tag-list">
          {maintenanceTags.map((tag) => (
            <span key={tag.id} className="tag">
              #{tag.name}
              <Button
                preserveChildren
                className="tag-text-action"
                size="sm"
                variant="text"
                onClick={() => onRenameTag(tag)}
              >
                重命名
              </Button>
              <Button
                preserveChildren
                className="tag-text-action"
                size="sm"
                variant="danger"
                onClick={() => onDeleteTag(tag)}
              >
                删除
              </Button>
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}
