import { describe, expect, it } from "vitest";
import {
  buildTestReport,
  evaluateCi,
  evaluateStepCheck,
  latestRunsPerWorkflow,
  matchStepCategories,
  parseVitestReport,
  toJobInput,
  toWorkflowRunInput,
  type JobInput,
  type WorkflowRunInput,
} from "../../../src/utils/devCockpit/ciEvidence";

const HEAD = "abcdef1234567890";
const NOW = "2026-10-05T12:00:00.000Z";

function run(overrides: Partial<WorkflowRunInput> = {}): WorkflowRunInput {
  return {
    id: 1,
    name: "Quality",
    path: ".github/workflows/quality.yml",
    runNumber: 1,
    runAttempt: 1,
    status: "completed",
    conclusion: "success",
    headSha: HEAD,
    htmlUrl: "https://github.com/o/r/actions/runs/1",
    createdAt: NOW,
    ...overrides,
  };
}

function job(steps: JobInput["steps"], runId = 1): JobInput {
  return { id: 10, runId, name: "quality", htmlUrl: "https://github.com/o/r/actions/runs/1/job/10", steps };
}

const step = (name: string, conclusion: string | null = "success", status = "completed") => ({ name, status, conclusion });

describe("matchStepCategories", () => {
  it("matches step names case-insensitively on whole words", () => {
    expect(matchStepCategories("Test")).toEqual(["tests"]);
    expect(matchStepCategories("Run unit tests")).toEqual(["tests"]);
    expect(matchStepCategories("TYPECHECK")).toEqual(["typecheck"]);
    expect(matchStepCategories("type-check")).toEqual(["typecheck"]);
    expect(matchStepCategories("Build")).toEqual(["build"]);
    expect(matchStepCategories("Build and test")).toEqual(["tests", "build"]);
  });

  it("ignores names that only contain the words as substrings", () => {
    expect(matchStepCategories("Upload Vitest report")).toEqual([]);
    expect(matchStepCategories("Set up Docker Buildx")).toEqual([]);
    expect(matchStepCategories("Install dependencies")).toEqual([]);
  });
});

describe("latestRunsPerWorkflow", () => {
  it("keeps the highest run number and attempt per workflow", () => {
    const runs = [
      run({ id: 1, runNumber: 1 }),
      run({ id: 2, runNumber: 2, runAttempt: 1 }),
      run({ id: 3, runNumber: 2, runAttempt: 2 }),
      run({ id: 4, name: "Docker", path: ".github/workflows/docker.yml", runNumber: 7 }),
    ];
    expect(latestRunsPerWorkflow(runs).map((item) => item.id).sort()).toEqual([3, 4]);
  });
});

describe("evaluateCi", () => {
  it("passes when every workflow on the head commit succeeded", () => {
    const result = evaluateCi([run()], HEAD, NOW);
    expect(result.state).toBe("PASS");
    expect(result.evidence[0]).toMatchObject({ level: "A", kind: "ci-run", confidence: "high", observedAt: NOW });
  });

  it("only uses runs of the head commit, never older commits", () => {
    const result = evaluateCi([run({ headSha: "old", conclusion: "success" })], HEAD, NOW);
    expect(result.state).toBe("UNKNOWN");
    expect(result.reason).toContain("abcdef1");
  });

  it("fails when one workflow failed on the head commit", () => {
    const runs = [run(), run({ id: 2, name: "Docker", path: "docker.yml", conclusion: "failure" })];
    expect(evaluateCi(runs, HEAD, NOW).state).toBe("FAIL");
  });

  it("is unknown while a run is in progress or was cancelled", () => {
    expect(evaluateCi([run({ status: "in_progress", conclusion: null })], HEAD, NOW).state).toBe("UNKNOWN");
    expect(evaluateCi([run({ conclusion: "cancelled" })], HEAD, NOW).state).toBe("UNKNOWN");
  });

  it("uses the latest attempt, so a successful re-run replaces a failure", () => {
    const runs = [run({ id: 1, conclusion: "failure" }), run({ id: 2, runAttempt: 2, conclusion: "success" })];
    expect(evaluateCi(runs, HEAD, NOW).state).toBe("PASS");
  });
});

describe("evaluateStepCheck", () => {
  const runs = [run()];

  it("reports each category from its own step", () => {
    const jobs = [job([step("Test"), step("Typecheck", "failure"), step("Build", "skipped")])];
    expect(evaluateStepCheck("tests", runs, jobs, NOW).state).toBe("PASS");
    expect(evaluateStepCheck("typecheck", runs, jobs, NOW).state).toBe("FAIL");
    expect(evaluateStepCheck("build", runs, jobs, NOW).state).toBe("UNKNOWN");
  });

  it("is unknown when no step matches", () => {
    const result = evaluateStepCheck("typecheck", runs, [job([step("Lint")])], NOW);
    expect(result.state).toBe("UNKNOWN");
    expect(result.evidence).toEqual([]);
  });

  it("is unknown when no job data is available", () => {
    expect(evaluateStepCheck("tests", runs, [], NOW).reason).toContain("No CI job data");
  });

  it("ignores jobs of runs that are not part of the evaluated set", () => {
    expect(evaluateStepCheck("tests", runs, [job([step("Test", "failure")], 99)], NOW).state).toBe("UNKNOWN");
  });

  it("gives high confidence to exact names and medium to partial matches", () => {
    const jobs = [job([step("Test"), step("Run integration tests")])];
    const result = evaluateStepCheck("tests", runs, jobs, NOW);
    expect(result.evidence.map((item) => item.confidence)).toEqual(["high", "medium"]);
  });
});

describe("raw mappers", () => {
  it("maps GitHub REST runs and jobs", () => {
    expect(toWorkflowRunInput({ id: 5, name: "Q", path: "q.yml", run_number: 3, run_attempt: 2, status: "completed", conclusion: "success", head_sha: HEAD, html_url: "u", created_at: NOW }))
      .toEqual({ id: 5, name: "Q", path: "q.yml", runNumber: 3, runAttempt: 2, status: "completed", conclusion: "success", headSha: HEAD, htmlUrl: "u", createdAt: NOW });
    expect(toJobInput({ id: 1, run_id: 5, name: "j", html_url: "u", steps: [{ name: "Test", status: "completed", conclusion: "success" }] }).steps)
      .toEqual([step("Test")]);
  });
});

describe("Vitest report", () => {
  const report = { numTotalTests: 6, numPassedTests: 3, numFailedTests: 1, numPendingTests: 1, numTodoTests: 1, numFailedTestSuites: 1 };

  it("parses passed, failed, skipped and todo counts", () => {
    expect(parseVitestReport(report)).toEqual({ total: 6, passed: 3, failed: 1, skipped: 1, todo: 1, failedSuites: 1 });
  });

  it("rejects unrecognised shapes", () => {
    expect(parseVitestReport(null)).toBeNull();
    expect(parseVitestReport({ numTotalTests: "6" })).toBeNull();
  });

  it("builds an available report with level A evidence", () => {
    const result = buildTestReport(report, "artifact vitest-report", "u", NOW);
    expect(result.state).toBe("AVAILABLE");
    expect(result.evidence[0]).toMatchObject({ level: "A", kind: "test-report", confidence: "high" });
  });

  it("builds an unknown report from an invalid file", () => {
    expect(buildTestReport({}, "artifact vitest-report", "u", NOW)).toMatchObject({ state: "UNKNOWN", counts: null });
  });
});
