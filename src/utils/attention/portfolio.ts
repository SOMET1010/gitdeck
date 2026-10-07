import type {
  AttentionBrief,
  AttentionBucket,
  BriefItem,
  BriefQuestion,
  DuplicateGroup,
  HistoryEntry,
  RepoAttention,
  TodaySummary,
} from "../../types/attention";
import { isBlockingPullRequest } from "./engine";

const VARIANT_SUFFIXES = new Set([
  "prod", "production", "stable", "vf", "final", "new", "old", "copy", "backup", "bak", "test", "dev", "demo", "draft", "tmp", "temp", "main", "master", "clone", "fork",
]);

/**
 * Normalised name used to spot probable duplicates: case, separators, version / hash /
 * number suffixes and common variant words (prod, stable, vf, copy…) are ignored.
 */
export function duplicateKey(repository: string): string {
  const name = repository.split("/").pop() ?? repository;
  const tokens = name.toLowerCase().split(/[-_.\s]+/).filter(Boolean);
  while (tokens.length > 1) {
    const last = tokens[tokens.length - 1];
    if (VARIANT_SUFFIXES.has(last) || /^v?\d+$/.test(last) || /^[0-9a-f]{6,}$/.test(last)) tokens.pop();
    else break;
  }
  return tokens.join("");
}

/** Groups of two or more repositories sharing a duplicate key; the most recently pushed is the suggested canonical. */
export function findDuplicateGroups(repos: { repository: string; pushedAt: string | null }[]): DuplicateGroup[] {
  const groups = new Map<string, { repository: string; pushedAt: string | null }[]>();
  for (const repo of repos) {
    const key = duplicateKey(repo.repository);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), repo]);
  }
  return [...groups.entries()]
    .filter(([, members]) => members.length > 1)
    .map(([key, members]) => {
      const sorted = [...members].sort((a, b) => (b.pushedAt ?? "").localeCompare(a.pushedAt ?? "") || a.repository.localeCompare(b.repository));
      return { key, repositories: sorted.map((member) => member.repository), suggestedCanonical: sorted[0].repository };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function buildTodaySummary(repos: RepoAttention[], duplicates: DuplicateGroup[]): TodaySummary {
  let decisions = 0;
  let blockingPullRequests = 0;
  let redCi = 0;
  for (const repo of repos) {
    const deep = repo.signals.deep;
    if (!deep) continue;
    decisions += deep.issues?.decision ?? 0;
    blockingPullRequests += (deep.pullRequests ?? []).filter(isBlockingPullRequest).length;
    if (deep.ci.state === "FAIL") redCi += 1;
  }
  return {
    decisions,
    blockingPullRequests,
    redCi,
    inactive: repos.filter((repo) => repo.computed.bucket === "INACTIVE" || repo.computed.bucket === "ARCHIVE_CANDIDATE").length,
    duplicateCandidates: duplicates.reduce((sum, group) => sum + group.repositories.length - 1, 0),
    now: repos.filter((repo) => repo.effectiveBucket === "NOW").length,
  };
}

/** History entries for repositories whose computed bucket changed since the last recorded value. */
export function computedChanges(
  previous: Record<string, AttentionBucket>,
  repos: { repository: string; computed: { bucket: AttentionBucket; reasons: { message: string }[] } }[],
  at: string,
): HistoryEntry[] {
  return repos
    .filter((repo) => previous[repo.repository] !== repo.computed.bucket)
    .map((repo) => ({
      type: "computed-change" as const,
      repository: repo.repository,
      at,
      from: previous[repo.repository] ?? null,
      to: repo.computed.bucket,
      reason: repo.computed.reasons[0]?.message ?? "",
    }));
}

function itemOf(repo: RepoAttention, title: string, reason?: string): BriefItem {
  const first = repo.computed.reasons[0];
  return {
    repository: repo.repository,
    title,
    reason: reason ?? first?.message ?? "",
    url: repo.url,
    evidence: first?.evidence ?? [],
  };
}

function label(repo: RepoAttention): string {
  return repo.override ? `${repo.effectiveBucket} (forced; computed ${repo.computed.bucket})` : repo.effectiveBucket;
}

/**
 * Deterministic answers built only from the attention data. They propose; they never act.
 * - now: what needs attention now (NOW, URGENT, BLOCKED)
 * - week: what can be finished this week (NOW, URGENT, ALMOST_DONE)
 * - cleanup: what could be paused or archived (inactive, archive candidates, duplicates)
 */
export function buildBrief(question: BriefQuestion, repos: RepoAttention[], duplicates: DuplicateGroup[], observedAt: string): AttentionBrief {
  const pick = (buckets: AttentionBucket[]) => repos.filter((repo) => buckets.includes(repo.effectiveBucket));
  let items: BriefItem[];
  let summary: string;

  if (question === "cleanup") {
    const archive = pick(["ARCHIVE_CANDIDATE"]).map((repo) => itemOf(repo, `Archive ${repo.repository}?`));
    const pause = pick(["INACTIVE"]).map((repo) => itemOf(repo, `Pause ${repo.repository}?`));
    const duplicateItems: BriefItem[] = duplicates.flatMap((group) => group.repositories
      .filter((name) => name !== group.suggestedCanonical)
      .map((name) => ({
        repository: name,
        title: `Probable duplicate of ${group.suggestedCanonical}`,
        reason: `Same normalised name "${group.key}" as ${group.repositories.filter((other) => other !== name).join(", ")}; ${group.suggestedCanonical} has the most recent push. Inference, to confirm before archiving.`,
        url: repos.find((repo) => repo.repository === name)?.url,
        evidence: [{ level: "D" as const, kind: "duplicate-name", source: "repository names", summary: `normalised name: ${group.key}`, observedAt, confidence: "low" as const }],
      })));
    const seen = new Set<string>();
    items = [...archive, ...duplicateItems, ...pause].filter((item) => (seen.has(item.repository) ? false : (seen.add(item.repository), true)));
    summary = items.length
      ? `${archive.length} archive candidate(s), ${duplicateItems.length} probable duplicate(s), ${pause.length} inactive repo(s) to pause. Nothing is archived or deleted automatically: archive on GitHub after checking (archiving is reversible).`
      : "Nothing to clean up with the current evidence.";
  } else if (question === "week") {
    items = pick(["NOW", "URGENT", "ALMOST_DONE"]).map((repo) => itemOf(repo, `${label(repo)} · ${repo.repository}`));
    summary = items.length
      ? `${items.length} repo(s) to finish or unblock this week, most urgent first.`
      : "No repo has a signal that calls for finishing work this week.";
  } else {
    items = pick(["NOW", "URGENT", "BLOCKED"]).map((repo) => itemOf(repo, `${label(repo)} · ${repo.repository}`));
    summary = items.length ? `${items.length} repo(s) need your attention now, most urgent first.` : "Nothing needs your attention right now with the current evidence.";
  }
  return { ok: true, question, observedAt, summary, items, readOnly: true };
}
