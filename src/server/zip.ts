import { inflateRawSync } from "node:zlib";

export interface ZipEntry {
  name: string;
  data: Buffer;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

/**
 * Minimal ZIP reader for GitHub Actions artifacts (stored or deflated entries, no ZIP64).
 * Throws when the archive is malformed or uses an unsupported compression method.
 */
export function readZipEntries(archive: Buffer): ZipEntry[] {
  let eocd = -1;
  for (let offset = archive.length - 22; offset >= Math.max(0, archive.length - 22 - 0xffff); offset--) {
    if (archive.readUInt32LE(offset) === EOCD_SIGNATURE) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error("Invalid ZIP archive: end of central directory not found");

  const entryCount = archive.readUInt16LE(eocd + 10);
  let cursor = archive.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let index = 0; index < entryCount; index++) {
    if (archive.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) throw new Error("Invalid ZIP archive: bad central directory entry");
    const method = archive.readUInt16LE(cursor + 10);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const name = archive.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    cursor += 46 + nameLength + extraLength + commentLength;

    if (archive.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) throw new Error("Invalid ZIP archive: bad local header");
    const dataStart = localOffset + 30 + archive.readUInt16LE(localOffset + 26) + archive.readUInt16LE(localOffset + 28);
    const raw = archive.subarray(dataStart, dataStart + compressedSize);
    if (method === 0) entries.push({ name, data: Buffer.from(raw) });
    else if (method === 8) entries.push({ name, data: inflateRawSync(raw) });
    else throw new Error(`Unsupported ZIP compression method ${method} for ${name}`);
  }
  return entries;
}
