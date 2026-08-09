import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn()
}));

vi.mock("@tauri-apps/api/core", () => tauriMocks);

import { isTauriRuntime, pickAudioFile, pickAudioFolder } from "./tauri";

describe("Tauri command wrappers", () => {
  beforeEach(() => {
    tauriMocks.invoke.mockReset();
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("detects the Tauri runtime marker", async () => {
    await expect(isTauriRuntime()).resolves.toBe(false);
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    await expect(isTauriRuntime()).resolves.toBe(true);
  });

  it("returns native dialog selections", async () => {
    tauriMocks.invoke
      .mockResolvedValueOnce("/library")
      .mockResolvedValueOnce("/library/audio.mp3");

    await expect(pickAudioFolder()).resolves.toBe("/library");
    await expect(pickAudioFile()).resolves.toBe("/library/audio.mp3");
    expect(tauriMocks.invoke).toHaveBeenNthCalledWith(1, "pick_audio_folder");
    expect(tauriMocks.invoke).toHaveBeenNthCalledWith(2, "pick_audio_file");
  });

  it("converts native command failures to null", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    tauriMocks.invoke.mockRejectedValue(new Error("dialog unavailable"));

    await expect(pickAudioFolder()).resolves.toBeNull();
    await expect(pickAudioFile()).resolves.toBeNull();
    expect(error).toHaveBeenCalledTimes(2);
  });
});
