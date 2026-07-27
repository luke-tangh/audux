import type { ReactNode } from "react";

type FieldGroupProps = {
  label?: ReactNode;
  htmlFor?: string;
  helperText?: ReactNode;
  errorText?: ReactNode;
  children: ReactNode;
  className?: string;
  hideLabel?: boolean;
  wide?: boolean;
  disabled?: boolean;
};

export default function FieldGroup({
  label,
  htmlFor,
  helperText,
  errorText,
  children,
  className = "",
  hideLabel = false,
  wide = false,
  disabled = false
}: FieldGroupProps) {
  return (
    <div
      className={[
        "ui-field-group",
        wide ? "ui-field-group-wide" : "",
        hideLabel ? "ui-field-group-hide-label" : "",
        disabled ? "ui-field-group-disabled" : "",
        className
      ]
        .filter(Boolean)
        .join(" ")}
      aria-disabled={disabled || undefined}
    >
      {label && (
        <label className="ui-field-label" htmlFor={htmlFor}>
          {label}
        </label>
      )}

      {children}

      {errorText ? (
        <div className="ui-field-error" role="alert">
          {errorText}
        </div>
      ) : helperText ? (
        <div className="ui-field-helper">{helperText}</div>
      ) : null}
    </div>
  );
}
