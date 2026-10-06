/**
 * Dev Cockpit model.
 *
 * Evidence levels:
 * - A: executed proof (CI runs, CI steps, test reports)
 * - B: GitHub state (issues, PRs, milestones, releases, security alerts)
 * - C: repository content (files, markers, docs)
 * - D: inference made by Gitdeck; never reported with "high" confidence
 */
export type EvidenceLevel = "A" | "B" | "C" | "D";

export type Confidence = "high" | "medium" | "low";

export interface Evidence {
  level: EvidenceLevel;
  /** Machine-readable origin, e.g. "ci-run", "ci-step", "test-report", "commit". */
  kind: string;
  /** Human-readable source, e.g. "workflow Quality #12 / step Typecheck". */
  source: string;
  /** What was observed, e.g. "conclusion: failure". */
  summary: string;
  url?: string;
  observedAt: string;
  confidence: Confidence;
}

export type CockpitItemType = "FEATURE" | "TASK" | "TEST" | "BUG" | "RISK" | "TECH_DEBT" | "DECISION";

export type CockpitStatus = "DONE" | "PARTIAL" | "TODO" | "BLOCKED" | "UNKNOWN";

export type Priority = "P0" | "P1" | "P2";

export interface CockpitItem {
  id: string;
  repository: string;
  title: string;
  description?: string;
  type: CockpitItemType;
  status: CockpitStatus;
  /** Priority carried by the source (label) and priority suggested by Gitdeck are never merged. */
  priority: { source: Priority | null; suggested: Priority | null };
  source: string;
  evidence: Evidence[];
  githubUrl?: string;
  commit?: string;
  branch?: string;
  pullRequest?: number;
  tests?: string[];
  lastObservedAt: string;
  confidence: Confidence;
}

/** Outcome of one quality check. UNKNOWN always carries a reason. */
export type CheckState = "PASS" | "FAIL" | "UNKNOWN";

export type QualityCheckId = "ci" | "tests" | "typecheck" | "build";

/** Criteria a release readiness verdict can require. */
export type ReadinessCriterionId = QualityCheckId | "p0Issues";

export interface ReadinessCheck {
  id: ReadinessCriterionId;
  state: CheckState;
  reason: string;
  evidence: Evidence[];
}

export interface QualityCheck extends ReadinessCheck {
  id: QualityCheckId;
}

export interface TestCounts {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  todo: number;
  failedSuites: number;
}

export interface TestReport {
  state: "AVAILABLE" | "UNKNOWN";
  counts: TestCounts | null;
  reason: string;
  evidence: Evidence[];
}

export type ReadinessVerdict = "READY" | "NOT_READY" | "UNKNOWN";

export interface ReadinessFinding {
  code: string;
  /** Criterion the finding is about, when it comes from a required criterion. */
  criterion?: ReadinessCriterionId;
  message: string;
  evidence: Evidence[];
}

export interface ReleaseReadiness {
  verdict: ReadinessVerdict;
  blockers: ReadinessFinding[];
  warnings: ReadinessFinding[];
  /** Required proofs that are missing, unreachable or unidentifiable. */
  unknowns: ReadinessFinding[];
  evidence: Evidence[];
}

export interface HeadCommit {
  sha: string;
  branch: string;
  message: string;
  url: string;
  committedAt: string | null;
}

/** Block-level availability: UNKNOWN always carries a reason. */
export type BlockState = "AVAILABLE" | "UNKNOWN";

export interface FeaturesBlock {
  state: BlockState;
  reason: string;
  items: CockpitItem[];
}

export interface RemainingWorkBlock {
  state: BlockState;
  reason: string;
  /** Open items grouped by the priority carried by their source (labels). */
  bySourcePriority: Record<Priority | "none", CockpitItem[]>;
  /** Items Gitdeck suggests a priority for (inference, level D), grouped by that suggestion. */
  bySuggestedPriority: Record<Priority, CockpitItem[]>;
}

export type NextActionKind = "fix-check" | "fix-failing-tests" | "resolve-issue" | "unblock-issue" | "provide-proof";

export interface NextAction {
  id: string;
  kind: NextActionKind;
  /** English fallback title; the UI translates from `kind` and `target`. */
  title: string;
  /** Check id, issue number or criterion the action is about. */
  target: string;
  /** What the action is about in plain words: issue title or observed cause. */
  subject: string;
  priority: { source: Priority | null; suggested: Priority | null };
  url?: string;
  evidence: Evidence[];
}

export interface DevCockpitBlockError {
  block: string;
  reason: string;
}

export interface DevCockpitData {
  ok: true;
  repository: string;
  observedAt: string;
  headCommit: HeadCommit | null;
  readiness: ReleaseReadiness;
  quality: {
    ci: QualityCheck;
    tests: QualityCheck;
    typecheck: QualityCheck;
    build: QualityCheck;
    testReport: TestReport;
  };
  /** Readiness criterion "no open issue labelled P0". */
  p0Issues: ReadinessCheck;
  features: FeaturesBlock;
  remaining: RemainingWorkBlock;
  nextActions: NextAction[];
  errors: DevCockpitBlockError[];
}
