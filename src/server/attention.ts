import type {
  AttentionBrief,
  AttentionBucket,
  AttentionData,
  BriefQuestion,
  DeepSignals,
  IssueCounts,
  LightSignals,
  MilestoneSignal,
  PullRequestSignal,
  RepoAttention,
  RepoSignals,
} from "../types/attention";
import { DEFAULT_THRESHOLDS } from "../types/attention";
import type { CockpitItem } from "../types/devCockpit";
import { activeOverride, compareAttention, computeAttention, type ComputedAttention } from "../utils/attention/engine";
import { buildBrief, buildTodaySummary, computedChanges, findDuplicateGroups } from "../utils/attention/portfolio";
import { AttentionStore, attentionStore } from "./attentionStore";
import { getReposCached } from "./dashboardData";
import { getDevCockpit } from "./devCockpit";
import { restApi } from "./githubClient";

const DEEP_LIMIT = Math.max(1, Number(process.env.GITDECK_ATTENTION_DEEP_LIMIT ?? 25) || 25);
const CONCURRENCY = 4;
const MAX_PR_DETAILS = 10;
const TTL_MS = 5 * 60 * 1000;

export type AttentionResult = AttentionData | { ok: false; error: string; needsAuth?: true };

interface Collected {
  observedAt: string;
  entries: { signals: RepoSignals; computed: ComputedAttention }[];
  coverage: AttentionData["coverage"];
}

let cache: { at: number; value: Collected } | null = null;
let inflight: Promise<Collected | { ok: false; error: string; needsAuth?: true }> | null = null;

async function mapPool<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index]);
    }
  }));
  return results;
}

function countIssues(items: CockpitItem[]): IssueCounts {
  return {
    open: items.length,
    p0: items.filter((item) => item.priority.source === "P0").length,
    p1: items.filter((item) => item.priority.source === "P1").length,
    p2: items.filter((item) => item.priority.source === "P2").length,
    bug: items.filter((item) => item.type === "BUG").length,
    blocked: items.filter((item) => item.status === "BLOCKED").length,
    decision: items.filter((item) => item.type === "DECISION").length,
  };
}

async function loadPullRequests(repo: string, errors: string[]): Promise<PullRequestSignal[] | null> {
  const list = await restApi<Record<string, unknown>[]>(`/repos/${repo}/pulls?state=open&per_page=50`);
  if (!list.ok) {
    errors.push(`pull requests: ${list.error}`);
    return null;
  }
  const prs = list.data ?? [];
  // mergeable_state is only returned by the single-PR endpoint.
  const details = await Promise.all(prs.slice(0, MAX_PR_DETAILS).map((pr) => restApi<Record<string, unknown>>(`/repos/${repo}/pulls/${pr.number}`)));
  return prs.map((pr, index) => {
    const detail = details[index];
    const labels = Array.isArray(pr.labels) ? (pr.labels as { name?: string }[]).map((label) => String(label?.name ?? "")).filter(Boolean) : [];
    return {
      number: Number(pr.number),
      title: String(pr.title ?? ""),
      url: String(pr.html_url ?? ""),
      draft: Boolean(pr.draft),
      labels,
      mergeableState: detail?.ok && typeof detail.data?.mergeable_state === "string" ? detail.data.mergeable_state : null,
    };
  });
}

async function loadMilestones(repo: string, errors: string[]): Promise<MilestoneSignal[] | null> {
  const result = await restApi<Record<string, unknown>[]>(`/repos/${repo}/milestones?state=open&per_page=50`);
  if (!result.ok) {
    errors.push(`milestones: ${result.error}`);
    return null;
  }
  return (result.data ?? []).map((milestone) => ({
    title: String(milestone.title ?? ""),
    url: String(milestone.html_url ?? ""),
    dueOn: typeof milestone.due_on === "string" ? milestone.due_on : null,
    openIssues: Number(milestone.open_issues ?? 0),
    closedIssues: Number(milestone.closed_issues ?? 0),
  }));
}

async function loadDeep(repo: string, now: Date): Promise<DeepSignals> {
  const errors: string[] = [];
  const [cockpit, meta, pullRequests, milestones, releases] = await Promise.all([
    getDevCockpit(repo, null, now),
    restApi<{ size?: number; default_branch?: string }>(`/repos/${repo}`),
    loadPullRequests(repo, errors),
    loadMilestones(repo, errors),
    restApi<{ draft?: boolean; published_at?: string | null }[]>(`/repos/${repo}/releases?per_page=10`),
  ]);
  if (!releases.ok) errors.push(`releases: ${releases.error}`);
  const releaseList = releases.ok ? releases.data ?? [] : null;
  if (!cockpit.ok) {
    errors.push(`cockpit: ${cockpit.error}`);
    return {
      defaultBranch: meta.ok ? meta.data?.default_branch ?? null : null,
      sizeKb: meta.ok ? meta.data?.size ?? null : null,
      ci: { state: "UNKNOWN", reason: cockpit.error, evidence: [] },
      readiness: "UNKNOWN",
      issues: null,
      issuesReason: cockpit.error,
      pullRequests,
      milestones,
      draftReleases: releaseList ? releaseList.filter((release) => release.draft).length : null,
      latestReleaseAt: releaseList?.find((release) => !release.draft && release.published_at)?.published_at ?? null,
      errors,
    };
  }
  errors.push(...cockpit.errors.map((error) => `${error.block}: ${error.reason}`));
  const issueItems = cockpit.remaining.state === "AVAILABLE"
    ? [...cockpit.remaining.bySourcePriority.P0, ...cockpit.remaining.bySourcePriority.P1, ...cockpit.remaining.bySourcePriority.P2, ...cockpit.remaining.bySourcePriority.none]
    : null;
  return {
    defaultBranch: cockpit.headCommit?.branch ?? null,
    sizeKb: meta.ok ? meta.data?.size ?? null : null,
    ci: { state: cockpit.quality.ci.state, reason: cockpit.quality.ci.reason, evidence: cockpit.quality.ci.evidence },
    readiness: cockpit.readiness.verdict,
    issues: issueItems ? countIssues(issueItems) : null,
    issuesReason: cockpit.remaining.reason,
    pullRequests,
    milestones,
    draftReleases: releaseList ? releaseList.filter((release) => release.draft).length : null,
    latestReleaseAt: releaseList?.find((release) => !release.draft && release.published_at)?.published_at ?? null,
    errors,
  };
}

async function lightFromWatchList(names: string[]): Promise<LightSignals[]> {
  return mapPool(names, CONCURRENCY, async (repository) => {
    const meta = await restApi<{ html_url?: string; pushed_at?: string; archived?: boolean; fork?: boolean; open_issues_count?: number }>(`/repos/${repository}`);
    return {
      repository,
      url: meta.ok ? meta.data?.html_url ?? `https://github.com/${repository}` : `https://github.com/${repository}`,
      pushedAt: meta.ok ? meta.data?.pushed_at ?? null : null,
      isArchived: meta.ok ? Boolean(meta.data?.archived) : false,
      isFork: meta.ok ? Boolean(meta.data?.fork) : false,
      openIssueCount: meta.ok ? meta.data?.open_issues_count ?? null : null,
    };
  });
}

/** Two passes: light signals for every repository, deep evaluation for the selected ones. */
async function collect(store: AttentionStore, fresh: boolean, now: Date): Promise<Collected | { ok: false; error: string; needsAuth?: true }> {
  const file = await store.read();
  const thresholds = DEFAULT_THRESHOLDS;
  const reposResult = await getReposCached(fresh);
  let light: LightSignals[];
  let listSource: "account" | "watch-list" = "account";
  let listError: string | null = null;
  if (reposResult.ok) {
    light = reposResult.repos.map((repo) => ({
      repository: repo.nameWithOwner,
      url: repo.url,
      pushedAt: repo.pushedAt ?? null,
      isArchived: repo.isArchived,
      isFork: repo.isFork,
      openIssueCount: repo.openIssueCount ?? null,
    }));
  } else {
    if (reposResult.needsAuth) return { ok: false, error: reposResult.error, needsAuth: true };
    listSource = "watch-list";
    listError = reposResult.error;
    light = [];
  }
  const known = new Set(light.map((repo) => repo.repository.toLowerCase()));
  const extra = [...file.watchList, ...Object.keys(file.overrides)].filter((name, index, all) => !known.has(name.toLowerCase()) && all.indexOf(name) === index);
  light.push(...await lightFromWatchList(extra));
  light = light.filter((repo) => !repo.isArchived);

  const forced = new Set([...file.watchList, ...Object.keys(file.overrides)].map((name) => name.toLowerCase()));
  const recent = light
    .filter((repo) => !forced.has(repo.repository.toLowerCase()))
    .filter((repo) => {
      const pushed = repo.pushedAt ? Date.parse(repo.pushedAt) : NaN;
      return !Number.isNaN(pushed) && now.getTime() - pushed < thresholds.inactiveDays * 24 * 60 * 60 * 1000;
    })
    .sort((a, b) => (b.pushedAt ?? "").localeCompare(a.pushedAt ?? ""));
  const deepTargets = [
    ...light.filter((repo) => forced.has(repo.repository.toLowerCase())),
    ...recent,
  ].slice(0, Math.max(DEEP_LIMIT, forced.size));
  const deepNames = new Set(deepTargets.map((repo) => repo.repository));

  const deepResults = new Map<string, DeepSignals>();
  await mapPool(deepTargets, CONCURRENCY, async (repo) => {
    deepResults.set(repo.repository, await loadDeep(repo.repository, now));
  });

  const entries = light.map((repo) => {
    const signals: RepoSignals = { light: repo, deep: deepNames.has(repo.repository) ? deepResults.get(repo.repository) ?? null : null };
    return { signals, computed: computeAttention(signals, now, thresholds) };
  });

  const observedAt = now.toISOString();
  const previous = file.lastBuckets;
  const changes = computedChanges(previous, entries.map(({ signals, computed }) => ({ repository: signals.light.repository, computed })), observedAt);
  await store.recordComputed(changes, Object.fromEntries(entries.map(({ signals, computed }) => [signals.light.repository, computed.bucket])));

  return {
    observedAt,
    entries,
    coverage: { listed: light.length, deepEvaluated: deepTargets.length, deepLimit: DEEP_LIMIT, listSource, listError },
  };
}

function assemble(collected: Collected, file: Awaited<ReturnType<AttentionStore["read"]>>, now: Date): AttentionData {
  const duplicates = findDuplicateGroups(collected.entries.map(({ signals }) => ({ repository: signals.light.repository, pushedAt: signals.light.pushedAt })));
  const duplicateOf = new Map<string, string>();
  for (const group of duplicates) for (const name of group.repositories) duplicateOf.set(name, group.key);
  const repos: RepoAttention[] = collected.entries.map(({ signals, computed }): RepoAttention => {
    const override = activeOverride(file.overrides[signals.light.repository], now);
    return {
      repository: signals.light.repository,
      url: signals.light.url,
      computed: { bucket: computed.bucket, reasons: computed.reasons },
      override,
      effectiveBucket: override?.bucket ?? computed.bucket,
      sortKey: { deadline: computed.deadline, pushedAt: signals.light.pushedAt },
      evaluated: signals.deep ? "deep" : "light",
      pushedAt: signals.light.pushedAt,
      duplicateGroup: duplicateOf.get(signals.light.repository) ?? null,
      signals,
    };
  }).sort(compareAttention);
  return {
    ok: true,
    observedAt: collected.observedAt,
    thresholds: DEFAULT_THRESHOLDS,
    repos,
    today: buildTodaySummary(repos, duplicates),
    duplicates,
    coverage: collected.coverage,
    watchList: [...file.watchList],
  };
}

export async function getAttention(fresh = false, store: AttentionStore = attentionStore, now: Date = new Date()): Promise<AttentionResult> {
  if (!fresh && cache && now.getTime() - cache.at < TTL_MS) return assemble(cache.value, await store.read(), now);
  if (!inflight) {
    inflight = collect(store, fresh, now).finally(() => {
      inflight = null;
    });
  }
  const collected = await inflight;
  if ("ok" in collected) return collected;
  cache = { at: now.getTime(), value: collected };
  return assemble(collected, await store.read(), now);
}

export async function getAttentionBrief(question: BriefQuestion, store: AttentionStore = attentionStore): Promise<AttentionBrief | { ok: false; error: string; needsAuth?: true }> {
  const data = await getAttention(false, store);
  if (!data.ok) return data;
  return buildBrief(question, data.repos, data.duplicates, data.observedAt);
}

export function computedBucketOf(repository: string): AttentionBucket | null {
  const entry = cache?.value.entries.find(({ signals }) => signals.light.repository === repository);
  return entry?.computed.bucket ?? null;
}

export function resetAttentionCache(): void {
  cache = null;
}
