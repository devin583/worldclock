import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ICON_DIR = path.join(ROOT, 'src-tauri', 'icons');
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const appIconChecks = [
  { name: '32x32 app png', file: '32x32.png', minTransparent: 0.38, maxOpaque: 0.58 },
  { name: '128x128 app png', file: '128x128.png', minTransparent: 0.40, maxOpaque: 0.56 },
  { name: '256x256 app png', file: '128x128@2x.png', minTransparent: 0.40, maxOpaque: 0.56 },
];

function readPng(buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('not a PNG');
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  if (bitDepth !== 8 || colorType !== 6) {
    throw new Error(`unsupported PNG format bitDepth=${bitDepth} colorType=${colorType}`);
  }

  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(width * height * bytesPerPixel);

  function paeth(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
  }

  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= bytesPerPixel ? out[dst + x - bytesPerPixel] : 0;
      const up = y > 0 ? out[dst + x - stride] : 0;
      const upLeft = y > 0 && x >= bytesPerPixel ? out[dst + x - stride - bytesPerPixel] : 0;
      const value = raw[src + x];
      if (filter === 0) out[dst + x] = value;
      else if (filter === 1) out[dst + x] = (value + left) & 0xff;
      else if (filter === 2) out[dst + x] = (value + up) & 0xff;
      else if (filter === 3) out[dst + x] = (value + Math.floor((left + up) / 2)) & 0xff;
      else if (filter === 4) out[dst + x] = (value + paeth(left, up, upLeft)) & 0xff;
      else throw new Error(`unsupported PNG filter ${filter}`);
    }
  }

  return { width, height, data: out };
}

function iconMetrics(png) {
  let transparent = 0;
  let opaque = 0;
  let alphaSum = 0;
  let cornerAlphaMax = 0;
  const total = png.width * png.height;
  const cornerSize = Math.max(1, Math.round(Math.min(png.width, png.height) * 0.14));

  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const alpha = png.data[(y * png.width + x) * 4 + 3];
      alphaSum += alpha;
      if (alpha <= 16) transparent += 1;
      if (alpha >= 244) opaque += 1;
      const inCornerX = x < cornerSize || x >= png.width - cornerSize;
      const inCornerY = y < cornerSize || y >= png.height - cornerSize;
      if (inCornerX && inCornerY) cornerAlphaMax = Math.max(cornerAlphaMax, alpha);
    }
  }

  return {
    transparentRatio: transparent / total,
    opaqueRatio: opaque / total,
    meanAlpha: alphaSum / total / 255,
    cornerAlphaMax,
  };
}

function passPng(name, png, limits) {
  const metrics = iconMetrics(png);
  const ok = metrics.transparentRatio >= limits.minTransparent
    && metrics.opaqueRatio <= limits.maxOpaque
    && metrics.cornerAlphaMax <= 24;
  const line = `${ok ? 'PASS' : 'FAIL'} ${name} transparent=${metrics.transparentRatio.toFixed(3)} opaque=${metrics.opaqueRatio.toFixed(3)} meanAlpha=${metrics.meanAlpha.toFixed(3)} cornerAlphaMax=${metrics.cornerAlphaMax}`;
  console.log(line);
  return ok ? [] : [line];
}

function readIcoEntries(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1) {
    throw new Error('not an ICO file');
  }
  const count = buffer.readUInt16LE(4);
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    const offset = 6 + i * 16;
    const width = buffer[offset] || 256;
    const height = buffer[offset + 1] || 256;
    const bytes = buffer.readUInt32LE(offset + 8);
    const imageOffset = buffer.readUInt32LE(offset + 12);
    entries.push({
      width,
      height,
      data: buffer.subarray(imageOffset, imageOffset + bytes),
    });
  }
  return entries;
}

const failures = [];

for (const check of appIconChecks) {
  const png = readPng(fs.readFileSync(path.join(ICON_DIR, check.file)));
  failures.push(...passPng(check.name, png, check));
}

const tray = readPng(fs.readFileSync(path.join(ICON_DIR, 'tray.png')));
failures.push(...passPng('tray png', tray, { minTransparent: 0.70, maxOpaque: 0.25 }));

const requiredIcoSizes = new Set([16, 24, 32, 48, 64, 128, 256]);
const icoEntries = readIcoEntries(path.join(ICON_DIR, 'icon.ico'));
for (const entry of icoEntries) requiredIcoSizes.delete(entry.width);
const sizesLine = `${requiredIcoSizes.size === 0 ? 'PASS' : 'FAIL'} icon.ico contains 16/24/32/48/64/128/256`;
console.log(sizesLine);
if (requiredIcoSizes.size > 0) failures.push(sizesLine);

for (const entry of icoEntries) {
  if (!entry.data.subarray(0, 8).equals(PNG_SIGNATURE)) {
    const line = `FAIL icon.ico ${entry.width}x${entry.height} is not PNG-compressed`;
    console.log(line);
    failures.push(line);
    continue;
  }
  const png = readPng(entry.data);
  failures.push(...passPng(`icon.ico ${entry.width}x${entry.height}`, png, {
    minTransparent: entry.width <= 24 ? 0.34 : 0.38,
    maxOpaque: entry.width <= 24 ? 0.62 : 0.58,
  }));
}

if (failures.length) {
  console.error(`\n${failures.length} icon checks failed.`);
  process.exit(1);
}
