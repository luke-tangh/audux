import { useId } from "react";
import type { ReactNode, TextareaHTMLAttributes } from "react";
import FieldGroup from "./FieldGroup";

type TextareaFieldProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "children"> & {
  label?: ReactNode;
  helperText?: ReactNode;
  errorText?: ReactNode;
  hideLabel?: boolean;
  wide?: boolean;
  wrapperClassName?: string;
  onValueChange?: (value: string) => void;
};

export default function TextareaField({
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
  ...textareaProps
}: TextareaFieldProps) {
  const generatedId = useId();
  const fieldId = id || `${generatedId}-textarea-field`;
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
      <textarea
        {...textareaProps}
        id={fieldId}
        disabled={disabled}
        className={["ui-textarea-field", className].filter(Boolean).join(" ")}
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
