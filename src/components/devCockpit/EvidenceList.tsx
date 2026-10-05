import { useI18n } from "../../i18n/I18nProvider";
import type { Evidence } from "../../types/devCockpit";
import { formatRelativeTime } from "../../utils/format";

interface EvidenceListProps {
  evidence: Evidence[];
}

export function EvidenceList({ evidence }: EvidenceListProps) {
  const { language, t } = useI18n();
  if (!evidence.length) return null;
  const confidenceLabel = {
    high: t("cockpit.confidence.high"),
    medium: t("cockpit.confidence.medium"),
    low: t("cockpit.confidence.low"),
  };
  return (
    <ul className="cockpit-evidence">
      {evidence.map((item, index) => (
        <li key={`${item.kind}-${item.source}-${index}`}>
          {item.url ? (
            <a href={item.url} target="_blank" rel="noopener noreferrer">{item.source}</a>
          ) : (
            <span>{item.source}</span>
          )}
          <span className="cockpit-evidence-summary">{item.summary}</span>
          <span className="cockpit-evidence-meta">
            {t("cockpit.evidenceMeta", { level: item.level, confidence: confidenceLabel[item.confidence] })}
            {" · "}
            {formatRelativeTime(item.observedAt, Date.now(), language)}
          </span>
        </li>
      ))}
    </ul>
  );
}
