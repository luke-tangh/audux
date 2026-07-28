import { Button } from "../ui";

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
  const hasAiDescription = Boolean(description);

  return (
    <div className="inspector-section-stack">
      <section className="panel-card ai-card">
        <div className="card-heading-row">
          <h3>AI 建议描述</h3>
          <Button variant="text" onClick={onAnalyze}>
            重新分析
          </Button>
        </div>

        {hasAiDescription ? (
          <>
            <p>{description}</p>
            <Button variant="filled" onClick={onAcceptDescription}>
              接受为用户描述
            </Button>
          </>
        ) : (
          <div className="soft-empty">
            暂无 AI 建议。点击「AI 分析」后，会根据 metadata 和 transcript 生成描述。
          </div>
        )}
      </section>

      <section className="panel-card">
        <div className="card-heading-row">
          <h3>AI 标签建议</h3>
          {aiTags.length > 0 && (
            <Button variant="text" onClick={onAcceptAllTags}>
              接受全部未添加标签
            </Button>
          )}
        </div>

        {aiTags.length === 0 && <div className="soft-empty">暂无 AI 标签建议</div>}

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
                    <em>已接受</em>
                  ) : (
                    <Button
                      preserveChildren
                      className="tag-text-action"
                      size="sm"
                      variant="text"
                      onClick={() => onAcceptTag(tagName)}
                    >
                      接受
                    </Button>
                  )}
                </span>
              );
            })}
          </div>
        )}
      </section>

      {rawContent && (
        <section className="panel-card">
          <details>
            <summary>查看原始 AI 输出</summary>
            <pre className="raw-ai-output">{rawContent}</pre>
          </details>
        </section>
      )}
    </div>
  );
}
