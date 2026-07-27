import { useId } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import FieldGroup from "./FieldGroup";

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "children"> & {
  label?: ReactNode;
  helperText?: ReactNode;
  errorText?: ReactNode;
  hideLabel?: boolean;
  wide?: boolean;
  wrapperClassName?: string;
  onValueChange?: (value: string) => void;
};

export default function TextField({
  label,
  helperText,
  errorText,
  hideLabel = false,
  wide = false,
  wrapperClassName = "",
  className = "",
  id,
  disabled,
  onChange,
  onValueChange,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  ...inputProps
}: TextFieldProps) {
  const generatedId = useId();
  const fieldId = id || `${generatedId}-text-field`;
  const helperId = `${fieldId}-helper`;
  const errorId = `${fieldId}-error`;

  const describedBy = [
    ariaDescribedBy,
    errorText ? errorId : helperText ? helperId : undefined
  ]
    .filter(Boolean)
    .join(" ") || undefined;

  return (
    <FieldGroup
      className={wrapperClassName}
      label={label}
      htmlFor={fieldId}
      helperText={
        helperText && !errorText ? <span id={helperId}>{helperText}</span> : undefined
      }
      errorText={errorText ? <span id={errorId}>{errorText}</span> : undefined}
      hideLabel={hideLabel}
      wide={wide}
      disabled={disabled}
    >
      <input
        {...inputProps}
        id={fieldId}
        disabled={disabled}
        className={["ui-text-field", className].filter(Boolean).join(" ")}
        aria-describedby={describedBy}
        aria-invalid={ariaInvalid || Boolean(errorText) || undefined}
        onChange={(event) => {
          onChange?.(event);
          onValueChange?.(event.currentTarget.value);
        }}
      />
    </FieldGroup>
  );
}
