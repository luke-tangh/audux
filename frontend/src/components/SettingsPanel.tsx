import { useEffect, useRef, useState } from "react";
import { api, asrEndpointPrivacyWarning, endpointPrivacyWarning } from "../api";
import type {
  DatabaseBackup,
  DatabaseRestoreStatus,
  ExternalAsrPreprocessingStatus,
  LibraryDuplicateGroup,
  LibraryHealthSummary,
  LibraryHealthTask,
  LibraryRoot,
  MissingAudioHealthItem,
  Playlist,
  SafeRelinkCandidate,
  ScanTask,
  Tag,
  WhisperComponentStatus
} from "../types";
import { pickAudioFolder, restartApplication } from "../tauri";
import TaskPanel from "./TaskPanel";
import { PanelCard, Tabs } from "./ui";
import { useDialog } from "./dialog/UnifiedDialog";
import { useTheme } from "../theme";
import { useLocale } from "../i18n/LocaleProvider";
import { useTranslation } from "react-i18next";
import { localizedPrivacyWarning, localizedStoredError } from "../i18n/errors";
import AsrSettingsTab from "./settings/AsrSettingsTab";
import LibrarySettingsTab from "./settings/LibrarySettingsTab";
import HealthSettingsTab from "./settings/HealthSettingsTab";
import LlmSettingsTab from "./settings/LlmSettingsTab";
import LogsSettingsTab from "./settings/LogsSettingsTab";
import MaintenanceSettingsTab from "./settings/MaintenanceSettingsTab";
import SettingsHeader from "./settings/SettingsHeader";
import { SETTINGS_TABS, type SettingsTab, type ToastType } from "./settings/types";
import { terminalStatus } from "./settings/settingsUtils";

type Props = {
  refresh: () => void;
  notify?: (message: string, type?: ToastType) => void;
};

export default function SettingsPanel({ refresh, notify }: Props) {
  const dialog = useDialog();
  const { themeMode, setThemeMode, resolvedTheme } = useTheme();
  const { languagePreference, setLanguagePreference } = useLocale();
  const { t } = useTranslation();

  const [activeTab, setActiveTab] = useState<SettingsTab>("library");

  const [roots, setRoots] = useState<LibraryRoot[]>([]);
  const [scanTasks, setScanTasks] = useState<ScanTask[]>([]);
  const [path, setPath] = useState("");
  const [scanResult, setScanResult] = useState("");
  const [playlistName, setPlaylistName] = useState("");
  const [settingsPlaylists, setSettingsPlaylists] = useState<Playlist[]>([]);
  const [maintenanceTags, setMaintenanceTags] = useState<Tag[]>([]);
  const [databaseBackups, setDatabaseBackups] = useState<DatabaseBackup[]>([]);
  const [databaseRestoreStatus, setDatabaseRestoreStatus] =
    useState<DatabaseRestoreStatus | null>(null);
  const [backupAction, setBackupAction] = useState<string | null>(null);
  const [libraryHealth, setLibraryHealth] = useState<LibraryHealthSummary | null>(null);
  const [healthTasks, setHealthTasks] = useState<LibraryHealthTask[]>([]);
  const [healthCandidates, setHealthCandidates] = useState<Record<number, SafeRelinkCandidate[]>>({});
  const [healthAction, setHealthAction] = useState<string | null>(null);

  const [asrProvider, setAsrProvider] = useState("faster_whisper");
  const [asrModelName, setAsrModelName] = useState("small");
  const [asrDevice, setAsrDevice] = useState("cpu");
  const [asrComputeType, setAsrComputeType] = useState("int8");
  const [asrBeamSize, setAsrBeamSize] = useState("5");
  const [asrExternalEndpoint, setAsrExternalEndpoint] = useState("");
  const [asrExternalModelName, setAsrExternalModelName] = useState("");
  const [asrExternalApiKey, setAsrExternalApiKey] = useState("");
  const [asrExternalLanguage, setAsrExternalLanguage] = useState("auto");
  const [asrExternalTimestampPolicy, setAsrExternalTimestampPolicy] =
    useState("preferred");
  const [asrExternalTimeout, setAsrExternalTimeout] = useState("3600");
  const [asrExternalAllowRemoteEndpoint, setAsrExternalAllowRemoteEndpoint] =
    useState(false);
  const [asrExternalChunkingEnabled, setAsrExternalChunkingEnabled] =
    useState(false);
  const [asrExternalChunkSeconds, setAsrExternalChunkSeconds] = useState("28");
  const [asrExternalChunkOverlapSeconds, setAsrExternalChunkOverlapSeconds] =
    useState("1");
  const [asrExternalPreferSilence, setAsrExternalPreferSilence] = useState(true);
  const [asrExternalVadThreshold, setAsrExternalVadThreshold] = useState("0.5");
  const [asrExternalMinimumSilenceMs, setAsrExternalMinimumSilenceMs] =
    useState("400");
  const [externalAsrPreprocessing, setExternalAsrPreprocessing] =
    useState<ExternalAsrPreprocessingStatus | null>(null);
  const [whisperComponent, setWhisperComponent] =
    useState<WhisperComponentStatus | null>(null);

  const [llmEndpoint, setLlmEndpoint] = useState("");
  const [llmModel, setLlmModel] = useState("");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [llmTimeout, setLlmTimeout] = useState("60");
  const [llmMaxTokens, setLlmMaxTokens] = useState("800");
  const [llmTemperature, setLlmTemperature] = useState("0.2");
  const [llmAllowRemoteEndpoint, setLlmAllowRemoteEndpoint] = useState(false);
  const [aiOutputLanguage, setAiOutputLanguage] = useState("auto");

  const [llmTestResult, setLlmTestResult] = useState("");
  const [backendStatus, setBackendStatus] = useState("checking");
  const [logs, setLogs] = useState("");

  const scanStatusRef = useRef<Record<number, string>>({});
  const scanInitializedRef = useRef(false);

  function applyScanTasks(rows: ScanTask[], allowNotify = true) {
    let shouldRefresh = false;

    if (allowNotify && scanInitializedRef.current) {
      for (const task of rows) {
        const previous = scanStatusRef.current[task.id];

        if (previous && previous !== task.status && terminalStatus(task.status)) {
          if (task.status === "done") {
            notify?.(
              t("settings.notifications.scanDone", { id: task.id, imported: task.imported, updated: task.updated, missing: task.missing }),
              "success"
            );
          }

          if (task.status === "failed") {
            notify?.(t("settings.notifications.scanFailed", {
              id: task.id,
              error: localizedStoredError(t, task.error_code, task.error_params, task.error_message)
            }), "error");
          }

          if (task.status === "canceled") {
            notify?.(t("settings.notifications.scanCanceled", { id: task.id }), "info");
          }

          shouldRefresh = true;
        }
      }
    }

    const nextStatus: Record<number, string> = {};
    for (const task of rows) {
      nextStatus[task.id] = task.status;
    }

    scanStatusRef.current = nextStatus;
    scanInitializedRef.current = true;
    setScanTasks(rows);

    if (shouldRefresh) {
      refresh();
    }
  }

  async function loadScanTasks() {
    const rows = await api.listScanTasks({ limit: 20 });
    applyScanTasks(rows, true);
  }

  async function loadLibraryHealth() {
    const [summary, taskRows] = await Promise.all([
      api.getLibraryHealth(),
      api.listLibraryHealthTasks(20)
    ]);
    setLibraryHealth(summary);
    setHealthTasks(taskRows);
  }

  async function loadLogs() {
    const result = await api.getLogs(400);
    setLogs(result.content || "");
  }

  async function loadTags() {
    const tagRows = await api.listTags().catch(() => []);
    setMaintenanceTags(tagRows);
  }

  async function loadBackups() {
    setBackupAction("load");
    try {
      const [backups, restoreStatus] = await Promise.all([
        api.listDatabaseBackups(),
        api.getDatabaseRestoreStatus()
      ]);
      setDatabaseBackups(backups);
      setDatabaseRestoreStatus(restoreStatus);
    } finally {
      setBackupAction(null);
    }
  }

  async function loadWhisperComponentStatus() {
    const status = await api.getWhisperComponentStatus();
    setWhisperComponent(status);
  }

  async function load() {
    try {
      await api.health();
      setBackendStatus("ok");

      const [
        rootRows,
        settings,
        scanRows,
        tagRows,
        playlistRows,
        componentStatus,
        preprocessingStatus
      ] = await Promise.all([
        api.listLibraryRoots(),
        api.listSettings(),
        api.listScanTasks({ limit: 20 }),
        api.listTags().catch(() => []),
        api.listPlaylists().catch(() => []),
        api.getWhisperComponentStatus(),
        api.getExternalAsrPreprocessingStatus()
      ]);

      setRoots(rootRows);
      applyScanTasks(scanRows, false);
      setMaintenanceTags(tagRows);
      setSettingsPlaylists(playlistRows);
      setWhisperComponent(componentStatus);
      setExternalAsrPreprocessing(preprocessingStatus);

      const [backups, restoreStatus] = await Promise.all([
        api.listDatabaseBackups().catch(() => []),
        api.getDatabaseRestoreStatus().catch(() => null)
      ]);
      setDatabaseBackups(backups);
      setDatabaseRestoreStatus(restoreStatus);

      setAsrProvider(
        settings.find((setting) => setting.key === "asr.provider")?.value ||
          "faster_whisper"
      );
      setAsrModelName(settings.find((setting) => setting.key === "asr.model_name")?.value || "small");
      setAsrDevice(settings.find((setting) => setting.key === "asr.device")?.value || "cpu");
      setAsrComputeType(settings.find((setting) => setting.key === "asr.compute_type")?.value || "int8");
      setAsrBeamSize(settings.find((setting) => setting.key === "asr.beam_size")?.value || "5");
      setAsrExternalEndpoint(
        settings.find((setting) => setting.key === "asr.external.endpoint")?.value || ""
      );
      setAsrExternalModelName(
        settings.find((setting) => setting.key === "asr.external.model_name")?.value || ""
      );
      setAsrExternalApiKey(
        settings.find((setting) => setting.key === "asr.external.api_key")?.value || ""
      );
      setAsrExternalLanguage(
        settings.find((setting) => setting.key === "asr.external.language")?.value ||
          "auto"
      );
      setAsrExternalTimestampPolicy(
        settings.find((setting) => setting.key === "asr.external.timestamp_policy")
          ?.value || "preferred"
      );
      setAsrExternalTimeout(
        settings.find((setting) => setting.key === "asr.external.timeout")?.value ||
          "3600"
      );
      setAsrExternalAllowRemoteEndpoint(
        ["1", "true", "yes", "on"].includes(
          (
            settings.find(
              (setting) => setting.key === "asr.external.allow_remote_endpoint"
            )?.value || ""
          ).toLowerCase()
        )
      );
      setAsrExternalChunkingEnabled(
        ["1", "true", "yes", "on"].includes(
          (
            settings.find(
              (setting) => setting.key === "asr.external.chunking_enabled"
            )?.value || ""
          ).toLowerCase()
        )
      );
      setAsrExternalChunkSeconds(
        settings.find((setting) => setting.key === "asr.external.chunk_seconds")
          ?.value || "28"
      );
      setAsrExternalChunkOverlapSeconds(
        settings.find(
          (setting) => setting.key === "asr.external.chunk_overlap_seconds"
        )?.value || "1"
      );
      setAsrExternalPreferSilence(
        !["0", "false", "no", "off"].includes(
          (
            settings.find(
              (setting) => setting.key === "asr.external.prefer_silence"
            )?.value || "true"
          ).toLowerCase()
        )
      );
      setAsrExternalVadThreshold(
        settings.find(
          (setting) => setting.key === "asr.external.vad_threshold"
        )?.value || "0.5"
      );
      setAsrExternalMinimumSilenceMs(
        settings.find(
          (setting) => setting.key === "asr.external.minimum_silence_ms"
        )?.value || "400"
      );

      setLlmEndpoint(settings.find((setting) => setting.key === "llm.endpoint")?.value || "");
      setLlmModel(settings.find((setting) => setting.key === "llm.model_name")?.value || "");
      setLlmApiKey(settings.find((setting) => setting.key === "llm.api_key")?.value || "");
      setLlmTimeout(settings.find((setting) => setting.key === "llm.timeout")?.value || "60");
      setLlmMaxTokens(settings.find((setting) => setting.key === "llm.max_tokens")?.value || "800");
      setLlmTemperature(settings.find((setting) => setting.key === "llm.temperature")?.value || "0.2");
      setAiOutputLanguage(
        settings.find((setting) => setting.key === "ai.output_language")?.value || "auto"
      );
      setLlmAllowRemoteEndpoint(
        ["1", "true", "yes", "on"].includes(
          (
            settings.find((setting) => setting.key === "llm.allow_remote_endpoint")?.value || ""
          ).toLowerCase()
        )
      );
    } catch (err) {
      console.error(err);
      setBackendStatus("failed");
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  useEffect(() => {
    load().catch(console.error);
    loadLogs().catch(console.error);
    loadLibraryHealth().catch(console.error);

    const timer = setInterval(() => {
      loadScanTasks().catch(console.error);
      loadWhisperComponentStatus().catch(console.error);
      loadLibraryHealth().catch(console.error);
    }, 3000);

    return () => clearInterval(timer);
  }, []);

  async function chooseFolder() {
    const selected = await pickAudioFolder();

    if (selected) {
      setPath(selected);
    } else {
      notify?.(t("settings.notifications.noFolder"), "error");
    }
  }

  async function addRoot() {
    if (!path.trim()) return;

    try {
      await api.createLibraryRoot(path.trim());
      setPath("");

      await load();
      refresh();
      notify?.(t("settings.notifications.rootAdded"), "success");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function toggleRoot(root: LibraryRoot, isEnabled: boolean) {
    try {
      await api.updateLibraryRoot(root.id, {
        is_enabled: isEnabled
      });

      await load();
      refresh();
      notify?.(isEnabled ? t("settings.notifications.rootEnabled") : t("settings.notifications.rootDisabled"), "success");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function removeRoot(root: LibraryRoot) {
    const ok = await dialog.confirm({
      title: t("settings.removeRoot.title"),
      message: t("settings.removeRoot.message", { path: root.path }),
      confirmLabel: t("settings.removeRoot.confirm"),
      cancelLabel: t("common.actions.cancel"),
      tone: "danger",
      destructive: true
    });

    if (!ok) return;

    try {
      const result = await api.deleteLibraryRoot(root.id);
      await load();
      refresh();
      notify?.(
        t("settings.notifications.rootRemoved", { count: result.detached_audio_items }),
        "success"
      );
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function scan(id: number) {
    try {
      setScanResult(t("settings.scan.creating"));
      const task = await api.scanLibraryRoot(id);
      setScanResult(t("settings.scan.created", { id: task.id }));
      notify?.(t("settings.scan.created", { id: task.id }), "success");
      await loadScanTasks();
      refresh();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function cancelScan(task: ScanTask) {
    const ok = await dialog.confirm({
      title: t("settings.scan.cancelTitle"),
      message: t("settings.scan.cancelMessage", { id: task.id }),
      confirmLabel: t("settings.scan.cancelConfirm"),
      cancelLabel: t("settings.scan.keep"),
      tone: "warning"
    });

    if (!ok) return;

    try {
      await api.cancelScanTask(task.id);
      notify?.(t("settings.scan.cancelRequested", { id: task.id }), "info");
      await loadScanTasks();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function createPlaylist() {
    if (!playlistName.trim()) return;

    try {
      await api.createPlaylist(playlistName.trim());
      setPlaylistName("");

      refresh();
      await load();

      notify?.(t("settings.playlist.created"), "success");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function renamePlaylist(playlist: Playlist) {
    const name = await dialog.prompt({
      title: t("settings.playlist.renameTitle"),
      message: t("settings.playlist.renameMessage", { name: playlist.name }),
      inputLabel: t("settings.library.playlistName"),
      defaultValue: playlist.name,
      required: true,
      confirmLabel: t("common.actions.save"),
      cancelLabel: t("common.actions.cancel"),
      validate: (value) => {
        const trimmed = value.trim();
        if (!trimmed) return t("settings.playlist.nameRequired");
        if (trimmed === playlist.name) return t("settings.playlist.nameDifferent");
        return null;
      }
    });

    if (name === null) return;

    try {
      await api.updatePlaylist(playlist.id, name.trim());
      await load();
      refresh();
      notify?.(t("settings.playlist.renamed"), "success");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function deletePlaylist(playlist: Playlist) {
    const ok = await dialog.confirm({
      title: t("settings.playlist.deleteTitle"),
      message: t("settings.playlist.deleteMessage", { name: playlist.name }),
      confirmLabel: t("settings.playlist.deleteConfirm"),
      cancelLabel: t("common.actions.cancel"),
      tone: "danger",
      destructive: true
    });

    if (!ok) return;

    try {
      const result = await api.deletePlaylist(playlist.id);
      await load();
      refresh();
      notify?.(t("settings.playlist.deleted", { count: result.removed_items }), "success");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function saveAsr() {
    if (asrProvider === "faster_whisper" && !whisperComponent?.available) {
      notify?.(t("settings.asr.installRequired"), "error");
      return;
    }

    const warning = asrEndpointPrivacyWarning(asrExternalEndpoint);
    if (
      asrProvider === "external" &&
      warning &&
      !asrExternalAllowRemoteEndpoint
    ) {
      notify?.(t("settings.asr.allowRemoteRequired"), "error");
      return;
    }

    const chunkSeconds = Number(asrExternalChunkSeconds);
    const overlapSeconds = Number(asrExternalChunkOverlapSeconds);
    const vadThreshold = Number(asrExternalVadThreshold);
    const minimumSilenceMs = Number(asrExternalMinimumSilenceMs);
    if (
      asrProvider === "external" &&
      asrExternalChunkingEnabled &&
      (!Number.isFinite(chunkSeconds) ||
        chunkSeconds < 5 ||
        chunkSeconds > 600 ||
        !Number.isFinite(overlapSeconds) ||
        overlapSeconds < 0 ||
        overlapSeconds > 10 ||
        overlapSeconds >= chunkSeconds / 2 ||
        !Number.isFinite(vadThreshold) ||
        vadThreshold < 0.1 ||
        vadThreshold > 0.9 ||
        !Number.isInteger(minimumSilenceMs) ||
        minimumSilenceMs < 100 ||
        minimumSilenceMs > 5000)
    ) {
      notify?.(t("settings.asr.chunkingInvalid"), "error");
      return;
    }

    if (
      asrProvider === "external" &&
      asrExternalChunkingEnabled &&
      !externalAsrPreprocessing?.available
    ) {
      notify?.(t("settings.asr.ffmpegInstallRequired"), "error");
      return;
    }

    try {
      await api.setSetting("asr.provider", asrProvider);
      await api.setSetting("asr.model_name", asrModelName.trim() || "small");
      await api.setSetting("asr.device", asrDevice.trim() || "cpu");
      await api.setSetting("asr.compute_type", asrComputeType.trim() || "int8");
      await api.setSetting("asr.beam_size", asrBeamSize.trim() || "5");
      await api.setSetting("asr.external.endpoint", asrExternalEndpoint.trim());
      await api.setSetting(
        "asr.external.model_name",
        asrExternalModelName.trim()
      );
      await api.setSetting("asr.external.api_key", asrExternalApiKey);
      await api.setSetting(
        "asr.external.language",
        asrExternalLanguage.trim() || "auto"
      );
      await api.setSetting(
        "asr.external.timestamp_policy",
        asrExternalTimestampPolicy
      );
      await api.setSetting(
        "asr.external.timeout",
        asrExternalTimeout.trim() || "3600"
      );
      await api.setSetting(
        "asr.external.allow_remote_endpoint",
        asrExternalAllowRemoteEndpoint ? "true" : "false"
      );
      await api.setSetting(
        "asr.external.chunking_enabled",
        asrExternalChunkingEnabled ? "true" : "false"
      );
      await api.setSetting(
        "asr.external.chunk_seconds",
        asrExternalChunkSeconds.trim() || "28"
      );
      await api.setSetting(
        "asr.external.chunk_overlap_seconds",
        asrExternalChunkOverlapSeconds.trim() || "1"
      );
      await api.setSetting(
        "asr.external.prefer_silence",
        asrExternalPreferSilence ? "true" : "false"
      );
      await api.setSetting(
        "asr.external.vad_threshold",
        asrExternalVadThreshold.trim() || "0.5"
      );
      await api.setSetting(
        "asr.external.minimum_silence_ms",
        asrExternalMinimumSilenceMs.trim() || "400"
      );

      notify?.(t("settings.asr.saved"), "success");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function installWhisperComponent() {
    try {
      const status = await api.installWhisperComponent();
      setWhisperComponent(status);
      notify?.(t("settings.asr.downloadStarted"), "info");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function cancelWhisperComponentInstall() {
    try {
      const status = await api.cancelWhisperComponentInstall();
      setWhisperComponent(status);
      notify?.(t("settings.asr.cancelRequested"), "info");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function removeWhisperComponent() {
    const ok = await dialog.confirm({
      title: t("settings.asr.removeTitle"),
      message: t("settings.asr.removeMessage"),
      confirmLabel: t("settings.asr.removeComponent"),
      cancelLabel: t("common.actions.cancel"),
      tone: "danger",
      destructive: true
    });

    if (!ok) return;

    try {
      const status = await api.removeWhisperComponent();
      setWhisperComponent(status);
      notify?.(t("settings.asr.removed"), "success");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function saveLlm() {
    const warning = endpointPrivacyWarning(llmEndpoint);
    if (warning && !llmAllowRemoteEndpoint) {
      notify?.(t("settings.llm.allowRemoteRequired"), "error");
      return;
    }

    try {
      await api.setSetting("llm.endpoint", llmEndpoint.trim());
      await api.setSetting("llm.model_name", llmModel.trim());
      await api.setSetting("llm.api_key", llmApiKey);
      await api.setSetting("llm.timeout", llmTimeout.trim() || "60");
      await api.setSetting("llm.max_tokens", llmMaxTokens.trim() || "800");
      await api.setSetting("llm.temperature", llmTemperature.trim() || "0.2");
      await api.setSetting("ai.output_language", aiOutputLanguage);
      await api.setSetting(
        "llm.allow_remote_endpoint",
        llmAllowRemoteEndpoint ? "true" : "false"
      );

      notify?.(t("settings.llm.saved"), "success");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function testLlm() {
    const warning = endpointPrivacyWarning(llmEndpoint);
    if (warning && !llmAllowRemoteEndpoint) {
      const ok = await dialog.confirm({
        title: t("settings.llm.testRemoteTitle"),
        message: t("settings.llm.testRemoteMessage", { warning }),
        confirmLabel: t("settings.llm.testContinue"),
        cancelLabel: t("common.actions.cancel"),
        tone: "privacy"
      });

      if (!ok) return;
    }

    setLlmTestResult(t("settings.llm.testing"));

    try {
      const result = await api.testLlm({
        endpoint: llmEndpoint.trim(),
        model_name: llmModel.trim(),
        api_key: llmApiKey || undefined,
        timeout: Number(llmTimeout || "60"),
        max_tokens: Number(llmMaxTokens || "64"),
        temperature: Number(llmTemperature || "0")
      });

      if (result.privacy_warning) {
        notify?.(
          localizedPrivacyWarning(t, result.privacy_warning_code, result.privacy_warning),
          "error"
        );
      }

      setLlmTestResult(t("settings.llm.testSuccessResult", { content: result.content }));
      notify?.(t("settings.llm.testSuccess"), "success");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLlmTestResult(t("settings.llm.testFailedResult", { error: message }));
      notify?.(t("settings.llm.testFailed", { error: message }), "error");
    }
  }

  async function rebuildSearch() {
    const ok = await dialog.confirm({
      title: t("settings.search.rebuildTitle"),
      message: t("settings.search.rebuildMessage"),
      confirmLabel: t("settings.search.rebuildConfirm"),
      cancelLabel: t("common.actions.cancel"),
      tone: "warning"
    });

    if (!ok) return;

    try {
      const result = await api.rebuildSearchIndex();
      notify?.(t("settings.search.rebuilt", { count: result.count }), "success");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function renameTag(tag: Tag) {
    const name = await dialog.prompt({
      title: t("settings.tags.renameTitle"),
      message: t("settings.tags.renameMessage", { name: tag.name }),
      inputLabel: t("settings.tags.name"),
      defaultValue: tag.name,
      placeholder: t("settings.tags.newName"),
      required: true,
      confirmLabel: t("common.actions.save"),
      cancelLabel: t("common.actions.cancel"),
      validate: (value) => {
        const trimmed = value.trim();

        if (!trimmed) return t("settings.tags.nameRequired");
        if (trimmed === tag.name) return t("settings.tags.nameDifferent");

        return null;
      }
    });

    if (name === null) return;

    try {
      await api.updateTag(tag.id, { name: name.trim() });
      await loadTags();
      refresh();
      notify?.(t("settings.tags.renamed"), "success");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function deleteTag(tag: Tag) {
    const ok = await dialog.confirm({
      title: t("settings.tags.deleteTitle"),
      message: t("settings.tags.deleteMessage", { name: tag.name }),
      confirmLabel: t("settings.tags.deleteConfirm"),
      cancelLabel: t("common.actions.cancel"),
      tone: "danger",
      destructive: true
    });

    if (!ok) return;

    try {
      await api.deleteTag(tag.id, false);
      await loadTags();
      refresh();
      notify?.(t("settings.tags.deleted"), "success");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function mergeTag(tag: Tag) {
    const targetName = await dialog.prompt({
      title: t("settings.tags.mergeTitle"),
      message: t("settings.tags.mergeMessage", { name: tag.name }),
      inputLabel: t("settings.tags.targetName"),
      placeholder: t("settings.tags.targetPlaceholder"),
      required: true,
      confirmLabel: t("settings.maintenance.merge"),
      cancelLabel: t("common.actions.cancel"),
      tone: "warning",
      validate: (value) => {
        const normalized = value.trim();
        if (normalized === tag.name) return t("settings.tags.same");
        if (!maintenanceTags.some((candidate) => candidate.name === normalized)) {
          return t("settings.tags.targetMissing");
        }
        return null;
      }
    });

    if (targetName === null) return;
    const target = maintenanceTags.find(
      (candidate) => candidate.name === targetName.trim()
    );
    if (!target) return;

    try {
      const result = await api.mergeTag(tag.id, target.id);
      await loadTags();
      refresh();
      notify?.(
        t("settings.tags.merged", { source: tag.name, target: result.target_tag.name, count: result.affected_audio_items }),
        "success"
      );
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function cleanupTags() {
    const ok = await dialog.confirm({
      title: t("settings.tags.cleanupTitle"),
      message: t("settings.tags.cleanupMessage"),
      confirmLabel: t("settings.tags.cleanupConfirm"),
      cancelLabel: t("common.actions.cancel"),
      tone: "warning"
    });

    if (!ok) return;

    try {
      const result = await api.cleanupTags();
      await loadTags();
      refresh();
      notify?.(t("settings.tags.cleaned", { count: result.deleted }), "success");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function createDatabaseBackup() {
    const name = await dialog.prompt({
      title: t("settings.backup.createTitle"),
      message: t("settings.backup.createMessage"),
      inputLabel: t("settings.backup.name"),
      placeholder: t("settings.backup.namePlaceholder"),
      required: false,
      confirmLabel: t("settings.backup.create"),
      cancelLabel: t("common.actions.cancel"),
      validate: (value) => value.trim().length > 80 ? t("settings.backup.nameTooLong") : null
    });
    if (name === null) return;

    setBackupAction("create");
    try {
      await api.createDatabaseBackup(name.trim() || undefined);
      await loadBackups();
      notify?.(t("settings.backup.created"), "success");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBackupAction(null);
    }
  }

  async function validateDatabaseBackup(backup: DatabaseBackup) {
    setBackupAction(`validate:${backup.id}`);
    try {
      const result = await api.validateDatabaseBackup(backup.id);
      await loadBackups();
      notify?.(
        result.integrity_status === "valid"
          ? t("settings.backup.valid")
          : t("settings.backup.invalid", { error: result.integrity_error || "" }),
        result.integrity_status === "valid" ? "success" : "error"
      );
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBackupAction(null);
    }
  }

  async function deleteDatabaseBackup(backup: DatabaseBackup) {
    const ok = await dialog.confirm({
      title: t("settings.backup.deleteTitle"),
      message: t("settings.backup.deleteMessage", { name: backup.name }),
      confirmLabel: t("settings.backup.deleteConfirm"),
      cancelLabel: t("common.actions.cancel"),
      tone: "danger",
      destructive: true
    });
    if (!ok) return;

    setBackupAction(`delete:${backup.id}`);
    try {
      await api.deleteDatabaseBackup(backup.id);
      await loadBackups();
      notify?.(t("settings.backup.deleted"), "success");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBackupAction(null);
    }
  }

  async function restoreDatabaseBackup(backup: DatabaseBackup) {
    setBackupAction(`preflight:${backup.id}`);
    try {
      const preflight = await api.preflightDatabaseRestore(backup.id);
      if (!preflight.ok) {
        const reasons = preflight.blockers.map((blocker) => {
          if (blocker.code === "backup.integrity_invalid") {
            return t("settings.backup.blocker.integrity");
          }
          if (blocker.code === "backup.incompatible") {
            return t("settings.backup.blocker.incompatible");
          }
          if (blocker.code === "backup.active_tasks") {
            return t("settings.backup.blocker.activeTasks", {
              aiTasks: preflight.active_ai_tasks,
              scanTasks: preflight.active_scan_tasks,
              healthTasks: preflight.active_health_tasks
            });
          }
          if (blocker.code === "backup.insufficient_space") {
            return t("settings.backup.blocker.space");
          }
          if (blocker.code === "backup.restore_pending") {
            return t("settings.backup.blocker.pending");
          }
          return blocker.message;
        }).join("\n");
        await dialog.alert({
          title: t("settings.backup.preflightFailedTitle"),
          message: t("settings.backup.preflightFailedMessage", { reasons }),
          confirmLabel: t("common.dialog.acknowledge"),
          tone: "warning"
        });
        return;
      }

      const ok = await dialog.confirm({
        title: t("settings.backup.restoreTitle"),
        message: t("settings.backup.restoreMessage", {
          name: backup.name,
          aiTasks: preflight.active_ai_tasks,
          scanTasks: preflight.active_scan_tasks,
          healthTasks: preflight.active_health_tasks
        }),
        details: t("settings.backup.restoreDetails"),
        confirmLabel: t("settings.backup.restoreConfirm"),
        cancelLabel: t("common.actions.cancel"),
        tone: "danger",
        destructive: true
      });
      if (!ok) return;

      await api.scheduleDatabaseRestore(backup.id);
      await loadBackups();
      const restarted = await restartApplication();
      if (!restarted) {
        await dialog.alert({
          title: t("settings.backup.restartTitle"),
          message: t("settings.backup.restartManual"),
          confirmLabel: t("common.dialog.acknowledge"),
          tone: "warning"
        });
      }
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBackupAction(null);
    }
  }

  async function cancelPendingDatabaseRestore() {
    setBackupAction("cancel-restore");
    try {
      await api.cancelPendingDatabaseRestore();
      await loadBackups();
      notify?.(t("settings.backup.pendingCanceled"), "success");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBackupAction(null);
    }
  }

  async function startLibraryHealthCheck() {
    setHealthAction("check");
    try {
      await api.startLibraryHealthCheck();
      await loadLibraryHealth();
      notify?.(t("settings.health.checkStarted"), "success");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setHealthAction(null);
    }
  }

  async function cancelLibraryHealthTask(task: LibraryHealthTask) {
    setHealthAction(`cancel-${task.id}`);
    try {
      await api.cancelLibraryHealthTask(task.id);
      await loadLibraryHealth();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setHealthAction(null);
    }
  }

  async function retryLibraryHealthTask(task: LibraryHealthTask) {
    setHealthAction(`retry-${task.id}`);
    try {
      await api.retryLibraryHealthTask(task.id);
      await loadLibraryHealth();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setHealthAction(null);
    }
  }

  async function confirmDuplicateHashes(group: LibraryDuplicateGroup) {
    setHealthAction(`hash-${group.candidate_key || group.hash_prefix || "group"}`);
    try {
      await api.confirmDuplicateHashes(group.audio_items.map((item) => item.id));
      await loadLibraryHealth();
      notify?.(t("settings.health.hashStarted"), "success");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setHealthAction(null);
    }
  }

  async function findRelinkCandidates(audio: MissingAudioHealthItem) {
    setHealthAction(`candidates-${audio.id}`);
    try {
      const result = await api.findRelinkCandidates(audio.id);
      setHealthCandidates((current) => ({
        ...current,
        [audio.id]: result.candidates
      }));
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setHealthAction(null);
    }
  }

  async function safeRelink(
    audio: MissingAudioHealthItem,
    candidate: SafeRelinkCandidate
  ) {
    setHealthAction(`preview-${audio.id}`);
    try {
      const preview = await api.previewSafeRelink(audio.id, candidate.path);
      const confirmed = await dialog.confirm({
        title: t("settings.health.relinkTitle"),
        message: t("settings.health.relinkMessage", {
          title: preview.audio.title,
          oldPath: preview.audio.old_path,
          newPath: preview.candidate.path,
          segments: preview.impacts.transcript_segments,
          tags: preview.impacts.tags_preserved,
          playlists: preview.impacts.manual_playlists_preserved,
          plays: preview.impacts.play_count_preserved
        }),
        confirmLabel: t("settings.health.relinkConfirm"),
        cancelLabel: t("common.actions.cancel"),
        tone: "warning"
      });
      if (!confirmed) return;
      await api.commitSafeRelink(audio.id, candidate.path, preview.confirmation);
      setHealthCandidates((current) => {
        const next = { ...current };
        delete next[audio.id];
        return next;
      });
      await loadLibraryHealth();
      refresh();
      notify?.(t("settings.health.relinked"), "success");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setHealthAction(null);
    }
  }

  const llmWarning = endpointPrivacyWarning(llmEndpoint);
  const asrExternalWarning = asrEndpointPrivacyWarning(asrExternalEndpoint);

  return (
    <section className="settings-panel">
      <SettingsHeader
        themeMode={themeMode}
        resolvedTheme={resolvedTheme}
        onThemeModeChange={setThemeMode}
        backendStatus={backendStatus}
        languagePreference={languagePreference}
        onLanguagePreferenceChange={setLanguagePreference}
      />

      <Tabs
        className="settings-tabs"
        items={SETTINGS_TABS.map((id) => ({ id, label: t(`settings.tabs.${id}`) }))}
        activeId={activeTab}
        onChange={setActiveTab}
        ariaLabel={t("settings.header.title")}
        idPrefix="settings"
      />

      <div
        className="settings-content"
        role="tabpanel"
        id={`settings-panel-${activeTab}`}
        aria-labelledby={`settings-tab-${activeTab}`}
      >
        {activeTab === "library" && (
          <LibrarySettingsTab
            roots={roots}
            scanTasks={scanTasks}
            path={path}
            scanResult={scanResult}
            playlistName={playlistName}
            playlists={settingsPlaylists}
            onPathChange={setPath}
            onChooseFolder={chooseFolder}
            onAddRoot={addRoot}
            onToggleRoot={toggleRoot}
            onRemoveRoot={removeRoot}
            onScan={scan}
            onCancelScan={cancelScan}
            onPlaylistNameChange={setPlaylistName}
            onCreatePlaylist={createPlaylist}
            onRenamePlaylist={renamePlaylist}
            onDeletePlaylist={deletePlaylist}
          />
        )}

        {activeTab === "health" && (
          <HealthSettingsTab
            summary={libraryHealth}
            tasks={healthTasks}
            candidates={healthCandidates}
            action={healthAction}
            onRefresh={() => loadLibraryHealth().catch((err) => notify?.(String(err), "error"))}
            onStartCheck={startLibraryHealthCheck}
            onCancelTask={cancelLibraryHealthTask}
            onRetryTask={retryLibraryHealthTask}
            onConfirmDuplicates={confirmDuplicateHashes}
            onFindCandidates={findRelinkCandidates}
            onRelink={safeRelink}
          />
        )}

        {activeTab === "asr" && (
          <AsrSettingsTab
            asrProvider={asrProvider}
            asrModelName={asrModelName}
            asrDevice={asrDevice}
            asrComputeType={asrComputeType}
            asrBeamSize={asrBeamSize}
            externalEndpoint={asrExternalEndpoint}
            externalModelName={asrExternalModelName}
            externalApiKey={asrExternalApiKey}
            externalLanguage={asrExternalLanguage}
            externalTimestampPolicy={asrExternalTimestampPolicy}
            externalTimeout={asrExternalTimeout}
            externalAllowRemoteEndpoint={asrExternalAllowRemoteEndpoint}
            externalChunkingEnabled={asrExternalChunkingEnabled}
            externalChunkSeconds={asrExternalChunkSeconds}
            externalChunkOverlapSeconds={asrExternalChunkOverlapSeconds}
            externalPreferSilence={asrExternalPreferSilence}
            externalVadThreshold={asrExternalVadThreshold}
            externalMinimumSilenceMs={asrExternalMinimumSilenceMs}
            externalPreprocessing={externalAsrPreprocessing}
            externalWarning={asrExternalWarning}
            whisperComponent={whisperComponent}
            onAsrProviderChange={setAsrProvider}
            onAsrModelNameChange={setAsrModelName}
            onAsrDeviceChange={setAsrDevice}
            onAsrComputeTypeChange={setAsrComputeType}
            onAsrBeamSizeChange={setAsrBeamSize}
            onExternalEndpointChange={setAsrExternalEndpoint}
            onExternalModelNameChange={setAsrExternalModelName}
            onExternalApiKeyChange={setAsrExternalApiKey}
            onExternalLanguageChange={setAsrExternalLanguage}
            onExternalTimestampPolicyChange={setAsrExternalTimestampPolicy}
            onExternalTimeoutChange={setAsrExternalTimeout}
            onExternalAllowRemoteEndpointChange={
              setAsrExternalAllowRemoteEndpoint
            }
            onExternalChunkingEnabledChange={setAsrExternalChunkingEnabled}
            onExternalChunkSecondsChange={setAsrExternalChunkSeconds}
            onExternalChunkOverlapSecondsChange={setAsrExternalChunkOverlapSeconds}
            onExternalPreferSilenceChange={setAsrExternalPreferSilence}
            onExternalVadThresholdChange={setAsrExternalVadThreshold}
            onExternalMinimumSilenceMsChange={setAsrExternalMinimumSilenceMs}
            onInstallWhisperComponent={installWhisperComponent}
            onCancelWhisperComponentInstall={cancelWhisperComponentInstall}
            onRemoveWhisperComponent={removeWhisperComponent}
            onSaveAsr={saveAsr}
          />
        )}

        {activeTab === "llm" && (
          <LlmSettingsTab
            llmEndpoint={llmEndpoint}
            llmModel={llmModel}
            llmApiKey={llmApiKey}
            llmTimeout={llmTimeout}
            llmMaxTokens={llmMaxTokens}
            llmTemperature={llmTemperature}
            llmAllowRemoteEndpoint={llmAllowRemoteEndpoint}
            aiOutputLanguage={aiOutputLanguage}
            llmWarning={llmWarning}
            llmTestResult={llmTestResult}
            onLlmEndpointChange={setLlmEndpoint}
            onLlmModelChange={setLlmModel}
            onLlmApiKeyChange={setLlmApiKey}
            onLlmTimeoutChange={setLlmTimeout}
            onLlmMaxTokensChange={setLlmMaxTokens}
            onLlmTemperatureChange={setLlmTemperature}
            onLlmAllowRemoteEndpointChange={setLlmAllowRemoteEndpoint}
            onAiOutputLanguageChange={setAiOutputLanguage}
            onSaveLlm={saveLlm}
            onTestLlm={testLlm}
          />
        )}

        {activeTab === "tasks" && (
          <PanelCard>
            <TaskPanel onTaskChanged={refresh} notify={notify} />
          </PanelCard>
        )}

        {activeTab === "maintenance" && (
          <MaintenanceSettingsTab
            maintenanceTags={maintenanceTags}
            databaseBackups={databaseBackups}
            databaseRestoreStatus={databaseRestoreStatus}
            backupAction={backupAction}
            onCreateBackup={createDatabaseBackup}
            onLoadBackups={() => loadBackups().catch((err) => notify?.(String(err), "error"))}
            onValidateBackup={validateDatabaseBackup}
            onRestoreBackup={restoreDatabaseBackup}
            onDeleteBackup={deleteDatabaseBackup}
            onCancelRestore={cancelPendingDatabaseRestore}
            onRebuildSearch={rebuildSearch}
            onCleanupTags={cleanupTags}
            onLoadTags={loadTags}
            onRenameTag={renameTag}
            onMergeTag={mergeTag}
            onDeleteTag={deleteTag}
          />
        )}

        {activeTab === "logs" && (
          <LogsSettingsTab
            logs={logs}
            onLoadLogs={loadLogs}
            onReloadBackend={load}
          />
        )}
      </div>
    </section>
  );
}
