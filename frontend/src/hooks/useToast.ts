import { useCallback, useState } from "react";

export type ToastType = "info" | "success" | "error";

export type Toast = {
  id: number;
  message: string;
  type: ToastType;
};

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const closeToast = useCallback((id: number) => {
    setToasts((rows) => rows.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback((message: string, type: ToastType = "info") => {
    const id = Date.now() + Math.random();

    setToasts((rows) => [
      ...rows,
      {
        id,
        message,
        type
      }
    ]);

    window.setTimeout(
      () => {
        setToasts((rows) => rows.filter((toast) => toast.id !== id));
      },
      type === "error" ? 8000 : 3800
    );
  }, []);

  return {
    toasts,
    notify,
    closeToast
  };
}
