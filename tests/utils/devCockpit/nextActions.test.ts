import { describe, expect, it } from "vitest";
import type { Evidence, ReleaseReadiness } from "../../../src/types/devCockpit";
import { classifyIssue } from "../../../src/utils/devCockpit/classifyIssues";
import { buildNextActions } from "../../../src/utils/devCockpit/nextActions";

const NOW = "2026-10-06T08:00:00.000Z";
const REPO = "owner/repo";
const STEP: Evidence = { level: "A", kind: "ci-step", source: "step Typecheck", summary: "conclusion: failure", observedAt: NOW, confidence: "high" };

function readiness(partial: Partial<ReleaseReadiness>): ReleaseReadiness {
  return { verdict: "UNKNOWN", blockers: [], warnings: [], unknowns: [], evidence: [], ...partial };
}

const issue = (number: number, labels: string[]) =>
  classifyIssue({ number, title: `Issue ${number}`, url: `u${number}`, labels, updatedAt: NOW }, REPO, NOW);

describe("buildNextActions", () => {
  it("puts readiness blockers first, with their evidence and a suggested P0", () => {
    const actions = buildNextActions(readiness({
      blockers: [
        { code: "typecheck-failed", criterion: "typecheck", message: "Step(s) failed: Typecheck.", evidence: [STEP] },
        { code: "tests-report-failed", criterion: "tests", message: "2 failed", evidence: [STEP] },
      ],
    }), [issue(1, ["P0"])], NOW);
    expect(actions.map((action) => [action.kind, action.target])).toEqual([
      ["fix-check", "typecheck"],
      ["fix-failing-tests", "tests"],
      ["resolve-issue", "1"],
    ]);
    expect(actions[0]).toMatchObject({ priority: { source: null, suggested: "P0" }, evidence: [STEP] });
    expect(actions[2].priority).toEqual({ source: "P0", suggested: null });
  });

  it("merges missing proofs that share a cause into one action with explicit provenance", () => {
    const cause = "No GitHub Actions run found for commit 6e88ddc.";
    const actions = buildNextActions(readiness({
      unknowns: ["ci", "tests", "typecheck", "build"].map((criterion) => ({ code: `${criterion}-unknown`, criterion: criterion as "ci", message: cause, evidence: [] })),
    }), [], NOW);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ kind: "provide-proof", target: "ci, tests, typecheck, build", priority: { suggested: "P1" } });
    expect(actions[0].evidence).toEqual([{ level: "D", kind: "readiness", source: "release readiness / ci, tests, typecheck, build", summary: cause, observedAt: NOW, confidence: "high" }]);
  });

  it("orders P0 issues before missing proof and P1 issues, blocked issues first", () => {
    const actions = buildNextActions(readiness({
      unknowns: [{ code: "build-unknown", criterion: "build", message: "No build step.", evidence: [] }],
    }), [issue(3, ["P1"]), issue(4, ["P1", "blocked"]), issue(2, ["P0"]), issue(5, ["P2"]), issue(6, [])], NOW);
    expect(actions.map((action) => [action.kind, action.target])).toEqual([
      ["resolve-issue", "2"],
      ["provide-proof", "build"],
      ["unblock-issue", "4"],
      ["resolve-issue", "3"],
    ]);
  });

  it("never returns more than five actions and skips the P0 criterion already covered by its issues", () => {
    const issues = Array.from({ length: 8 }, (_, index) => issue(index + 1, ["P0"]));
    const actions = buildNextActions(readiness({
      blockers: [{ code: "p0Issues-failed", criterion: "p0Issues", message: "8 open P0", evidence: [] }],
    }), issues, NOW);
    expect(actions).toHaveLength(5);
    expect(actions.every((action) => action.kind === "resolve-issue")).toBe(true);
  });

  it("returns nothing when there is no evidence-backed action", () => {
    expect(buildNextActions(readiness({ verdict: "READY" }), [issue(9, ["P2"])], NOW)).toEqual([]);
  });
});
