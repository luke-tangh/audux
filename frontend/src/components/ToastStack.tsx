import type { Toast } from "../hooks/useToast";
import { IconButton, MaterialIcon } from "./ui";
import { useTranslation } from "react-i18next";

type Props = {
  toasts: Toast[];
  onClose: (id: number) => void;
};

export default function ToastStack({ toasts, onClose }: Props) {
  const { t } = useTranslation();
  if (toasts.length === 0) return null;

  return (
    <div
      className="toast-stack"
      aria-live="polite"
      aria-relevant="additions removals"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast-${toast.type}`}
          role={toast.type === "error" ? "alert" : "status"}
        >
          <div className="toast-content">
            <div className="toast-message">{toast.message}</div>

            <IconButton
              className="toast-close"
              label={t("common.actions.closeNotification")}
              onClick={() => onClose(toast.id)}
            >
                <MaterialIcon name="close" size={18} />
              </IconButton>
          </div>
        </div>
      ))}
    </div>
  );
}
