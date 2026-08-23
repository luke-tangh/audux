import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";

import Button, { type ButtonSize, type ButtonVariant } from "./Button";
import MaterialIcon from "./MaterialIcon";
import type { MaterialIconName } from "./MaterialIcon";
import { useAnchoredPopover } from "../../hooks/useAnchoredPopover";

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
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({ left: 0, top: 0 });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
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

  function updateMenuPosition() {
    const trigger = triggerRef.current;
    const menu = menuRef.current;

    if (!trigger || !menu || typeof window === "undefined") return;

    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const viewportMargin = 8;
    const menuGap = 6;
    const spaceBelow = window.innerHeight - triggerRect.bottom - viewportMargin;
    const spaceAbove = triggerRect.top - viewportMargin;
    const openAbove = spaceBelow < menuRect.height + menuGap && spaceAbove > spaceBelow;

    let left = align === "end" ? triggerRect.right - menuRect.width : triggerRect.left;
    left = Math.max(
      viewportMargin,
      Math.min(left, window.innerWidth - viewportMargin - menuRect.width)
    );

    let top = openAbove
      ? triggerRect.top - menuRect.height - menuGap
      : triggerRect.bottom + menuGap;
    top = Math.max(
      viewportMargin,
      Math.min(top, window.innerHeight - viewportMargin - menuRect.height)
    );

    setMenuStyle({ left, top });
  }

  useLayoutEffect(() => {
    if (open) updateMenuPosition();
  }, [align, items.length, open]);

  useAnchoredPopover({
    open,
    anchorRef: rootRef,
    popoverRef: menuRef,
    onDismiss: () => close(),
    onReposition: updateMenuPosition
  });

  useEffect(() => {
    if (!open) return;

    const firstIndex = enabledIndexes[0];
    if (firstIndex !== undefined) focusItem(firstIndex);

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

  const menu =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            id={menuId}
            className="ui-action-menu-popover"
            style={menuStyle}
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
          </div>,
          document.body
        )
      : null;

  return (
    <>
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
      </div>
      {menu}
    </>
  );
}
