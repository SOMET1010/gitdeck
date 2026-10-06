import { describe, expect, it } from "vitest";
import type { ReleaseReadiness } from "../../../src/types/devCockpit";
import {
  buildRemainingWork,
  classifyIssue,
  evaluateP0Issues,
  itemsFromReadiness,
  sourcePriority,
  toIssueInput,
  unknownFeatures,
  type IssueInput,
} from "../../../src/utils/devCockpit/classifyIssues";

const NOW = "2026-10-06T08:00:00.000Z";
const REPO = "owner/repo";

function issue(number: number, labels: string[]): IssueInput {
  return { number, title: `Issue ${number}`, url: `https://github.com/owner/repo/issues/${number}`, labels, updatedAt: NOW };
}

describe("toIssueInput", () => {
  it("keeps issues and drops pull requests", () => {
    expect(toIssueInput({ number: 1, title: "t", html_url: "u", labels: [{ name: "bug" }, "P1"], updated_at: NOW }))
      .toEqual({ number: 1, title: "t", url: "u", labels: ["bug", "P1"], updatedAt: NOW });
    expect(toIssueInput({ number: 2, pull_request: {} })).toBeNull();
  });
});

describe("sourcePriority", () => {
  it("reads P0/P1/P2 labels case-insensitively and keeps the highest", () => {
    expect(sourcePriority(["p1"])).toBe("P1");
    expect(sourcePriority(["P2", "P0"])).toBe("P0");
    expect(sourcePriority(["priority:high", "P10"])).toBeNull();
  });
});

describe("classifyIssue", () => {
  it("derives type and status from labels only", () => {
    expect(classifyIssue(issue(1, ["bug", "P0"]), REPO, NOW)).toMatchObject({ type: "BUG", status: "TODO", priority: { source: "P0", suggested: null } });
    expect(classifyIssue(issue(2, ["Blocked"]), REPO, NOW)).toMatchObject({ type: "TASK", status: "BLOCKED" });
    expect(classifyIssue(issue(3, ["decision"]), REPO, NOW)).toMatchObject({ type: "DECISION", status: "TODO" });
  });

  it("attaches level B evidence pointing to the issue", () => {
    const item = classifyIssue(issue(4, []), REPO, NOW);
    expect(item.evidence).toEqual([{ level: "B", kind: "issue", source: "issue #4", summary: "open, no label", url: "https://github.com/owner/repo/issues/4", observedAt: NOW, confidence: "high" }]);
    expect(item.id).toBe("owner/repo:issue:4");
  });
});

describe("evaluateP0Issues", () => {
  const items = [classifyIssue(issue(1, ["P0"]), REPO, NOW), classifyIssue(issue(2, ["P1"]), REPO, NOW)];

  it("fails when a P0 issue is open", () => {
    const check = evaluateP0Issues(items, true, NOW, "https://github.com/owner/repo");
    expect(check.state).toBe("FAIL");
    expect(check.evidence).toHaveLength(1);
  });

  it("passes when no P0 issue is open, with evidence", () => {
    const check = evaluateP0Issues(items.slice(1), true, NOW, "https://github.com/owner/repo");
    expect(check.state).toBe("PASS");
    expect(check.evidence[0]).toMatchObject({ level: "B", summary: "1 open, 0 labelled P0" });
  });

  it("passes when issues are disabled, since no P0 issue can exist", () => {
    expect(evaluateP0Issues(null, false, NOW, undefined)).toMatchObject({ state: "PASS", evidence: [{ summary: "has_issues: false" }] });
  });

  it("is unknown when issues could not be read", () => {
    expect(evaluateP0Issues(null, true, NOW, undefined, "boom")).toMatchObject({ state: "UNKNOWN", reason: "boom" });
    expect(evaluateP0Issues(null, null, NOW, undefined).state).toBe("UNKNOWN");
  });
});

describe("remaining work", () => {
  const readiness: ReleaseReadiness = {
    verdict: "NOT_READY",
    blockers: [
      { code: "typecheck-failed", criterion: "typecheck", message: "Step(s) failed: Typecheck.", evidence: [] },
      { code: "p0Issues-failed", criterion: "p0Issues", message: "1 open P0", evidence: [] },
    ],
    warnings: [],
    unknowns: [{ code: "build-unknown", criterion: "build", message: "No build step.", evidence: [] }],
    evidence: [],
  };

  it("suggests P0 for blockers and P1 for missing proof, as level D inference, without touching the source priority", () => {
    const items = itemsFromReadiness(readiness, REPO, NOW);
    expect(items.map((item) => [item.source, item.priority.source, item.priority.suggested])).toEqual([
      ["readiness:typecheck-failed", null, "P0"],
      ["readiness:build-unknown", null, "P1"],
    ]);
    expect(items[0].evidence[0]).toMatchObject({ level: "D", kind: "inference" });
    expect(items[0].confidence).toBe("medium");
  });

  it("keeps source and suggested priority groups separate", () => {
    const issues = [classifyIssue(issue(1, ["P0"]), REPO, NOW), classifyIssue(issue(2, []), REPO, NOW)];
    const block = buildRemainingWork(issues, "", itemsFromReadiness(readiness, REPO, NOW));
    expect(block.state).toBe("AVAILABLE");
    expect(block.bySourcePriority.P0.map((item) => item.source)).toEqual(["issue #1"]);
    expect(block.bySourcePriority.none.map((item) => item.source)).toEqual(["issue #2"]);
    expect(block.bySuggestedPriority.P0.map((item) => item.source)).toEqual(["readiness:typecheck-failed"]);
    expect(block.bySuggestedPriority.P1.map((item) => item.source)).toEqual(["readiness:build-unknown"]);
  });

  it("is unknown when issues are not available, but still lists suggestions", () => {
    const block = buildRemainingWork(null, "Issues are disabled", itemsFromReadiness(readiness, REPO, NOW));
    expect(block).toMatchObject({ state: "UNKNOWN", reason: "Issues are disabled" });
    expect(block.bySuggestedPriority.P0).toHaveLength(1);
  });
});

describe("unknownFeatures", () => {
  it("never infers features", () => {
    expect(unknownFeatures()).toMatchObject({ state: "UNKNOWN", items: [] });
  });
});

describe("itemsFromReadiness grouping", () => {
  it("merges missing proofs that share a cause into one suggested item", () => {
    const cause = "No GitHub Actions run found for commit 6e88ddc.";
    const readiness: ReleaseReadiness = {
      verdict: "UNKNOWN",
      blockers: [],
      warnings: [],
      unknowns: (["ci", "tests", "typecheck", "build"] as const).map((criterion) => ({ code: `${criterion}-unknown`, criterion, message: cause, evidence: [] })),
      evidence: [],
    };
    const items = itemsFromReadiness(readiness, REPO, NOW);
    expect(items.map((item) => [item.source, item.title])).toEqual([["readiness:ci-unknown+tests-unknown+typecheck-unknown+build-unknown", cause]]);
  });
});
