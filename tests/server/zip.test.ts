import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { readZipEntries } from "../../src/server/zip";

/** Builds a ZIP archive (CRC left at 0, which the reader does not check). */
function buildZip(files: { name: string; content: string; method: 0 | 8 }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const raw = Buffer.from(file.content);
    const data = file.method === 8 ? deflateRawSync(raw) : raw;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(file.method, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(file.method, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDirectory, end]);
}

describe("readZipEntries", () => {
  it("reads stored and deflated entries", () => {
    const archive = buildZip([
      { name: "a.txt", content: "plain", method: 0 },
      { name: "vitest-report.json", content: JSON.stringify({ numTotalTests: 3 }), method: 8 },
    ]);
    const entries = readZipEntries(archive);
    expect(entries.map((entry) => entry.name)).toEqual(["a.txt", "vitest-report.json"]);
    expect(entries[0].data.toString()).toBe("plain");
    expect(JSON.parse(entries[1].data.toString())).toEqual({ numTotalTests: 3 });
  });

  it("rejects data that is not a ZIP archive", () => {
    expect(() => readZipEntries(Buffer.from("not a zip archive at all, definitely not"))).toThrow(/Invalid ZIP/);
  });
});
