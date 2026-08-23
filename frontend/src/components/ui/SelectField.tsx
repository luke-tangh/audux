import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  CSSProperties,
  KeyboardEvent,
  ReactNode,
  SelectHTMLAttributes
} from "react";
import { useTranslation } from "react-i18next";
import { useAnchoredPopover } from "../../hooks/useAnchoredPopover";

export type SelectFieldOption = {
  value: string;
  label: ReactNode;
  disabled?: boolean;
};

export type SelectFieldControlSize = "default" | "compact" | "toolbar" | "mini";

type CssLength = number | string;

type SelectFieldStyle = CSSProperties &
  Record<`--${string}`, string | number | undefined>;

type SelectFieldProps = Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "children" | "onChange" | "value" | "size" | "multiple"
> & {
  label?: ReactNode;
  value: string | number;
  options: readonly SelectFieldOption[];
  onValueChange: (value: string) => void;
  density?: "comfortable" | "compact";
  /**
   * Visual size of the closed control.
   *
   * - default: standard 56px text-field-like control
   * - compact: 44px compact control
   * - toolbar: 48px command-bar control
   * - mini: 40px pill control, used by media/tool surfaces
   */
  controlSize?: SelectFieldControlSize;
  controlWidth?: CssLength;
  controlMinWidth?: CssLength;
  controlMaxWidth?: CssLength;
  controlHeight?: CssLength;
  controlRadius?: CssLength;
  hideLabel?: boolean;
  wrapperClassName?: string;
  variant?: "filled" | "outlined";
  menuClassName?: string;
  menuMinWidth?: number;
  menuWidth?: number | "control";
  style?: CSSProperties;
};

function readableLabel(label: ReactNode): string | undefined {
  if (typeof label === "string") return label;
  if (typeof label === "number") return String(label);
  return undefined;
}

function isTypingKey(event: KeyboardEvent<HTMLButtonElement>) {
  return (
    event.key.length === 1 &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey
  );
}

function cssLength(value: CssLength | undefined): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === "number" ? `${value}px` : value;
}

function setCssVar(
  style: SelectFieldStyle,
  key: `--${string}`,
  value: CssLength | undefined
) {
  const resolved = cssLength(value);

  if (resolved !== undefined) {
    style[key] = resolved;
  }
}

export default function SelectField({
  label,
  value,
  options,
  onValueChange,
  density = "comfortable",
  controlSize,
  controlWidth,
  controlMinWidth,
  controlMaxWidth,
  controlHeight,
  controlRadius,
  hideLabel = false,
  wrapperClassName = "",
  className = "",
  variant = "filled",
  menuClassName = "",
  menuMinWidth = 200,
  menuWidth,
  disabled,
  id,
  name,
  required,
  title,
  autoFocus,
  style,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid
}: SelectFieldProps) {
  const { t } = useTranslation();
  const generatedId = useId();
  const rootId = id || `${generatedId}-select-field`;
  const labelId = `${rootId}-label`;
  const valueId = `${rootId}-value`;
  const buttonId = `${rootId}-button`;
  const listboxId = `${rootId}-listbox`;

  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const selectedValue = String(value ?? "");
  const selectedIndex = options.findIndex((option) => option.value === selectedValue);
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  const firstEnabledIndex = options.findIndex((option) => !option.disabled);
  const safeActiveIndex =
    selectedIndex >= 0
      ? selectedIndex
      : firstEnabledIndex >= 0
        ? firstEnabledIndex
        : 0;

  const resolvedControlSize =
    controlSize || (density === "compact" ? "compact" : "default");

  const rootStyle: SelectFieldStyle = {
    ...(style as SelectFieldStyle | undefined)
  };

  setCssVar(rootStyle, "--ui-select-width", controlWidth);
  setCssVar(rootStyle, "--ui-select-min-width", controlMinWidth);
  setCssVar(rootStyle, "--ui-select-max-width", controlMaxWidth);
  setCssVar(rootStyle, "--ui-select-height", controlHeight);
  setCssVar(rootStyle, "--ui-select-radius", controlRadius);

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(safeActiveIndex);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({
    left: 0,
    top: 0,
    width: 0,
    maxHeight: 320
  });

  const controlLabel =
    ariaLabel || readableLabel(label) || readableLabel(selectedOption?.label) || t("common.actions.select");

  const activeOptionId =
    open && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined;

  function getFirstEnabledIndex() {
    return options.findIndex((option) => !option.disabled);
  }

  function getLastEnabledIndex() {
    for (let index = options.length - 1; index >= 0; index -= 1) {
      if (!options[index].disabled) return index;
    }

    return -1;
  }

  function getNextEnabledIndex(fromIndex: number, direction: 1 | -1) {
    if (options.length === 0) return -1;

    let index = fromIndex;

    for (let step = 0; step < options.length; step += 1) {
      index =
        direction === 1
          ? (index + 1) % options.length
          : (index - 1 + options.length) % options.length;

      if (!options[index].disabled) return index;
    }

    return -1;
  }

  function updateMenuPosition() {
    const root = rootRef.current;

    if (!root || typeof window === "undefined") return;

    const rect = root.getBoundingClientRect();
    const viewportMargin = 8;
    const menuGap = 6;
    const viewportWidth = Math.max(64, window.innerWidth - viewportMargin * 2);

    const rawRequestedWidth =
      menuWidth === "control"
        ? rect.width
        : typeof menuWidth === "number"
          ? menuWidth
          : Math.max(rect.width, menuMinWidth);

    const fallbackMinWidth =
      menuWidth === "control" || typeof menuWidth === "number"
        ? 64
        : menuMinWidth;

    const desiredWidth = Math.min(
      Math.max(rawRequestedWidth, fallbackMinWidth),
      viewportWidth
    );

    let left = rect.left;

    if (left + desiredWidth > window.innerWidth - viewportMargin) {
      left = window.innerWidth - viewportMargin - desiredWidth;
    }

    left = Math.max(viewportMargin, left);

    const optionHeight = density === "compact" ? 44 : 48;
    const menuVerticalPadding = 16;
    const estimatedMenuHeight = Math.max(
      88,
      options.length * optionHeight + menuVerticalPadding
    );

    const spaceBelow = window.innerHeight - rect.bottom - viewportMargin;
    const spaceAbove = rect.top - viewportMargin;
    const preferredHeight = Math.min(estimatedMenuHeight, 320);
    const openAbove = spaceBelow < preferredHeight && spaceAbove > spaceBelow;
    const availableHeight = Math.max(0, openAbove ? spaceAbove : spaceBelow);

    const maxHeight = Math.max(
      96,
      Math.min(320, Math.max(96, availableHeight - menuGap))
    );

    const measuredMenuHeight =
      menuRef.current?.getBoundingClientRect().height || 0;

    const menuHeight = Math.min(
      measuredMenuHeight > 0 ? measuredMenuHeight : estimatedMenuHeight,
      maxHeight
    );

    let top = openAbove
      ? rect.top - menuHeight - menuGap
      : rect.bottom + menuGap;

    top = Math.max(
      viewportMargin,
      Math.min(top, window.innerHeight - viewportMargin - menuHeight)
    );

    setMenuStyle({
      left,
      top,
      width: desiredWidth,
      maxHeight
    });
  }

  function openMenu(preferredIndex = safeActiveIndex) {
    if (disabled || options.length === 0) return;

    const preferredOption = options[preferredIndex];

    if (preferredOption && !preferredOption.disabled) {
      setActiveIndex(preferredIndex);
    } else {
      const firstEnabled = getFirstEnabledIndex();
      setActiveIndex(firstEnabled >= 0 ? firstEnabled : 0);
    }

    setOpen(true);
    window.requestAnimationFrame(updateMenuPosition);
  }

  function closeMenu() {
    setOpen(false);
  }

  function toggleMenu() {
    if (open) {
      closeMenu();
      return;
    }

    openMenu();
  }

  function chooseOption(index: number) {
    const option = options[index];

    if (!option || option.disabled) return;

    onValueChange(option.value);
    closeMenu();

    window.requestAnimationFrame(() => {
      buttonRef.current?.focus();
    });
  }

  function handleButtonKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();

      if (!open) {
        openMenu(selectedIndex >= 0 ? selectedIndex : getFirstEnabledIndex());
        return;
      }

      const nextIndex = getNextEnabledIndex(activeIndex, 1);
      if (nextIndex >= 0) setActiveIndex(nextIndex);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();

      if (!open) {
        openMenu(selectedIndex >= 0 ? selectedIndex : getLastEnabledIndex());
        return;
      }

      const nextIndex = getNextEnabledIndex(activeIndex, -1);
      if (nextIndex >= 0) setActiveIndex(nextIndex);
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      const firstIndex = getFirstEnabledIndex();

      if (!open) openMenu(firstIndex);
      if (firstIndex >= 0) setActiveIndex(firstIndex);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      const lastIndex = getLastEnabledIndex();

      if (!open) openMenu(lastIndex);
      if (lastIndex >= 0) setActiveIndex(lastIndex);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();

      if (!open) {
        openMenu();
        return;
      }

      chooseOption(activeIndex);
      return;
    }

    if (event.key === "Escape") {
      if (!open) return;

      event.preventDefault();
      closeMenu();
      return;
    }

    if (event.key === "Tab" && open) {
      closeMenu();
      return;
    }

    if (isTypingKey(event)) {
      const query = event.key.toLocaleLowerCase();
      const startIndex = activeIndex >= 0 ? activeIndex : -1;

      for (let step = 1; step <= options.length; step += 1) {
        const index = (startIndex + step) % options.length;
        const option = options[index];

        if (option.disabled) continue;

        const text =
          typeof option.label === "string"
            ? option.label
            : typeof option.label === "number"
              ? String(option.label)
              : option.value;

        if (text.toLocaleLowerCase().startsWith(query)) {
          event.preventDefault();

          if (!open) openMenu(index);
          setActiveIndex(index);
          return;
        }
      }
    }
  }

  useEffect(() => {
    if (!open) {
      setActiveIndex(safeActiveIndex);
    }
  }, [open, safeActiveIndex]);

  useAnchoredPopover({
    open,
    anchorRef: rootRef,
    popoverRef: menuRef,
    onDismiss: closeMenu,
    onReposition: updateMenuPosition
  });

  useEffect(() => {
    if (!open) return;

    updateMenuPosition();
  }, [open]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;

    window.requestAnimationFrame(() => {
      document
        .getElementById(`${listboxId}-option-${activeIndex}`)
        ?.scrollIntoView({ block: "nearest" });
    });
  }, [activeIndex, listboxId, open]);

  const rootClassName = [
    "ui-select-field",
    `ui-select-field-${variant}`,
    `ui-select-field-density-${density}`,
    `ui-select-field-control-${resolvedControlSize}`,
    open ? "ui-select-field-open" : "",
    label ? "" : "ui-select-field-no-label",
    hideLabel ? "ui-select-field-hide-label" : "",
    disabled ? "ui-select-field-disabled" : "",
    ariaInvalid ? "ui-select-field-invalid" : "",
    wrapperClassName,
    className
  ]
    .filter(Boolean)
    .join(" ");

  const menu =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            id={listboxId}
            className={[
              "ui-select-field-menu",
              `ui-select-field-menu-${density}`,
              menuClassName
            ]
              .filter(Boolean)
              .join(" ")}
            style={menuStyle}
            role="listbox"
            aria-label={controlLabel}
            tabIndex={-1}
          >
            {options.map((option, index) => {
              const selected = option.value === selectedValue;
              const active = index === activeIndex;
              const optionId = `${listboxId}-option-${index}`;

              return (
                <div
                  key={`${option.value}-${index}`}
                  id={optionId}
                  className={[
                    "ui-select-field-option",
                    selected ? "ui-select-field-option-selected" : "",
                    active ? "ui-select-field-option-active" : "",
                    option.disabled ? "ui-select-field-option-disabled" : ""
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  role="option"
                  aria-selected={selected}
                  aria-disabled={option.disabled || undefined}
                  onMouseEnter={() => {
                    if (!option.disabled) setActiveIndex(index);
                  }}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => chooseOption(index)}
                >
                  <span
                    className="ui-select-field-option-check"
                    aria-hidden="true"
                  >
                    {selected ? "✓" : ""}
                  </span>
                  <span className="ui-select-field-option-label">
                    {option.label}
                  </span>
                </div>
              );
            })}
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <div
        ref={rootRef}
        id={rootId}
        className={rootClassName}
        data-open={open ? "true" : "false"}
        style={Object.keys(rootStyle).length > 0 ? rootStyle : undefined}
      >
        {label && (
          <span id={labelId} className="ui-select-field-label">
            {label}
          </span>
        )}

        <button
          ref={buttonRef}
          id={buttonId}
          type="button"
          className="ui-select-field-button"
          disabled={disabled}
          title={title}
          autoFocus={autoFocus}
          role="combobox"
          aria-label={ariaLabel || (!label ? controlLabel : undefined)}
          aria-labelledby={!ariaLabel && label ? `${labelId} ${valueId}` : undefined}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-autocomplete="none"
          aria-controls={open ? listboxId : undefined}
          aria-activedescendant={activeOptionId}
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid}
          aria-required={required || undefined}
          onClick={toggleMenu}
          onKeyDown={handleButtonKeyDown}
        >
          <span id={valueId} className="ui-select-field-value">
            {selectedOption?.label ?? t("common.actions.selectPrompt")}
          </span>
        </button>

        {name && !disabled && (
          <input type="hidden" name={name} value={selectedValue} />
        )}
      </div>

      {menu}
    </>
  );
}
