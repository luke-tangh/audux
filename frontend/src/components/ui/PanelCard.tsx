import { useId } from "react";
import type { ReactNode } from "react";

type PanelCardProps = {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

export default function PanelCard({
  title,
  actions,
  children,
  className = ""
}: PanelCardProps) {
  const titleId = useId();

  return (
    <section
      className={["ui-panel-card", className].filter(Boolean).join(" ")}
      aria-labelledby={title ? titleId : undefined}
    >
      {(title || actions) && (
        <div className="ui-panel-card-header">
          {title && <h3 id={titleId}>{title}</h3>}
          {actions && <div className="ui-panel-card-actions">{actions}</div>}
        </div>
      )}

      {children}
    </section>
  );
}
