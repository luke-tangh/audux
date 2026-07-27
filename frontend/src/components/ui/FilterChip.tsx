import type { InputHTMLAttributes, ReactNode } from "react";

type FilterChipProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "children" | "checked" | "onChange" | "type"
> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children: ReactNode;
};

export default function FilterChip({
  checked,
  onCheckedChange,
  children,
  className = "",
  disabled,
  ...inputProps
}: FilterChipProps) {
  return (
    <label
      className={[
        "ui-filter-chip",
        checked ? "ui-filter-chip-selected" : "",
        disabled ? "ui-filter-chip-disabled" : "",
        className
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <input
        {...inputProps}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onCheckedChange(event.currentTarget.checked)}
      />
      <span>{children}</span>
    </label>
  );
}
