import { useI18n } from "../../i18n/I18nProvider";
import type { HistoryEntry } from "../../types/attention";
import { formatRelativeTime } from "../../utils/format";
import { BUCKET_KEYS } from "./BucketLabel";

export function HistoryList({ entries, showRepository }: { entries: HistoryEntry[]; showRepository: boolean }) {
  const { language, t } = useI18n();
  if (!entries.length) return <p className="cockpit-muted">{t("attention.historyEmpty")}</p>;
  const bucketText = (bucket: HistoryEntry["from"]) => (bucket ? t(BUCKET_KEYS[bucket]) : "—");
  return (
    <ul className="attention-history">
      {entries.map((entry, index) => (
        <li key={`${entry.at}-${entry.repository}-${index}`}>
          <span className="cockpit-evidence-meta">{formatRelativeTime(entry.at, Date.now(), language)} · {new Date(entry.at).toLocaleString(language)}</span>
          {showRepository ? <strong>{entry.repository}</strong> : null}
          <span>
            {entry.type === "override-cleared"
              ? t("attention.history.override-cleared", { from: bucketText(entry.from) })
              : t(`attention.history.${entry.type}`, { from: bucketText(entry.from), to: bucketText(entry.to) })}
          </span>
          {entry.reason ? <span className="cockpit-muted">— {entry.reason}</span> : null}
        </li>
      ))}
    </ul>
  );
}
