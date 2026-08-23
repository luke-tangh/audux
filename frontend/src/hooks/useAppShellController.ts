import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { AudioItem } from "../types";
import { useDialog } from "../components/dialog/UnifiedDialog";
import type { ViewMode } from "./library/types";

type Params = {
  selected: AudioItem | null;
  setSelected: (item: AudioItem | null) => void;
  view: ViewMode;
  openSettings: () => void;
  initialized: boolean;
  rootsLength: number;
  activeSavedViewId: number | null;
  selectedPlaylistId: number | null;
  selectedTag?: string;
};

export function useAppShellController({
  selected,
  setSelected,
  view,
  openSettings,
  initialized,
  rootsLength,
  activeSavedViewId,
  selectedPlaylistId,
  selectedTag
}: Params) {
  const { t } = useTranslation();
  const dialog = useDialog();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorDirty, setInspectorDirty] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const settingsBeforeLeaveRef = useRef<(() => Promise<boolean>) | null>(null);
  const [compactNavigation, setCompactNavigation] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 860px)").matches
  );
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    typeof window !== "undefined" &&
      window.localStorage.getItem("audux.sidebar.collapsed") === "true"
  );
  const [onboardingOpen, setOnboardingOpen] = useState(false);

  useEffect(() => {
    if (!selected) {
      setInspectorOpen(false);
      setInspectorDirty(false);
    }
  }, [selected]);

  useEffect(() => {
    if (!inspectorDirty && !settingsDirty) return;
    const preventWindowClose = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventWindowClose);
    return () => window.removeEventListener("beforeunload", preventWindowClose);
  }, [inspectorDirty, settingsDirty]);

  useEffect(() => {
    if (!inspectorOpen || !window.matchMedia("(max-width: 1040px)").matches) return;
    const frame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(".inspector-close-button")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [inspectorOpen, selected?.id]);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 860px)");
    const update = () => {
      setCompactNavigation(query.matches);
      if (!query.matches) setNavigationOpen(false);
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (compactNavigation) setNavigationOpen(false);
  }, [activeSavedViewId, compactNavigation, selectedPlaylistId, selectedTag, view]);

  useEffect(() => {
    window.localStorage.setItem("audux.sidebar.collapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (initialized && rootsLength === 0) setOnboardingOpen(true);
  }, [initialized, rootsLength]);

  async function confirmDiscardInspectorChanges() {
    if (!inspectorDirty) return true;
    return dialog.confirm({
      title: t("detail.overview.discardTitle"),
      message: t("detail.overview.discardMessage"),
      confirmLabel: t("detail.overview.discardChanges"),
      cancelLabel: t("detail.overview.keepEditing"),
      tone: "warning",
      destructive: true
    });
  }

  async function openInspector(item: AudioItem) {
    if (selected?.id !== item.id && !(await confirmDiscardInspectorChanges())) return;
    setInspectorDirty(false);
    setSelected(item);
    setInspectorOpen(true);
  }

  async function closeInspector() {
    if (!(await confirmDiscardInspectorChanges())) return;
    setInspectorDirty(false);
    setInspectorOpen(false);
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(".audio-row.selected .audio-row-primary")?.focus();
    });
  }

  async function prepareWorkspaceNavigation() {
    if (view === "settings" && settingsBeforeLeaveRef.current) {
      if (!(await settingsBeforeLeaveRef.current())) return false;
    }
    if (!inspectorDirty) return true;
    if (!(await confirmDiscardInspectorChanges())) return false;
    setInspectorDirty(false);
    setInspectorOpen(false);
    return true;
  }

  const handleSettingsBeforeLeaveChange = useCallback(
    (handler: (() => Promise<boolean>) | null) => {
      settingsBeforeLeaveRef.current = handler;
    },
    []
  );

  async function requestOpenSettings() {
    if (!(await confirmDiscardInspectorChanges())) return;
    setInspectorDirty(false);
    openSettings();
  }

  function closeNavigation(restoreFocus = false) {
    setNavigationOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(".app-navigation-toggle")?.focus();
      });
    }
  }

  return {
    inspectorOpen,
    setInspectorDirty,
    setSettingsDirty,
    compactNavigation,
    navigationOpen,
    setNavigationOpen,
    sidebarCollapsed,
    setSidebarCollapsed,
    onboardingOpen,
    setOnboardingOpen,
    openInspector,
    closeInspector,
    prepareWorkspaceNavigation,
    handleSettingsBeforeLeaveChange,
    requestOpenSettings,
    closeNavigation
  };
}
