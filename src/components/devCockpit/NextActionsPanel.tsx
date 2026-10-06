import { useI18n } from "../../i18n/I18nProvider";
import type { TranslationKey } from "../../i18n/translations";
import type { NextAction, NextActionKind } from "../../types/devCockpit";
import { EvidenceList } from "./EvidenceList";
import { PriorityBadges } from "./PriorityBadges";

const ACTION_KEYS = {
  "fix-check": "cockpit.action.fix-check",
  "fix-failing-tests": "cockpit.action.fix-failing-tests",
  "resolve-issue": "cockpit.action.resolve-issue",
  "unblock-issue": "cockpit.action.unblock-issue",
  "provide-proof": "cockpit.action.provide-proof",
} as const satisfies Record<NextActionKind, TranslationKey>;

export function NextActionsPanel({ actions }: { actions: NextAction[] }) {
  const { t } = useI18n();
  return (
    <section className="cockpit-panel" aria-labelledby="cockpit-actions-title">
      <header className="cockpit-panel-head">
        <h3 id="cockpit-actions-title">{t("cockpit.nextActions")}</h3>
        <span className="cockpit-count">{actions.length} / 5</span>
      </header>
      {actions.length ? (
        <ol className="cockpit-actions">
          {actions.map((action) => (
            <li key={action.id}>
              <div className="cockpit-item-head">
                {action.url
                  ? <a className="cockpit-item-title" href={action.url} target="_blank" rel="noopener noreferrer">{t(ACTION_KEYS[action.kind], { target: action.target })}</a>
                  : <span className="cockpit-item-title">{t(ACTION_KEYS[action.kind], { target: action.target })}</span>}
                <PriorityBadges priority={action.priority} />
              </div>
              <div className="cockpit-action-subject">{action.subject}</div>
              <EvidenceList evidence={action.evidence} />
            </li>
          ))}
        </ol>
      ) : (
        <p className="cockpit-muted">{t("cockpit.noActions")}</p>
      )}
    </section>
  );
}
