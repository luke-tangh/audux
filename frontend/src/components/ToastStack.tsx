import type { Toast } from "../hooks/useToast";

type Props = {
  toasts: Toast[];
  onClose: (id: number) => void;
};

export default function ToastStack({ toasts, onClose }: Props) {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-stack">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.type}`}>
          <div className="toast-content">
            <div className="toast-message">{toast.message}</div>

            <button className="toast-close" onClick={() => onClose(toast.id)}>
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
