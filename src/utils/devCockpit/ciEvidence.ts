import type { CheckState, Confidence, Evidence, QualityCheck, QualityCheckId, TestCounts, TestReport } from "../../types/devCockpit";

export interface WorkflowRunInput {
  id: number;
  name: string | null;
  path: string | null;
  runNumber: number;
  runAttempt: number;
  status: string;
  conclusion: string | null;
  headSha: string;
  htmlUrl: string;
  createdAt: string;
}

export interface StepInput {
  name: string;
  status: string;
  conclusion: string | null;
}

export interface JobInput {
  id: number;
  runId: number;
  name: string;
  htmlUrl: string;
  steps: StepInput[];
}

export type StepCategory = Exclude<QualityCheckId, "ci">;

const STEP_PATTERNS: Record<StepCategory, RegExp> = {
  typecheck: /\btype[\s_-]?check(?:s|ing)?\b/i,
  tests: /\btests?\b/i,
  build: /\bbuild\b/i,
};

const FAILED_CONCLUSIONS = new Set(["failure", "timed_out", "startup_failure"]);
const PASSED_CONCLUSIONS = new Set(["success"]);

type Outcome = "pass" | "fail" | "unknown";

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function outcomeOf(status: string, conclusion: string | null): Outcome {
  if (status !== "completed") return "unknown";
  if (conclusion && FAILED_CONCLUSIONS.has(conclusion)) return "fail";
  if (conclusion && PASSED_CONCLUSIONS.has(conclusion)) return "pass";
  return "unknown";
}

function describe(status: string, conclusion: string | null): string {
  return status === "completed" ? `conclusion: ${conclusion ?? "none"}` : `status: ${status}`;
}

function runLabel(run: WorkflowRunInput): string {
  return `workflow ${run.name ?? run.path ?? run.id} #${run.runNumber}`;
}

/** Maps a raw GitHub REST workflow run to the input shape used here. */
export function toWorkflowRunInput(raw: Record<string, unknown>): WorkflowRunInput {
  return {
    id: Number(raw.id),
    name: typeof raw.name === "string" ? raw.name : null,
    path: typeof raw.path === "string" ? raw.path : null,
    runNumber: Number(raw.run_number ?? 0),
    runAttempt: Number(raw.run_attempt ?? 1),
    status: String(raw.status ?? ""),
    conclusion: typeof raw.conclusion === "string" ? raw.conclusion : null,
    headSha: String(raw.head_sha ?? ""),
    htmlUrl: String(raw.html_url ?? ""),
    createdAt: String(raw.created_at ?? ""),
  };
}

/** Maps a raw GitHub REST job to the input shape used here. */
export function toJobInput(raw: Record<string, unknown>): JobInput {
  const steps = Array.isArray(raw.steps) ? (raw.steps as Record<string, unknown>[]) : [];
  return {
    id: Number(raw.id),
    runId: Number(raw.run_id),
    name: String(raw.name ?? ""),
    htmlUrl: String(raw.html_url ?? ""),
    steps: steps.map((step) => ({
      name: String(step.name ?? ""),
      status: String(step.status ?? ""),
      conclusion: typeof step.conclusion === "string" ? step.conclusion : null,
    })),
  };
}

/** Keeps the most recent run (highest run number, then attempt) of each workflow. */
export function latestRunsPerWorkflow(runs: WorkflowRunInput[]): WorkflowRunInput[] {
  const latest = new Map<string, WorkflowRunInput>();
  for (const run of runs) {
    const key = run.path ?? run.name ?? String(run.id);
    const current = latest.get(key);
    if (
      !current ||
      run.runNumber > current.runNumber ||
      (run.runNumber === current.runNumber && run.runAttempt > current.runAttempt)
    ) {
      latest.set(key, run);
    }
  }
  return [...latest.values()].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
}

/** Categories a CI step name matches (case-insensitive, whole words). */
export function matchStepCategories(stepName: string): StepCategory[] {
  return (Object.keys(STEP_PATTERNS) as StepCategory[]).filter((category) => STEP_PATTERNS[category].test(stepName));
}

function aggregate(outcomes: Outcome[]): CheckState {
  if (outcomes.includes("fail")) return "FAIL";
  if (outcomes.length === 0 || outcomes.includes("unknown")) return "UNKNOWN";
  return "PASS";
}

/**
 * CI status of one commit: only runs whose head SHA is that commit, latest run per workflow.
 * Older runs on other commits are never used.
 */
export function evaluateCi(runs: WorkflowRunInput[], headSha: string, observedAt: string): QualityCheck {
  const onHead = latestRunsPerWorkflow(runs.filter((run) => run.headSha === headSha));
  if (onHead.length === 0) {
    return {
      id: "ci",
      state: "UNKNOWN",
      reason: `No GitHub Actions run found for commit ${shortSha(headSha)}.`,
      evidence: [],
    };
  }
  const outcomes = onHead.map((run) => outcomeOf(run.status, run.conclusion));
  const evidence: Evidence[] = onHead.map((run) => ({
    level: "A",
    kind: "ci-run",
    source: runLabel(run),
    summary: `${describe(run.status, run.conclusion)} on ${shortSha(run.headSha)}`,
    url: run.htmlUrl,
    observedAt,
    confidence: "high",
  }));
  const state = aggregate(outcomes);
  const failing = onHead.filter((_, index) => outcomes[index] === "fail").map(runLabel);
  const undecided = onHead.filter((_, index) => outcomes[index] === "unknown").map(runLabel);
  const reason =
    state === "FAIL"
      ? `Failed on ${shortSha(headSha)}: ${failing.join(", ")}.`
      : state === "UNKNOWN"
        ? `Not conclusive on ${shortSha(headSha)} (pending, cancelled or skipped): ${undecided.join(", ")}.`
        : `All ${onHead.length} workflow(s) succeeded on ${shortSha(headSha)}.`;
  return { id: "ci", state, reason, evidence };
}

/**
 * Status of the test / typecheck / build steps found in the jobs of the given runs.
 * A category without any matching step is UNKNOWN.
 */
export function evaluateStepCheck(
  category: StepCategory,
  runs: WorkflowRunInput[],
  jobs: JobInput[],
  observedAt: string,
): QualityCheck {
  const runsById = new Map(runs.map((run) => [run.id, run]));
  const matches: { job: JobInput; step: StepInput; run: WorkflowRunInput | undefined }[] = [];
  for (const job of jobs) {
    if (!runsById.has(job.runId)) continue;
    for (const step of job.steps) {
      if (matchStepCategories(step.name).includes(category)) matches.push({ job, step, run: runsById.get(job.runId) });
    }
  }
  if (matches.length === 0) {
    return {
      id: category,
      state: "UNKNOWN",
      reason: jobs.length === 0
        ? `No CI job data available to find a "${category}" step.`
        : `No CI step whose name matches "${category}" was found.`,
      evidence: [],
    };
  }
  const outcomes = matches.map(({ step }) => outcomeOf(step.status, step.conclusion));
  const evidence: Evidence[] = matches.map(({ job, step, run }) => {
    const exact = step.name.trim().toLowerCase() === category || step.name.trim().toLowerCase() === category.replace(/s$/, "");
    const confidence: Confidence = exact ? "high" : "medium";
    return {
      level: "A",
      kind: "ci-step",
      source: `${run ? runLabel(run) : `run ${job.runId}`} / job ${job.name} / step ${step.name}`,
      summary: describe(step.status, step.conclusion),
      url: job.htmlUrl,
      observedAt,
      confidence,
    };
  });
  const state = aggregate(outcomes);
  const names = (wanted: Outcome) => matches.filter((_, index) => outcomes[index] === wanted).map(({ step }) => step.name);
  const reason =
    state === "FAIL"
      ? `Step(s) failed: ${names("fail").join(", ")}.`
      : state === "UNKNOWN"
        ? `Step(s) not conclusive (pending, skipped or cancelled): ${names("unknown").join(", ")}.`
        : `Step(s) succeeded: ${names("pass").join(", ")}.`;
  return { id: category, state, reason, evidence };
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/** Reads counts from a Vitest (Jest-compatible) JSON report; null when the shape is not recognised. */
export function parseVitestReport(json: unknown): TestCounts | null {
  if (!json || typeof json !== "object") return null;
  const report = json as Record<string, unknown>;
  const total = count(report.numTotalTests);
  const passed = count(report.numPassedTests);
  const failed = count(report.numFailedTests);
  const skipped = count(report.numPendingTests);
  const todo = count(report.numTodoTests);
  if (total === null || passed === null || failed === null || skipped === null || todo === null) return null;
  return { total, passed, failed, skipped, todo, failedSuites: count(report.numFailedTestSuites) ?? 0 };
}

export function unknownTestReport(reason: string): TestReport {
  return { state: "UNKNOWN", counts: null, reason, evidence: [] };
}

/** Builds the test report block from a parsed JSON report and where it came from. */
export function buildTestReport(json: unknown, source: string, url: string | undefined, observedAt: string): TestReport {
  const counts = parseVitestReport(json);
  if (!counts) return unknownTestReport(`Report from ${source} is not a recognised Vitest JSON report.`);
  return {
    state: "AVAILABLE",
    counts,
    reason: `${counts.passed} passed, ${counts.failed} failed, ${counts.skipped} skipped, ${counts.todo} todo (${counts.total} total).`,
    evidence: [{
      level: "A",
      kind: "test-report",
      source,
      summary: `total ${counts.total}, passed ${counts.passed}, failed ${counts.failed}, skipped ${counts.skipped}, todo ${counts.todo}, failed suites ${counts.failedSuites}`,
      url,
      observedAt,
      confidence: "high",
    }],
  };
}
