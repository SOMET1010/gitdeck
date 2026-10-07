import { useI18n } from "../../i18n/I18nProvider";
import type { TranslationKey } from "../../i18n/translations";
import type { AttentionBucket } from "../../types/attention";

export const BUCKET_KEYS = {
  NOW: "attention.bucket.NOW",
  URGENT: "attention.bucket.URGENT",
  BLOCKED: "attention.bucket.BLOCKED",
  ALMOST_DONE: "attention.bucket.ALMOST_DONE",
  CAN_WAIT: "attention.bucket.CAN_WAIT",
  INACTIVE: "attention.bucket.INACTIVE",
  ARCHIVE_CANDIDATE: "attention.bucket.ARCHIVE_CANDIDATE",
  UNKNOWN: "attention.bucket.UNKNOWN",
} as const satisfies Record<AttentionBucket, TranslationKey>;

export function BucketLabel({ bucket }: { bucket: AttentionBucket }) {
  const { t } = useI18n();
  return <span className={`attention-bucket-pill ${bucket}`}>{t(BUCKET_KEYS[bucket])}</span>;
}
