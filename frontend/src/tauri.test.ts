import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  getVersion: vi.fn(),
  check: vi.fn(),
  listen: vi.fn()
}));

vi.mock("@tauri-apps/api/core", () => tauriMocks);
vi.mock("@tauri-apps/api/app", () => ({ getVersion: tauriMocks.getVersion }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: tauriMocks.check }));
vi.mock("@tauri-apps/api/event", () => ({ listen: tauriMocks.listen }));

import {
  checkApplicationUpdate,
  downloadApplicationUpdate,
  getCurrentApplicationVersion,
  installApplicationUpdate,
  isApplicationUpdaterConfigured,
  isTauriRuntime,
  listenForApplicationCloseRequest,
  confirmApplicationClose,
  setApplicationCloseGuard,
  pickAudioFile,
  pickAudioFolder,
  restartApplication
} from "./tauri";

describe("Tauri command wrappers", () => {
  beforeEach(() => {
    tauriMocks.invoke.mockReset();
    tauriMocks.getVersion.mockReset();
    tauriMocks.check.mockReset();
    tauriMocks.listen.mockReset();
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

  it("reports whether the native updater has release configuration", async () => {
    await expect(isApplicationUpdaterConfigured()).resolves.toBe(false);
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    tauriMocks.invoke.mockResolvedValue(true);

    await expect(isApplicationUpdaterConfigured()).resolves.toBe(true);
    expect(tauriMocks.invoke).toHaveBeenCalledWith("application_updater_configured");
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

  it("restarts only inside the Tauri runtime", async () => {
    await expect(restartApplication()).resolves.toBe(false);
    expect(tauriMocks.invoke).not.toHaveBeenCalled();

    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    tauriMocks.invoke.mockResolvedValue(undefined);
    await expect(restartApplication()).resolves.toBe(true);
    expect(tauriMocks.invoke).toHaveBeenCalledWith("restart_application");
  });

  it("negotiates application close only inside the Tauri runtime", async () => {
    const handler = vi.fn();
    const unlisten = vi.fn();
    tauriMocks.listen.mockResolvedValue(unlisten);

    await expect(listenForApplicationCloseRequest(handler)).resolves.toEqual(
      expect.any(Function)
    );
    expect(tauriMocks.listen).not.toHaveBeenCalled();
    await expect(confirmApplicationClose()).resolves.toBe(false);
    await expect(setApplicationCloseGuard(true)).resolves.toBe(false);

    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    tauriMocks.invoke.mockResolvedValue(undefined);
    await expect(listenForApplicationCloseRequest(handler)).resolves.toBe(unlisten);
    expect(tauriMocks.listen).toHaveBeenCalledWith(
      "audux://close-requested",
      expect.any(Function)
    );
    await expect(confirmApplicationClose()).resolves.toBe(true);
    expect(tauriMocks.invoke).toHaveBeenCalledWith("confirm_application_close");
    await expect(setApplicationCloseGuard(true)).resolves.toBe(true);
    expect(tauriMocks.invoke).toHaveBeenCalledWith(
      "set_application_close_guard",
      { enabled: true }
    );
  });

  it("checks, downloads, installs, and restarts a signed application update", async () => {
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    const download = vi.fn(async (onEvent: (event: unknown) => void) => {
      onEvent({ event: "Started", data: { contentLength: 100 } });
      onEvent({ event: "Progress", data: { chunkLength: 40 } });
      onEvent({ event: "Progress", data: { chunkLength: 60 } });
      onEvent({ event: "Finished" });
    });
    const install = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    tauriMocks.check.mockResolvedValue({
      currentVersion: "1.0.0",
      version: "1.0.1",
      date: "2026-08-24T00:00:00Z",
      body: "安全更新",
      download,
      install,
      close
    });
    tauriMocks.getVersion.mockResolvedValue("1.0.0");
    tauriMocks.invoke.mockResolvedValue(undefined);

    await expect(getCurrentApplicationVersion()).resolves.toBe("1.0.0");
    await expect(checkApplicationUpdate()).resolves.toEqual({
      currentVersion: "1.0.0",
      version: "1.0.1",
      date: "2026-08-24T00:00:00Z",
      body: "安全更新"
    });
    const progress = vi.fn();
    await downloadApplicationUpdate(progress);
    expect(progress).toHaveBeenLastCalledWith({
      downloadedBytes: 100,
      totalBytes: 100
    });
    await installApplicationUpdate();
    expect(install).toHaveBeenCalledTimes(1);
    expect(tauriMocks.invoke).toHaveBeenCalledWith("restart_application");
  });
});
