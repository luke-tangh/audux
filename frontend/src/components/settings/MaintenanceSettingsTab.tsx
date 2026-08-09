import { api } from "../../api";
import type { Tag } from "../../types";
import { useTranslation } from "react-i18next";
import { Button, PanelCard } from "../ui";

type MaintenanceSettingsTabProps = {
  maintenanceTags: Tag[];
  onRebuildSearch: () => void;
  onCleanupTags: () => void;
  onLoadTags: () => void;
  onRenameTag: (tag: Tag) => void;
  onMergeTag: (tag: Tag) => void;
  onDeleteTag: (tag: Tag) => void;
};

export default function MaintenanceSettingsTab({
  maintenanceTags,
  onRebuildSearch,
  onCleanupTags,
  onLoadTags,
  onRenameTag,
  onMergeTag,
  onDeleteTag
}: MaintenanceSettingsTabProps) {
  const { t } = useTranslation();
  return (
    <div className="settings-grid-layout">
      <PanelCard title={t("settings.maintenance.exportIndex")}>
        <div className="section-actions">
          <Button variant="outlined" onClick={() => window.open(api.metadataExportUrl("json"), "_blank")}>
            {t("settings.maintenance.exportJson")}
          </Button>

          <Button variant="outlined" onClick={() => window.open(api.metadataExportUrl("csv"), "_blank")}>
            {t("settings.maintenance.exportCsv")}
          </Button>

          <Button variant="outlined" onClick={onRebuildSearch}>
            {t("settings.maintenance.rebuild")}
          </Button>
        </div>
      </PanelCard>

      <PanelCard
        title={t("settings.maintenance.tags")}
        actions={
          <>
            <Button variant="outlined" onClick={onCleanupTags}>
              {t("settings.maintenance.cleanup")}
            </Button>
            <Button variant="outlined" onClick={onLoadTags}>
              {t("settings.maintenance.refresh")}
            </Button>
          </>
        }
      >
        <p className="muted">{t("settings.maintenance.description")}</p>

        {maintenanceTags.length === 0 && <p className="muted">{t("settings.maintenance.noTags")}</p>}

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
                {t("settings.maintenance.rename")}
              </Button>
              <Button
                preserveChildren
                className="tag-text-action"
                size="sm"
                variant="text"
                onClick={() => onMergeTag(tag)}
              >
                {t("settings.maintenance.merge")}
              </Button>
              <Button
                preserveChildren
                className="tag-text-action"
                size="sm"
                variant="danger"
                onClick={() => onDeleteTag(tag)}
              >
                {t("common.actions.delete")}
              </Button>
            </span>
          ))}
        </div>
      </PanelCard>
    </div>
  );
}
