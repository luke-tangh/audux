import { useId } from "react";
import type { ReactNode } from "react";

type PanelCardProps = {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  headerClassName?: string;
};

export default function PanelCard({
  title,
  actions,
  children,
  className = "",
  headerClassName = ""
}: PanelCardProps) {
  const titleId = useId();
  const hasHeader = Boolean(title || actions);

  return (
    <section
      className={[
        "ui-panel-card",
        hasHeader ? "ui-panel-card-with-header" : "",
        className
      ]
        .filter(Boolean)
        .join(" ")}
      aria-labelledby={title ? titleId : undefined}
    >
      {hasHeader && (
        <div
          className={["ui-panel-card-header", headerClassName]
            .filter(Boolean)
            .join(" ")}
        >
          {title && <h3 id={titleId}>{title}</h3>}
          {actions && <div className="ui-panel-card-actions">{actions}</div>}
        </div>
      )}

      {children}
    </section>
  );
}
