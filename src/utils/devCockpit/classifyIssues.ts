import type {
  CockpitItem,
  Evidence,
  FeaturesBlock,
  Priority,
  ReadinessCheck,
  ReadinessFinding,
  ReleaseReadiness,
  RemainingWorkBlock,
} from "../../types/devCockpit";

/** Label conventions (exact names, case-insensitive). */
export const PRIORITY_LABELS: readonly Priority[] = ["P0", "P1", "P2"];
export const BUG_LABEL = "bug";
export const BLOCKED_LABEL = "blocked";
export const DECISION_LABEL = "decision";

export interface IssueInput {
  number: number;
  title: string;
  url: string;
  labels: string[];
  updatedAt: string;
}

/** Maps a raw GitHub REST issue; pull requests (also returned by the issues API) give null. */
export function toIssueInput(raw: Record<string, unknown>): IssueInput | null {
  if (raw.pull_request) return null;
  const labels = Array.isArray(raw.labels)
    ? (raw.labels as unknown[]).map((label) => (typeof label === "string" ? label : String((label as { name?: unknown })?.name ?? ""))).filter(Boolean)
    : [];
  return {
    number: Number(raw.number),
    title: String(raw.title ?? ""),
    url: String(raw.html_url ?? ""),
    labels,
    updatedAt: String(raw.updated_at ?? ""),
  };
}

function hasLabel(labels: string[], wanted: string): boolean {
  return labels.some((label) => label.trim().toLowerCase() === wanted.toLowerCase());
}

/** Highest priority among the P0/P1/P2 labels, or null when none is set. */
export function sourcePriority(labels: string[]): Priority | null {
  return PRIORITY_LABELS.find((priority) => hasLabel(labels, priority)) ?? null;
}

/** Open issue -> cockpit item. Type and status only come from labels; nothing is inferred. */
export function classifyIssue(issue: IssueInput, repository: string, observedAt: string): CockpitItem {
  const type = hasLabel(issue.labels, BUG_LABEL) ? "BUG" : hasLabel(issue.labels, DECISION_LABEL) ? "DECISION" : "TASK";
  const status = hasLabel(issue.labels, BLOCKED_LABEL) ? "BLOCKED" : "TODO";
  const evidence: Evidence = {
    level: "B",
    kind: "issue",
    source: `issue #${issue.number}`,
    summary: `open${issue.labels.length ? `, labels: ${issue.labels.join(", ")}` : ", no label"}`,
    url: issue.url,
    observedAt,
    confidence: "high",
  };
  return {
    id: `${repository}:issue:${issue.number}`,
    repository,
    title: issue.title,
    type,
    status,
    priority: { source: sourcePriority(issue.labels), suggested: null },
    source: `issue #${issue.number}`,
    evidence: [evidence],
    githubUrl: issue.url,
    lastObservedAt: observedAt,
    confidence: "high",
  };
}

/**
 * Readiness criterion "no open issue labelled P0".
 * `items` null means the open issues could not be read; `issuesEnabled` false means the
 * repository has no issue tracker, so no P0 issue can be open.
 */
export function evaluateP0Issues(
  items: CockpitItem[] | null,
  issuesEnabled: boolean | null,
  observedAt: string,
  repositoryUrl: string | undefined,
  unavailableReason = "Open issues could not be read.",
): ReadinessCheck {
  if (issuesEnabled === false) {
    return {
      id: "p0Issues",
      state: "PASS",
      reason: "Issues are disabled on this repository, so no P0 issue can be open.",
      evidence: [{ level: "B", kind: "repository", source: "repository settings", summary: "has_issues: false", url: repositoryUrl, observedAt, confidence: "high" }],
    };
  }
  if (items === null || issuesEnabled === null) return { id: "p0Issues", state: "UNKNOWN", reason: unavailableReason, evidence: [] };
  const p0 = items.filter((item) => item.priority.source === "P0");
  if (p0.length) {
    return {
      id: "p0Issues",
      state: "FAIL",
      reason: `${p0.length} open issue(s) labelled P0: ${p0.map((item) => item.source).join(", ")}.`,
      evidence: p0.flatMap((item) => item.evidence),
    };
  }
  return {
    id: "p0Issues",
    state: "PASS",
    reason: `No open issue labelled P0 among ${items.length} open issue(s).`,
    evidence: [{ level: "B", kind: "issues", source: "open issues", summary: `${items.length} open, 0 labelled P0`, url: repositoryUrl ? `${repositoryUrl}/issues` : undefined, observedAt, confidence: "high" }],
  };
}

/** Findings sharing the same message (same observed cause), in first-seen order. */
export function groupByMessage(findings: ReadinessFinding[]): ReadinessFinding[][] {
  const groups = new Map<string, ReadinessFinding[]>();
  for (const finding of findings) groups.set(finding.message, [...(groups.get(finding.message) ?? []), finding]);
  return [...groups.values()];
}

/**
 * Items Gitdeck derives from the readiness evaluation, with a suggested priority (level D):
 * a blocker suggests P0, missing proof suggests P1. Open P0 issues are already listed as issues.
 */
export function itemsFromReadiness(readiness: ReleaseReadiness, repository: string, observedAt: string): CockpitItem[] {
  const derive = (code: string, message: string, evidence: Evidence[], suggested: Priority): CockpitItem => ({
    id: `${repository}:readiness:${code}`,
    repository,
    title: message,
    type: "TASK",
    status: "TODO",
    priority: { source: null, suggested },
    source: `readiness:${code}`,
    evidence: [
      { level: "D", kind: "inference", source: "release readiness", summary: `suggested ${suggested}: ${suggested === "P0" ? "blocks the release" : "required proof is missing"}`, observedAt, confidence: "medium" },
      ...evidence,
    ],
    lastObservedAt: observedAt,
    confidence: "medium",
  });
  return [
    ...readiness.blockers.filter((finding) => finding.criterion !== "p0Issues").map((finding) => derive(finding.code, finding.message, finding.evidence, "P0")),
    ...groupByMessage(readiness.unknowns.filter((finding) => finding.criterion !== "p0Issues")).map((findings) =>
      derive(findings.map((finding) => finding.code).join("+"), findings[0].message, findings.flatMap((finding) => finding.evidence), "P1")),
  ];
}

export function buildRemainingWork(issueItems: CockpitItem[] | null, unavailableReason: string, suggestedItems: CockpitItem[]): RemainingWorkBlock {
  const bySourcePriority: RemainingWorkBlock["bySourcePriority"] = { P0: [], P1: [], P2: [], none: [] };
  for (const item of issueItems ?? []) bySourcePriority[item.priority.source ?? "none"].push(item);
  const bySuggestedPriority: RemainingWorkBlock["bySuggestedPriority"] = { P0: [], P1: [], P2: [] };
  for (const item of suggestedItems) if (item.priority.suggested) bySuggestedPriority[item.priority.suggested].push(item);
  return issueItems === null
    ? { state: "UNKNOWN", reason: unavailableReason, bySourcePriority, bySuggestedPriority }
    : { state: "AVAILABLE", reason: `${issueItems.length} open issue(s).`, bySourcePriority, bySuggestedPriority };
}

/** Features have no reliable source yet (roadmap / issues / milestones to be defined): always UNKNOWN. */
export function unknownFeatures(): FeaturesBlock {
  return {
    state: "UNKNOWN",
    reason: "No reliable feature source is configured yet (roadmap, issues or milestones to be defined). Code, routes and components are not used to infer features.",
    items: [],
  };
}
