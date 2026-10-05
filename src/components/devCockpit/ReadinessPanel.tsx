import { useI18n } from "../../i18n/I18nProvider";
import type { TranslationKey } from "../../i18n/translations";
import type { ReadinessFinding, ReleaseReadiness } from "../../types/devCockpit";
import { EvidenceList } from "./EvidenceList";
import { StateBadge } from "./StateBadge";

const VERDICT_KEYS = {
  READY: "cockpit.verdict.READY",
  NOT_READY: "cockpit.verdict.NOT_READY",
  UNKNOWN: "cockpit.verdict.UNKNOWN",
} as const satisfies Record<ReleaseReadiness["verdict"], TranslationKey>;

function FindingGroup({ title, tone, findings }: { title: string; tone: string; findings: ReadinessFinding[] }) {
  if (!findings.length) return null;
  return (
    <div className={`cockpit-findings ${tone}`}>
      <h4>{title} <span className="cockpit-count">{findings.length}</span></h4>
      <ul>
        {findings.map((finding) => (
          <li key={finding.code}>
            <div className="cockpit-finding-message">{finding.message}</div>
            <EvidenceList evidence={finding.evidence} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ReadinessPanel({ readiness }: { readiness: ReleaseReadiness }) {
  const { t } = useI18n();
  const empty = !readiness.blockers.length && !readiness.unknowns.length && !readiness.warnings.length;
  return (
    <section className="cockpit-panel" aria-labelledby="cockpit-readiness-title">
      <header className="cockpit-panel-head">
        <h3 id="cockpit-readiness-title">{t("cockpit.readiness")}</h3>
        <StateBadge state={readiness.verdict} label={`${readiness.verdict} · ${t(VERDICT_KEYS[readiness.verdict])}`} />
      </header>
      <p className="cockpit-rule">{t("cockpit.readinessRule")}</p>
      <FindingGroup title={t("cockpit.blockers")} tone="failure" findings={readiness.blockers} />
      <FindingGroup title={t("cockpit.unknowns")} tone="cancelled" findings={readiness.unknowns} />
      <FindingGroup title={t("cockpit.warnings")} tone="warning" findings={readiness.warnings} />
      {empty ? <p className="cockpit-muted">{t("cockpit.noFindings")}</p> : null}
      {readiness.verdict === "READY" ? <EvidenceList evidence={readiness.evidence} /> : null}
    </section>
  );
}
