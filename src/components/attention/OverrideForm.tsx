import { useState, type FormEvent } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { ATTENTION_BUCKETS, type AttentionBucket } from "../../types/attention";
import { BUCKET_KEYS } from "./BucketLabel";

interface OverrideFormProps {
  initialBucket: AttentionBucket;
  busy: boolean;
  onSubmit: (bucket: AttentionBucket, reason: string, days: number) => void;
  onCancel: () => void;
}

export function OverrideForm({ initialBucket, busy, onSubmit, onCancel }: OverrideFormProps) {
  const { t } = useI18n();
  const [bucket, setBucket] = useState<AttentionBucket>(initialBucket);
  const [reason, setReason] = useState("");
  const [days, setDays] = useState(30);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!reason.trim()) return;
    onSubmit(bucket, reason.trim(), days);
  }

  return (
    <form className="attention-override-form" onSubmit={submit}>
      <select className="sort" value={bucket} onChange={(event) => setBucket(event.target.value as AttentionBucket)} aria-label={t("attention.force")}>
        {ATTENTION_BUCKETS.map((value) => <option key={value} value={value}>{t(BUCKET_KEYS[value])}</option>)}
      </select>
      <input
        className="cockpit-input"
        value={reason}
        required
        placeholder={t("attention.reason")}
        aria-label={t("attention.reason")}
        onChange={(event) => setReason(event.target.value)}
      />
      <label>
        {t("attention.days")}
        <input
          className="cockpit-input attention-days"
          type="number"
          min={1}
          max={365}
          value={days}
          onChange={(event) => setDays(Math.min(365, Math.max(1, Number(event.target.value) || 1)))}
        />
      </label>
      <button className="btn primary" type="submit" disabled={busy || !reason.trim()}>{t("attention.save")}</button>
      <button className="btn" type="button" onClick={onCancel}>{t("common.cancel")}</button>
    </form>
  );
}
