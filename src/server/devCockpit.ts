import type { CockpitItem, DevCockpitBlockError, DevCockpitData, HeadCommit, QualityCheck, TestReport } from "../types/devCockpit";
import {
  buildTestReport,
  evaluateCi,
  evaluateStepCheck,
  latestRunsPerWorkflow,
  toJobInput,
  toWorkflowRunInput,
  unknownTestReport,
  type JobInput,
  type StepCategory,
  type WorkflowRunInput,
} from "../utils/devCockpit/ciEvidence";
import {
  buildRemainingWork,
  classifyIssue,
  evaluateP0Issues,
  itemsFromReadiness,
  toIssueInput,
  unknownFeatures,
  type IssueInput,
} from "../utils/devCockpit/classifyIssues";
import { buildNextActions } from "../utils/devCockpit/nextActions";
import { evaluateReleaseReadiness } from "../utils/devCockpit/releaseReadiness";
import { restApi, restApiBinary, restApiPaginate } from "./githubClient";
import { readZipEntries } from "./zip";

/** Artifact name convention for the Vitest JSON report (see .github/workflows/quality.yml). */
export const TEST_REPORT_ARTIFACT = "vitest-report";

export type DevCockpitResult = DevCockpitData | { ok: false; error: string; needsAuth?: true };

interface RawArtifact {
  id: number;
  name: string;
  expired: boolean;
  archive_download_url: string;
  workflow_run?: { id?: number };
}

function unknownCheck(id: QualityCheck["id"], reason: string): QualityCheck {
  return { id, state: "UNKNOWN", reason, evidence: [] };
}

interface RepositoryMeta {
  defaultBranch: string | null;
  hasIssues: boolean | null;
  url: string | undefined;
}

async function loadRepository(repo: string, errors: DevCockpitBlockError[]): Promise<RepositoryMeta | null> {
  const meta = await restApi<{ default_branch?: string; has_issues?: boolean; html_url?: string }>(`/repos/${repo}`);
  if (!meta.ok || !meta.data) {
    errors.push({ block: "repository", reason: meta.ok ? "Repository metadata not returned by GitHub." : meta.error });
    return null;
  }
  return {
    defaultBranch: meta.data.default_branch ?? null,
    hasIssues: typeof meta.data.has_issues === "boolean" ? meta.data.has_issues : null,
    url: meta.data.html_url,
  };
}

async function loadHeadCommit(repo: string, branch: string | null, errors: DevCockpitBlockError[]): Promise<HeadCommit | null> {
  if (!branch) {
    errors.push({ block: "headCommit", reason: "Default branch unknown." });
    return null;
  }
  const commit = await restApi<{ sha: string; html_url: string; commit?: { message?: string; committer?: { date?: string } } }>(
    `/repos/${repo}/commits/${encodeURIComponent(branch)}`,
  );
  if (!commit.ok || !commit.data?.sha) {
    errors.push({ block: "headCommit", reason: commit.ok ? `No commit returned for branch ${branch}.` : commit.error });
    return null;
  }
  return {
    sha: commit.data.sha,
    branch,
    message: (commit.data.commit?.message ?? "").split("\n")[0],
    url: commit.data.html_url,
    committedAt: commit.data.commit?.committer?.date ?? null,
  };
}

/** Open issues as cockpit items; null when they cannot be read (or the repository has no issues). */
async function loadIssueItems(
  repo: string,
  meta: RepositoryMeta | null,
  observedAt: string,
  errors: DevCockpitBlockError[],
): Promise<{ items: CockpitItem[] | null; reason: string }> {
  if (!meta || meta.hasIssues === null) return { items: null, reason: "Repository metadata unavailable, so open issues were not read." };
  if (!meta.hasIssues) return { items: null, reason: "Issues are disabled on this repository: no source for remaining work." };
  const result = await restApiPaginate<Record<string, unknown>>(`/repos/${repo}/issues?state=open&per_page=100`);
  if (!result.ok) {
    errors.push({ block: "issues", reason: result.error });
    return { items: null, reason: `Open issues unavailable: ${result.error}` };
  }
  const items = result.data
    .map(toIssueInput)
    .filter((issue): issue is IssueInput => issue !== null)
    .map((issue) => classifyIssue(issue, repo, observedAt));
  return { items, reason: "" };
}

async function loadJobs(repo: string, runs: WorkflowRunInput[], errors: DevCockpitBlockError[]): Promise<JobInput[] | null> {
  const results = await Promise.all(
    runs.map((run) => restApi<{ jobs?: Record<string, unknown>[] }>(`/repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`)),
  );
  const jobs: JobInput[] = [];
  let failed = false;
  results.forEach((result, index) => {
    if (result.ok) jobs.push(...(result.data?.jobs ?? []).map(toJobInput));
    else {
      failed = true;
      errors.push({ block: "ciJobs", reason: `run ${runs[index].id}: ${result.error}` });
    }
  });
  return failed ? null : jobs;
}

async function loadTestReport(repo: string, runs: WorkflowRunInput[], observedAt: string, errors: DevCockpitBlockError[]): Promise<TestReport> {
  if (runs.length === 0) return unknownTestReport("No CI run on the head commit, so no test report.");
  for (const run of runs) {
    const artifacts = await restApi<{ artifacts?: RawArtifact[] }>(`/repos/${repo}/actions/runs/${run.id}/artifacts?per_page=100`);
    if (!artifacts.ok) {
      errors.push({ block: "testReport", reason: `run ${run.id} artifacts: ${artifacts.error}` });
      continue;
    }
    const artifact = (artifacts.data?.artifacts ?? []).find((item) => item.name === TEST_REPORT_ARTIFACT);
    if (!artifact) continue;
    const source = `artifact ${TEST_REPORT_ARTIFACT} of workflow ${run.name ?? run.id} #${run.runNumber}`;
    if (artifact.expired) return unknownTestReport(`The ${source} has expired.`);
    const archive = await restApiBinary(artifact.archive_download_url);
    if (!archive.ok) {
      errors.push({ block: "testReport", reason: `download ${source}: ${archive.error}` });
      return unknownTestReport(`Could not download the ${source}: ${archive.error}`);
    }
    try {
      const entry = readZipEntries(archive.data).find((item) => item.name.endsWith(".json"));
      if (!entry) return unknownTestReport(`The ${source} contains no JSON file.`);
      return buildTestReport(JSON.parse(entry.data.toString("utf8")), source, run.htmlUrl, observedAt);
    } catch (error) {
      errors.push({ block: "testReport", reason: (error as Error).message });
      return unknownTestReport(`The ${source} could not be read: ${(error as Error).message}`);
    }
  }
  return unknownTestReport(`No "${TEST_REPORT_ARTIFACT}" artifact found on the CI runs of the head commit.`);
}

/**
 * Release readiness, quality, remaining work and next actions of a repository, anchored on the head commit of a branch
 * (default branch unless `branch` is given). Each block degrades to UNKNOWN with a reason.
 */
export async function getDevCockpit(repo: string, branch: string | null = null, now: Date = new Date()): Promise<DevCockpitResult> {
  const observedAt = now.toISOString();
  const errors: DevCockpitBlockError[] = [];

  const meta = await loadRepository(repo, errors);
  if (!meta && errors.some((error) => /authentication required/i.test(error.reason))) {
    return { ok: false, error: "authentication required", needsAuth: true };
  }
  const headCommit = await loadHeadCommit(repo, branch ?? meta?.defaultBranch ?? null, errors);

  let ci = unknownCheck("ci", "Head commit unknown.");
  const steps: Record<StepCategory, QualityCheck> = {
    tests: unknownCheck("tests", "Head commit unknown."),
    typecheck: unknownCheck("typecheck", "Head commit unknown."),
    build: unknownCheck("build", "Head commit unknown."),
  };
  let testReport = unknownTestReport("Head commit unknown.");

  if (headCommit) {
    const runsResult = await restApi<{ workflow_runs?: Record<string, unknown>[] }>(
      `/repos/${repo}/actions/runs?head_sha=${headCommit.sha}&per_page=100`,
    );
    if (!runsResult.ok) {
      errors.push({ block: "ci", reason: runsResult.error });
      const reason = `CI runs unavailable: ${runsResult.error}`;
      ci = unknownCheck("ci", reason);
      for (const category of Object.keys(steps) as StepCategory[]) steps[category] = unknownCheck(category, reason);
      testReport = unknownTestReport(reason);
    } else {
      const runs = (runsResult.data?.workflow_runs ?? []).map(toWorkflowRunInput);
      ci = evaluateCi(runs, headCommit.sha, observedAt);
      const headRuns = latestRunsPerWorkflow(runs.filter((run) => run.headSha === headCommit.sha));
      const jobs = headRuns.length ? await loadJobs(repo, headRuns, errors) : [];
      for (const category of Object.keys(steps) as StepCategory[]) {
        steps[category] = jobs === null
          ? unknownCheck(category, "CI job details unavailable.")
          : headRuns.length === 0
            ? unknownCheck(category, ci.reason)
            : evaluateStepCheck(category, headRuns, jobs, observedAt);
      }
      testReport = await loadTestReport(repo, headRuns, observedAt, errors);
    }
  }

  const issues = await loadIssueItems(repo, meta, observedAt, errors);
  const p0Issues = evaluateP0Issues(issues.items, meta?.hasIssues ?? null, observedAt, meta?.url, issues.reason);
  const readiness = evaluateReleaseReadiness({ checks: { ci, ...steps, p0Issues }, testReport });
  return {
    ok: true,
    repository: repo,
    observedAt,
    headCommit,
    readiness,
    quality: { ci, tests: steps.tests, typecheck: steps.typecheck, build: steps.build, testReport },
    p0Issues,
    features: unknownFeatures(),
    remaining: buildRemainingWork(issues.items, issues.reason, itemsFromReadiness(readiness, repo, observedAt)),
    nextActions: buildNextActions(readiness, issues.items ?? [], observedAt),
    errors,
  };
}
