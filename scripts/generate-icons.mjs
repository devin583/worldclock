import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ICON_DIR = path.join(ROOT, 'src-tauri', 'icons');
const ICONSET_DIR = path.join(ICON_DIR, 'icon.iconset');

const APP_PNGS = [
  ['32x32.png', 32],
  ['128x128.png', 128],
  ['128x128@2x.png', 256],
];
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const ICONSET_SPECS = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
];

function mix(a, b, t) {
  return a + (b - a) * t;
}

function hexToRgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

class Raster {
  constructor(size) {
    this.size = size;
    this.scale = size <= 64 ? 4 : size <= 256 ? 3 : 2;
    this.width = size * this.scale;
    this.height = size * this.scale;
    this.data = new Float32Array(this.width * this.height * 4);
  }

  blendPixel(x, y, rgb, alpha) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height || alpha <= 0) return;
    const idx = (y * this.width + x) * 4;
    const da = this.data[idx + 3];
    const outA = alpha + da * (1 - alpha);
    if (outA <= 0) return;
    this.data[idx] = (rgb[0] * alpha + this.data[idx] * da * (1 - alpha)) / outA;
    this.data[idx + 1] = (rgb[1] * alpha + this.data[idx + 1] * da * (1 - alpha)) / outA;
    this.data[idx + 2] = (rgb[2] * alpha + this.data[idx + 2] * da * (1 - alpha)) / outA;
    this.data[idx + 3] = outA;
  }

  drawCircle(cx, cy, radius, painter) {
    const minX = Math.max(0, Math.floor(cx - radius));
    const maxX = Math.min(this.width - 1, Math.ceil(cx + radius));
    const minY = Math.max(0, Math.floor(cy - radius));
    const maxY = Math.min(this.height - 1, Math.ceil(cy + radius));
    const r2 = radius * radius;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const d = Math.sqrt(d2);
        const paint = painter(d / radius, dx / radius, dy / radius);
        if (!paint) continue;
        this.blendPixel(x, y, paint.rgb, paint.alpha);
      }
    }
  }

  drawRing(cx, cy, innerRadius, outerRadius, painter) {
    const minX = Math.max(0, Math.floor(cx - outerRadius));
    const maxX = Math.min(this.width - 1, Math.ceil(cx + outerRadius));
    const minY = Math.max(0, Math.floor(cy - outerRadius));
    const maxY = Math.min(this.height - 1, Math.ceil(cy + outerRadius));
    const inner2 = innerRadius * innerRadius;
    const outer2 = outerRadius * outerRadius;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 < inner2 || d2 > outer2) continue;
        const d = Math.sqrt(d2);
        const t = (d - innerRadius) / (outerRadius - innerRadius);
        const paint = painter(t, dx / outerRadius, dy / outerRadius);
        if (!paint) continue;
        this.blendPixel(x, y, paint.rgb, paint.alpha);
      }
    }
  }

  drawLine(x1, y1, x2, y2, width, rgb, alpha) {
    const radius = width / 2;
    const minX = Math.max(0, Math.floor(Math.min(x1, x2) - radius));
    const maxX = Math.min(this.width - 1, Math.ceil(Math.max(x1, x2) + radius));
    const minY = Math.max(0, Math.floor(Math.min(y1, y2) - radius));
    const maxY = Math.min(this.height - 1, Math.ceil(Math.max(y1, y2) + radius));
    const vx = x2 - x1;
    const vy = y2 - y1;
    const len2 = vx * vx + vy * vy || 1;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const px = x + 0.5;
        const py = y + 0.5;
        const t = Math.max(0, Math.min(1, ((px - x1) * vx + (py - y1) * vy) / len2));
        const nx = x1 + vx * t;
        const ny = y1 + vy * t;
        const dx = px - nx;
        const dy = py - ny;
        if (dx * dx + dy * dy <= radius * radius) {
          this.blendPixel(x, y, rgb, alpha);
        }
      }
    }
  }

  toPngBuffer() {
    const out = Buffer.alloc(this.size * this.size * 4);
    const block = this.scale * this.scale;
    for (let y = 0; y < this.size; y += 1) {
      for (let x = 0; x < this.size; x += 1) {
        let a = 0;
        let r = 0;
        let g = 0;
        let b = 0;
        for (let yy = 0; yy < this.scale; yy += 1) {
          for (let xx = 0; xx < this.scale; xx += 1) {
            const src = (((y * this.scale + yy) * this.width) + (x * this.scale + xx)) * 4;
            const alpha = this.data[src + 3];
            a += alpha;
            r += this.data[src] * alpha;
            g += this.data[src + 1] * alpha;
            b += this.data[src + 2] * alpha;
          }
        }
        const dst = (y * this.size + x) * 4;
        const outA = a / block;
        if (outA > 0) {
          out[dst] = Math.round(r / a);
          out[dst + 1] = Math.round(g / a);
          out[dst + 2] = Math.round(b / a);
        }
        out[dst + 3] = Math.round(outA * 255);
      }
    }
    return encodePng(this.size, this.size, out);
  }
}

function polar(cx, cy, radius, degrees) {
  const rad = (degrees * Math.PI) / 180;
  return {
    x: cx + Math.sin(rad) * radius,
    y: cy - Math.cos(rad) * radius,
  };
}

function renderAppIcon(size) {
  const raster = new Raster(size);
  const s = raster.scale;
  const cx = size * s * 0.5;
  const cy = size * s * 0.5;
  const r = size * s * 0.37;
  const faceOuter = hexToRgb('#19202b');
  const faceInner = hexToRgb('#303847');
  const white = hexToRgb('#f7f3ec');
  const tick = hexToRgb('#d7dde7');
  const orange = hexToRgb('#e7894c');

  raster.drawCircle(cx, cy + r * 0.13, r * 1.16, (t, _x, y) => ({
    rgb: [0, 0, 0],
    alpha: Math.max(0, 0.20 * (1 - t) * (0.72 + Math.max(0, y) * 0.28)),
  }));

  raster.drawCircle(cx, cy, r * 1.05, (t) => ({
    rgb: [235, 241, 246],
    alpha: 0.96 * (1 - Math.max(0, t - 0.76) * 0.45),
  }));
  raster.drawCircle(cx, cy, r * 0.94, (t, _x, y) => ({
    rgb: [
      mix(faceInner[0], faceOuter[0], t * 0.86 + Math.max(0, y) * 0.12),
      mix(faceInner[1], faceOuter[1], t * 0.86 + Math.max(0, y) * 0.12),
      mix(faceInner[2], faceOuter[2], t * 0.86 + Math.max(0, y) * 0.12),
    ],
    alpha: 1,
  }));
  raster.drawRing(cx, cy, r * 0.84, r * 0.88, () => ({ rgb: [255, 255, 255], alpha: 0.15 }));

  const tickCount = size >= 64 ? 60 : 12;
  for (let i = 0; i < tickCount; i += 1) {
    const isHour = tickCount === 12 || i % 5 === 0;
    const angle = (i / tickCount) * 360;
    const outer = r * 0.75;
    const inner = r * (isHour ? 0.62 : 0.68);
    const p1 = polar(cx, cy, inner, angle);
    const p2 = polar(cx, cy, outer, angle);
    raster.drawLine(
      p1.x,
      p1.y,
      p2.x,
      p2.y,
      Math.max(1.05 * s, (isHour ? 0.030 : 0.018) * size * s),
      tick,
      isHour ? 0.92 : 0.36,
    );
  }

  const hour = polar(cx, cy, r * 0.39, 305);
  const minute = polar(cx, cy, r * 0.57, 60);
  const second = polar(cx, cy, r * 0.66, 0);
  raster.drawLine(cx, cy, hour.x, hour.y, Math.max(2.2 * s, size * s * 0.052), white, 0.98);
  raster.drawLine(cx, cy, minute.x, minute.y, Math.max(1.8 * s, size * s * 0.040), white, 0.98);
  raster.drawLine(cx, cy + r * 0.12, second.x, second.y, Math.max(1.2 * s, size * s * 0.026), orange, 0.98);
  raster.drawCircle(cx, cy, Math.max(2.0 * s, r * 0.095), () => ({ rgb: orange, alpha: 1 }));
  raster.drawCircle(cx, cy, Math.max(0.8 * s, r * 0.036), () => ({ rgb: [255, 248, 238], alpha: 1 }));

  return raster.toPngBuffer();
}

function renderTrayIcon(size) {
  const raster = new Raster(size);
  const s = raster.scale;
  const cx = size * s * 0.5;
  const cy = size * s * 0.5;
  const r = size * s * 0.32;
  const white = [255, 255, 255];
  raster.drawRing(cx, cy, r * 0.87, r, () => ({ rgb: white, alpha: 0.95 }));
  raster.drawLine(cx, cy, cx, cy - r * 0.58, Math.max(1.8 * s, size * s * 0.064), white, 0.95);
  raster.drawLine(cx, cy, cx + r * 0.48, cy + r * 0.26, Math.max(1.6 * s, size * s * 0.058), white, 0.95);
  raster.drawCircle(cx, cy, Math.max(1.5 * s, r * 0.12), () => ({ rgb: white, alpha: 0.95 }));
  return raster.toPngBuffer();
}

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  typeBuf.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 8 + data.length);
  return out;
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (stride + 1);
    raw[row] = 0;
    rgba.copy(raw, row + 1, y * stride, y * stride + stride);
  }
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function writeIco(filePath, entries) {
  const headerSize = 6 + entries.length * 16;
  let offset = headerSize;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  entries.forEach((entry, index) => {
    const dir = 6 + index * 16;
    header[dir] = entry.size >= 256 ? 0 : entry.size;
    header[dir + 1] = entry.size >= 256 ? 0 : entry.size;
    header[dir + 2] = 0;
    header[dir + 3] = 0;
    header.writeUInt16LE(1, dir + 4);
    header.writeUInt16LE(32, dir + 6);
    header.writeUInt32LE(entry.png.length, dir + 8);
    header.writeUInt32LE(offset, dir + 12);
    offset += entry.png.length;
  });
  fs.writeFileSync(filePath, Buffer.concat([header, ...entries.map((entry) => entry.png)]));
}

fs.mkdirSync(ICON_DIR, { recursive: true });

for (const [name, size] of APP_PNGS) {
  fs.writeFileSync(path.join(ICON_DIR, name), renderAppIcon(size));
}
fs.writeFileSync(path.join(ICON_DIR, 'tray.png'), renderTrayIcon(32));
writeIco(
  path.join(ICON_DIR, 'icon.ico'),
  ICO_SIZES.map((size) => ({ size, png: renderAppIcon(size) })),
);

fs.rmSync(ICONSET_DIR, { recursive: true, force: true });
fs.mkdirSync(ICONSET_DIR, { recursive: true });
for (const [name, size] of ICONSET_SPECS) {
  fs.writeFileSync(path.join(ICONSET_DIR, name), renderAppIcon(size));
}

try {
  execFileSync('iconutil', ['-c', 'icns', ICONSET_DIR, '-o', path.join(ICON_DIR, 'icon.icns')], {
    stdio: 'inherit',
  });
} finally {
  fs.rmSync(ICONSET_DIR, { recursive: true, force: true });
}

console.log('Generated transparent app icons and tray icon.');
