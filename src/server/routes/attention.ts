import { ATTENTION_BUCKETS, type AttentionBucket, type BriefQuestion } from "../../types/attention";
import { parseRepositoryName } from "../../utils/repository";
import { computedBucketOf, getAttention, getAttentionBrief } from "../attention";
import { attentionStore } from "../attentionStore";
import { parseJsonBody, sendJson } from "../http";
import type { AppRouter, RouteContext } from "../router";
import { sendError } from "./shared";

const BRIEF_QUESTIONS = new Set<BriefQuestion>(["now", "week", "cleanup"]);

function statusOf(result: { ok: boolean; needsAuth?: boolean }): number {
  return result.ok ? 200 : result.needsAuth ? 401 : 502;
}

function validRepo(value: unknown): string | null {
  return typeof value === "string" && parseRepositoryName(value.trim()) ? value.trim() : null;
}

async function list(ctx: RouteContext): Promise<void> {
  try {
    const result = await getAttention(ctx.url.searchParams.get("fresh") === "1");
    sendJson(ctx.res, statusOf(result), result);
  } catch (error) {
    sendError(ctx, error);
  }
}

async function brief(ctx: RouteContext): Promise<void> {
  const question = ctx.url.searchParams.get("question") as BriefQuestion | null;
  if (!question || !BRIEF_QUESTIONS.has(question)) {
    sendJson(ctx.res, 400, { ok: false, error: "question must be one of: now, week, cleanup" });
    return;
  }
  try {
    const result = await getAttentionBrief(question);
    sendJson(ctx.res, statusOf(result), result);
  } catch (error) {
    sendError(ctx, error);
  }
}

async function setOverride(ctx: RouteContext): Promise<void> {
  const body = await parseJsonBody<{ repo?: unknown; bucket?: unknown; reason?: unknown; days?: unknown }>(ctx.req, ctx.res);
  if (!body) return;
  const repo = validRepo(body.repo);
  const bucket = typeof body.bucket === "string" && ATTENTION_BUCKETS.includes(body.bucket as AttentionBucket) ? body.bucket as AttentionBucket : null;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const days = body.days === undefined ? 30 : Number(body.days);
  if (!repo || !bucket || !reason || !Number.isInteger(days) || days < 1 || days > 365) {
    sendJson(ctx.res, 400, { ok: false, error: "repo (owner/name), bucket, a non-empty reason and days (1-365) are required" });
    return;
  }
  const override = await attentionStore.setOverride(repo, bucket, reason, days, new Date(), computedBucketOf(repo));
  sendJson(ctx.res, 200, { ok: true, override });
}

async function clearOverride(ctx: RouteContext): Promise<void> {
  const body = await parseJsonBody<{ repo?: unknown; reason?: unknown }>(ctx.req, ctx.res);
  if (!body) return;
  const repo = validRepo(body.repo);
  if (!repo) {
    sendJson(ctx.res, 400, { ok: false, error: "repo (owner/name) is required" });
    return;
  }
  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : "Override removed";
  sendJson(ctx.res, 200, { ok: true, cleared: await attentionStore.clearOverride(repo, reason, new Date()) });
}

async function watch(ctx: RouteContext): Promise<void> {
  const body = await parseJsonBody<{ repo?: unknown; watched?: unknown }>(ctx.req, ctx.res);
  if (!body) return;
  const repo = validRepo(body.repo);
  if (!repo || typeof body.watched !== "boolean") {
    sendJson(ctx.res, 400, { ok: false, error: "repo (owner/name) and watched (boolean) are required" });
    return;
  }
  sendJson(ctx.res, 200, { ok: true, watchList: await attentionStore.setWatched(repo, body.watched) });
}

async function history(ctx: RouteContext): Promise<void> {
  const repo = ctx.url.searchParams.get("repo");
  const file = await attentionStore.read();
  const entries = (repo ? file.history.filter((entry) => entry.repository === repo) : file.history).slice(-500).reverse();
  sendJson(ctx.res, 200, { ok: true, history: entries });
}

export function registerAttentionRoutes(router: AppRouter): void {
  router.get("/api/attention", list);
  router.get("/api/attention/brief", brief);
  router.get("/api/attention/history", history);
  router.post("/api/attention/override", setOverride);
  router.post("/api/attention/override/clear", clearOverride);
  router.post("/api/attention/watch", watch);
}
