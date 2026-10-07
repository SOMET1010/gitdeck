import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getReposCached = vi.fn();
const getDevCockpit = vi.fn();
const restApi = vi.fn();

vi.mock("../../src/server/dashboardData", () => ({ getReposCached }));
vi.mock("../../src/server/devCockpit", () => ({ getDevCockpit }));
vi.mock("../../src/server/githubClient", () => ({ restApi }));

const { getAttention, getAttentionBrief, resetAttentionCache } = await import("../../src/server/attention");
const { AttentionStore } = await import("../../src/server/attentionStore");

const NOW = new Date("2026-10-07T12:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86400000).toISOString();

function ghRepo(nameWithOwner: string, pushedDaysAgo: number, isArchived = false) {
  return { nameWithOwner, url: `https://github.com/${nameWithOwner}`, pushedAt: daysAgo(pushedDaysAgo), isArchived, isFork: false };
}

function cockpit(ciState: "PASS" | "FAIL" | "UNKNOWN", p0 = 0) {
  const items = Array.from({ length: p0 }, (_, index) => ({ id: `i${index}`, type: "BUG", status: "TODO", priority: { source: "P0", suggested: null }, evidence: [] }));
  return {
    ok: true,
    headCommit: { branch: "main" },
    quality: { ci: { state: ciState, reason: `ci ${ciState}`, evidence: [] } },
    readiness: { verdict: ciState === "FAIL" ? "NOT_READY" : "UNKNOWN" },
    remaining: { state: "AVAILABLE", reason: "", bySourcePriority: { P0: items, P1: [], P2: [], none: [] } },
    errors: [],
  };
}

function routeRest(overrides: Record<string, unknown> = {}) {
  restApi.mockImplementation(async (path: string) => {
    const key = Object.keys(overrides).find((prefix) => path.startsWith(prefix));
    if (key) return overrides[key];
    if (/\/pulls\?/.test(path) || /\/milestones\?/.test(path) || /\/releases\?/.test(path)) return { ok: true, data: [] };
    const repo = /^\/repos\/([^/]+\/[^/?]+)$/.exec(path);
    if (repo) return { ok: true, data: { size: 1000, default_branch: "main", html_url: `https://github.com/${repo[1]}`, pushed_at: daysAgo(1) } };
    return { ok: false, error: `unexpected ${path}` };
  });
}

describe("getAttention", () => {
  let dir: string;
  let store: InstanceType<typeof AttentionStore>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "attention-"));
    store = new AttentionStore(join(dir, "attention.json"));
    resetAttentionCache();
    getReposCached.mockReset();
    getDevCockpit.mockReset();
    restApi.mockReset();
    routeRest();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("evaluates recent repos in depth, inactive ones lightly, and skips archived repos", async () => {
    getReposCached.mockResolvedValue({ ok: true, repos: [ghRepo("me/active", 2), ghRepo("me/old", 400), ghRepo("me/archived", 1, true)], owners: [], fetchedAt: "" });
    getDevCockpit.mockResolvedValue(cockpit("FAIL"));
    const result = await getAttention(true, store, NOW);
    if (!result.ok) throw new Error("expected ok");
    expect(result.repos.map((repo) => [repo.repository, repo.effectiveBucket, repo.evaluated])).toEqual([
      ["me/active", "NOW", "deep"],
      ["me/old", "ARCHIVE_CANDIDATE", "light"],
    ]);
    expect(getDevCockpit).toHaveBeenCalledTimes(1);
    expect(result.coverage).toMatchObject({ listed: 2, deepEvaluated: 1, listSource: "account", listError: null });
    expect(result.today).toMatchObject({ now: 1, redCi: 1, inactive: 1 });
  });

  it("falls back to watched and forced repos when the account list is unavailable", async () => {
    getReposCached.mockResolvedValue({ ok: false, error: "/user/orgs forbidden" });
    getDevCockpit.mockResolvedValue(cockpit("PASS"));
    await store.setWatched("me/watched", true);
    const result = await getAttention(true, store, NOW);
    if (!result.ok) throw new Error("expected ok");
    expect(result.coverage).toMatchObject({ listSource: "watch-list", listError: "/user/orgs forbidden", deepEvaluated: 1 });
    expect(result.repos.map((repo) => [repo.repository, repo.effectiveBucket])).toEqual([["me/watched", "CAN_WAIT"]]);
  });

  it("shows an active override next to the computed bucket, and records computed changes once", async () => {
    getReposCached.mockResolvedValue({ ok: true, repos: [ghRepo("me/a", 2)], owners: [], fetchedAt: "" });
    getDevCockpit.mockResolvedValue(cockpit("PASS"));
    await store.setOverride("me/a", "NOW", "DG review", 7, NOW, null);
    const first = await getAttention(true, store, NOW);
    if (!first.ok) throw new Error("expected ok");
    expect(first.repos[0]).toMatchObject({ effectiveBucket: "NOW", computed: { bucket: "CAN_WAIT" }, override: { reason: "DG review" } });
    await getAttention(true, store, NOW);
    const history = (await store.read()).history.filter((entry) => entry.type === "computed-change");
    expect(history).toHaveLength(1);
  });

  it("keeps a deep evaluation failure as UNKNOWN instead of failing the whole page", async () => {
    getReposCached.mockResolvedValue({ ok: true, repos: [ghRepo("me/a", 2)], owners: [], fetchedAt: "" });
    getDevCockpit.mockResolvedValue({ ok: false, error: "rate limited" });
    routeRest({ "/repos/me/a/pulls?": { ok: false, error: "rate limited" } });
    const result = await getAttention(true, store, NOW);
    if (!result.ok) throw new Error("expected ok");
    expect(result.repos[0].effectiveBucket).toBe("UNKNOWN");
    expect(result.repos[0].signals.deep?.errors).toContain("cockpit: rate limited");
  });

  it("asks for authentication when no account is connected", async () => {
    getReposCached.mockResolvedValue({ ok: false, error: "authentication required", needsAuth: true });
    expect(await getAttention(true, store, NOW)).toEqual({ ok: false, error: "authentication required", needsAuth: true });
  });

  it("answers briefs from the same evidence", async () => {
    getReposCached.mockResolvedValue({ ok: true, repos: [ghRepo("me/a", 2), ghRepo("me/a-copy", 300)], owners: [], fetchedAt: "" });
    getDevCockpit.mockResolvedValue(cockpit("PASS", 1));
    await getAttention(true, store, NOW);
    const now = await getAttentionBrief("now", store);
    const cleanup = await getAttentionBrief("cleanup", store);
    if (!now.ok || !cleanup.ok) throw new Error("expected ok");
    expect(now.items.map((item) => item.repository)).toEqual(["me/a"]);
    expect(cleanup.items.map((item) => item.repository)).toEqual(["me/a-copy"]);
  });
});
