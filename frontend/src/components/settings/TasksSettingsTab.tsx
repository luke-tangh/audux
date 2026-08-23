import { useState } from "react";
import { useTranslation } from "react-i18next";

import TaskPanel from "../TaskPanel";
import { CheckboxField, PanelCard } from "../ui";
import type { ToastType } from "./types";

type TasksSettingsTabProps = {
  activityCenterEnabled: boolean;
  onActivityCenterEnabledChange: (enabled: boolean) => Promise<void>;
  onTaskChanged: () => void;
  notify?: (message: string, type?: ToastType) => void;
};

export default function TasksSettingsTab({
  activityCenterEnabled,
  onActivityCenterEnabledChange,
  onTaskChanged,
  notify
}: TasksSettingsTabProps) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  async function updateActivityCenter(enabled: boolean) {
    setSaving(true);
    setSaveError("");
    try {
      await onActivityCenterEnabledChange(enabled);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSaveError(message);
      notify?.(t("settings.tasks.activityCenterSaveFailed", { error: message }), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="settings-tab-stack">
      <PanelCard
        title={t("settings.tasks.activityCenterTitle")}
        className="max-form-card"
      >
        <CheckboxField
          checked={activityCenterEnabled}
          disabled={saving}
          label={t("settings.tasks.activityCenterEnabled")}
          description={t("settings.tasks.activityCenterDescription")}
          onCheckedChange={(enabled) => void updateActivityCenter(enabled)}
        />
        {saveError && (
          <p className="settings-inline-error" role="alert">
            {t("settings.tasks.activityCenterSaveFailed", { error: saveError })}
          </p>
        )}
      </PanelCard>

      <PanelCard>
        <TaskPanel onTaskChanged={onTaskChanged} notify={notify} />
      </PanelCard>
    </div>
  );
}
