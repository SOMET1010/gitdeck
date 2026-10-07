import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { AttentionBucket, AttentionOverride, HistoryEntry } from "../types/attention";
import { DATA_DIR } from "./config";

export const ATTENTION_PATH = resolve(DATA_DIR, "attention.json");
const MAX_HISTORY = 2000;

export interface AttentionFile {
  version: 1;
  overrides: Record<string, AttentionOverride>;
  history: HistoryEntry[];
  /** Last computed bucket per repository, to log computed changes. */
  lastBuckets: Record<string, AttentionBucket>;
  /** Repositories always evaluated in depth (validation perimeter), never a priority list. */
  watchList: string[];
}

function emptyFile(): AttentionFile {
  return { version: 1, overrides: {}, history: [], lastBuckets: {}, watchList: [] };
}

/** Local JSON store for overrides, history and watch list (under ~/.gitdeck by default). */
export class AttentionStore {
  private cache: AttentionFile | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly path: string = ATTENTION_PATH) {}

  async read(): Promise<AttentionFile> {
    if (this.cache) return this.cache;
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf-8")) as Partial<AttentionFile>;
      this.cache = { ...emptyFile(), ...parsed, version: 1 };
    } catch {
      this.cache = emptyFile();
    }
    return this.cache;
  }

  /** Serialised read-modify-write so concurrent requests cannot lose updates. */
  update<T>(change: (file: AttentionFile) => T): Promise<T> {
    const run = this.queue.then(async () => {
      const file = await this.read();
      const result = change(file);
      if (file.history.length > MAX_HISTORY) file.history.splice(0, file.history.length - MAX_HISTORY);
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(this.path, JSON.stringify(file, null, 2));
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  setOverride(repository: string, bucket: AttentionBucket, reason: string, days: number, now: Date, computed: AttentionBucket | null): Promise<AttentionOverride> {
    return this.update((file) => {
      const override: AttentionOverride = {
        repository,
        bucket,
        reason,
        setAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString(),
      };
      const previous = file.overrides[repository];
      file.overrides[repository] = override;
      file.history.push({ type: "override-set", repository, at: override.setAt, from: previous?.bucket ?? computed, to: bucket, reason, expiresAt: override.expiresAt });
      return override;
    });
  }

  clearOverride(repository: string, reason: string, now: Date): Promise<boolean> {
    return this.update((file) => {
      const previous = file.overrides[repository];
      if (!previous) return false;
      delete file.overrides[repository];
      file.history.push({ type: "override-cleared", repository, at: now.toISOString(), from: previous.bucket, reason });
      return true;
    });
  }

  setWatched(repository: string, watched: boolean): Promise<string[]> {
    return this.update((file) => {
      const list = file.watchList.filter((name) => name.toLowerCase() !== repository.toLowerCase());
      if (watched) list.push(repository);
      file.watchList = list.sort((a, b) => a.localeCompare(b));
      return [...file.watchList];
    });
  }

  recordComputed(entries: HistoryEntry[], buckets: Record<string, AttentionBucket>): Promise<void> {
    return this.update((file) => {
      file.history.push(...entries);
      file.lastBuckets = { ...file.lastBuckets, ...buckets };
    });
  }
}

export const attentionStore = new AttentionStore();
