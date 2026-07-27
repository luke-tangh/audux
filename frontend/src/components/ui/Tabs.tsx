import { useId, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";

export type TabItem<T extends string = string> = {
  id: T;
  label: ReactNode;
  disabled?: boolean;
  panelId?: string;
};

type TabsProps<T extends string = string> = {
  items: readonly TabItem<T>[];
  activeId: T;
  onChange: (id: T) => void;
  ariaLabel: string;
  className?: string;
  idPrefix?: string;
};

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

export default function Tabs<T extends string = string>({
  items,
  activeId,
  onChange,
  ariaLabel,
  className = "ui-tabs",
  idPrefix
}: TabsProps<T>) {
  const fallbackId = useId();
  const prefix = safeId(idPrefix || fallbackId);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const enabledItems = items.filter((item) => !item.disabled);

  function focusTab(id: T) {
    const index = items.findIndex((item) => item.id === id);

    if (index < 0) return;

    window.requestAnimationFrame(() => {
      tabRefs.current[index]?.focus();
    });
  }

  function selectAndFocus(id: T) {
    onChange(id);
    focusTab(id);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.defaultPrevented || enabledItems.length === 0) {
      return;
    }

    const activeEnabledItem =
      enabledItems.find((item) => item.id === activeId) || enabledItems[0];

    const activeEnabledIndex = enabledItems.findIndex(
      (item) => item.id === activeEnabledItem.id
    );

    let nextEnabledIndex: number | null = null;

    if (event.key === "ArrowRight") {
      nextEnabledIndex = (activeEnabledIndex + 1) % enabledItems.length;
    }

    if (event.key === "ArrowLeft") {
      nextEnabledIndex =
        (activeEnabledIndex - 1 + enabledItems.length) % enabledItems.length;
    }

    if (event.key === "Home") {
      nextEnabledIndex = 0;
    }

    if (event.key === "End") {
      nextEnabledIndex = enabledItems.length - 1;
    }

    if (nextEnabledIndex === null) {
      return;
    }

    event.preventDefault();
    selectAndFocus(enabledItems[nextEnabledIndex].id);
  }

  return (
    <div
      className={className}
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation="horizontal"
      onKeyDown={handleKeyDown}
    >
      {items.map((item, index) => {
        const selected = item.id === activeId;
        const tabId = `${prefix}-tab-${safeId(item.id)}`;
        const panelId = item.panelId || `${prefix}-panel-${safeId(item.id)}`;

        return (
          <button
            key={item.id}
            id={tabId}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected && !item.disabled ? 0 : -1}
            className={selected ? "active" : ""}
            disabled={item.disabled}
            onClick={() => onChange(item.id)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
