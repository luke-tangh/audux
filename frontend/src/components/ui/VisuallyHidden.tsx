import type { HTMLAttributes, ReactNode } from "react";

type VisuallyHiddenProps = HTMLAttributes<HTMLSpanElement> & {
  children: ReactNode;
};

export default function VisuallyHidden({
  children,
  className = "",
  ...props
}: VisuallyHiddenProps) {
  return (
    <span className={["sr-only", className].filter(Boolean).join(" ")} {...props}>
      {children}
    </span>
  );
}
