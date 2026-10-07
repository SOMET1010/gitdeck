import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, type DeepSignals, type RepoAttention, type RepoSignals } from "../../../src/types/attention";
import { activeOverride, compareAttention, computeAttention, daysSince, isBlockingPullRequest } from "../../../src/utils/attention/engine";

const NOW = new Date("2026-10-07T12:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86400000).toISOString();
const inDays = (days: number) => new Date(NOW.getTime() + days * 86400000).toISOString();

function deep(partial: Partial<DeepSignals> = {}): DeepSignals {
  return {
    defaultBranch: "main",
    sizeKb: 5000,
    ci: { state: "PASS", reason: "green", evidence: [] },
    readiness: "UNKNOWN",
    issues: { open: 10, p0: 0, p1: 0, p2: 0, bug: 0, blocked: 0, decision: 0 },
    issuesReason: "",
    pullRequests: [],
    milestones: [],
    draftReleases: 0,
    latestReleaseAt: null,
    errors: [],
    ...partial,
  };
}

function signals(pushedDaysAgo: number | null, deepSignals: DeepSignals | null): RepoSignals {
  return {
    light: { repository: "o/r", url: "https://github.com/o/r", pushedAt: pushedDaysAgo === null ? null : daysAgo(pushedDaysAgo), isArchived: false, isFork: false, openIssueCount: null },
    deep: deepSignals,
  };
}

const pr = (number: number, labels: string[], mergeableState: string | null = "clean", draft = false) => ({ number, title: `PR ${number}`, url: `u${number}`, draft, labels, mergeableState });
const run = (s: RepoSignals) => computeAttention(s, NOW, DEFAULT_THRESHOLDS);

describe("computeAttention", () => {
  it("puts a red CI on the default branch in NOW", () => {
    const result = run(signals(1, deep({ ci: { state: "FAIL", reason: "Failed on abc", evidence: [] } })));
    expect(result.bucket).toBe("NOW");
    expect(result.reasons[0].code).toBe("ci-red");
  });

  it("puts open P0 issues and P0 pull requests in NOW", () => {
    expect(run(signals(1, deep({ issues: { open: 3, p0: 1, p1: 0, p2: 0, bug: 1, blocked: 0, decision: 0 } }))).bucket).toBe("NOW");
    expect(run(signals(1, deep({ pullRequests: [pr(42, ["P0"], "clean", true)] }))).reasons[0].code).toBe("pr-p0");
  });

  it("puts a P1 pull request that cannot merge in NOW, and an open P1 in URGENT", () => {
    expect(run(signals(1, deep({ pullRequests: [pr(1, ["P1"], "dirty")] }))).bucket).toBe("NOW");
    expect(run(signals(1, deep({ pullRequests: [pr(1, ["P1"], "clean")] }))).bucket).toBe("URGENT");
  });

  it("puts a close or overdue milestone with open work in URGENT and keeps its deadline for ordering", () => {
    const due = run(signals(1, deep({ milestones: [{ title: "RC1", url: "m", dueOn: inDays(3), openIssues: 4, closedIssues: 10 }] })));
    expect(due.bucket).toBe("URGENT");
    expect(due.deadline).toBe(inDays(3));
    expect(run(signals(1, deep({ milestones: [{ title: "RC1", url: "m", dueOn: inDays(-2), openIssues: 1, closedIssues: 1 }] }))).reasons[0].code).toBe("milestone-overdue");
    expect(run(signals(1, deep({ milestones: [{ title: "Later", url: "m", dueOn: inDays(30), openIssues: 4, closedIssues: 1 }] }))).bucket).toBe("CAN_WAIT");
  });

  it("treats draft releases as unfinished releases (URGENT)", () => {
    expect(run(signals(1, deep({ draftReleases: 1 }))).bucket).toBe("URGENT");
  });

  it("puts blocked labels and conflicting PRs in BLOCKED", () => {
    expect(run(signals(1, deep({ issues: { open: 2, p0: 0, p1: 0, p2: 0, bug: 0, blocked: 1, decision: 0 } }))).bucket).toBe("BLOCKED");
    expect(run(signals(1, deep({ pullRequests: [pr(5, [], "unstable")] }))).bucket).toBe("BLOCKED");
    expect(run(signals(1, deep({ pullRequests: [pr(5, [], "dirty", true)] }))).bucket).toBe("CAN_WAIT");
  });

  it("detects almost done work from milestones and readiness", () => {
    expect(run(signals(1, deep({ milestones: [{ title: "v1", url: "m", dueOn: null, openIssues: 1, closedIssues: 9 }] }))).bucket).toBe("ALMOST_DONE");
    expect(run(signals(1, deep({ readiness: "READY", issues: { open: 2, p0: 0, p1: 0, p2: 0, bug: 0, blocked: 0, decision: 0 } }))).bucket).toBe("ALMOST_DONE");
  });

  it("applies inactivity thresholds only when nothing more urgent is found", () => {
    expect(run(signals(45, deep())).bucket).toBe("INACTIVE");
    expect(run(signals(200, deep())).bucket).toBe("ARCHIVE_CANDIDATE");
    expect(run(signals(45, deep({ sizeKb: 3 }))).reasons[0].code).toBe("nearly-empty");
    expect(run(signals(200, deep({ ci: { state: "FAIL", reason: "red", evidence: [] } }))).bucket).toBe("NOW");
  });

  it("never gives a reassuring bucket without data", () => {
    expect(run(signals(2, null)).bucket).toBe("UNKNOWN");
    expect(run(signals(null, null)).bucket).toBe("UNKNOWN");
    expect(run(signals(2, deep({ pullRequests: null, issues: null, issuesReason: "rate limited" }))).bucket).toBe("UNKNOWN");
    expect(run(signals(40, null)).bucket).toBe("INACTIVE");
  });

  it("says what was checked when nothing is urgent", () => {
    const result = run(signals(2, deep({ issues: null, issuesReason: "Issues are disabled on this repository" })));
    expect(result.bucket).toBe("CAN_WAIT");
    expect(result.reasons[0].message).toContain("issues disabled");
  });
});

describe("helpers", () => {
  it("computes days since a date", () => {
    expect(daysSince(daysAgo(3), NOW)).toBe(3);
    expect(daysSince(null, NOW)).toBeNull();
  });

  it("flags blocking pull requests, never drafts", () => {
    expect(isBlockingPullRequest(pr(1, [], "dirty"))).toBe(true);
    expect(isBlockingPullRequest(pr(1, ["blocked"], "clean"))).toBe(true);
    expect(isBlockingPullRequest(pr(1, ["P0"], "dirty", true))).toBe(false);
    expect(isBlockingPullRequest(pr(1, [], "clean"))).toBe(false);
  });

  it("ignores expired overrides", () => {
    const override = { repository: "o/r", bucket: "NOW" as const, reason: "x", setAt: daysAgo(10), expiresAt: inDays(1) };
    expect(activeOverride(override, NOW)).toBe(override);
    expect(activeOverride({ ...override, expiresAt: daysAgo(1) }, NOW)).toBeNull();
    expect(activeOverride(undefined, NOW)).toBeNull();
  });

  it("orders by bucket, then deadline, then most recent push", () => {
    const entry = (repository: string, bucket: RepoAttention["effectiveBucket"], deadline: string | null, pushedAt: string | null) =>
      ({ repository, effectiveBucket: bucket, sortKey: { deadline, pushedAt } }) as RepoAttention;
    const sorted = [
      entry("a", "CAN_WAIT", null, daysAgo(1)),
      entry("b", "URGENT", inDays(5), daysAgo(1)),
      entry("c", "URGENT", inDays(2), daysAgo(9)),
      entry("d", "NOW", null, daysAgo(20)),
      entry("e", "URGENT", null, daysAgo(1)),
    ].sort(compareAttention).map((item) => item.repository);
    expect(sorted).toEqual(["d", "c", "b", "e", "a"]);
  });
});
