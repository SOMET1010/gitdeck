import { useState } from "react";
import { fetchAttentionBrief } from "../../api/github";
import { useI18n } from "../../i18n/I18nProvider";
import type { AttentionBrief, BriefQuestion } from "../../types/attention";
import { EvidenceList } from "../devCockpit/EvidenceList";

const QUESTIONS: { id: BriefQuestion; key: "attention.ask.now" | "attention.ask.week" | "attention.ask.cleanup" }[] = [
  { id: "now", key: "attention.ask.now" },
  { id: "week", key: "attention.ask.week" },
  { id: "cleanup", key: "attention.ask.cleanup" },
];

/** Deterministic "copilot": fixed questions answered from the attention evidence, read-only. */
export function CopilotPanel() {
  const { t } = useI18n();
  const [brief, setBrief] = useState<AttentionBrief | null>(null);
  const [loading, setLoading] = useState<BriefQuestion | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function ask(question: BriefQuestion) {
    setLoading(question);
    setError(null);
    try {
      setBrief(await fetchAttentionBrief(question));
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setLoading(null);
    }
  }

  return (
    <section className="cockpit-panel" aria-labelledby="attention-copilot-title">
      <header className="cockpit-panel-head">
        <h3 id="attention-copilot-title">{t("attention.copilot")}</h3>
      </header>
      <p className="cockpit-rule">{t("attention.copilotHint")}</p>
      <div className="attention-card-actions">
        {QUESTIONS.map(({ id, key }) => (
          <button key={id} className={`btn${brief?.question === id ? " primary" : ""}`} type="button" disabled={loading !== null} onClick={() => void ask(id)}>
            {t(key)}
          </button>
        ))}
      </div>
      {error ? <div className="error">{error}</div> : null}
      {brief ? (
        <div className="attention-brief">
          <p><strong>{brief.summary}</strong></p>
          {brief.items.length ? (
            <ol className="cockpit-actions">
              {brief.items.map((item, index) => (
                <li key={`${item.repository}-${index}`}>
                  <div className="cockpit-item-head">
                    {item.url
                      ? <a className="cockpit-item-title" href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a>
                      : <span className="cockpit-item-title">{item.title}</span>}
                  </div>
                  <div className="cockpit-action-subject">{item.reason}</div>
                  <EvidenceList evidence={item.evidence} />
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
