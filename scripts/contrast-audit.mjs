import fs from 'node:fs';

const DESKTOPS = {
  white: [255, 255, 255],
  black: [0, 0, 0],
  neutral: [126, 128, 132],
  warm: [176, 154, 126],
  cool: [58, 86, 104],
};

const ALL_DESKTOPS = Object.keys(DESKTOPS);

const cssFiles = {
  flip: fs.readFileSync(new URL('../src/flip-clock.css', import.meta.url), 'utf8'),
  analog: fs.readFileSync(new URL('../src/analog-clock.css', import.meta.url), 'utf8'),
  world: fs.readFileSync(new URL('../src/world-clock.css', import.meta.url), 'utf8'),
  style: fs.readFileSync(new URL('../src/style.css', import.meta.url), 'utf8'),
};

const cssGuards = [
  { file: 'flip', token: '--card: rgba(24,26,34,.94)', name: 'glass card opacity floor' },
  { file: 'flip', token: '--meta-bg: rgba(6,8,12,.84)', name: 'dark flip meta backing floor' },
  { file: 'analog', token: '--face: rgba(24,26,34,.96)', name: 'dark analog face opacity floor' },
  { file: 'analog', token: '--tick: rgba(255,255,255,.40)', name: 'dark analog minute tick visibility' },
  { file: 'world', token: '--zm-halo: rgba(6,8,12,.84)', name: 'zone metadata backing floor' },
  { file: 'style', token: 'background: rgba(6, 8, 12, 0.84)', name: 'pomodoro status backing floor' },
];

const checks = [
  // Flip cards: primary numerals should stay comfortably above WCAG AAA.
  { name: 'classic digit/card', fg: '#f5f3ee', bg: '#2b2d35', min: 7 },
  { name: 'classic digit/top', fg: '#f5f3ee', bg: '#3a3d47', min: 7 },
  { name: 'classic digit/bottom', fg: '#f5f3ee', bg: '#1f2128', min: 7 },
  { name: 'minimal digit/card', fg: '#232220', bg: '#f7f5f1', min: 7 },
  { name: 'minimal digit/top', fg: '#232220', bg: '#ffffff', min: 7 },
  { name: 'minimal digit/bottom', fg: '#232220', bg: '#ece9e3', min: 7 },
  { name: 'cute digit/card', fg: '#422719', bg: '#ffeede', min: 7 },
  { name: 'cute digit/top', fg: '#422719', bg: '#fff8f0', min: 7 },
  { name: 'cute digit/bottom', fg: '#422719', bg: '#f4ceb0', min: 7 },
  { name: 'glass digit/card', fg: '#ffffff', bg: 'rgba(24,26,34,.94)', bases: ALL_DESKTOPS, min: 7 },
  { name: 'glass digit/top', fg: '#ffffff', bg: 'rgba(60,64,78,.96)', bases: ALL_DESKTOPS, min: 7 },
  { name: 'glass digit/bottom', fg: '#ffffff', bg: 'rgba(12,14,20,.96)', bases: ALL_DESKTOPS, min: 7 },

  // Labels and metadata: these are small text, so anything below 4.5 is rejected.
  { name: 'dark flip meta text', fg: 'rgba(255,255,255,.92)', bg: 'rgba(6,8,12,.84)', bases: ALL_DESKTOPS, min: 4.5 },
  { name: 'light flip meta text', fg: 'rgba(35,34,32,.92)', bg: 'rgba(255,250,242,.98)', bases: ALL_DESKTOPS, min: 4.5 },
  { name: 'cute flip meta text', fg: '#4c2f20', bg: 'rgba(255,247,238,.98)', bases: ALL_DESKTOPS, min: 4.5 },
  { name: 'dark zone city', fg: '#f4f2ec', bg: 'rgba(6,8,12,.84)', bases: ALL_DESKTOPS, min: 7 },
  { name: 'dark zone secondary', fg: 'rgba(255,255,255,.90)', bg: 'rgba(6,8,12,.84)', bases: ALL_DESKTOPS, min: 4.5 },
  { name: 'dark zone chip', fg: 'rgba(255,255,255,.95)', layers: ['rgba(6,8,12,.84)', 'rgba(255,255,255,.24)'], bases: ALL_DESKTOPS, min: 4.5 },
  { name: 'light zone city', fg: '#2a2620', bg: 'rgba(255,250,242,.98)', bases: ALL_DESKTOPS, min: 7 },
  { name: 'light zone secondary', fg: 'rgba(45,39,32,.88)', bg: 'rgba(255,250,242,.98)', bases: ALL_DESKTOPS, min: 4.5 },
  { name: 'light zone chip', fg: 'rgba(45,39,32,.95)', layers: ['rgba(255,250,242,.98)', 'rgba(40,34,28,.16)'], bases: ALL_DESKTOPS, min: 4.5 },
  { name: 'light zone accent text', fg: '#9f5125', bg: 'rgba(255,250,242,.98)', bases: ALL_DESKTOPS, min: 4.5 },

  // Analog clock: hands/hour ticks must read instantly; minute ticks may be secondary.
  { name: 'dark analog hand/face', fg: '#f4f2ec', bg: 'rgba(24,26,34,.96)', bases: ALL_DESKTOPS, min: 7 },
  { name: 'dark analog hour tick/face', fg: 'rgba(255,255,255,.94)', bg: 'rgba(24,26,34,.96)', bases: ALL_DESKTOPS, min: 7 },
  { name: 'dark analog minute tick/face', fg: 'rgba(255,255,255,.40)', bg: 'rgba(24,26,34,.96)', bases: ALL_DESKTOPS, min: 2 },
  { name: 'dark analog accent/face', fg: '#e7894c', bg: 'rgba(24,26,34,.96)', bases: ALL_DESKTOPS, min: 4.5 },
  { name: 'light analog hand/face', fg: '#2a2620', bg: 'rgba(247,245,241,.98)', bases: ALL_DESKTOPS, min: 7 },
  { name: 'light analog hour tick/face', fg: 'rgba(40,34,28,.92)', bg: 'rgba(247,245,241,.98)', bases: ALL_DESKTOPS, min: 7 },
  { name: 'light analog minute tick/face', fg: 'rgba(40,34,28,.54)', bg: 'rgba(247,245,241,.98)', bases: ALL_DESKTOPS, min: 2 },
  { name: 'light analog accent/face', fg: '#9f5125', bg: 'rgba(247,245,241,.98)', bases: ALL_DESKTOPS, min: 4.5 },
  { name: 'dark dual readout time', fg: '#f4f2ec', bg: 'rgba(6,8,12,.84)', bases: ALL_DESKTOPS, min: 7 },
  { name: 'dark dual readout secondary', fg: 'rgba(255,255,255,.88)', bg: 'rgba(6,8,12,.84)', bases: ALL_DESKTOPS, min: 4.5 },
  { name: 'light dual readout time', fg: '#2a2620', bg: 'rgba(255,250,242,.98)', bases: ALL_DESKTOPS, min: 7 },
  { name: 'light dual readout secondary', fg: 'rgba(45,39,32,.86)', bg: 'rgba(255,250,242,.98)', bases: ALL_DESKTOPS, min: 4.5 },

  // App chrome: menus/status surfaces must remain readable on a bright desktop.
  { name: 'floating surface primary', fg: 'rgba(252,254,255,1)', bg: 'rgba(14,16,21,.97)', bases: ALL_DESKTOPS, min: 7 },
  { name: 'floating surface secondary', fg: 'rgba(246,250,255,.86)', bg: 'rgba(14,16,21,.97)', bases: ALL_DESKTOPS, min: 4.5 },
  { name: 'pomodoro status', fg: 'rgba(252,254,255,1)', bg: 'rgba(6,8,12,.84)', bases: ALL_DESKTOPS, min: 7 },
  { name: 'primary action text', fg: 'rgba(0,0,0,.82)', bg: '#e7894c', min: 4.5 },
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

function blend(fg, bg = DESKTOPS.white) {
  const alpha = fg[3] ?? 1;
  return [
    fg[0] * alpha + bg[0] * (1 - alpha),
    fg[1] * alpha + bg[1] * (1 - alpha),
    fg[2] * alpha + bg[2] * (1 - alpha),
  ];
}

function blendLayers(layers, base) {
  return layers.reduce((acc, color) => blend(parseColor(color), acc), base);
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
for (const guard of cssGuards) {
  const ok = cssFiles[guard.file]?.includes(guard.token);
  const line = `${ok ? 'PASS' : 'FAIL'} CSS ${guard.name}`;
  console.log(line);
  if (!ok) failures.push(line);
}

for (const item of checks) {
  const bases = item.bases || (item.base ? [item.base] : ['white']);
  for (const baseKey of bases) {
    const base = Array.isArray(baseKey) ? baseKey : DESKTOPS[baseKey];
    const bg = item.layers ? blendLayers(item.layers, base) : blend(parseColor(item.bg), base);
    const fg = blend(parseColor(item.fg), bg);
    const ratio = contrast(fg, bg);
    const suffix = Array.isArray(baseKey) || bases.length === 1 ? '' : ` / ${baseKey}`;
    const line = `${ratio >= item.min ? 'PASS' : 'FAIL'} ${ratio.toFixed(2)} ${item.name}${suffix}`;
    console.log(line);
    if (ratio < item.min) failures.push(line);
  }
}

if (failures.length) {
  console.error(`\n${failures.length} contrast checks failed.`);
  process.exit(1);
}
