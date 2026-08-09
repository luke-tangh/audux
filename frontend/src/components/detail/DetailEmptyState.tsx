import { MaterialIcon } from "../ui";
import { useTranslation } from "react-i18next";

export default function DetailEmptyState() {
  const { t } = useTranslation();
  return (
    <aside className="inspector-panel empty-inspector">
      <div className="empty-detail-card">
        <div className="empty-detail-icon">
          <MaterialIcon name="music_note" size={38} />
        </div>

        <span className="eyebrow">{t("detail.empty.eyebrow")}</span>

        <h2>{t("detail.empty.title")}</h2>

        <p>
          {t("detail.empty.description")}
        </p>

        <div className="detail-empty-steps">
          <div>
            <strong>1</strong>
            <span>{t("detail.empty.addLibrary")}</span>
          </div>

          <div>
            <strong>2</strong>
            <span>{t("detail.empty.scan")}</span>
          </div>

          <div>
            <strong>3</strong>
            <span>{t("detail.empty.organize")}</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
