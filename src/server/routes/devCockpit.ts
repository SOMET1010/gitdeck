import { getDevCockpit } from "../devCockpit";
import { sendJson } from "../http";
import type { AppRouter, RouteContext } from "../router";
import { requireRepo, sendError } from "./shared";

async function devCockpit(ctx: RouteContext): Promise<void> {
  const repo = requireRepo(ctx);
  if (!repo) return;
  const branch = ctx.url.searchParams.get("branch")?.trim() || null;
  try {
    const result = await getDevCockpit(repo, branch);
    sendJson(ctx.res, result.ok ? 200 : result.needsAuth ? 401 : 502, result);
  } catch (error) {
    sendError(ctx, error);
  }
}

export function registerDevCockpitRoutes(router: AppRouter): void {
  router.get("/api/dev-cockpit", devCockpit);
}
