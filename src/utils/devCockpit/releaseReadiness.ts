import type {
  Evidence,
  ReadinessCheck,
  ReadinessCriterionId,
  ReadinessFinding,
  ReleaseReadiness,
  TestReport,
} from "../../types/devCockpit";

/** Criteria that must be proven satisfied for a READY verdict (MVP defaults). */
export const DEFAULT_REQUIRED_CHECKS: readonly ReadinessCriterionId[] = ["ci", "tests", "typecheck", "build", "p0Issues"];

export interface ReadinessInput {
  checks: Partial<Record<ReadinessCriterionId, ReadinessCheck>>;
  testReport?: TestReport | null;
}

/**
 * Release readiness from evidence only:
 * - any required criterion proven failed, or failing tests in the report -> NOT_READY;
 * - otherwise any required proof missing, unreachable or inconclusive -> UNKNOWN;
 * - READY only when every required criterion is configured and proven satisfied.
 * UNKNOWN is never promoted to READY, and no score is computed.
 */
export function evaluateReleaseReadiness(
  input: ReadinessInput,
  requiredChecks: readonly ReadinessCriterionId[] = DEFAULT_REQUIRED_CHECKS,
): ReleaseReadiness {
  const blockers: ReadinessFinding[] = [];
  const warnings: ReadinessFinding[] = [];
  const unknowns: ReadinessFinding[] = [];
  const evidence: Evidence[] = [];

  if (requiredChecks.length === 0) {
    unknowns.push({ code: "no-criteria", message: "No readiness criterion is configured.", evidence: [] });
  }

  for (const id of requiredChecks) {
    const check = input.checks[id];
    if (!check) {
      unknowns.push({ code: `${id}-missing`, criterion: id, message: `Check "${id}" was not evaluated.`, evidence: [] });
      continue;
    }
    evidence.push(...check.evidence);
    if (check.state === "FAIL") {
      blockers.push({ code: `${id}-failed`, criterion: id, message: check.reason, evidence: check.evidence });
    } else if (check.state === "UNKNOWN") {
      unknowns.push({ code: `${id}-unknown`, criterion: id, message: check.reason, evidence: check.evidence });
    }
  }

  const report = input.testReport;
  if (report?.state === "AVAILABLE" && report.counts) {
    evidence.push(...report.evidence);
    const { failed, failedSuites, skipped, todo } = report.counts;
    if (failed > 0 || failedSuites > 0) {
      blockers.push({
        code: "tests-report-failed",
        criterion: "tests",
        message: `Test report: ${failed} failed test(s), ${failedSuites} failed suite(s).`,
        evidence: report.evidence,
      });
    }
    if (skipped > 0) {
      warnings.push({ code: "tests-skipped", message: `Test report: ${skipped} skipped test(s).`, evidence: report.evidence });
    }
    if (todo > 0) {
      warnings.push({ code: "tests-todo", message: `Test report: ${todo} todo test(s).`, evidence: report.evidence });
    }
  } else {
    warnings.push({
      code: "tests-report-unavailable",
      message: `Test counts unavailable: ${report?.reason ?? "no test report"}`,
      evidence: [],
    });
  }

  const verdict = blockers.length > 0 ? "NOT_READY" : unknowns.length > 0 ? "UNKNOWN" : "READY";
  return { verdict, blockers, warnings, unknowns, evidence };
}
