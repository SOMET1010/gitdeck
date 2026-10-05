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

export interface QualityCheck {
  id: QualityCheckId;
  state: CheckState;
  reason: string;
  evidence: Evidence[];
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
  errors: DevCockpitBlockError[];
}
