import { deflateRawSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";

const restApi = vi.fn();
const restApiBinary = vi.fn();

vi.mock("../../src/server/githubClient", () => ({ restApi, restApiBinary }));

const { getDevCockpit } = await import("../../src/server/devCockpit");

const REPO = "owner/repo";
const SHA = "1234567890abcdef";
const NOW = new Date("2026-10-05T12:00:00.000Z");

const RUN = {
  id: 7,
  name: "Quality",
  path: ".github/workflows/quality.yml",
  run_number: 3,
  run_attempt: 1,
  status: "completed",
  conclusion: "success",
  head_sha: SHA,
  html_url: "https://github.com/owner/repo/actions/runs/7",
  created_at: NOW.toISOString(),
};

const JOBS = {
  jobs: [{
    id: 70,
    run_id: 7,
    name: "quality",
    html_url: "https://github.com/owner/repo/actions/runs/7/job/70",
    steps: ["Test", "Typecheck", "Build"].map((name) => ({ name, status: "completed", conclusion: "success" })),
  }],
};

type Responses = Record<string, { ok: true; data: unknown } | { ok: false; error: string; status?: number }>;

function routeResponses(responses: Responses) {
  restApi.mockImplementation(async (path: string) => {
    const key = Object.keys(responses).find((prefix) => path.startsWith(prefix));
    return key ? responses[key] : { ok: false, error: `unexpected ${path}`, status: 404 };
  });
}

const base: Responses = {
  [`/repos/${REPO}/commits/`]: { ok: true, data: { sha: SHA, html_url: "c", commit: { message: "feat: x\n\nbody", committer: { date: "d" } } } },
  [`/repos/${REPO}/actions/runs?`]: { ok: true, data: { workflow_runs: [RUN] } },
  [`/repos/${REPO}/actions/runs/7/jobs`]: { ok: true, data: JOBS },
  [`/repos/${REPO}/actions/runs/7/artifacts`]: { ok: true, data: { artifacts: [] } },
  [`/repos/${REPO}`]: { ok: true, data: { default_branch: "main" } },
};

describe("getDevCockpit", () => {
  beforeEach(() => {
    restApi.mockReset();
    restApiBinary.mockReset();
  });

  it("anchors CI on the default branch head and reports each step", async () => {
    routeResponses(base);
    const result = await getDevCockpit(REPO, null, NOW);
    if (!result.ok) throw new Error("expected ok");
    expect(result.headCommit).toMatchObject({ sha: SHA, branch: "main", message: "feat: x" });
    expect(restApi).toHaveBeenCalledWith(`/repos/${REPO}/actions/runs?head_sha=${SHA}&per_page=100`);
    expect([result.quality.ci.state, result.quality.tests.state, result.quality.typecheck.state, result.quality.build.state])
      .toEqual(["PASS", "PASS", "PASS", "PASS"]);
    expect(result.quality.testReport.state).toBe("UNKNOWN");
    expect(result.readiness.verdict).toBe("READY");
    expect(result.errors).toEqual([]);
  });

  it("uses the requested branch without reading the repository metadata", async () => {
    routeResponses(base);
    const result = await getDevCockpit(REPO, "feature/x", NOW);
    expect(result.ok && result.headCommit?.branch).toBe("feature/x");
    expect(restApi).toHaveBeenCalledWith(`/repos/${REPO}/commits/feature%2Fx`);
    expect(restApi).not.toHaveBeenCalledWith(`/repos/${REPO}`);
  });

  it("degrades to UNKNOWN when job details are unavailable", async () => {
    routeResponses({ ...base, [`/repos/${REPO}/actions/runs/7/jobs`]: { ok: false, error: "boom", status: 500 } });
    const result = await getDevCockpit(REPO, null, NOW);
    if (!result.ok) throw new Error("expected ok");
    expect(result.quality.ci.state).toBe("PASS");
    expect(result.quality.build.state).toBe("UNKNOWN");
    expect(result.readiness.verdict).toBe("UNKNOWN");
    expect(result.errors).toEqual([{ block: "ciJobs", reason: "run 7: boom" }]);
  });

  it("degrades every block to UNKNOWN when the head commit cannot be read", async () => {
    routeResponses({ ...base, [`/repos/${REPO}/commits/`]: { ok: false, error: "Not Found", status: 404 } });
    const result = await getDevCockpit(REPO, null, NOW);
    if (!result.ok) throw new Error("expected ok");
    expect(result.headCommit).toBeNull();
    expect(result.quality.ci.state).toBe("UNKNOWN");
    expect(result.readiness.verdict).toBe("UNKNOWN");
    expect(result.errors[0]).toEqual({ block: "headCommit", reason: "Not Found" });
  });

  it("reports a failing test report as NOT_READY", async () => {
    routeResponses({
      ...base,
      [`/repos/${REPO}/actions/runs/7/artifacts`]: {
        ok: true,
        data: { artifacts: [{ id: 1, name: "vitest-report", expired: false, archive_download_url: "https://api.github.com/zip" }] },
      },
    });
    restApiBinary.mockResolvedValue({ ok: true, data: zipOf("vitest-report.json", JSON.stringify({ numTotalTests: 2, numPassedTests: 1, numFailedTests: 1, numPendingTests: 0, numTodoTests: 0 })) });
    const result = await getDevCockpit(REPO, null, NOW);
    if (!result.ok) throw new Error("expected ok");
    expect(result.quality.testReport.counts).toMatchObject({ passed: 1, failed: 1 });
    expect(result.readiness.verdict).toBe("NOT_READY");
  });

  it("asks for authentication when no token is available", async () => {
    routeResponses({ [`/repos/${REPO}`]: { ok: false, error: "authentication required", status: 401 } });
    expect(await getDevCockpit(REPO, null, NOW)).toEqual({ ok: false, error: "authentication required", needsAuth: true });
  });
});

function zipOf(name: string, content: string): Buffer {
  const fileName = Buffer.from(name);
  const data = deflateRawSync(Buffer.from(content));
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(fileName.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt16LE(fileName.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(30 + fileName.length + data.length, 16);
  return Buffer.concat([local, fileName, data, central, fileName, end]);
}
