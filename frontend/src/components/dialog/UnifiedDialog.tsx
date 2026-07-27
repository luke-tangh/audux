import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type { KeyboardEvent, MutableRefObject, ReactNode } from "react";
import { Button, MaterialIcon } from "../ui";

export type UnifiedDialogTone = "default" | "danger" | "warning" | "privacy" | "success";

type BaseDialogOptions = {
  title: string;
  message?: ReactNode;
  details?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: UnifiedDialogTone;
  destructive?: boolean;
};

export type ConfirmDialogOptions = BaseDialogOptions;

export type AlertDialogOptions = Omit<BaseDialogOptions, "cancelLabel" | "destructive">;

export type PromptDialogOptions = BaseDialogOptions & {
  inputLabel?: string;
  defaultValue?: string;
  placeholder?: string;
  multiline?: boolean;
  required?: boolean;
  validate?: (value: string) => string | null | undefined;
};

type ActiveDialog =
  | {
      id: number;
      kind: "confirm";
      options: ConfirmDialogOptions;
      resolve: (value: boolean) => void;
    }
  | {
      id: number;
      kind: "alert";
      options: AlertDialogOptions;
      resolve: () => void;
    }
  | {
      id: number;
      kind: "prompt";
      options: PromptDialogOptions;
      resolve: (value: string | null) => void;
    };

type DialogContextValue = {
  confirm: (options: ConfirmDialogOptions) => Promise<boolean>;
  alert: (options: AlertDialogOptions) => Promise<void>;
  prompt: (options: PromptDialogOptions) => Promise<string | null>;
};

const DialogContext = createContext<DialogContextValue | null>(null);

function toneIconName(tone: UnifiedDialogTone) {
  if (tone === "danger") return "error";
  if (tone === "warning") return "warning";
  if (tone === "privacy") return "privacy_tip";
  if (tone === "success") return "check_circle";
  return "help";
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const idRef = useRef(1);
  const queueRef = useRef<ActiveDialog[]>([]);
  const dialogRef = useRef<ActiveDialog | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const dialogPanelRef = useRef<HTMLDivElement | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const promptInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  const [dialog, setDialog] = useState<ActiveDialog | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [inputError, setInputError] = useState("");

  const activateDialog = useCallback((next: ActiveDialog | null) => {
    if (next && !dialogRef.current && typeof document !== "undefined") {
      const activeElement = document.activeElement;
      restoreFocusRef.current =
        activeElement instanceof HTMLElement ? activeElement : null;
    }

    dialogRef.current = next;
    setInputError("");
    setInputValue(next?.kind === "prompt" ? next.options.defaultValue || "" : "");
    setDialog(next);
  }, []);

  const showNext = useCallback(() => {
    if (dialogRef.current) return;

    const next = queueRef.current.shift() || null;
    if (next) {
      activateDialog(next);
    }
  }, [activateDialog]);

  const closeCurrent = useCallback(() => {
    activateDialog(null);

    window.setTimeout(() => {
      const hasQueuedDialog = queueRef.current.length > 0;
      showNext();

      if (!hasQueuedDialog) {
        restoreFocusRef.current?.focus();
        restoreFocusRef.current = null;
      }
    }, 0);
  }, [activateDialog, showNext]);

  const openDialog = useCallback(
    (next: ActiveDialog) => {
      queueRef.current.push(next);
      showNext();
    },
    [showNext]
  );

  const confirm = useCallback(
    (options: ConfirmDialogOptions) => {
      return new Promise<boolean>((resolve) => {
        openDialog({
          id: idRef.current++,
          kind: "confirm",
          options,
          resolve
        });
      });
    },
    [openDialog]
  );

  const alert = useCallback(
    (options: AlertDialogOptions) => {
      return new Promise<void>((resolve) => {
        openDialog({
          id: idRef.current++,
          kind: "alert",
          options,
          resolve
        });
      });
    },
    [openDialog]
  );

  const prompt = useCallback(
    (options: PromptDialogOptions) => {
      return new Promise<string | null>((resolve) => {
        openDialog({
          id: idRef.current++,
          kind: "prompt",
          options,
          resolve
        });
      });
    },
    [openDialog]
  );

  const contextValue = useMemo(
    () => ({
      confirm,
      alert,
      prompt
    }),
    [confirm, alert, prompt]
  );

  const cancelDialog = useCallback(() => {
    if (!dialog) return;

    if (dialog.kind === "confirm") {
      dialog.resolve(false);
    }

    if (dialog.kind === "prompt") {
      dialog.resolve(null);
    }

    if (dialog.kind === "alert") {
      dialog.resolve();
    }

    closeCurrent();
  }, [closeCurrent, dialog]);

  const submitDialog = useCallback(() => {
    if (!dialog) return;

    if (dialog.kind === "confirm") {
      dialog.resolve(true);
      closeCurrent();
      return;
    }

    if (dialog.kind === "alert") {
      dialog.resolve();
      closeCurrent();
      return;
    }

    const value = inputValue;
    const trimmed = value.trim();

    if (dialog.options.required && !trimmed) {
      setInputError("此项为必填");
      return;
    }

    const validationError = dialog.options.validate?.(value);
    if (validationError) {
      setInputError(validationError);
      return;
    }

    dialog.resolve(value);
    closeCurrent();
  }, [closeCurrent, dialog, inputValue]);

  useEffect(() => {
    if (!dialog) return;

    const options = dialog.options as BaseDialogOptions;
    const shouldFocusCancel =
      dialog.kind === "confirm" && (options.destructive || options.tone === "danger");

    const target =
      dialog.kind === "prompt"
        ? promptInputRef.current
        : shouldFocusCancel
          ? cancelButtonRef.current
          : confirmButtonRef.current;

    window.setTimeout(() => {
      target?.focus();
    }, 0);
  }, [dialog?.id]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Tab") {
      const container = dialogPanelRef.current;
      if (!container) return;

      const focusable = Array.from(
        container.querySelectorAll(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element): element is HTMLElement => {
        return (
          element instanceof HTMLElement &&
          !element.hasAttribute("disabled") &&
          element.getAttribute("aria-hidden") !== "true"
        );
      });

      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }

      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancelDialog();
    }
  }

  const dialogOverlay = dialog ? (() => {
    const options = dialog.options as BaseDialogOptions;
    const tone: UnifiedDialogTone =
      options.tone || (options.destructive ? "danger" : "default");

    const titleId = `unified-dialog-title-${dialog.id}`;
    const messageId = `unified-dialog-message-${dialog.id}`;
    const inputId = `unified-dialog-input-${dialog.id}`;

    const showCancel = dialog.kind !== "alert";
    const confirmLabel =
      options.confirmLabel ||
      (dialog.kind === "alert" ? "知道了" : dialog.kind === "prompt" ? "确认" : "确认");
    const cancelLabel = options.cancelLabel || "取消";
    const confirmVariant =
      options.destructive || tone === "danger" ? "danger" : "filled";

    return (
      <div className="unified-dialog-backdrop" role="presentation">
        <div
          ref={dialogPanelRef}
          className={`unified-dialog unified-dialog-${tone}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={options.message ? messageId : undefined}
          onKeyDown={handleKeyDown}
        >
          <div className="unified-dialog-tone-icon" aria-hidden="true">
            <MaterialIcon name={toneIconName(tone)} size={24} />
          </div>

          <div className="unified-dialog-content">
            <h2 id={titleId}>{options.title}</h2>

            {options.message && (
              <div id={messageId} className="unified-dialog-message">
                {options.message}
              </div>
            )}

            {options.details && (
              <div className="unified-dialog-details">{options.details}</div>
            )}

            {dialog.kind === "prompt" && (
              <div className="unified-dialog-prompt">
                {dialog.options.inputLabel && (
                  <label className="unified-dialog-input-label" htmlFor={inputId}>
                    {dialog.options.inputLabel}
                  </label>
                )}

                {dialog.options.multiline ? (
                  <textarea
                    id={inputId}
                    ref={promptInputRef as MutableRefObject<HTMLTextAreaElement | null>}
                    value={inputValue}
                    placeholder={dialog.options.placeholder}
                    aria-label={
                      dialog.options.inputLabel || dialog.options.placeholder || "输入内容"
                    }
                    aria-invalid={Boolean(inputError)}
                    onChange={(event) => {
                      setInputValue(event.target.value);
                      setInputError("");
                    }}
                  />
                ) : (
                  <input
                    id={inputId}
                    ref={promptInputRef as MutableRefObject<HTMLInputElement | null>}
                    value={inputValue}
                    placeholder={dialog.options.placeholder}
                    aria-label={
                      dialog.options.inputLabel || dialog.options.placeholder || "输入内容"
                    }
                    aria-invalid={Boolean(inputError)}
                    onChange={(event) => {
                      setInputValue(event.target.value);
                      setInputError("");
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        submitDialog();
                      }
                    }}
                  />
                )}

                {inputError && (
                  <div className="unified-dialog-input-error" role="alert">
                    {inputError}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="unified-dialog-actions">
            {showCancel && (
              <Button
                type="button"
                ref={cancelButtonRef}
                variant="outlined"
                onClick={cancelDialog}
              >
                {cancelLabel}
              </Button>
            )}

            <Button
              type="button"
              ref={confirmButtonRef}
              variant={confirmVariant}
              onClick={submitDialog}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    );
  })() : null;

  return (
    <DialogContext.Provider value={contextValue}>
      {children}
      {dialogOverlay}
    </DialogContext.Provider>
  );
}

export function useDialog(): DialogContextValue {
  const value = useContext(DialogContext);

  if (!value) {
    throw new Error("useDialog must be used within DialogProvider");
  }

  return value;
}
