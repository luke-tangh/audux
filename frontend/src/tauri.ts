async function invokeCommand<T>(command: string): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command);
}

export function resolveTauriBackendBaseUrl(): Promise<string> {
  return invokeCommand<string>("backend_base_url");
}

export async function isTauriRuntime(): Promise<boolean> {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
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
