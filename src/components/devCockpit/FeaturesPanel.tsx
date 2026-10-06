import { useI18n } from "../../i18n/I18nProvider";
import type { FeaturesBlock } from "../../types/devCockpit";
import { EvidenceList } from "./EvidenceList";
import { StateBadge } from "./StateBadge";

export function FeaturesPanel({ features }: { features: FeaturesBlock }) {
  const { t } = useI18n();
  return (
    <section className="cockpit-panel" aria-labelledby="cockpit-features-title">
      <header className="cockpit-panel-head">
        <h3 id="cockpit-features-title">{t("cockpit.features")}</h3>
        {features.state === "UNKNOWN" ? <StateBadge state="UNKNOWN" label={t("cockpit.state.UNKNOWN")} /> : null}
      </header>
      {features.items.length ? (
        <ul className="cockpit-items">
          {features.items.map((item) => (
            <li key={item.id}>
              <div className="cockpit-item-head">
                <span className="cockpit-item-type">{item.status}</span>
                <span className="cockpit-item-title">{item.title}</span>
              </div>
              <EvidenceList evidence={item.evidence} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="cockpit-muted">{features.reason}</p>
      )}
    </section>
  );
}
