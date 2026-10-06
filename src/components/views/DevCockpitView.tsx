import { useEffect, useState, type FormEvent } from "react";
import { fetchDevCockpit } from "../../api/github";
import { useI18n } from "../../i18n/I18nProvider";
import type { DevCockpitData } from "../../types/devCockpit";
import { parseRepositoryInput, shortSha } from "../../utils/devCockpit/display";
import { formatNumber, formatRelativeTime } from "../../utils/format";
import { FeaturesPanel } from "../devCockpit/FeaturesPanel";
import { NextActionsPanel } from "../devCockpit/NextActionsPanel";
import { QualityPanel } from "../devCockpit/QualityPanel";
import { ReadinessPanel } from "../devCockpit/ReadinessPanel";
import { RemainingWorkPanel } from "../devCockpit/RemainingWorkPanel";

interface DevCockpitViewProps {
  repository: string | null;
  branch: string | null;
  knownRepos: string[];
  onTargetChange: (repository: string, branch: string | null) => void;
}

export function DevCockpitView({ repository, branch, knownRepos, onTargetChange }: DevCockpitViewProps) {
  const { language, t } = useI18n();
  const [repoInput, setRepoInput] = useState(repository ?? "");
  const [branchInput, setBranchInput] = useState(branch ?? "");
  const [inputError, setInputError] = useState<string | null>(null);
  const [data, setData] = useState<DevCockpitData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    setRepoInput(repository ?? "");
    setBranchInput(branch ?? "");
  }, [repository, branch]);

  useEffect(() => {
    if (!repository) {
      setData(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchDevCockpit(repository, branch, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setData(null);
        setError((reason as Error).message || String(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [repository, branch, reloadToken]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = parseRepositoryInput(repoInput);
    if (!parsed) {
      setInputError(t("cockpit.invalidRepository"));
      return;
    }
    setInputError(null);
    const nextBranch = branchInput.trim() || null;
    if (parsed === repository && nextBranch === branch) setReloadToken((value) => value + 1);
    else onTargetChange(parsed, nextBranch);
  }

  const counts = data?.quality.testReport.counts ?? null;

  return (
    <div className="view-cockpit" style={{ display: "block" }}>
      <form className="toolbar cockpit-toolbar" onSubmit={submit}>
        <label htmlFor="cockpit-repo">{t("cockpit.repository")}</label>
        <input
          id="cockpit-repo"
          className="cockpit-input"
          list="cockpit-known-repos"
          value={repoInput}
          placeholder={t("cockpit.repositoryPlaceholder")}
          onChange={(event) => setRepoInput(event.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <datalist id="cockpit-known-repos">
          {knownRepos.map((name) => <option value={name} key={name} />)}
        </datalist>
        <label htmlFor="cockpit-branch">{t("cockpit.branch")}</label>
        <input
          id="cockpit-branch"
          className="cockpit-input cockpit-input-branch"
          value={branchInput}
          placeholder={t("cockpit.branchPlaceholder")}
          onChange={(event) => setBranchInput(event.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <button className="btn primary" type="submit" disabled={loading}>
          {loading ? t("common.loadingEllipsis") : t("cockpit.evaluate")}
        </button>
        {inputError ? <span className="cockpit-input-error" role="alert">{inputError}</span> : null}
      </form>

      {error ? <div className="error">{error}</div> : null}

      {!repository ? (
        <div className="empty">
          <div className="big">{t("cockpit.emptyTitle")}</div>
          <div>{t("cockpit.emptyText")}</div>
        </div>
      ) : null}

      {data ? (
        <>
          <section className="stats">
            <div className="stat">
              <div className="k">{t("cockpit.readiness")}</div>
              <div className={`v cockpit-verdict ${data.readiness.verdict}`}>{data.readiness.verdict}</div>
              <div className="sub">{data.repository}</div>
            </div>
            <div className="stat">
              <div className="k">{t("cockpit.headCommit")}</div>
              <div className="v">
                {data.headCommit
                  ? <a href={data.headCommit.url} target="_blank" rel="noopener noreferrer">{shortSha(data.headCommit.sha)}</a>
                  : "—"}
              </div>
              <div className="sub">{data.headCommit ? `${data.headCommit.branch} · ${data.headCommit.message}` : t("cockpit.headCommitUnknown")}</div>
            </div>
            <div className="stat">
              <div className="k">{t("cockpit.testCounts")}</div>
              <div className="v">{counts ? `${formatNumber(counts.passed)} / ${formatNumber(counts.total)}` : "—"}</div>
              <div className="sub">
                {counts
                  ? t("cockpit.testCountsValue", { passed: formatNumber(counts.passed), total: formatNumber(counts.total) })
                  : t("cockpit.testCountsUnavailable")}
              </div>
            </div>
            <div className="stat">
              <div className="k">{t("cockpit.observedAt")}</div>
              <div className="v">{formatRelativeTime(data.observedAt, Date.now(), language)}</div>
              <div className="sub">{new Date(data.observedAt).toLocaleString(language)}</div>
            </div>
          </section>

          <div className="cockpit-grid">
            <ReadinessPanel readiness={data.readiness} />
            <NextActionsPanel actions={data.nextActions} />
            <QualityPanel quality={data.quality} />
            <RemainingWorkPanel remaining={data.remaining} p0Issues={data.p0Issues} />
          </div>

          <FeaturesPanel features={data.features} />

          {data.errors.length ? (
            <section className="cockpit-panel">
              <header className="cockpit-panel-head"><h3>{t("cockpit.errors")}</h3></header>
              <ul className="cockpit-errors">
                {data.errors.map((item, index) => <li key={`${item.block}-${index}`}><strong>{item.block}</strong> — {item.reason}</li>)}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
