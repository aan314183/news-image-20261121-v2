// news-image-20261121 v2 — entrypoint (Node 22, stdlib only).
// Validates the bundled front-page image and copies it to the output dir.
// The image is a fixed asset: both runs write byte-identical output.
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, "entry.png");

const outDir = process.env.MAKEFUN_OUTPUT_DIR;
if (!outDir) throw new Error("MAKEFUN_OUTPUT_DIR is not set");

const buf = readFileSync(src);

// PNG magic: 89 50 4E 47 0D 0A 1A 0A
const magic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
if (!buf.subarray(0, 8).equals(magic)) throw new Error("entry.png is not a PNG");

// Size cap: at most 1 MiB (1048576 bytes)
if (buf.length > 1048576) throw new Error(`entry.png too large: ${buf.length} bytes`);

// IHDR must be the first chunk and must describe at most 1024x1024.
if (buf.toString("ascii", 12, 16) !== "IHDR") throw new Error("first chunk is not IHDR");
const width = buf.readUInt32BE(16);
const height = buf.readUInt32BE(20);
if (width > 1024 || height > 1024) {
  throw new Error(`entry.png too big: ${width}x${height}`);
}

// IEND must close the file: 00 00 00 00 49 45 4e 44 + CRC.
const tail = buf.subarray(buf.length - 12);
if (tail.readUInt32BE(0) !== 0 || tail.toString("ascii", 4, 8) !== "IEND") {
  throw new Error("entry.png has no intact trailing IEND chunk");
}

// Walk every chunk and verify its CRC32 (type bytes + data), so a truncated
// or corrupted middle chunk is caught, not just a missing IEND.
const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable.push(c >>> 0);
}
const crc32 = (b) => {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
let off = 8;
let sawIEND = false;
while (off + 8 <= buf.length) {
  const len = buf.readUInt32BE(off);
  const type = buf.toString("ascii", off + 4, off + 8);
  if (off + 12 + len > buf.length) throw new Error(`chunk ${type} overruns the file`);
  const stored = buf.readUInt32BE(off + 8 + len);
  const actual = crc32(buf.subarray(off + 4, off + 8 + len));
  if (stored !== actual) throw new Error(`chunk ${type} fails its CRC check`);
  off += 12 + len;
  if (type === "IEND") {
    sawIEND = true;
    break;
  }
}
if (!sawIEND || off !== buf.length) throw new Error("trailing bytes after IEND");

mkdirSync(outDir, { recursive: true });
copyFileSync(src, join(outDir, "entry.png"));
console.log(`entry.png ${width}x${height}, ${buf.length} bytes -> ${join(outDir, "entry.png")}`);
