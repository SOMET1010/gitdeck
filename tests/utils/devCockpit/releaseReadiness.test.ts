import { describe, expect, it } from "vitest";
import type { CheckState, ReadinessCheck, ReadinessCriterionId, TestReport } from "../../../src/types/devCockpit";
import { evaluateReleaseReadiness } from "../../../src/utils/devCockpit/releaseReadiness";

const NOW = "2026-10-05T12:00:00.000Z";

function check(id: ReadinessCriterionId, state: CheckState): ReadinessCheck {
  return {
    id,
    state,
    reason: `${id} is ${state}`,
    evidence: state === "UNKNOWN" ? [] : [{ level: "A", kind: "ci-step", source: id, summary: state, observedAt: NOW, confidence: "high" }],
  };
}

function checks(states: Partial<Record<ReadinessCriterionId, CheckState>> = {}) {
  const ids: ReadinessCriterionId[] = ["ci", "tests", "typecheck", "build", "p0Issues"];
  return Object.fromEntries(ids.map((id) => [id, check(id, states[id] ?? "PASS")])) as Record<ReadinessCriterionId, ReadinessCheck>;
}

function report(counts: Partial<NonNullable<TestReport["counts"]>> = {}): TestReport {
  return {
    state: "AVAILABLE",
    counts: { total: 10, passed: 10, failed: 0, skipped: 0, todo: 0, failedSuites: 0, ...counts },
    reason: "ok",
    evidence: [{ level: "A", kind: "test-report", source: "artifact", summary: "counts", observedAt: NOW, confidence: "high" }],
  };
}

describe("evaluateReleaseReadiness", () => {
  it("is READY when every required check is proven green", () => {
    const result = evaluateReleaseReadiness({ checks: checks(), testReport: report() });
    expect(result.verdict).toBe("READY");
    expect(result.blockers).toEqual([]);
    expect(result.unknowns).toEqual([]);
    expect(result.evidence.length).toBe(6);
  });

  it("is NOT_READY when a required check is explicitly red", () => {
    const result = evaluateReleaseReadiness({ checks: checks({ typecheck: "FAIL" }), testReport: report() });
    expect(result.verdict).toBe("NOT_READY");
    expect(result.blockers.map((item) => item.code)).toEqual(["typecheck-failed"]);
    expect(result.blockers[0].evidence.length).toBe(1);
  });

  it("is NOT_READY when the test report contains failures even if steps are green", () => {
    const result = evaluateReleaseReadiness({ checks: checks(), testReport: report({ failed: 2, passed: 8 }) });
    expect(result.verdict).toBe("NOT_READY");
    expect(result.blockers.map((item) => item.code)).toEqual(["tests-report-failed"]);
  });

  it("is NOT_READY rather than UNKNOWN when red and missing proofs coexist", () => {
    const result = evaluateReleaseReadiness({ checks: checks({ build: "FAIL", ci: "UNKNOWN" }) });
    expect(result.verdict).toBe("NOT_READY");
    expect(result.unknowns.map((item) => item.code)).toEqual(["ci-unknown"]);
  });

  it("is UNKNOWN when a required proof is inconclusive", () => {
    const result = evaluateReleaseReadiness({ checks: checks({ build: "UNKNOWN" }), testReport: report() });
    expect(result.verdict).toBe("UNKNOWN");
    expect(result.unknowns.map((item) => item.code)).toEqual(["build-unknown"]);
  });

  it("never turns missing data into READY", () => {
    expect(evaluateReleaseReadiness({ checks: {} }).verdict).toBe("UNKNOWN");
    const { ci, tests, typecheck } = checks();
    const result = evaluateReleaseReadiness({ checks: { ci, tests, typecheck }, testReport: report() });
    expect(result.verdict).toBe("UNKNOWN");
    expect(result.unknowns.map((item) => item.code)).toEqual(["build-missing", "p0Issues-missing"]);
  });

  it("never turns an empty set of criteria into READY", () => {
    const result = evaluateReleaseReadiness({ checks: checks(), testReport: report() }, []);
    expect(result.verdict).toBe("UNKNOWN");
    expect(result.unknowns.map((item) => item.code)).toEqual(["no-criteria"]);
  });

  it("stays UNKNOWN when every check is UNKNOWN, whatever the test report says", () => {
    const states = { ci: "UNKNOWN", tests: "UNKNOWN", typecheck: "UNKNOWN", build: "UNKNOWN", p0Issues: "UNKNOWN" } as const;
    expect(evaluateReleaseReadiness({ checks: checks(states), testReport: report() }).verdict).toBe("UNKNOWN");
  });

  it("is NOT_READY when an open P0 issue is reported", () => {
    const result = evaluateReleaseReadiness({ checks: checks({ p0Issues: "FAIL" }), testReport: report() });
    expect(result.verdict).toBe("NOT_READY");
    expect(result.blockers[0]).toMatchObject({ code: "p0Issues-failed", criterion: "p0Issues" });
  });

  it("is UNKNOWN when open issues could not be read", () => {
    expect(evaluateReleaseReadiness({ checks: checks({ p0Issues: "UNKNOWN" }), testReport: report() }).verdict).toBe("UNKNOWN");
  });

  it("warns about skipped and todo tests and about missing counts without blocking", () => {
    const withSkips = evaluateReleaseReadiness({ checks: checks(), testReport: report({ skipped: 2, todo: 1 }) });
    expect(withSkips.verdict).toBe("READY");
    expect(withSkips.warnings.map((item) => item.code)).toEqual(["tests-skipped", "tests-todo"]);

    const withoutReport = evaluateReleaseReadiness({ checks: checks() });
    expect(withoutReport.verdict).toBe("READY");
    expect(withoutReport.warnings.map((item) => item.code)).toEqual(["tests-report-unavailable"]);
  });
});
