import { useCallback, useEffect, useState } from "react";

import { api } from "../api";
import type { StatisticsOverview } from "../types";
import { useBackendReady } from "./useBackendReady";

export function useStatistics(days: number) {
  const { ensureBackendReady } = useBackendReady();
  const [data, setData] = useState<StatisticsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);

  const refresh = useCallback(() => setRefreshToken((value) => value + 1), []);

  useEffect(() => {
    let canceled = false;
    setLoading(true);
    setError("");

    async function load() {
      try {
        await ensureBackendReady();
        const overview = await api.getStatisticsOverview(days);
        if (!canceled) setData(overview);
      } catch (loadError) {
        if (!canceled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      } finally {
        if (!canceled) setLoading(false);
      }
    }

    void load();
    return () => {
      canceled = true;
    };
  }, [days, ensureBackendReady, refreshToken]);

  return { data, loading, error, refresh };
}
