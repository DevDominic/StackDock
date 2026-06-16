#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const BUILD_DIR = path.join(ROOT, 'build');
const SVG_PATH = path.join(BUILD_DIR, 'icon.svg');
const PNG_PATH = path.join(BUILD_DIR, 'icon.png');
const SIZE = 1024;

if (!fs.existsSync(SVG_PATH)) {
  throw new Error(`Missing icon source: ${path.relative(ROOT, SVG_PATH)}`);
}

fs.mkdirSync(BUILD_DIR, { recursive: true });

const pixels = Buffer.alloc(SIZE * SIZE * 4);

function mix(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function hex(value) {
  const clean = value.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16));
}

function blendPixel(x, y, color, alpha = 1) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE || alpha <= 0) return;
  const i = (y * SIZE + x) * 4;
  const inv = 1 - alpha;
  pixels[i] = Math.round(color[0] * alpha + pixels[i] * inv);
  pixels[i + 1] = Math.round(color[1] * alpha + pixels[i + 1] * inv);
  pixels[i + 2] = Math.round(color[2] * alpha + pixels[i + 2] * inv);
  pixels[i + 3] = 255;
}

function fillRoundedRect(x, y, w, h, r, color, alpha = 1) {
  const x2 = x + w;
  const y2 = y + h;
  for (let py = y; py < y2; py++) {
    for (let px = x; px < x2; px++) {
      const cx = px < x + r ? x + r : px >= x2 - r ? x2 - r - 1 : px;
      const cy = py < y + r ? y + r : py >= y2 - r ? y2 - r - 1 : py;
      const dx = px - cx;
      const dy = py - cy;
      if (dx * dx + dy * dy <= r * r) blendPixel(px, py, color, alpha);
    }
  }
}

function strokeRoundedRect(x, y, w, h, r, width, color) {
  fillRoundedRect(x, y, w, h, r, color, 1);
  fillRoundedRect(x + width, y + width, w - width * 2, h - width * 2, Math.max(0, r - width), hex('#0B1220'), 1);
}

function fillCircle(cx, cy, radius, color, alpha = 1) {
  const r2 = radius * radius;
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) blendPixel(x, y, color, alpha);
    }
  }
}

function line(x1, y1, x2, y2, width, c1, c2 = c1) {
  const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 3);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = mix(x1, x2, t);
    const y = mix(y1, y2, t);
    const color = [mix(c1[0], c2[0], t), mix(c1[1], c2[1], t), mix(c1[2], c2[2], t)];
    fillCircle(x, y, width / 2, color, 1);
  }
}

function polyline(points, width, colors) {
  for (let i = 0; i < points.length - 1; i++) {
    line(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1], width, colors[i], colors[i + 1] ?? colors[i]);
  }
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function writePng(file, width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    rgba.copy(raw, row + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(file, png);
}

const bg1 = hex('#111827');
const bg2 = hex('#1E1B4B');
const bg3 = hex('#0F172A');
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const t = (x + y) / (SIZE * 2);
    const mid = t < 0.52 ? t / 0.52 : (t - 0.52) / 0.48;
    const a = t < 0.52 ? bg1 : bg2;
    const b = t < 0.52 ? bg2 : bg3;
    blendPixel(x, y, [mix(a[0], b[0], mid), mix(a[1], b[1], mid), mix(a[2], b[2], mid)], 1);
  }
}

fillRoundedRect(176, 216, 672, 592, 100, hex('#020617'), 0.32);
strokeRoundedRect(240, 230, 544, 564, 70, 24, hex('#38BDF8'));
fillRoundedRect(264, 254, 496, 516, 46, hex('#0B1220'), 1);
fillRoundedRect(240, 330, 544, 20, 0, hex('#334155'), 1);
fillCircle(308, 286, 20, hex('#F87171'));
fillCircle(368, 286, 20, hex('#FBBF24'));
fillCircle(428, 286, 20, hex('#34D399'));

polyline([[336, 442], [438, 512], [336, 582]], 44, [hex('#38BDF8'), hex('#38BDF8'), hex('#38BDF8')]);
line(480, 604, 688, 604, 44, hex('#A78BFA'));
polyline([[590, 410], [694, 410], [748, 464], [694, 518], [512, 518], [458, 572], [512, 626], [620, 626]], 48, [hex('#38BDF8'), hex('#5ABCF7'), hex('#6CAAF6'), hex('#818CF8'), hex('#8E86F9'), hex('#9B86FA'), hex('#A78BFA'), hex('#A78BFA')]);

for (const [x, stroke] of [[304, '#38BDF8'], [460, '#818CF8'], [616, '#A78BFA']]) {
  fillRoundedRect(x, 684, 104, 50, 16, hex(stroke), 1);
  fillRoundedRect(x + 10, 694, 84, 30, 8, hex('#1E293B'), 1);
}

writePng(PNG_PATH, SIZE, SIZE, pixels);
console.log(`Generated ${path.relative(ROOT, PNG_PATH)} from ${path.relative(ROOT, SVG_PATH)}`);
