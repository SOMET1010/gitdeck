import { describe, expect, it } from "vitest";
import type { RepoAttention } from "../../../src/types/attention";
import { buildBrief, buildTodaySummary, computedChanges, duplicateKey, findDuplicateGroups } from "../../../src/utils/attention/portfolio";

const AT = "2026-10-07T12:00:00.000Z";

describe("duplicateKey", () => {
  it("ignores case, separators and variant suffixes", () => {
    expect(duplicateKey("me/Approvals-manager")).toBe(duplicateKey("me/approvals_manager"));
    expect(duplicateKey("me/lovable-project-revive-4033ab0b")).toBe("lovableprojectrevive");
    expect(duplicateKey("me/lovable-project-revive-46")).toBe("lovableprojectrevive");
    expect(duplicateKey("me/MONTOIT-PROD")).toBe(duplicateKey("me/montoit_stable"));
    expect(duplicateKey("me/montoit-vf")).toBe("montoit");
    expect(duplicateKey("me/Generateur_modules_odoo")).not.toBe(duplicateKey("me/ODOO_genrator"));
  });

  it("keeps a lone token even if it looks like a suffix", () => {
    expect(duplicateKey("me/demo")).toBe("demo");
  });
});

describe("findDuplicateGroups", () => {
  it("groups probable duplicates and suggests the most recently pushed as canonical", () => {
    const groups = findDuplicateGroups([
      { repository: "me/approvals-manager", pushedAt: "2026-01-01T00:00:00Z" },
      { repository: "me/approvals_manager", pushedAt: "2026-05-01T00:00:00Z" },
      { repository: "me/julaba", pushedAt: "2026-10-01T00:00:00Z" },
    ]);
    expect(groups).toEqual([{ key: "approvalsmanager", repositories: ["me/approvals_manager", "me/approvals-manager"], suggestedCanonical: "me/approvals_manager" }]);
  });
});

function repo(name: string, bucket: RepoAttention["effectiveBucket"], extra: Partial<RepoAttention> = {}): RepoAttention {
  return {
    repository: name,
    url: `https://github.com/${name}`,
    computed: { bucket, reasons: [{ code: "x", message: `${name} reason`, evidence: [] }] },
    override: null,
    effectiveBucket: bucket,
    sortKey: { deadline: null, pushedAt: null },
    evaluated: "deep",
    pushedAt: null,
    duplicateGroup: null,
    signals: {
      light: { repository: name, url: "", pushedAt: null, isArchived: false, isFork: false, openIssueCount: null },
      deep: null,
    },
    ...extra,
  };
}

describe("buildTodaySummary", () => {
  it("counts decisions, blocking PRs, red CI, inactive repos and duplicates", () => {
    const withDeep = repo("me/a", "NOW");
    withDeep.signals.deep = {
      defaultBranch: "main", sizeKb: 10, ci: { state: "FAIL", reason: "", evidence: [] }, readiness: "NOT_READY",
      issues: { open: 3, p0: 0, p1: 0, p2: 0, bug: 0, blocked: 0, decision: 2 }, issuesReason: "",
      pullRequests: [
        { number: 1, title: "", url: "", draft: false, labels: [], mergeableState: "dirty" },
        { number: 2, title: "", url: "", draft: true, labels: ["P0"], mergeableState: "dirty" },
      ],
      milestones: [], draftReleases: 0, latestReleaseAt: null, errors: [],
    };
    const summary = buildTodaySummary([withDeep, repo("me/b", "INACTIVE"), repo("me/c", "ARCHIVE_CANDIDATE")], [{ key: "k", repositories: ["x", "y", "z"], suggestedCanonical: "x" }]);
    expect(summary).toEqual({ decisions: 2, blockingPullRequests: 1, redCi: 1, inactive: 2, duplicateCandidates: 2, now: 1 });
  });
});

describe("computedChanges", () => {
  it("logs only repositories whose computed bucket changed", () => {
    const changes = computedChanges({ "me/a": "NOW", "me/b": "CAN_WAIT" }, [repo("me/a", "NOW"), repo("me/b", "URGENT"), repo("me/c", "INACTIVE")], AT);
    expect(changes.map((entry) => [entry.repository, entry.type === "computed-change" ? entry.from : "", entry.type === "computed-change" ? entry.to : ""])).toEqual([
      ["me/b", "CAN_WAIT", "URGENT"],
      ["me/c", null, "INACTIVE"],
    ]);
  });
});

describe("buildBrief", () => {
  const repos = [repo("me/now", "NOW"), repo("me/urgent", "URGENT"), repo("me/blocked", "BLOCKED"), repo("me/almost", "ALMOST_DONE"), repo("me/idle", "INACTIVE"), repo("me/old", "ARCHIVE_CANDIDATE"), repo("me/fine", "CAN_WAIT")];

  it("answers 'now' with NOW, URGENT and BLOCKED repos in order", () => {
    expect(buildBrief("now", repos, [], AT).items.map((item) => item.repository)).toEqual(["me/now", "me/urgent", "me/blocked"]);
  });

  it("answers 'week' with work that can be finished", () => {
    expect(buildBrief("week", repos, [], AT).items.map((item) => item.repository)).toEqual(["me/now", "me/urgent", "me/almost"]);
  });

  it("answers 'cleanup' with proposals only, duplicates marked as inference", () => {
    const brief = buildBrief("cleanup", repos, [{ key: "fine", repositories: ["me/fine", "me/fine-copy"], suggestedCanonical: "me/fine" }], AT);
    expect(brief.readOnly).toBe(true);
    expect(brief.items.map((item) => item.repository)).toEqual(["me/old", "me/fine-copy", "me/idle"]);
    expect(brief.items[1].evidence[0]).toMatchObject({ level: "D", confidence: "low" });
    expect(brief.summary).toContain("Nothing is archived or deleted automatically");
  });

  it("mentions both buckets when an override is active", () => {
    const forced = repo("me/forced", "CAN_WAIT", { effectiveBucket: "NOW", override: { repository: "me/forced", bucket: "NOW", reason: "DG demo", setAt: AT, expiresAt: AT } });
    expect(buildBrief("now", [forced], [], AT).items[0].title).toBe("NOW (forced; computed CAN_WAIT) · me/forced");
  });
});
