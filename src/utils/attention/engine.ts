import type {
  AttentionBucket,
  AttentionOverride,
  AttentionReason,
  AttentionThresholds,
  PullRequestSignal,
  RepoAttention,
  RepoSignals,
} from "../../types/attention";
import { ATTENTION_BUCKETS } from "../../types/attention";
import type { Evidence } from "../../types/devCockpit";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Repositories smaller than this (KB) are considered nearly empty. */
export const NEARLY_EMPTY_KB = 50;

function hasLabel(labels: string[], wanted: string): boolean {
  return labels.some((label) => label.trim().toLowerCase() === wanted.toLowerCase());
}

export function daysSince(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  return Number.isNaN(time) ? null : Math.floor((now.getTime() - time) / DAY_MS);
}

function prEvidence(pr: PullRequestSignal, observedAt: string, summary: string): Evidence {
  return { level: "B", kind: "pull-request", source: `PR #${pr.number}`, summary, url: pr.url, observedAt, confidence: "high" };
}

/** A non-draft PR whose merge is blocked by a conflict or failing checks, or labelled blocked / P0. */
export function isBlockingPullRequest(pr: PullRequestSignal): boolean {
  if (pr.draft) return false;
  return pr.mergeableState === "dirty" || pr.mergeableState === "unstable" || hasLabel(pr.labels, "blocked") || hasLabel(pr.labels, "P0");
}

export interface ComputedAttention {
  bucket: AttentionBucket;
  reasons: AttentionReason[];
  deadline: string | null;
}

/**
 * Ordered rules, first match wins: NOW > URGENT > BLOCKED > ALMOST_DONE > inactivity > CAN_WAIT.
 * Missing data never yields a reassuring bucket: it gives UNKNOWN.
 */
export function computeAttention(signals: RepoSignals, now: Date, thresholds: AttentionThresholds): ComputedAttention {
  const observedAt = now.toISOString();
  const { light, deep } = signals;
  const idle = daysSince(light.pushedAt, now);
  const pushEvidence: Evidence[] = light.pushedAt
    ? [{ level: "B", kind: "repository", source: "last push", summary: `pushed ${idle} day(s) ago (${light.pushedAt})`, url: light.url, observedAt, confidence: "high" }]
    : [];

  const inactivity = (): ComputedAttention | null => {
    if (idle === null) return null;
    if (idle >= thresholds.archiveDays) {
      return { bucket: "ARCHIVE_CANDIDATE", deadline: null, reasons: [{ code: "inactive-long", message: `No push for ${idle} days (≥ ${thresholds.archiveDays}). Archiving can be considered.`, evidence: pushEvidence }] };
    }
    if (idle >= thresholds.inactiveDays) {
      if (deep?.sizeKb !== null && deep?.sizeKb !== undefined && deep.sizeKb < NEARLY_EMPTY_KB) {
        return {
          bucket: "ARCHIVE_CANDIDATE",
          deadline: null,
          reasons: [{
            code: "nearly-empty",
            message: `Nearly empty (${deep.sizeKb} KB) and no push for ${idle} days.`,
            evidence: [...pushEvidence, { level: "B", kind: "repository", source: "repository size", summary: `${deep.sizeKb} KB`, url: light.url, observedAt, confidence: "high" }],
          }],
        };
      }
      return { bucket: "INACTIVE", deadline: null, reasons: [{ code: "inactive", message: `No push for ${idle} days (≥ ${thresholds.inactiveDays}).`, evidence: pushEvidence }] };
    }
    return null;
  };

  if (!deep) {
    const inactive = inactivity();
    if (inactive) return inactive;
    return {
      bucket: "UNKNOWN",
      deadline: null,
      reasons: [{ code: "not-evaluated", message: light.pushedAt ? "Recently active but not evaluated in depth (outside the deep evaluation limit)." : "No activity date available.", evidence: pushEvidence }],
    };
  }

  const now_: AttentionReason[] = [];
  const urgent: AttentionReason[] = [];
  const blocked: AttentionReason[] = [];
  const almostDone: AttentionReason[] = [];
  const prs = deep.pullRequests ?? [];
  let deadline: string | null = null;

  if (deep.ci.state === "FAIL") now_.push({ code: "ci-red", message: `CI red on the default branch: ${deep.ci.reason}`, evidence: deep.ci.evidence });
  if (deep.issues && deep.issues.p0 > 0) {
    now_.push({ code: "issue-p0", message: `${deep.issues.p0} open issue(s) labelled P0.`, evidence: [{ level: "B", kind: "issues", source: "open issues", summary: `${deep.issues.p0} labelled P0`, url: `${light.url}/issues?q=is%3Aopen+label%3AP0`, observedAt, confidence: "high" }] });
  }
  for (const pr of prs) {
    const p0 = hasLabel(pr.labels, "P0");
    const p1 = hasLabel(pr.labels, "P1");
    const mergeBlocked = !pr.draft && (pr.mergeableState === "dirty" || pr.mergeableState === "unstable");
    if (p0) now_.push({ code: "pr-p0", message: `PR #${pr.number} labelled P0 is open${pr.draft ? " (draft)" : ""}: ${pr.title}`, evidence: [prEvidence(pr, observedAt, `open, labels: ${pr.labels.join(", ")}`)] });
    else if (p1 && mergeBlocked) now_.push({ code: "pr-p1-merge-blocked", message: `PR #${pr.number} labelled P1 cannot be merged (${pr.mergeableState}): ${pr.title}`, evidence: [prEvidence(pr, observedAt, `mergeable_state: ${pr.mergeableState}`)] });
    else if (p1) urgent.push({ code: "pr-p1", message: `PR #${pr.number} labelled P1 is open: ${pr.title}`, evidence: [prEvidence(pr, observedAt, `open, labels: ${pr.labels.join(", ")}`)] });
    if (!p0 && (mergeBlocked || hasLabel(pr.labels, "blocked"))) {
      blocked.push({ code: "pr-blocked", message: `PR #${pr.number} is blocked (${hasLabel(pr.labels, "blocked") ? "label blocked" : `mergeable_state ${pr.mergeableState}`}): ${pr.title}`, evidence: [prEvidence(pr, observedAt, `mergeable_state: ${pr.mergeableState ?? "unknown"}`)] });
    }
  }
  if (deep.issues && deep.issues.p1 > 0) {
    urgent.push({ code: "issue-p1", message: `${deep.issues.p1} open issue(s) labelled P1.`, evidence: [{ level: "B", kind: "issues", source: "open issues", summary: `${deep.issues.p1} labelled P1`, url: `${light.url}/issues?q=is%3Aopen+label%3AP1`, observedAt, confidence: "high" }] });
  }
  for (const milestone of deep.milestones ?? []) {
    const total = milestone.openIssues + milestone.closedIssues;
    const remainingDays = milestone.dueOn ? Math.ceil((Date.parse(milestone.dueOn) - now.getTime()) / DAY_MS) : null;
    const evidence: Evidence[] = [{ level: "B", kind: "milestone", source: `milestone ${milestone.title}`, summary: `${milestone.closedIssues}/${total} closed${milestone.dueOn ? `, due ${milestone.dueOn.slice(0, 10)}` : ""}`, url: milestone.url, observedAt, confidence: "high" }];
    if (remainingDays !== null && remainingDays <= thresholds.deadlineDays && milestone.openIssues > 0) {
      urgent.push({ code: remainingDays < 0 ? "milestone-overdue" : "milestone-due", message: remainingDays < 0 ? `Milestone "${milestone.title}" is ${-remainingDays} day(s) overdue with ${milestone.openIssues} open item(s).` : `Milestone "${milestone.title}" is due in ${remainingDays} day(s) with ${milestone.openIssues} open item(s).`, evidence });
      if (!deadline || (milestone.dueOn && milestone.dueOn < deadline)) deadline = milestone.dueOn;
    } else if (total > 0 && milestone.openIssues > 0 && milestone.closedIssues / total >= thresholds.almostDoneRatio) {
      almostDone.push({ code: "milestone-almost-done", message: `Milestone "${milestone.title}" is ${Math.round((milestone.closedIssues / total) * 100)}% done (${milestone.openIssues} left).`, evidence });
    }
  }
  if (deep.draftReleases && deep.draftReleases > 0) {
    urgent.push({ code: "release-draft", message: `${deep.draftReleases} draft release(s) not published yet.`, evidence: [{ level: "B", kind: "release", source: "releases", summary: `${deep.draftReleases} draft`, url: `${light.url}/releases`, observedAt, confidence: "high" }] });
  }
  if (deep.issues && deep.issues.blocked > 0) {
    blocked.push({ code: "issue-blocked", message: `${deep.issues.blocked} open issue(s) labelled blocked.`, evidence: [{ level: "B", kind: "issues", source: "open issues", summary: `${deep.issues.blocked} labelled blocked`, url: `${light.url}/issues?q=is%3Aopen+label%3Ablocked`, observedAt, confidence: "high" }] });
  }
  if (deep.readiness === "READY" && deep.issues && deep.issues.open > 0 && deep.issues.open <= 3) {
    almostDone.push({ code: "ready-few-left", message: `Release readiness is READY and only ${deep.issues.open} issue(s) remain open.`, evidence: deep.ci.evidence });
  }

  if (now_.length) return { bucket: "NOW", reasons: [...now_, ...urgent, ...blocked], deadline };
  if (urgent.length) return { bucket: "URGENT", reasons: [...urgent, ...blocked], deadline };
  if (blocked.length) return { bucket: "BLOCKED", reasons: blocked, deadline };
  if (almostDone.length) return { bucket: "ALMOST_DONE", reasons: almostDone, deadline };
  const inactive = inactivity();
  if (inactive) return inactive;

  const known = deep.pullRequests !== null && (deep.issues !== null || /disabled/i.test(deep.issuesReason));
  if (!known) {
    return { bucket: "UNKNOWN", deadline, reasons: [{ code: "insufficient-data", message: `Not enough data to conclude: ${[deep.pullRequests === null ? "pull requests unavailable" : null, deep.issues === null ? deep.issuesReason : null].filter(Boolean).join("; ")}.`, evidence: [] }] };
  }
  const checked = [
    `${prs.length} open PR(s), none blocking`,
    deep.issues ? `${deep.issues.open} open issue(s), no P0/P1/blocked` : "issues disabled",
    deep.ci.state === "PASS" ? "CI green on the default branch" : `CI: ${deep.ci.reason}`,
    idle !== null ? `last push ${idle} day(s) ago` : null,
  ].filter(Boolean).join("; ");
  return { bucket: "CAN_WAIT", deadline, reasons: [{ code: "no-signal", message: `No urgent signal: ${checked}.`, evidence: [...deep.ci.evidence, ...pushEvidence] }] };
}

/** An override applies until it expires; it never replaces the computed bucket, it sits next to it. */
export function activeOverride(override: AttentionOverride | undefined, now: Date): AttentionOverride | null {
  if (!override) return null;
  return Date.parse(override.expiresAt) > now.getTime() ? override : null;
}

const BUCKET_RANK = new Map(ATTENTION_BUCKETS.map((bucket, index) => [bucket, index]));

/** Bucket order, then closest deadline, then most recent push, then name. Deterministic. */
export function compareAttention(a: RepoAttention, b: RepoAttention): number {
  const rank = (BUCKET_RANK.get(a.effectiveBucket) ?? 99) - (BUCKET_RANK.get(b.effectiveBucket) ?? 99);
  if (rank) return rank;
  const da = a.sortKey.deadline ?? "9999";
  const db = b.sortKey.deadline ?? "9999";
  if (da !== db) return da < db ? -1 : 1;
  const pa = a.sortKey.pushedAt ?? "";
  const pb = b.sortKey.pushedAt ?? "";
  if (pa !== pb) return pa > pb ? -1 : 1;
  return a.repository.localeCompare(b.repository);
}
