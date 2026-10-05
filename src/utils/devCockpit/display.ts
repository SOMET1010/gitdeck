import type { CheckState, ReadinessVerdict } from "../../types/devCockpit";

/** Visual tone shared with the existing CI badges (`.ci-conclusion.<tone>`). */
export type CockpitTone = "success" | "failure" | "cancelled";

const OWNER_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/**
 * Normalises user input into `owner/name`: accepts `owner/name`, GitHub URLs
 * (with or without protocol, trailing `.git`, extra path segments). Returns null otherwise.
 */
export function parseRepositoryInput(raw: string): string | null {
  let value = raw.trim();
  if (!value) return null;
  value = value.replace(/^https?:\/\//i, "").replace(/^(www\.)?github\.com\//i, "");
  const [owner, name] = value.split(/[/?#]/).filter(Boolean);
  if (!owner || !name) return null;
  const candidate = `${owner}/${name.replace(/\.git$/i, "")}`;
  return OWNER_NAME.test(candidate) ? candidate : null;
}

export function toneForState(state: CheckState | ReadinessVerdict): CockpitTone {
  if (state === "PASS" || state === "READY") return "success";
  if (state === "FAIL" || state === "NOT_READY") return "failure";
  return "cancelled";
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}
