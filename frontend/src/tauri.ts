import { invoke } from "@tauri-apps/api/core";

export async function isTauriRuntime(): Promise<boolean> {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function pickAudioFolder(): Promise<string | null> {
  try {
    const result = await invoke<string | null>("pick_audio_folder");
    return result;
  } catch (err) {
    console.error("pick_audio_folder failed", err);
    return null;
  }
}
