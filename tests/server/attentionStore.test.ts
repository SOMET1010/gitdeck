import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AttentionStore } from "../../src/server/attentionStore";

const NOW = new Date("2026-10-07T12:00:00.000Z");

describe("AttentionStore", () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "attention-"));
    path = join(dir, "attention.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("stores an override with its expiry and logs it", async () => {
    const store = new AttentionStore(path);
    const override = await store.setOverride("me/a", "NOW", "Board meeting", 7, NOW, "CAN_WAIT");
    expect(override.expiresAt).toBe("2026-10-14T12:00:00.000Z");
    const saved = JSON.parse(await readFile(path, "utf-8"));
    expect(saved.overrides["me/a"].reason).toBe("Board meeting");
    expect(saved.history).toEqual([{ type: "override-set", repository: "me/a", at: NOW.toISOString(), from: "CAN_WAIT", to: "NOW", reason: "Board meeting", expiresAt: override.expiresAt }]);
  });

  it("logs the previous forced bucket when an override is replaced, then cleared", async () => {
    const store = new AttentionStore(path);
    await store.setOverride("me/a", "NOW", "first", 7, NOW, "CAN_WAIT");
    await store.setOverride("me/a", "URGENT", "second", 7, NOW, "CAN_WAIT");
    expect(await store.clearOverride("me/a", "done", NOW)).toBe(true);
    expect(await store.clearOverride("me/a", "again", NOW)).toBe(false);
    const file = await new AttentionStore(path).read();
    expect(file.overrides).toEqual({});
    expect(file.history.map((entry) => [entry.type, entry.from])).toEqual([["override-set", "CAN_WAIT"], ["override-set", "NOW"], ["override-cleared", "URGENT"]]);
  });

  it("keeps a sorted watch list without duplicates", async () => {
    const store = new AttentionStore(path);
    await store.setWatched("me/b", true);
    await store.setWatched("me/a", true);
    await store.setWatched("ME/B", true);
    expect(await store.setWatched("me/a", false)).toEqual(["ME/B"]);
  });

  it("serialises concurrent updates without losing any", async () => {
    const store = new AttentionStore(path);
    await Promise.all(Array.from({ length: 10 }, (_, index) => store.setOverride(`me/r${index}`, "NOW", "x", 1, NOW, null)));
    const file = await new AttentionStore(path).read();
    expect(Object.keys(file.overrides)).toHaveLength(10);
    expect(file.history).toHaveLength(10);
  });

  it("starts empty when the file is missing or corrupt", async () => {
    expect((await new AttentionStore(join(dir, "missing.json")).read()).overrides).toEqual({});
  });
});
