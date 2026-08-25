import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { MaterialIcon } from "./ui";
import { useDialog } from "./dialog/UnifiedDialog";
import { useTheme } from "../theme";
import { useLocale } from "../i18n/LocaleProvider";
import { useTranslation } from "react-i18next";
import { usePolling } from "../hooks/usePolling";
import { useIntelligenceSettings } from "../hooks/settings/useIntelligenceSettings";
import { useLibrarySettings } from "../hooks/settings/useLibrarySettings";
import { useLibraryHealthSettings } from "../hooks/settings/useLibraryHealthSettings";
import { useMaintenanceSettings } from "../hooks/settings/useMaintenanceSettings";
import AsrSettingsTab from "./settings/AsrSettingsTab";
import LibrarySettingsTab from "./settings/LibrarySettingsTab";
import HealthSettingsTab from "./settings/HealthSettingsTab";
import LlmSettingsTab from "./settings/LlmSettingsTab";
import LogsSettingsTab from "./settings/LogsSettingsTab";
import MaintenanceSettingsTab from "./settings/MaintenanceSettingsTab";
import SettingsHeader from "./settings/SettingsHeader";
import TasksSettingsTab from "./settings/TasksSettingsTab";
import UpdatesSettingsTab from "./settings/UpdatesSettingsTab";
import { type SettingsTab, type ToastType } from "./settings/types";
import type { MaterialIconName } from "./ui/MaterialIcon";
import {
  DEFAULT_CASE_GLOSSARY
} from "./settings/settingsUtils";

type Props = {
  refresh: () => void;
  notify?: (message: string, type?: ToastType) => void;
  activityCenterEnabled: boolean;
  onActivityCenterEnabledChange: (enabled: boolean) => Promise<void>;
  onBeforeLeaveChange?: (handler: (() => Promise<boolean>) | null) => void;
  onDirtyChange?: (dirty: boolean) => void;
};

export default function SettingsPanel({
  refresh,
  notify,
  activityCenterEnabled,
  onActivityCenterEnabledChange,
  onBeforeLeaveChange,
  onDirtyChange
}: Props) {
  const dialog = useDialog();
  const { themeMode, setThemeMode, resolvedTheme } = useTheme();
  const { languagePreference, setLanguagePreference } = useLocale();
  const { t } = useTranslation();
  const intelligence = useIntelligenceSettings({ notify });
  const library = useLibrarySettings({ refresh, notify });
  const health = useLibraryHealthSettings({ refresh, notify });
  const maintenance = useMaintenanceSettings({ refresh, notify });

  const [activeTab, setActiveTab] = useState<SettingsTab>("library");

  const [logs, setLogs] = useState("");

  const beforeLeaveRef = useRef<() => Promise<boolean>>(async () => true);

  const settingsDirty = intelligence.isDirty;

  async function loadLogs() {
    const result = await api.getLogs(400);
    setLogs(result.content || "");
  }

  async function reloadSettingsData() {
    await Promise.all([
      intelligence.reload(),
      library.reload(),
      health.reload(),
      maintenance.reload()
    ]);
  }


  useEffect(() => {
    loadLogs().catch(console.error);
  }, []);

  usePolling({
    intervalMs: 3000,
    task: async () => {
      await intelligence.refreshWhisperComponent();
    },
    onError: console.error
  });

  async function saveDirtySettings() {
    const failedSection = await intelligence.flushDirty();
    if (failedSection) {
      setActiveTab(failedSection);
      return false;
    }
    return true;
  }

  async function requestBeforeLeave() {
    if (!settingsDirty) return true;

    if (await saveDirtySettings()) return true;
    await dialog.alert({
      title: t("settings.autoSave.leaveBlockedTitle"),
      message: t("settings.autoSave.leaveBlockedMessage"),
      confirmLabel: t("common.actions.close"),
      tone: "warning"
    });
    return false;
  }

  async function requestTabChange(nextTab: SettingsTab) {
    if (nextTab === activeTab || !(await requestBeforeLeave())) return;
    setActiveTab(nextTab);
  }

  beforeLeaveRef.current = requestBeforeLeave;

  useEffect(() => {
    onDirtyChange?.(settingsDirty);
  }, [onDirtyChange, settingsDirty]);

  useEffect(() => {
    return () => onDirtyChange?.(false);
  }, [onDirtyChange]);

  useEffect(() => {
    const handler = () => beforeLeaveRef.current();
    onBeforeLeaveChange?.(handler);
    return () => onBeforeLeaveChange?.(null);
  }, [onBeforeLeaveChange]);

  const settingsGroups: Array<{
    id: string;
    label: string;
    items: Array<{ id: SettingsTab; icon: MaterialIconName }>;
  }> = [
    {
      id: "library",
      label: t("settings.groups.library"),
      items: [
        { id: "library", icon: "library_music" },
        { id: "health", icon: "health_and_safety" },
        { id: "tasks", icon: "task_alt" }
      ]
    },
    {
      id: "intelligence",
      label: t("settings.groups.intelligence"),
      items: [
        { id: "asr", icon: "subtitles" },
        { id: "llm", icon: "auto_awesome" }
      ]
    },
    {
      id: "system",
      label: t("settings.groups.system"),
      items: [
        { id: "updates", icon: "download" },
        { id: "maintenance", icon: "build" },
        { id: "logs", icon: "description" }
      ]
    }
  ];

  return (
    <section className="settings-panel">
      <SettingsHeader
        themeMode={themeMode}
        resolvedTheme={resolvedTheme}
        onThemeModeChange={setThemeMode}
        backendStatus={intelligence.backendStatus}
        languagePreference={languagePreference}
        onLanguagePreferenceChange={setLanguagePreference}
      />

      <div className="settings-body-layout">
        <nav className="settings-section-nav" aria-label={t("settings.navigation")}>
          {settingsGroups.map((group) => (
            <div className="settings-nav-group" key={group.id}>
              <strong>{group.label}</strong>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={activeTab === item.id ? "active" : ""}
                  aria-current={activeTab === item.id ? "page" : undefined}
                  onClick={() => void requestTabChange(item.id)}
                >
                  <MaterialIcon name={item.icon} size={18} />
                  <span>{t(`settings.tabs.${item.id}`)}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div
          className="settings-content"
          role="region"
          aria-label={t(`settings.tabs.${activeTab}`)}
        >
        {activeTab === "library" && (
          <LibrarySettingsTab
            roots={library.roots}
            scanTasks={library.scanTasks}
            path={library.path}
            scanResult={library.scanResult}
            playlists={library.playlists}
            onPathChange={library.setPath}
            onChooseFolder={library.chooseFolder}
            onAddRoot={library.addRoot}
            onToggleRoot={library.toggleRoot}
            onRemoveRoot={library.removeRoot}
            onScan={library.scan}
            onCancelScan={library.cancelScan}
            onRenamePlaylist={library.renamePlaylist}
            onDeletePlaylist={library.deletePlaylist}
          />
        )}

        {activeTab === "health" && (
          <HealthSettingsTab
            summary={health.summary}
            tasks={health.tasks}
            candidates={health.candidates}
            action={health.action}
            onRefresh={() => health.reload().catch((err) => notify?.(String(err), "error"))}
            onStartCheck={health.startCheck}
            onCancelTask={health.cancelTask}
            onRetryTask={health.retryTask}
            onConfirmDuplicates={health.confirmDuplicates}
            onFindCandidates={health.findCandidates}
            onRelink={health.relink}
          />
        )}

        {activeTab === "asr" && (
          <AsrSettingsTab
            asrProvider={intelligence.asr.provider}
            asrModelName={intelligence.asr.modelName}
            asrDevice={intelligence.asr.device}
            asrComputeType={intelligence.asr.computeType}
            asrBeamSize={intelligence.asr.beamSize}
            externalEndpoint={intelligence.asr.externalEndpoint}
            externalModelName={intelligence.asr.externalModelName}
            externalApiKey={intelligence.asr.externalApiKey}
            externalLanguage={intelligence.asr.externalLanguage}
            externalTimestampPolicy={intelligence.asr.externalTimestampPolicy}
            externalTimeout={intelligence.asr.externalTimeout}
            externalAllowRemoteEndpoint={intelligence.asr.externalAllowRemoteEndpoint}
            externalChunkingEnabled={intelligence.asr.externalChunkingEnabled}
            externalChunkSeconds={intelligence.asr.externalChunkSeconds}
            externalChunkOverlapSeconds={intelligence.asr.externalChunkOverlapSeconds}
            externalChunkConcurrency={intelligence.asr.externalChunkConcurrency}
            externalPreferSilence={intelligence.asr.externalPreferSilence}
            externalVadThreshold={intelligence.asr.externalVadThreshold}
            externalMinimumSilenceMs={intelligence.asr.externalMinimumSilenceMs}
            externalFormattingEnabled={intelligence.asr.externalFormattingEnabled}
            externalCaseGlossary={intelligence.asr.externalCaseGlossary}
            externalPreprocessing={intelligence.externalPreprocessing}
            externalWarning={intelligence.asrWarning}
            whisperComponent={intelligence.whisperComponent}
            onAsrProviderChange={(value) => intelligence.setAsrField("provider", value)}
            onAsrModelNameChange={(value) => intelligence.setAsrField("modelName", value)}
            onAsrDeviceChange={(value) => intelligence.setAsrField("device", value)}
            onAsrComputeTypeChange={(value) => intelligence.setAsrField("computeType", value)}
            onAsrBeamSizeChange={(value) => intelligence.setAsrField("beamSize", value)}
            onExternalEndpointChange={(value) => intelligence.setAsrField("externalEndpoint", value)}
            onExternalModelNameChange={(value) => intelligence.setAsrField("externalModelName", value)}
            onExternalApiKeyChange={(value) => intelligence.setAsrField("externalApiKey", value)}
            onExternalLanguageChange={(value) => intelligence.setAsrField("externalLanguage", value)}
            onExternalTimestampPolicyChange={(value) => intelligence.setAsrField("externalTimestampPolicy", value)}
            onExternalTimeoutChange={(value) => intelligence.setAsrField("externalTimeout", value)}
            onExternalAllowRemoteEndpointChange={
              (value) => intelligence.setAsrField("externalAllowRemoteEndpoint", value)
            }
            onExternalChunkingEnabledChange={(value) => intelligence.setAsrField("externalChunkingEnabled", value)}
            onExternalChunkSecondsChange={(value) => intelligence.setAsrField("externalChunkSeconds", value)}
            onExternalChunkOverlapSecondsChange={(value) => intelligence.setAsrField("externalChunkOverlapSeconds", value)}
            onExternalChunkConcurrencyChange={(value) => intelligence.setAsrField("externalChunkConcurrency", value)}
            onExternalPreferSilenceChange={(value) => intelligence.setAsrField("externalPreferSilence", value)}
            onExternalVadThresholdChange={(value) => intelligence.setAsrField("externalVadThreshold", value)}
            onExternalMinimumSilenceMsChange={(value) => intelligence.setAsrField("externalMinimumSilenceMs", value)}
            onExternalFormattingEnabledChange={(value) => intelligence.setAsrField("externalFormattingEnabled", value)}
            onExternalCaseGlossaryChange={(value) => intelligence.setAsrField("externalCaseGlossary", value)}
            onResetExternalCaseGlossary={() =>
              intelligence.setAsrField("externalCaseGlossary", DEFAULT_CASE_GLOSSARY)
            }
            onInstallWhisperComponent={intelligence.installWhisperComponent}
            onCancelWhisperComponentInstall={intelligence.cancelWhisperComponentInstall}
            onRemoveWhisperComponent={intelligence.removeWhisperComponent}
            saveStatus={intelligence.asrAutoSave.status}
            saveError={intelligence.asrAutoSave.error}
            onRetrySave={intelligence.asrAutoSave.retry}
            onFlushSave={() => {
              void intelligence.asrAutoSave.flush();
            }}
          />
        )}

        {activeTab === "llm" && (
          <LlmSettingsTab
            llmEndpoint={intelligence.llm.endpoint}
            llmModel={intelligence.llm.model}
            llmApiKey={intelligence.llm.apiKey}
            llmTimeout={intelligence.llm.timeout}
            llmMaxTokens={intelligence.llm.maxTokens}
            llmTemperature={intelligence.llm.temperature}
            llmAllowRemoteEndpoint={intelligence.llm.allowRemoteEndpoint}
            aiOutputLanguage={intelligence.llm.outputLanguage}
            llmWarning={intelligence.llmWarning}
            llmTestResult={intelligence.llmTestResult}
            onLlmEndpointChange={(value) => intelligence.setLlmField("endpoint", value)}
            onLlmModelChange={(value) => intelligence.setLlmField("model", value)}
            onLlmApiKeyChange={(value) => intelligence.setLlmField("apiKey", value)}
            onLlmTimeoutChange={(value) => intelligence.setLlmField("timeout", value)}
            onLlmMaxTokensChange={(value) => intelligence.setLlmField("maxTokens", value)}
            onLlmTemperatureChange={(value) => intelligence.setLlmField("temperature", value)}
            onLlmAllowRemoteEndpointChange={(value) => intelligence.setLlmField("allowRemoteEndpoint", value)}
            onAiOutputLanguageChange={(value) => intelligence.setLlmField("outputLanguage", value)}
            onDiscoverLlmModels={intelligence.discoverLlmModels}
            saveStatus={intelligence.llmAutoSave.status}
            saveError={intelligence.llmAutoSave.error}
            onRetrySave={intelligence.llmAutoSave.retry}
            onFlushSave={() => {
              void intelligence.llmAutoSave.flush();
            }}
            onTestLlm={intelligence.testLlm}
          />
        )}

        {activeTab === "tasks" && (
          <TasksSettingsTab
            activityCenterEnabled={activityCenterEnabled}
            onActivityCenterEnabledChange={onActivityCenterEnabledChange}
            onTaskChanged={refresh}
            notify={notify}
          />
        )}

        {activeTab === "updates" && <UpdatesSettingsTab />}

        {activeTab === "maintenance" && (
          <MaintenanceSettingsTab
            maintenanceTags={maintenance.tags}
            databaseBackups={maintenance.backups}
            databaseRestoreStatus={maintenance.restoreStatus}
            backupAction={maintenance.action}
            onCreateBackup={maintenance.createBackup}
            onLoadBackups={() => maintenance.loadBackups().catch((err) => notify?.(String(err), "error"))}
            onValidateBackup={maintenance.validateBackup}
            onRestoreBackup={maintenance.restoreBackup}
            onDeleteBackup={maintenance.deleteBackup}
            onCancelRestore={maintenance.cancelRestore}
            onRebuildSearch={maintenance.rebuildSearch}
            onCleanupTags={maintenance.cleanupTags}
            onLoadTags={maintenance.loadTags}
            onRenameTag={maintenance.renameTag}
            onMergeTag={maintenance.mergeTag}
            onDeleteTag={maintenance.deleteTag}
            notify={notify}
          />
        )}

        {activeTab === "logs" && (
          <LogsSettingsTab
            logs={logs}
            onLoadLogs={loadLogs}
            onReloadBackend={() => void reloadSettingsData()}
          />
        )}
        </div>
      </div>
    </section>
  );
}
