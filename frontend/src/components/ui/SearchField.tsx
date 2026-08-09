import type { InputHTMLAttributes, ReactNode } from "react";
import IconButton from "./IconButton";
import MaterialIcon from "./MaterialIcon";
import { useTranslation } from "react-i18next";

type SearchFieldProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "children" | "onChange" | "type" | "value"
> & {
  value: string;
  onValueChange: (value: string) => void;
  onClear?: () => void;
  clearLabel?: string;
  icon?: ReactNode;
  wrapperClassName?: string;
};

export default function SearchField({
  value,
  onValueChange,
  onClear,
  clearLabel,
  icon,
  wrapperClassName = "",
  className = "",
  ...inputProps
}: SearchFieldProps) {
  const { t } = useTranslation();
  const resolvedClearLabel = clearLabel || t("common.actions.clearSearch");
  function clear() {
    if (onClear) {
      onClear();
      return;
    }

    onValueChange("");
  }

  return (
    <div
      className={["ui-search-field", wrapperClassName].filter(Boolean).join(" ")}
      role="search"
    >
      <span className="ui-search-field-icon" aria-hidden="true">
        {icon || <MaterialIcon name="search" size={20} />}
      </span>

      <input
        {...inputProps}
        type="search"
        value={value}
        className={["ui-search-field-input", className].filter(Boolean).join(" ")}
        onChange={(event) => onValueChange(event.currentTarget.value)}
      />

      {value.trim() && (
        <IconButton
          className="ui-search-field-clear"
          label={resolvedClearLabel}
          onClick={clear}
        >
          <MaterialIcon name="close" size={18} />
        </IconButton>
      )}
    </div>
  );
}
