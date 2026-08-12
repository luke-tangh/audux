import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import Button, { type ButtonSize, type ButtonVariant } from "./Button";
import MaterialIcon from "./MaterialIcon";
import type { MaterialIconName } from "./MaterialIcon";

export type ActionMenuItem = {
  id: string;
  label: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  icon?: MaterialIconName;
};

type ActionMenuProps = {
  label: string;
  items: readonly ActionMenuItem[];
  buttonText?: ReactNode;
  buttonIcon?: MaterialIconName;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  align?: "start" | "end";
  disabled?: boolean;
};

export default function ActionMenu({
  label,
  items,
  buttonText,
  buttonIcon = "more_horiz",
  variant = "text",
  size = "md",
  className = "",
  align = "end",
  disabled = false
}: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = `action-menu-${useId().replace(/[^a-zA-Z0-9_-]/g, "-")}`;

  const enabledIndexes = items.flatMap((item, index) =>
    item.disabled ? [] : [index]
  );

  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }

  function focusItem(index: number) {
    window.requestAnimationFrame(() => itemRefs.current[index]?.focus());
  }

  useEffect(() => {
    if (!open) return;

    const firstIndex = enabledIndexes[0];
    if (firstIndex !== undefined) focusItem(firstIndex);

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) close();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }

    if (event.key === "Tab") {
      close();
      return;
    }

    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();

    const currentIndex = itemRefs.current.findIndex(
      (element) => element === document.activeElement
    );
    const currentEnabledIndex = enabledIndexes.indexOf(currentIndex);
    let nextIndex = enabledIndexes[0];

    if (event.key === "End") nextIndex = enabledIndexes[enabledIndexes.length - 1];
    if (event.key === "ArrowDown") {
      nextIndex = enabledIndexes[(currentEnabledIndex + 1) % enabledIndexes.length];
    }
    if (event.key === "ArrowUp") {
      nextIndex =
        enabledIndexes[
          (currentEnabledIndex - 1 + enabledIndexes.length) % enabledIndexes.length
        ];
    }

    if (nextIndex !== undefined) focusItem(nextIndex);
  }

  return (
    <div className={`ui-action-menu ${className}`.trim()} ref={rootRef}>
      <Button
        ref={triggerRef}
        preserveChildren
        type="button"
        variant={variant}
        size={size}
        className="ui-action-menu-trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        {buttonIcon && <MaterialIcon name={buttonIcon} size={18} />}
        {buttonText && <span>{buttonText}</span>}
        {buttonText && <MaterialIcon name="arrow_drop_down" size={18} />}
      </Button>

      {open && (
        <div
          id={menuId}
          className={`ui-action-menu-popover align-${align}`}
          role="menu"
          aria-label={label}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={handleMenuKeyDown}
        >
          {items.map((item, index) => (
            <button
              key={item.id}
              ref={(element) => {
                itemRefs.current[index] = element;
              }}
              type="button"
              role="menuitem"
              className={item.danger ? "danger" : ""}
              disabled={item.disabled}
              onClick={() => {
                close(true);
                item.onSelect();
              }}
            >
              {item.icon && <MaterialIcon name={item.icon} size={18} />}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
