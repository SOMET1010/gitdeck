import type { CockpitItem, Evidence, NextAction, ReleaseReadiness } from "../../types/devCockpit";
import { groupByMessage } from "./classifyIssues";

export const MAX_NEXT_ACTIONS = 5;

function fromIssue(item: CockpitItem): NextAction {
  const blocked = item.status === "BLOCKED";
  const number = item.source.replace(/^issue #/, "");
  return {
    id: `${blocked ? "unblock" : "resolve"}:${item.id}`,
    kind: blocked ? "unblock-issue" : "resolve-issue",
    title: `${blocked ? "Unblock" : "Resolve"} ${item.source}: ${item.title}`,
    target: number,
    subject: item.title,
    priority: { ...item.priority },
    url: item.githubUrl,
    evidence: item.evidence,
  };
}

/**
 * At most `max` actions, each traceable to its evidence, in this order:
 * 1. readiness blockers (suggested P0), 2. open P0 issues (source P0),
 * 3. missing readiness proof (suggested P1), 4. open P1 issues (source P1).
 * Blocked issues come first within their priority. Nothing else is invented.
 */
export function buildNextActions(
  readiness: ReleaseReadiness,
  issueItems: CockpitItem[],
  observedAt: string,
  max = MAX_NEXT_ACTIONS,
): NextAction[] {
  // When a finding has no evidence of its own (missing proof), the readiness observation is the provenance.
  const provenance = (evidence: Evidence[], criteria: string, message: string): Evidence[] => (evidence.length
    ? evidence
    : [{ level: "D", kind: "readiness", source: `release readiness / ${criteria}`, summary: message, observedAt, confidence: "high" }]);

  const blockedFirst = (a: CockpitItem, b: CockpitItem) => Number(b.status === "BLOCKED") - Number(a.status === "BLOCKED");
  const issuesWith = (priority: "P0" | "P1") => issueItems.filter((item) => item.priority.source === priority).sort(blockedFirst).map(fromIssue);

  const blockerActions: NextAction[] = readiness.blockers
    .filter((finding) => finding.criterion !== "p0Issues")
    .map((finding) => ({
      id: `fix:${finding.code}`,
      kind: finding.code === "tests-report-failed" ? "fix-failing-tests" : "fix-check",
      title: finding.code === "tests-report-failed" ? "Fix the failing tests" : `Fix ${finding.criterion ?? finding.code}`,
      target: finding.criterion ?? finding.code,
      subject: finding.message,
      priority: { source: null, suggested: "P0" },
      evidence: provenance(finding.evidence, finding.criterion ?? finding.code, finding.message),
    }));

  // Missing proofs sharing the same cause (e.g. no CI run on the head commit) become one action.
  const proofActions: NextAction[] = groupByMessage(
    readiness.unknowns.filter((finding) => finding.criterion && finding.criterion !== "p0Issues"),
  ).map((findings) => {
    const message = findings[0].message;
    const criteria = findings.map((finding) => finding.criterion).join(", ");
    return {
      id: `prove:${findings.map((finding) => finding.code).join("+")}`,
      kind: "provide-proof",
      title: `Provide proof for ${criteria}: ${message}`,
      target: criteria,
      subject: message,
      priority: { source: null, suggested: "P1" },
      evidence: provenance(findings.flatMap((finding) => finding.evidence), criteria, message),
    };
  });

  const seen = new Set<string>();
  return [...blockerActions, ...issuesWith("P0"), ...proofActions, ...issuesWith("P1")]
    .filter((action) => (seen.has(action.id) ? false : (seen.add(action.id), true)))
    .slice(0, max);
}
