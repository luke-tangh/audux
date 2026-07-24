import { useCallback, useRef } from "react";
import { api } from "../api";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function useBackendReady() {
  const backendReadyRef = useRef(false);

  const ensureBackendReady = useCallback(async () => {
    if (backendReadyRef.current) return;

    let lastError: unknown = null;

    // PyInstaller onefile sidecar can take noticeably longer on first launch,
    // especially with native ASR dependencies bundled. Wait up to ~60s.
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        await api.health();
        await api.ensureAuthToken();

        backendReadyRef.current = true;
        return;
      } catch (err) {
        lastError = err;
        await sleep(500);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Backend is not ready");
  }, []);

  const resetBackendReady = useCallback(() => {
    backendReadyRef.current = false;
  }, []);

  return {
    ensureBackendReady,
    resetBackendReady
  };
}
