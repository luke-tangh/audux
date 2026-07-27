import { useId } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";

type CheckboxFieldProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "children" | "type"
> & {
  label: ReactNode;
  description?: ReactNode;
  wrapperClassName?: string;
  wide?: boolean;
  onCheckedChange?: (checked: boolean) => void;
};

export default function CheckboxField({
  label,
  description,
  wrapperClassName = "",
  wide = false,
  className = "",
  id,
  disabled,
  onChange,
  onCheckedChange,
  ...inputProps
}: CheckboxFieldProps) {
  const generatedId = useId();
  const fieldId = id || `${generatedId}-checkbox-field`;
  const descriptionId = description ? `${fieldId}-description` : undefined;

  return (
    <label
      className={[
        "ui-checkbox-field",
        disabled ? "ui-checkbox-field-disabled" : "",
        wide ? "ui-checkbox-field-wide" : "",
        wrapperClassName
      ]
        .filter(Boolean)
        .join(" ")}
      htmlFor={fieldId}
    >
      <input
        {...inputProps}
        id={fieldId}
        type="checkbox"
        disabled={disabled}
        className={["ui-checkbox-field-input", className].filter(Boolean).join(" ")}
        aria-describedby={descriptionId}
        onChange={(event) => {
          onChange?.(event);
          onCheckedChange?.(event.currentTarget.checked);
        }}
      />

      <span className="ui-checkbox-field-copy">
        <span className="ui-checkbox-field-label">{label}</span>
        {description && (
          <span id={descriptionId} className="ui-checkbox-field-description">
            {description}
          </span>
        )}
      </span>
    </label>
  );
}
