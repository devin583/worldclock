const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];

const checks = [
  { name: 'classic digit/card', fg: '#f5f3ee', bg: '#2b2d35', min: 7 },
  { name: 'minimal digit/card', fg: '#232220', bg: '#f7f5f1', min: 7 },
  { name: 'cute digit/card', fg: '#422719', bg: '#ffeede', min: 7 },
  { name: 'glass digit/card on white desktop', fg: '#ffffff', bg: 'rgba(30,32,40,.88)', base: WHITE, min: 7 },
  { name: 'glass digit/card on black desktop', fg: '#ffffff', bg: 'rgba(30,32,40,.88)', base: BLACK, min: 7 },
  { name: 'dark meta text', fg: 'rgba(255,255,255,.90)', bg: 'rgba(6,8,12,.78)', base: WHITE, min: 4.5 },
  { name: 'light meta text', fg: 'rgba(35,34,32,.92)', bg: 'rgba(255,250,242,.98)', base: WHITE, min: 4.5 },
  { name: 'cute meta text', fg: '#4c2f20', bg: 'rgba(255,247,238,.98)', base: WHITE, min: 4.5 },
  { name: 'dark analog hand/face', fg: '#f4f2ec', bg: 'rgba(28,30,38,.94)', base: WHITE, min: 4.5 },
  { name: 'light analog hand/face', fg: '#2a2620', bg: 'rgba(247,245,241,.98)', base: WHITE, min: 4.5 },
  { name: 'dark analog hour tick/face', fg: 'rgba(255,255,255,.94)', bg: 'rgba(28,30,38,.94)', base: WHITE, min: 4.5 },
  { name: 'light analog hour tick/face', fg: 'rgba(40,34,28,.92)', bg: 'rgba(247,245,241,.98)', base: WHITE, min: 4.5 },
  { name: 'light zone accent text', fg: '#9f5125', bg: 'rgba(255,250,242,.98)', base: WHITE, min: 4.5 },
  { name: 'light analog accent/face', fg: '#9f5125', bg: 'rgba(247,245,241,.98)', base: WHITE, min: 4.5 },
];

function parseColor(input) {
  if (input.startsWith('#')) {
    const hex = input.slice(1);
    const n = Number.parseInt(hex.length === 3
      ? hex.split('').map((c) => c + c).join('')
      : hex, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }

  const match = input.match(/rgba?\(([^)]+)\)/);
  if (!match) throw new Error(`Unsupported color: ${input}`);
  const parts = match[1].split(',').map((p) => p.trim());
  return [
    Number(parts[0]),
    Number(parts[1]),
    Number(parts[2]),
    parts[3] === undefined ? 1 : Number(parts[3]),
  ];
}

function blend(fg, bg = WHITE) {
  const alpha = fg[3] ?? 1;
  return [
    fg[0] * alpha + bg[0] * (1 - alpha),
    fg[1] * alpha + bg[1] * (1 - alpha),
    fg[2] * alpha + bg[2] * (1 - alpha),
  ];
}

function srgbToLinear(v) {
  const x = v / 255;
  return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}

function luminance(rgb) {
  const [r, g, b] = rgb.map(srgbToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const failures = [];
for (const item of checks) {
  const base = item.base || WHITE;
  const bg = blend(parseColor(item.bg), base);
  const fg = blend(parseColor(item.fg), bg);
  const ratio = contrast(fg, bg);
  const line = `${ratio >= item.min ? 'PASS' : 'FAIL'} ${ratio.toFixed(2)} ${item.name}`;
  console.log(line);
  if (ratio < item.min) failures.push(line);
}

if (failures.length) {
  console.error(`\n${failures.length} contrast checks failed.`);
  process.exit(1);
}
