import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "text" | "filled" | "outlined" | "tonal" | "danger";
export type ButtonSize = "sm" | "md";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  preserveChildren?: boolean;
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "text",
    size = "md",
    fullWidth = false,
    leadingIcon,
    trailingIcon,
    preserveChildren = false,
    className = "",
    children,
    type = "button",
    ...props
  },
  ref
) {
  const classes = [
    "ui-button",
    `ui-button-${variant}`,
    `ui-button-${size}`,
    fullWidth ? "ui-button-full-width" : "",
    className
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button ref={ref} type={type} className={classes} {...props}>
      {preserveChildren ? (
        children
      ) : (
        <>
          {leadingIcon && (
            <span className="ui-button-inline-icon" aria-hidden="true">
              {leadingIcon}
            </span>
          )}

          <span className="ui-button-label">{children}</span>

          {trailingIcon && (
            <span className="ui-button-inline-icon" aria-hidden="true">
              {trailingIcon}
            </span>
          )}
        </>
      )}
    </button>
  );
});

export default Button;
