import { Button, PanelCard } from "../ui";
import { useTranslation } from "react-i18next";

type AiTabProps = {
  description?: string;
  aiTags: string[];
  acceptedTagNames: Set<string>;
  rawContent?: string;
  onAnalyze: () => void;
  onAcceptDescription: () => void;
  onAcceptTag: (tagName: string) => void;
  onAcceptAllTags: () => void;
};

export default function AiTab({
  description,
  aiTags,
  acceptedTagNames,
  rawContent,
  onAnalyze,
  onAcceptDescription,
  onAcceptTag,
  onAcceptAllTags
}: AiTabProps) {
  const { t } = useTranslation();
  const hasAiDescription = Boolean(description);

  return (
    <div className="inspector-section-stack">
      <PanelCard
        className="ai-card"
        title={t("detail.ai.description")}
        actions={
          <Button variant="text" onClick={onAnalyze}>
            {t("detail.ai.reanalyze")}
          </Button>
        }
      >
        {hasAiDescription ? (
          <>
            <p>{description}</p>
            <Button variant="filled" onClick={onAcceptDescription}>
              {t("detail.ai.acceptDescription")}
            </Button>
          </>
        ) : (
          <div className="soft-empty">
            {t("detail.ai.emptyDescription")}
          </div>
        )}
      </PanelCard>

      <PanelCard
        title={t("detail.ai.tags")}
        actions={
          aiTags.length > 0 ? (
            <Button variant="text" onClick={onAcceptAllTags}>
              {t("detail.ai.acceptAll")}
            </Button>
          ) : null
        }
      >
        {aiTags.length === 0 && <div className="soft-empty">{t("detail.ai.emptyTags")}</div>}

        {aiTags.length > 0 && (
          <div className="tag-list">
            {aiTags.map((tagName) => {
              const accepted = acceptedTagNames.has(tagName);

              return (
                <span
                  className={accepted ? "tag accepted" : "tag suggestion"}
                  key={tagName}
                >
                  #{tagName}
                  {accepted ? (
                    <em>{t("detail.ai.accepted")}</em>
                  ) : (
                    <Button
                      preserveChildren
                      className="tag-text-action"
                      size="sm"
                      variant="text"
                      onClick={() => onAcceptTag(tagName)}
                    >
                      {t("detail.ai.accept")}
                    </Button>
                  )}
                </span>
              );
            })}
          </div>
        )}
      </PanelCard>

      {rawContent && (
        <PanelCard>
          <details>
            <summary>{t("detail.ai.raw")}</summary>
            <pre className="raw-ai-output">{rawContent}</pre>
          </details>
        </PanelCard>
      )}
    </div>
  );
}
