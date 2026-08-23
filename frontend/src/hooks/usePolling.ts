import { useEffect, useRef } from "react";

type UsePollingOptions = {
  enabled?: boolean;
  intervalMs: number;
  immediate?: boolean;
  task: () => Promise<void> | void;
  onError?: (error: unknown) => void;
};

/**
 * Runs one polling task at a time and schedules the next run only after the
 * current task settles. Updating task/onError does not restart the timer.
 */
export function usePolling({
  enabled = true,
  intervalMs,
  immediate = false,
  task,
  onError
}: UsePollingOptions) {
  const taskRef = useRef(task);
  const errorRef = useRef(onError);
  taskRef.current = task;
  errorRef.current = onError;

  useEffect(() => {
    if (!enabled) return;

    let active = true;
    let timer: number | null = null;

    const schedule = () => {
      if (!active) return;
      timer = window.setTimeout(run, intervalMs);
    };

    const run = async () => {
      try {
        await taskRef.current();
      } catch (error) {
        errorRef.current?.(error);
      } finally {
        schedule();
      }
    };

    if (immediate) {
      void run();
    } else {
      schedule();
    }

    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [enabled, immediate, intervalMs]);
}
