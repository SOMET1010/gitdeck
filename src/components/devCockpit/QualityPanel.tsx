import { useI18n } from "../../i18n/I18nProvider";
import type { TranslationKey } from "../../i18n/translations";
import type { DevCockpitData, QualityCheckId } from "../../types/devCockpit";
import { formatNumber } from "../../utils/format";
import { EvidenceList } from "./EvidenceList";
import { StateBadge } from "./StateBadge";

const CHECKS: { id: QualityCheckId; labelKey: TranslationKey }[] = [
  { id: "ci", labelKey: "cockpit.check.ci" },
  { id: "tests", labelKey: "cockpit.check.tests" },
  { id: "typecheck", labelKey: "cockpit.check.typecheck" },
  { id: "build", labelKey: "cockpit.check.build" },
];

const STATE_KEYS = {
  PASS: "cockpit.state.PASS",
  FAIL: "cockpit.state.FAIL",
  UNKNOWN: "cockpit.state.UNKNOWN",
} as const satisfies Record<"PASS" | "FAIL" | "UNKNOWN", TranslationKey>;

export function QualityPanel({ quality }: { quality: DevCockpitData["quality"] }) {
  const { t } = useI18n();
  const { testReport } = quality;
  const counts = testReport.counts;
  return (
    <section className="cockpit-panel" aria-labelledby="cockpit-quality-title">
      <header className="cockpit-panel-head">
        <h3 id="cockpit-quality-title">{t("cockpit.quality")}</h3>
      </header>
      <div className="cockpit-checks" role="table">
        {CHECKS.map(({ id, labelKey }) => {
          const check = quality[id];
          return (
            <div className="cockpit-check" role="row" key={id} data-check={id}>
              <div className="cockpit-check-name" role="cell">{t(labelKey)}</div>
              <div role="cell"><StateBadge state={check.state} label={t(STATE_KEYS[check.state])} /></div>
              <div className="cockpit-check-detail" role="cell">
                <div>{check.reason}</div>
                <EvidenceList evidence={check.evidence} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="cockpit-counts">
        {counts ? (
          (["passed", "failed", "skipped", "todo"] as const).map((key) => (
            <div className={`cockpit-count-cell ${key}`} key={key}>
              <span className="k">{t(`cockpit.counts.${key}`)}</span>
              <span className="v">{formatNumber(counts[key])}</span>
            </div>
          ))
        ) : (
          <p className="cockpit-muted">{t("cockpit.testCountsUnavailable")} — {testReport.reason}</p>
        )}
      </div>
      {counts ? <EvidenceList evidence={testReport.evidence} /> : null}
    </section>
  );
}
