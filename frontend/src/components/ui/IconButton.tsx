import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type IconButtonVariant = "plain" | "soft" | "danger";
export type IconButtonSize = "sm" | "md" | "lg";

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & {
  label: string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  children: ReactNode;
};

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    label,
    variant = "plain",
    size = "md",
    children,
    className = "",
    type = "button",
    title,
    ...props
  },
  ref
) {
  const classes = [
    "ui-icon-button",
    `ui-icon-button-${variant}`,
    `ui-icon-button-${size}`,
    className
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      aria-label={label}
      title={title || label}
      {...props}
    >
      <span aria-hidden="true">{children}</span>
    </button>
  );
});

export default IconButton;
