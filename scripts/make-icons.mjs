/**
 * Generate the app icons.
 *
 * Checked in rather than run at build time, and written with no dependencies,
 * for the same reason the Rust engine has none: an icon generator is not worth
 * a toolchain. Node's zlib is the only thing here that is not arithmetic.
 *
 *   node scripts/make-icons.mjs
 *
 * The mark is the app in one picture: a faint street grid with a red line that
 * follows it rather than cutting across.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'public', 'icons');

const BACKDROP = [0x0b, 0x0d, 0x10];
const GRID = [0x2a, 0x30, 0x38];
const ACCENT = [0xff, 0x4b, 0x4b];

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Encode RGBA pixels as a PNG. */
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha

  // One filter byte per scanline; filter 0 is "none", which compresses well
  // enough for flat art and keeps this function short.
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const from = y * width * 4;
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, from, from + width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 <= 1e-9) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/**
 * Stroke a polyline into the buffer.
 *
 * Distance-field rasterisation: a pixel's coverage is how far inside the stroke
 * it falls. Round caps and joins come free, and so does antialiasing.
 */
function stroke(buf, size, points, width, colour, alpha = 1) {
  const half = width / 2;
  const pad = Math.ceil(half + 2);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }

  const x0 = Math.max(0, Math.floor(minX) - pad);
  const x1 = Math.min(size - 1, Math.ceil(maxX) + pad);
  const y0 = Math.max(0, Math.floor(minY) - pad);
  const y1 = Math.min(size - 1, Math.ceil(maxY) + pad);

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      let d = Infinity;
      for (let i = 1; i < points.length; i++) {
        d = Math.min(d, distanceToSegment(
          x + 0.5, y + 0.5,
          points[i - 1][0], points[i - 1][1],
          points[i][0], points[i][1],
        ));
        if (d <= half - 1) break;
      }
      const coverage = Math.max(0, Math.min(1, half + 0.5 - d)) * alpha;
      if (coverage <= 0) continue;

      const o = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) {
        buf[o + c] = Math.round(buf[o + c] * (1 - coverage) + colour[c] * coverage);
      }
      buf[o + 3] = 255;
    }
  }
}

function render(size) {
  const buf = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    buf[i * 4] = BACKDROP[0];
    buf[i * 4 + 1] = BACKDROP[1];
    buf[i * 4 + 2] = BACKDROP[2];
    buf[i * 4 + 3] = 255;
  }

  // The network. Kept inside the middle 80% so a maskable crop cannot clip it.
  const inset = size * 0.16;
  const span = size - inset * 2;
  const lines = 4;
  const gridWidth = Math.max(1, size * 0.012);
  for (let i = 0; i <= lines; i++) {
    const at = inset + (span * i) / lines;
    stroke(buf, size, [[inset, at], [size - inset, at]], gridWidth, GRID);
    stroke(buf, size, [[at, inset], [at, size - inset]], gridWidth, GRID);
  }

  // The drawn line: a staircase across the grid, which is the shape a matcher
  // that follows the line produces and a shortest-path router never does.
  const step = span / lines;
  const route = [];
  let x = inset;
  let y = size - inset;
  route.push([x, y]);
  for (let i = 0; i < lines; i++) {
    y -= step;
    route.push([x, y]);
    x += step;
    route.push([x, y]);
  }
  stroke(buf, size, route, size * 0.16, ACCENT, 0.22); // halo
  stroke(buf, size, route, size * 0.075, ACCENT);

  return buf;
}

mkdirSync(OUT, { recursive: true });
for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  writeFileSync(join(OUT, name), encodePng(size, size, render(size)));
  console.log(`wrote ${name} (${size}x${size})`);
}

// The SVG twin, for browsers that prefer it and for scaling anywhere.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#0b0d10"/>
  <g stroke="#2a3038" stroke-width="6">
    ${[0, 1, 2, 3, 4]
      .map((i) => {
        const at = 82 + (348 * i) / 4;
        return `<line x1="82" y1="${at}" x2="430" y2="${at}"/><line x1="${at}" y1="82" x2="${at}" y2="430"/>`;
      })
      .join('\n    ')}
  </g>
  <path d="M 82 430 L 82 343 L 169 343 L 169 256 L 256 256 L 256 169 L 343 169 L 343 82 L 430 82"
    fill="none" stroke="#ff4b4b" stroke-width="82" stroke-linecap="round"
    stroke-linejoin="round" opacity="0.22"/>
  <path d="M 82 430 L 82 343 L 169 343 L 169 256 L 256 256 L 256 169 L 343 169 L 343 82 L 430 82"
    fill="none" stroke="#ff4b4b" stroke-width="38" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;
writeFileSync(join(OUT, 'icon.svg'), svg);
console.log('wrote icon.svg');
