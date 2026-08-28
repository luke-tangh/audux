import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "../i18n";

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  confirmApplicationClose: vi.fn(),
  listenForApplicationCloseRequest: vi.fn(),
  setApplicationCloseGuard: vi.fn()
}));

vi.mock("../components/dialog/UnifiedDialog", () => ({
  useDialog: () => ({ confirm: mocks.confirm })
}));
vi.mock("../tauri", () => ({
  confirmApplicationClose: mocks.confirmApplicationClose,
  listenForApplicationCloseRequest: mocks.listenForApplicationCloseRequest,
  setApplicationCloseGuard: mocks.setApplicationCloseGuard
}));

import { useAppShellController } from "./useAppShellController";

const baseParams = {
  selected: null,
  setSelected: vi.fn(),
  view: "library" as const,
  openSettings: vi.fn(),
  initialized: true,
  navigationReady: true,
  rootsLength: 1,
  activeSavedViewId: null,
  selectedPlaylistId: null,
  selectedTag: undefined
};

describe("useAppShellController", () => {
  let closeHandler: (() => void | Promise<void>) | undefined;

  beforeEach(() => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }));
    closeHandler = undefined;
    mocks.confirm.mockReset();
    mocks.confirmApplicationClose.mockReset().mockResolvedValue(true);
    mocks.setApplicationCloseGuard.mockReset().mockResolvedValue(true);
    mocks.listenForApplicationCloseRequest.mockReset().mockImplementation(
      async (handler: () => void | Promise<void>) => {
        closeHandler = handler;
        return () => undefined;
      }
    );
  });

  it("does not open onboarding until navigation has loaded successfully", async () => {
    const { result, rerender } = renderHook(
      (props) => useAppShellController(props),
      { initialProps: { ...baseParams, navigationReady: false, rootsLength: 0 } }
    );

    expect(result.current.onboardingOpen).toBe(false);
    rerender({ ...baseParams, navigationReady: true, rootsLength: 0 });
    await waitFor(() => expect(result.current.onboardingOpen).toBe(true));
  });

  it("keeps the native window open when dirty changes are not discarded", async () => {
    mocks.confirm.mockResolvedValue(false);
    const { result } = renderHook(() => useAppShellController(baseParams));
    act(() => result.current.setInspectorDirty(true));
    await waitFor(() => expect(closeHandler).toBeTypeOf("function"));
    await waitFor(() => expect(mocks.setApplicationCloseGuard).toHaveBeenCalledWith(true));

    await act(async () => closeHandler?.());

    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    expect(mocks.confirmApplicationClose).not.toHaveBeenCalled();
  });

  it("prepares dirty settings before confirming the native close", async () => {
    const prepareSettings = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(() => useAppShellController(baseParams));
    act(() => {
      result.current.handleSettingsBeforeLeaveChange(prepareSettings);
      result.current.setSettingsDirty(true);
    });
    await waitFor(() => expect(closeHandler).toBeTypeOf("function"));
    await waitFor(() => expect(mocks.setApplicationCloseGuard).toHaveBeenCalledWith(true));

    await act(async () => closeHandler?.());

    expect(prepareSettings).toHaveBeenCalledTimes(1);
    expect(mocks.confirmApplicationClose).toHaveBeenCalledTimes(1);
  });
});
