import { useI18n } from "../../i18n/I18nProvider";
import type { Priority } from "../../types/devCockpit";

interface PriorityBadgesProps {
  priority: { source: Priority | null; suggested: Priority | null };
}

/** Source and suggested priorities are always shown as two distinct badges, never merged. */
export function PriorityBadges({ priority }: PriorityBadgesProps) {
  const { t } = useI18n();
  return (
    <>
      {priority.source ? <span className={`cockpit-priority source ${priority.source}`}>{t("cockpit.priority.source", { priority: priority.source })}</span> : null}
      {priority.suggested ? <span className={`cockpit-priority suggested ${priority.suggested}`}>{t("cockpit.priority.suggested", { priority: priority.suggested })}</span> : null}
    </>
  );
}
