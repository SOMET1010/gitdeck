import type { CheckState, Evidence, ReadinessVerdict } from "./devCockpit";

/**
 * Attention buckets, from most to least urgent. Computed from evidence by ordered rules
 * (no score); a manual override can force another bucket for a limited time.
 */
export type AttentionBucket = "NOW" | "URGENT" | "BLOCKED" | "ALMOST_DONE" | "CAN_WAIT" | "INACTIVE" | "ARCHIVE_CANDIDATE" | "UNKNOWN";

export const ATTENTION_BUCKETS: readonly AttentionBucket[] = [
  "NOW", "URGENT", "BLOCKED", "ALMOST_DONE", "CAN_WAIT", "INACTIVE", "ARCHIVE_CANDIDATE", "UNKNOWN",
];

export interface AttentionThresholds {
  /** A milestone due within this many days is "close". */
  deadlineDays: number;
  /** No push for this many days makes a repository inactive. */
  inactiveDays: number;
  /** No push for this many days suggests archiving. */
  archiveDays: number;
  /** Share of closed milestone issues (0..1) considered "almost done". */
  almostDoneRatio: number;
}

export const DEFAULT_THRESHOLDS: AttentionThresholds = {
  deadlineDays: 7,
  inactiveDays: 30,
  archiveDays: 180,
  almostDoneRatio: 0.8,
};

export interface PullRequestSignal {
  number: number;
  title: string;
  url: string;
  draft: boolean;
  labels: string[];
  /** GitHub mergeable_state: clean, dirty (conflict), unstable (checks failing), blocked (protection), behind, unknown, draft. */
  mergeableState: string | null;
}

export interface MilestoneSignal {
  title: string;
  url: string;
  dueOn: string | null;
  openIssues: number;
  closedIssues: number;
}

export interface IssueCounts {
  open: number;
  p0: number;
  p1: number;
  p2: number;
  bug: number;
  blocked: number;
  decision: number;
}

/** Light signals, available for every repository from the repository list. */
export interface LightSignals {
  repository: string;
  url: string;
  pushedAt: string | null;
  isArchived: boolean;
  isFork: boolean;
  openIssueCount: number | null;
}

/** Deep signals, collected only for repositories selected for full evaluation. */
export interface DeepSignals {
  defaultBranch: string | null;
  sizeKb: number | null;
  ci: { state: CheckState; reason: string; evidence: Evidence[] };
  readiness: ReadinessVerdict;
  issues: IssueCounts | null;
  issuesReason: string;
  pullRequests: PullRequestSignal[] | null;
  milestones: MilestoneSignal[] | null;
  draftReleases: number | null;
  latestReleaseAt: string | null;
  errors: string[];
}

export interface RepoSignals {
  light: LightSignals;
  deep: DeepSignals | null;
}

export interface AttentionReason {
  code: string;
  message: string;
  evidence: Evidence[];
}

export interface AttentionOverride {
  repository: string;
  bucket: AttentionBucket;
  reason: string;
  setAt: string;
  expiresAt: string;
}

export interface RepoAttention {
  repository: string;
  url: string;
  computed: { bucket: AttentionBucket; reasons: AttentionReason[] };
  /** Active (not expired) override, shown next to the computed bucket, never merged into it. */
  override: AttentionOverride | null;
  /** Bucket used for display: the override when active, the computed bucket otherwise. */
  effectiveBucket: AttentionBucket;
  /** Deterministic ordering inside a bucket: closest deadline first, then most recent push. */
  sortKey: { deadline: string | null; pushedAt: string | null };
  evaluated: "deep" | "light";
  pushedAt: string | null;
  duplicateGroup: string | null;
  signals: RepoSignals;
}

export interface DuplicateGroup {
  key: string;
  repositories: string[];
  /** Most recently pushed repository of the group (suggested canonical, inference). */
  suggestedCanonical: string;
}

export interface TodaySummary {
  decisions: number;
  blockingPullRequests: number;
  redCi: number;
  inactive: number;
  duplicateCandidates: number;
  now: number;
}

export type HistoryEntry =
  | { type: "override-set"; repository: string; at: string; from: AttentionBucket | null; to: AttentionBucket; reason: string; expiresAt: string }
  | { type: "override-cleared"; repository: string; at: string; from: AttentionBucket; reason: string }
  | { type: "computed-change"; repository: string; at: string; from: AttentionBucket | null; to: AttentionBucket; reason: string };

export interface AttentionData {
  ok: true;
  observedAt: string;
  thresholds: AttentionThresholds;
  repos: RepoAttention[];
  today: TodaySummary;
  duplicates: DuplicateGroup[];
  coverage: { listed: number; deepEvaluated: number; deepLimit: number; listSource: "account" | "watch-list"; listError: string | null };
  watchList: string[];
}

export type BriefQuestion = "cleanup" | "week" | "now";

export interface BriefItem {
  repository: string;
  title: string;
  reason: string;
  url?: string;
  evidence: Evidence[];
}

export interface AttentionBrief {
  ok: true;
  question: BriefQuestion;
  observedAt: string;
  summary: string;
  items: BriefItem[];
  /** Always true: the brief only proposes, it never changes anything on GitHub. */
  readOnly: true;
}
