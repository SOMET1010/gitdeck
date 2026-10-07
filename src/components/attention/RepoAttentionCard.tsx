import { useState } from "react";
import { Link } from "react-router-dom";
import { fetchAttentionHistory } from "../../api/github";
import { useI18n } from "../../i18n/I18nProvider";
import type { AttentionBucket, HistoryEntry, RepoAttention } from "../../types/attention";
import { formatRelativeTime } from "../../utils/format";
import { EvidenceList } from "../devCockpit/EvidenceList";
import { BucketLabel } from "./BucketLabel";
import { HistoryList } from "./HistoryList";
import { OverrideForm } from "./OverrideForm";

interface RepoAttentionCardProps {
  repo: RepoAttention;
  watched: boolean;
  busy: boolean;
  onOverride: (repo: string, bucket: AttentionBucket, reason: string, days: number) => Promise<void>;
  onClearOverride: (repo: string) => Promise<void>;
  onWatch: (repo: string, watched: boolean) => Promise<void>;
}

export function RepoAttentionCard({ repo, watched, busy, onOverride, onClearOverride, onWatch }: RepoAttentionCardProps) {
  const { language, t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);

  async function toggleHistory() {
    if (history) {
      setHistory(null);
      return;
    }
    try {
      setHistory((await fetchAttentionHistory(repo.repository)).history);
    } catch {
      setHistory([]);
    }
  }

  return (
    <li className="attention-card" data-repo={repo.repository}>
      <div className="cockpit-item-head">
        <a className="cockpit-item-title" href={repo.url} target="_blank" rel="noopener noreferrer">{repo.repository}</a>
        {repo.override ? (
          <>
            <span className="cockpit-muted">{t("attention.computed")}</span>
            <BucketLabel bucket={repo.computed.bucket} />
            <span className="cockpit-muted">{t("attention.forced")}</span>
            <BucketLabel bucket={repo.override.bucket} />
          </>
        ) : null}
        {repo.evaluated === "light" ? <span className="cockpit-item-type">{t("attention.lightOnly")}</span> : null}
        {repo.pushedAt ? <span className="cockpit-evidence-meta">push {formatRelativeTime(repo.pushedAt, Date.now(), language)}</span> : null}
      </div>
      {repo.override ? (
        <div className="attention-forced-note">
          {t("attention.forcedUntil", { date: new Date(repo.override.expiresAt).toLocaleDateString(language), reason: repo.override.reason })}
        </div>
      ) : null}
      <ul className="attention-reasons">
        {repo.computed.reasons.map((reason, index) => (
          <li key={`${reason.code}-${index}`}>
            <div>{reason.message}</div>
            <EvidenceList evidence={reason.evidence} />
          </li>
        ))}
      </ul>
      <div className="attention-card-actions">
        <Link className="btn" to={`/cockpit?repository=${encodeURIComponent(repo.repository)}`}>{t("attention.openCockpit")}</Link>
        {repo.override
          ? <button className="btn" type="button" disabled={busy} onClick={() => void onClearOverride(repo.repository)}>{t("attention.clearForce")}</button>
          : <button className="btn" type="button" disabled={busy} onClick={() => setEditing((value) => !value)}>{t("attention.force")}</button>}
        <button className="btn" type="button" disabled={busy} onClick={() => void onWatch(repo.repository, !watched)}>
          {watched ? t("attention.unwatch") : t("attention.watch")}
        </button>
        <button className="btn" type="button" onClick={() => void toggleHistory()}>{t("attention.history")}</button>
      </div>
      {editing ? (
        <OverrideForm
          initialBucket={repo.computed.bucket}
          busy={busy}
          onCancel={() => setEditing(false)}
          onSubmit={(bucket, reason, days) => void onOverride(repo.repository, bucket, reason, days).then(() => setEditing(false))}
        />
      ) : null}
      {history ? <HistoryList entries={history} showRepository={false} /> : null}
    </li>
  );
}
