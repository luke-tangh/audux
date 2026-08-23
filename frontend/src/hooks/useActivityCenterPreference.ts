import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../api";

export const ACTIVITY_CENTER_SETTING_KEY = "ui.activity_center.enabled";

type SettingRow = {
  key: string;
  value: string;
};

export function activityCenterEnabledFromSettings(
  settings: SettingRow[] | null | undefined
): boolean {
  if (!Array.isArray(settings)) return false;

  const value = settings.find(
    (setting) => setting.key === ACTIVITY_CENTER_SETTING_KEY
  )?.value;

  return ["1", "true", "yes", "on"].includes((value || "").toLowerCase());
}

export function useActivityCenterPreference() {
  const [enabled, setEnabled] = useState(false);
  const requestVersionRef = useRef(0);

  useEffect(() => {
    const requestVersion = ++requestVersionRef.current;

    api.listSettings()
      .then((settings) => {
        if (requestVersion !== requestVersionRef.current) return;
        setEnabled(activityCenterEnabledFromSettings(settings));
      })
      .catch((error) => {
        console.error(error);
      });

    return () => {
      requestVersionRef.current += 1;
    };
  }, []);

  const updateEnabled = useCallback(async (nextEnabled: boolean) => {
    const requestVersion = ++requestVersionRef.current;
    await api.setSetting(
      ACTIVITY_CENTER_SETTING_KEY,
      nextEnabled ? "true" : "false"
    );
    if (requestVersion === requestVersionRef.current) setEnabled(nextEnabled);
  }, []);

  return { enabled, updateEnabled };
}
