import { useI18n } from "../../i18n/I18nProvider";
import type { CockpitItem, Priority, ReadinessCheck, RemainingWorkBlock } from "../../types/devCockpit";
import { EvidenceList } from "./EvidenceList";
import { PriorityBadges } from "./PriorityBadges";
import { StateBadge } from "./StateBadge";

const PRIORITIES: Priority[] = ["P0", "P1", "P2"];

function ItemList({ items }: { items: CockpitItem[] }) {
  const { t } = useI18n();
  if (!items.length) return <p className="cockpit-muted">{t("cockpit.emptyGroup")}</p>;
  return (
    <ul className="cockpit-items">
      {items.map((item) => (
        <li key={item.id}>
          <div className="cockpit-item-head">
            <span className="cockpit-item-type">{item.type}</span>
            {item.status === "BLOCKED" ? <span className="cockpit-item-type blocked">BLOCKED</span> : null}
            {item.githubUrl
              ? <a className="cockpit-item-title" href={item.githubUrl} target="_blank" rel="noopener noreferrer">{item.title}</a>
              : <span className="cockpit-item-title">{item.title}</span>}
            <PriorityBadges priority={item.priority} />
          </div>
          <EvidenceList evidence={item.evidence} />
        </li>
      ))}
    </ul>
  );
}

interface RemainingWorkPanelProps {
  remaining: RemainingWorkBlock;
  p0Issues: ReadinessCheck;
}

export function RemainingWorkPanel({ remaining, p0Issues }: RemainingWorkPanelProps) {
  const { t } = useI18n();
  const suggestedCount = PRIORITIES.reduce((sum, priority) => sum + remaining.bySuggestedPriority[priority].length, 0);
  return (
    <section className="cockpit-panel" aria-labelledby="cockpit-remaining-title">
      <header className="cockpit-panel-head">
        <h3 id="cockpit-remaining-title">{t("cockpit.remaining")}</h3>
      </header>

      <div className="cockpit-criterion">
        <span>{t("cockpit.p0Criterion")}</span>
        <StateBadge state={p0Issues.state} label={t(`cockpit.state.${p0Issues.state}`)} />
        <span className="cockpit-muted">{p0Issues.reason}</span>
      </div>

      <h4 className="cockpit-subhead">{t("cockpit.sourcePriority")}</h4>
      {remaining.state === "UNKNOWN" ? (
        <p className="cockpit-muted"><StateBadge state="UNKNOWN" label={t("cockpit.state.UNKNOWN")} /> {remaining.reason}</p>
      ) : (
        <>
          {PRIORITIES.map((priority) => (
            <div className="cockpit-priority-group" key={priority}>
              <h5>{priority} <span className="cockpit-count">{remaining.bySourcePriority[priority].length}</span></h5>
              <ItemList items={remaining.bySourcePriority[priority]} />
            </div>
          ))}
          <div className="cockpit-priority-group">
            <h5>{t("cockpit.noPriority")} <span className="cockpit-count">{remaining.bySourcePriority.none.length}</span></h5>
            <ItemList items={remaining.bySourcePriority.none} />
          </div>
        </>
      )}

      <h4 className="cockpit-subhead">{t("cockpit.suggestedPriority")}</h4>
      {suggestedCount ? (
        PRIORITIES.filter((priority) => remaining.bySuggestedPriority[priority].length).map((priority) => (
          <div className="cockpit-priority-group" key={priority}>
            <h5>{priority} <span className="cockpit-count">{remaining.bySuggestedPriority[priority].length}</span></h5>
            <ItemList items={remaining.bySuggestedPriority[priority]} />
          </div>
        ))
      ) : (
        <p className="cockpit-muted">{t("cockpit.emptyGroup")}</p>
      )}
    </section>
  );
}
