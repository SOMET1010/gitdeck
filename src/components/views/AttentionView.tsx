import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  clearAttentionOverride,
  fetchAttention,
  fetchAttentionHistory,
  setAttentionOverride,
  setAttentionWatched,
} from "../../api/github";
import { useI18n } from "../../i18n/I18nProvider";
import { ATTENTION_BUCKETS, type AttentionBucket, type AttentionData, type HistoryEntry } from "../../types/attention";
import { parseRepositoryInput } from "../../utils/devCockpit/display";
import { formatNumber, formatRelativeTime } from "../../utils/format";
import { BUCKET_KEYS, BucketLabel } from "../attention/BucketLabel";
import { CopilotPanel } from "../attention/CopilotPanel";
import { HistoryList } from "../attention/HistoryList";
import { RepoAttentionCard } from "../attention/RepoAttentionCard";

export function AttentionView() {
  const { language, t } = useI18n();
  const [data, setData] = useState<AttentionData | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [watchInput, setWatchInput] = useState("");
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);

  const load = useCallback(async (fresh: boolean) => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchAttention(fresh));
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  async function mutate(action: () => Promise<unknown>, fresh = false) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load(fresh);
      if (history) setHistory((await fetchAttentionHistory()).history);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function addWatch(event: FormEvent) {
    event.preventDefault();
    const repo = parseRepositoryInput(watchInput);
    if (!repo) {
      setError(t("cockpit.invalidRepository"));
      return;
    }
    setWatchInput("");
    void mutate(() => setAttentionWatched(repo, true), true);
  }

  async function toggleHistory() {
    if (history) setHistory(null);
    else setHistory((await fetchAttentionHistory()).history);
  }

  const groups = ATTENTION_BUCKETS
    .map((bucket) => ({ bucket, repos: (data?.repos ?? []).filter((repo) => repo.effectiveBucket === bucket) }))
    .filter((group) => group.repos.length);
  const watched = new Set(data?.watchList ?? []);
  const today = data?.today;
  const stat = (key: Parameters<typeof t>[0], value: number | undefined) => (
    <div className="stat"><div className="k">{t(key)}</div><div className="v">{value === undefined ? "—" : formatNumber(value)}</div></div>
  );

  return (
    <div className="view-attention" style={{ display: "block" }}>
      <div className="toolbar">
        <h2 className="attention-title">{t("attention.title")}</h2>
        <div className="spacer" />
        <button className="btn" type="button" disabled={loading} onClick={() => void load(true)}>
          {loading ? t("common.loadingEllipsis") : t("attention.refresh")}
        </button>
        <button className="btn" type="button" onClick={() => void toggleHistory()}>{t("attention.history")}</button>
      </div>
      <p className="cockpit-rule">{t("attention.subtitle")}</p>

      {error ? <div className="error">{error}</div> : null}

      <section className="stats" aria-label={t("attention.today")}>
        {stat("attention.today.now", today?.now)}
        {stat("attention.today.decisions", today?.decisions)}
        {stat("attention.today.blockingPrs", today?.blockingPullRequests)}
        {stat("attention.today.redCi", today?.redCi)}
        {stat("attention.today.inactive", today?.inactive)}
        {stat("attention.today.duplicates", today?.duplicateCandidates)}
      </section>

      {data ? (
        <p className="cockpit-muted">
          {t("attention.coverage", {
            listed: formatNumber(data.coverage.listed),
            deep: formatNumber(data.coverage.deepEvaluated),
            limit: formatNumber(data.coverage.deepLimit),
            source: data.coverage.listSource,
          })}
          {" · "}
          {formatRelativeTime(data.observedAt, Date.now(), language)}
        </p>
      ) : null}
      {data?.coverage.listError ? <div className="cockpit-muted attention-warning">{t("attention.listError", { error: data.coverage.listError })}</div> : null}

      <form className="toolbar cockpit-toolbar" onSubmit={addWatch}>
        <label htmlFor="attention-watch">{t("attention.addWatch")}</label>
        <input
          id="attention-watch"
          className="cockpit-input"
          value={watchInput}
          placeholder={t("cockpit.repositoryPlaceholder")}
          onChange={(event) => setWatchInput(event.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <button className="btn primary" type="submit" disabled={busy}>{t("attention.watch")}</button>
        <span className="cockpit-muted">{t("attention.watchHint")}</span>
      </form>

      {history ? (
        <section className="cockpit-panel">
          <header className="cockpit-panel-head"><h3>{t("attention.history")}</h3></header>
          <HistoryList entries={history} showRepository />
        </section>
      ) : null}

      <CopilotPanel />

      {data && !groups.length ? (
        <div className="empty"><div>{t("attention.empty")}</div></div>
      ) : null}

      {groups.map(({ bucket, repos }) => (
        <section className={`cockpit-panel attention-group ${bucket}`} key={bucket} aria-label={t(BUCKET_KEYS[bucket])}>
          <header className="cockpit-panel-head">
            <h3><BucketLabel bucket={bucket as AttentionBucket} /> <span className="cockpit-count">{repos.length}</span></h3>
          </header>
          <ul className="attention-cards">
            {repos.map((repo) => (
              <RepoAttentionCard
                key={repo.repository}
                repo={repo}
                watched={watched.has(repo.repository)}
                busy={busy}
                onOverride={(name, next, reason, days) => mutate(() => setAttentionOverride(name, next, reason, days))}
                onClearOverride={(name) => mutate(() => clearAttentionOverride(name, "Override removed from the cockpit"))}
                onWatch={(name, next) => mutate(() => setAttentionWatched(name, next), true)}
              />
            ))}
          </ul>
        </section>
      ))}

      {data?.duplicates.length ? (
        <section className="cockpit-panel">
          <header className="cockpit-panel-head"><h3>{t("attention.duplicates")}</h3></header>
          <ul className="attention-history">
            {data.duplicates.map((group) => (
              <li key={group.key}>
                <strong>{group.repositories.join(" · ")}</strong>
                <span className="cockpit-muted">{t("attention.suggestedCanonical", { repo: group.suggestedCanonical })}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
