import packageMetadata from "../package.json";
import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";

let pendingApplicationUpdate: Update | null = null;

export type ApplicationUpdateInfo = {
  currentVersion: string;
  version: string;
  date?: string;
  body?: string;
};

export type ApplicationUpdateProgress = {
  downloadedBytes: number;
  totalBytes: number | null;
};

async function invokeCommand<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return args ? invoke<T>(command, args) : invoke<T>(command);
}

export function resolveTauriBackendBaseUrl(): Promise<string> {
  return invokeCommand<string>("backend_base_url");
}

export async function isTauriRuntime(): Promise<boolean> {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function listenForApplicationCloseRequest(
  handler: () => void | Promise<void>
): Promise<() => void> {
  if (!(await isTauriRuntime())) return () => undefined;
  const { listen } = await import("@tauri-apps/api/event");
  return listen("audux://close-requested", () => {
    void handler();
  });
}

export async function confirmApplicationClose(): Promise<boolean> {
  if (!(await isTauriRuntime())) return false;
  try {
    await invokeCommand("confirm_application_close");
    return true;
  } catch (err) {
    console.error("confirm_application_close failed", err);
    return false;
  }
}

export async function setApplicationCloseGuard(enabled: boolean): Promise<boolean> {
  if (!(await isTauriRuntime())) return false;
  try {
    await invokeCommand("set_application_close_guard", { enabled });
    return true;
  } catch (err) {
    console.error("set_application_close_guard failed", err);
    return false;
  }
}

export async function getCurrentApplicationVersion(): Promise<string> {
  if (!(await isTauriRuntime())) return packageMetadata.version;
  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
}

export async function isApplicationUpdaterConfigured(): Promise<boolean> {
  if (!(await isTauriRuntime())) return false;
  return invokeCommand<boolean>("application_updater_configured");
}

export async function checkApplicationUpdate(): Promise<ApplicationUpdateInfo | null> {
  if (!(await isTauriRuntime())) return null;
  if (pendingApplicationUpdate) {
    await pendingApplicationUpdate.close();
    pendingApplicationUpdate = null;
  }
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check({ timeout: 30_000 });
  pendingApplicationUpdate = update;
  if (!update) return null;
  return {
    currentVersion: update.currentVersion,
    version: update.version,
    date: update.date,
    body: update.body
  };
}

export async function downloadApplicationUpdate(
  onProgress: (progress: ApplicationUpdateProgress) => void
): Promise<void> {
  if (!pendingApplicationUpdate) throw new Error("No application update is ready to download");
  let downloadedBytes = 0;
  let totalBytes: number | null = null;
  await pendingApplicationUpdate.download((event: DownloadEvent) => {
    if (event.event === "Started") {
      totalBytes = event.data.contentLength ?? null;
      downloadedBytes = 0;
    } else if (event.event === "Progress") {
      downloadedBytes += event.data.chunkLength;
    }
    onProgress({ downloadedBytes, totalBytes });
  }, { timeout: 10 * 60_000 });
}

export async function installApplicationUpdate(): Promise<void> {
  if (!pendingApplicationUpdate) throw new Error("No downloaded application update is ready to install");
  const update = pendingApplicationUpdate;
  await update.install();
  pendingApplicationUpdate = null;
  await invokeCommand("restart_application");
}

export async function pickAudioFolder(): Promise<string | null> {
  try {
    const result = await invokeCommand<string | null>("pick_audio_folder");
    return result;
  } catch (err) {
    console.error("pick_audio_folder failed", err);
    return null;
  }
}

export async function pickAudioFile(): Promise<string | null> {
  try {
    const result = await invokeCommand<string | null>("pick_audio_file");
    return result;
  } catch (err) {
    console.error("pick_audio_file failed", err);
    return null;
  }
}

export async function restartApplication(): Promise<boolean> {
  if (!(await isTauriRuntime())) return false;
  try {
    await invokeCommand("restart_application");
    return true;
  } catch (err) {
    console.error("restart_application failed", err);
    return false;
  }
}

async function invokeDirectoryCommand(command: string): Promise<boolean> {
  if (!(await isTauriRuntime())) return false;
  try {
    await invokeCommand(command);
    return true;
  } catch (err) {
    console.error(`${command} failed`, err);
    return false;
  }
}

export function openAppDataDirectory(): Promise<boolean> {
  return invokeDirectoryCommand("open_app_data_directory");
}

export function openLogsDirectory(): Promise<boolean> {
  return invokeDirectoryCommand("open_logs_directory");
}
