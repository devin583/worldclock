(() => {
if (window.__worldClockMainBootstrapped) return;
window.__worldClockMainBootstrapped = true;

const tauriApi = window.__TAURI__ ?? {};
const tauriInvoke = tauriApi.core?.invoke;
const tauriListen = tauriApi.event?.listen;
const isTauri = typeof tauriInvoke === 'function';
const isWindows = /Windows/i.test(navigator.userAgent);

const invoke = isTauri
  ? async (cmd, args) => {
      try { return await tauriInvoke(cmd, args); }
      catch (e) { console.warn('[invoke]', cmd, e); return null; }
    }
  : async (cmd, args) => { console.log('[invoke noop]', cmd, args); return null; };

const listen = typeof tauriListen === 'function' ? tauriListen : async () => () => {};

const TIMEZONES = [
  'Europe/Budapest','Europe/London','Europe/Paris','Europe/Berlin','Europe/Rome',
  'Europe/Madrid','Europe/Warsaw','Europe/Kiev','Europe/Moscow','Europe/Istanbul',
  'Asia/Shanghai','Asia/Tokyo','Asia/Seoul','Asia/Singapore','Asia/Hong_Kong',
  'Asia/Kolkata','Asia/Dubai','Asia/Karachi','Asia/Bangkok','Asia/Jakarta',
  'America/New_York','America/Chicago','America/Denver','America/Los_Angeles',
  'America/Toronto','America/Sao_Paulo','America/Buenos_Aires','America/Mexico_City',
  'Pacific/Auckland','Pacific/Sydney','Pacific/Honolulu',
  'Africa/Cairo','Africa/Lagos','Africa/Nairobi',
  'Atlantic/Reykjavik','UTC',
];

const THEME_VALUES = ['classic', 'minimal', 'cute', 'glass'];
const THEME_CLASSES = THEME_VALUES.map(t => `theme-${t}`);
const LEGACY_THEME_MAP = {
  'minimal-glass': 'glass',
  'mechanical': 'classic',
  'soft-companion': 'cute',
  'flip': 'classic',
  'boundless': 'minimal',
  'dark': 'classic',
  'light': 'minimal',
  'classic': 'classic',
  'glass-pet': 'glass',
  'moon-cat': 'cute',
  'pixel-buddy': 'classic',
};
const SURFACE_STYLE_VALUES = ['transparent', 'solid'];
const SURFACE_STYLE_CLASSES = SURFACE_STYLE_VALUES.map(s => `surface-${s}`);
const MODE_VALUES = ['digital', 'analog', 'both'];
const TIME_FORMAT_VALUES = ['24', '12'];

const DEFAULT_CONFIG = {
  clocks: [
    { label: 'Budapest', tz: 'Europe/Budapest' },
    { label: 'Beijing', tz: 'Asia/Shanghai' },
  ],
  clockCount: 2,
  mode: 'digital',
  locked: false,
  on_top: true,
  theme: 'classic',
  surfaceStyle: 'transparent',
  timeFormat: '24',
  opacity: 0.88,
  autostart: false,
  pomodoro: { focusMinutes: 25, breakMinutes: 5 },
};

let config = normalizeConfig();
let hitRegionFrame = 0;

const body = document.body;
const clockBody = document.getElementById('clock-body');
const objectShell = document.getElementById('object-shell');
const mainEl = document.getElementById('main');
const hoverControls = document.getElementById('hover-controls');
const contextMenu = document.getElementById('context-menu');
const settingsPanel = document.getElementById('settings-panel');
const pomodoroStatus = document.getElementById('pomodoro-status');
const btnLock = document.getElementById('btn-lock');
const btnOnTop = document.getElementById('btn-ontop');
const btnPomodoro = document.getElementById('btn-pomodoro');
const btnSettings = document.getElementById('btn-settings');
const btnHide = document.getElementById('btn-hide');
const btnCloseSettings = document.getElementById('btn-close-settings');
const modeBtns = document.querySelectorAll('.mode-btn');
const setOpacity = document.getElementById('set-opacity');

const pomodoroState = { phase: 'idle', running: false, durationMs: 0, remainingMs: 0, endAt: 0 };

body.classList.toggle('platform-windows', isWindows);

// ── normalise ─────────────────────────────────────────────────────────────

function clampNumber(v, min, max, fb) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fb;
}

function normalizeTheme(t) {
  const next = LEGACY_THEME_MAP[t] || t;
  return THEME_VALUES.includes(next) ? next : DEFAULT_CONFIG.theme;
}
function normalizeMode(m) { return MODE_VALUES.includes(m) ? m : DEFAULT_CONFIG.mode; }
function normalizeSurfaceStyle(s) { return SURFACE_STYLE_VALUES.includes(s) ? s : DEFAULT_CONFIG.surfaceStyle; }
function normalizeTimeFormat(v) { return TIME_FORMAT_VALUES.includes(String(v)) ? String(v) : DEFAULT_CONFIG.timeFormat; }
function normalizeClockCount(v) { return Number(v) === 1 ? 1 : 2; }
function normalizeClock(c, fb) {
  return {
    label: typeof c?.label === 'string' && c.label.trim() ? c.label.trim() : fb.label,
    tz: TIMEZONES.includes(c?.tz) ? c.tz : fb.tz,
  };
}
function normalizePomodoro(v = {}) {
  return {
    focusMinutes: clampNumber(v.focusMinutes, 1, 120, DEFAULT_CONFIG.pomodoro.focusMinutes),
    breakMinutes: clampNumber(v.breakMinutes, 1, 60, DEFAULT_CONFIG.pomodoro.breakMinutes),
  };
}
function normalizeConfig(saved = {}) {
  const src = saved && typeof saved === 'object' ? saved : {};
  const savedClocks = Array.isArray(src.clocks) ? src.clocks : [];
  return {
    ...DEFAULT_CONFIG, ...src,
    clocks: [
      normalizeClock(savedClocks[0], DEFAULT_CONFIG.clocks[0]),
      normalizeClock(savedClocks[1], DEFAULT_CONFIG.clocks[1]),
    ],
    clockCount: normalizeClockCount(src.clockCount ?? DEFAULT_CONFIG.clockCount),
    mode: normalizeMode(src.mode),
    theme: normalizeTheme(src.theme),
    surfaceStyle: normalizeSurfaceStyle(src.surfaceStyle),
    timeFormat: normalizeTimeFormat(src.timeFormat),
    opacity: clampNumber(src.opacity, 0.72, 1, DEFAULT_CONFIG.opacity),
    locked: Boolean(src.locked),
    on_top: src.on_top !== false,
    autostart: Boolean(src.autostart),
    pomodoro: normalizePomodoro(src.pomodoro),
  };
}
function activeClockCount() { return normalizeClockCount(config.clockCount); }

// ── clock component builder ───────────────────────────────────────────────

// minimal/cute have light backgrounds → use 'light' scheme for zone-meta / analog colors
function clockScheme() {
  return (config.theme === 'minimal' || config.theme === 'cute') ? 'light' : 'dark';
}

function buildClocks() {
  mainEl.innerHTML = '';

  const count = activeClockCount();
  const mode = config.mode;
  const variant = config.theme; // classic | minimal | cute | glass
  const lang = 'zh';
  const hour12 = config.timeFormat === '12';

  if (count === 1) {
    buildSingleClock(mode, variant, lang, hour12, config.clocks[0]);
  } else {
    buildDualClock(mode, variant, lang, hour12, config.clocks[0], config.clocks[1]);
  }

  scheduleHitRegionUpdate();
}

function buildSingleClock(mode, variant, lang, hour12, clock) {
  const scheme = clockScheme();
  if (mode === 'analog') {
    const wrap = document.createElement('div');
    wrap.className = 'single-wrap';

    const a = document.createElement('analog-clock');
    a.setAttribute('variant', scheme);
    a.setAttribute('seconds', '');
    if (clock.tz) a.setAttribute('tz', clock.tz);
    a.style.cssText = '--size:180px';
    wrap.appendChild(a);

    const zm = document.createElement('zone-meta');
    zm.setAttribute('variant', scheme);
    zm.setAttribute('tz', clock.tz);
    zm.setAttribute('label', clock.label);
    zm.setAttribute('lang', lang);
    zm.setAttribute('center', '');
    wrap.appendChild(zm);

    mainEl.appendChild(wrap);
  } else if (mode === 'both') {
    const d = document.createElement('dual-clock');
    d.setAttribute('variant', scheme);
    if (clock.tz) d.setAttribute('tz', clock.tz);
    d.setAttribute('meta', 'weekday,date,location');
    d.setAttribute('location', clock.label);
    d.setAttribute('lang', lang);
    if (hour12) d.setAttribute('hour12', '');
    mainEl.appendChild(d);
  } else {
    // digital
    const f = document.createElement('flip-clock');
    f.setAttribute('variant', variant);
    f.setAttribute('fields', 'hms');
    if (clock.tz) f.setAttribute('tz', clock.tz);
    f.setAttribute('meta', 'weekday,date,location');
    f.setAttribute('location', clock.label);
    f.setAttribute('lang', lang);
    if (hour12) f.setAttribute('hour12', '');
    if (hour12) f.setAttribute('ampm', '');
    mainEl.appendChild(f);
  }
}

function buildDualClock(mode, variant, lang, hour12, clockA, clockB) {
  const scheme = clockScheme();
  if (mode === 'both') {
    const wrap = document.createElement('div');
    wrap.className = 'dual-both-wrap';
    [clockA, clockB].forEach(clock => {
      const d = document.createElement('dual-clock');
      d.setAttribute('variant', scheme);
      if (clock.tz) d.setAttribute('tz', clock.tz);
      d.setAttribute('meta', 'weekday,date,location');
      d.setAttribute('location', clock.label);
      d.setAttribute('lang', lang);
      if (hour12) d.setAttribute('hour12', '');
      wrap.appendChild(d);
    });
    mainEl.appendChild(wrap);
  } else {
    const wp = document.createElement('world-pair');
    wp.setAttribute('type', mode === 'analog' ? 'analog' : 'digital');
    wp.setAttribute('layout', 'row');
    wp.setAttribute('variant', scheme);
    wp.setAttribute('lang', lang);
    wp.setAttribute('a-tz', clockA.tz);
    wp.setAttribute('a-label', clockA.label);
    wp.setAttribute('b-tz', clockB.tz);
    wp.setAttribute('b-label', clockB.label);
    mainEl.appendChild(wp);
  }
}

// ── pomodoro ──────────────────────────────────────────────────────────────

let tickTimerId = null;

function pomodoroDuration(phase) {
  return (phase === 'break' ? config.pomodoro.breakMinutes : config.pomodoro.focusMinutes) * 60000;
}
function formatDuration(ms) {
  const t = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}
function setPomodoroStatus(text) {
  if (!text) { pomodoroStatus.classList.add('hidden'); pomodoroStatus.textContent = ''; return; }
  pomodoroStatus.textContent = text;
  pomodoroStatus.classList.remove('hidden');
}
function startPomodoro(phase = 'focus') {
  const durationMs = pomodoroDuration(phase);
  Object.assign(pomodoroState, { phase, running: true, durationMs, remainingMs: durationMs, endAt: Date.now() + durationMs });
  body.classList.remove('pomodoro-done');
  updatePomodoro();
}
function pausePomodoro() {
  if (!pomodoroState.running) return;
  pomodoroState.remainingMs = Math.max(0, pomodoroState.endAt - Date.now());
  pomodoroState.running = false; pomodoroState.endAt = 0;
  updatePomodoro();
}
function resumePomodoro() {
  if (pomodoroState.phase === 'idle' || pomodoroState.remainingMs <= 0) { startPomodoro('focus'); return; }
  pomodoroState.running = true;
  pomodoroState.endAt = Date.now() + pomodoroState.remainingMs;
  updatePomodoro();
}
function resetPomodoro() {
  Object.assign(pomodoroState, { phase: 'idle', running: false, durationMs: 0, remainingMs: 0, endAt: 0 });
  body.classList.remove('pomodoro-active', 'pomodoro-paused', 'pomodoro-done');
  body.style.setProperty('--progress', '0deg');
  setPomodoroStatus(''); syncMenuLabels();
}
function togglePomodoro() {
  if (pomodoroState.running) pausePomodoro(); else resumePomodoro();
  syncMenuLabels();
}
function completePomodoro() {
  const wasFocus = pomodoroState.phase === 'focus';
  Object.assign(pomodoroState, { running: false, remainingMs: 0, endAt: 0 });
  body.classList.remove('pomodoro-active', 'pomodoro-paused');
  body.classList.add('pomodoro-done');
  body.style.setProperty('--progress', '360deg');
  setPomodoroStatus(wasFocus ? '专注完成' : '休息完成');
  window.setTimeout(() => body.classList.remove('pomodoro-done'), 1200);
  syncMenuLabels();
}
function updatePomodoro() {
  if (pomodoroState.phase === 'idle') return;
  if (pomodoroState.running) {
    pomodoroState.remainingMs = Math.max(0, pomodoroState.endAt - Date.now());
    if (pomodoroState.remainingMs <= 0) { completePomodoro(); return; }
  }
  const elapsed = pomodoroState.durationMs - pomodoroState.remainingMs;
  const progress = pomodoroState.durationMs > 0 ? (elapsed / pomodoroState.durationMs) * 360 : 0;
  body.classList.toggle('pomodoro-active', pomodoroState.running);
  body.classList.toggle('pomodoro-paused', !pomodoroState.running);
  body.style.setProperty('--progress', `${Math.max(0, Math.min(360, progress))}deg`);
  setPomodoroStatus(`${pomodoroState.phase === 'break' ? '休息' : '专注'} ${formatDuration(pomodoroState.remainingMs)}${pomodoroState.running ? '' : ' 暂停'}`);
}

function tick() {
  if (!document.hidden) updatePomodoro();
}
function startClock() {
  if (tickTimerId !== null) return;
  tickTimerId = window.setInterval(tick, 1000);
}
function stopClock() {
  if (tickTimerId === null) return;
  window.clearInterval(tickTimerId); tickTimerId = null;
}
document.addEventListener('visibilitychange', () => { if (document.hidden) stopClock(); else startClock(); });

// ── apply functions ───────────────────────────────────────────────────────

function applyMode(mode) {
  config.mode = normalizeMode(mode);
  modeBtns.forEach(b => b.classList.toggle('active', b.dataset.mode === config.mode));
  buildClocks();
}

function applyTheme(theme) {
  config.theme = normalizeTheme(theme);
  body.classList.remove(...THEME_CLASSES);
  body.classList.add(`theme-${config.theme}`);
  document.querySelectorAll('input[name="theme"]').forEach(i => { i.checked = i.value === config.theme; });
  if (isTauri) invoke('set_theme', { theme: config.theme });
  buildClocks();
}

function applySurfaceStyle(style) {
  config.surfaceStyle = normalizeSurfaceStyle(style);
  body.classList.remove(...SURFACE_STYLE_CLASSES);
  body.classList.add(`surface-${config.surfaceStyle}`);
  document.querySelectorAll('input[name="surface-style"]').forEach(i => { i.checked = i.value === config.surfaceStyle; });
  scheduleHitRegionUpdate();
}

function applyClockCount(count) {
  config.clockCount = normalizeClockCount(count);
  body.classList.toggle('clock-count-1', config.clockCount === 1);
  body.classList.toggle('clock-count-2', config.clockCount === 2);
  document.querySelectorAll('input[name="clock-count"]').forEach(i => { i.checked = Number(i.value) === config.clockCount; });
  syncSettingsClockCountVisibility();
  buildClocks();
}

function applyOpacity(value) {
  config.opacity = clampNumber(value, 0.72, 1, DEFAULT_CONFIG.opacity);
  body.style.setProperty('--clock-opacity', String(config.opacity));
  setOpacity.value = String(config.opacity);
  scheduleHitRegionUpdate();
}

function applyTimeFormat(value) {
  config.timeFormat = normalizeTimeFormat(value);
  document.querySelectorAll('input[name="time-format"]').forEach(i => { i.checked = i.value === config.timeFormat; });
  syncMenuLabels();
  buildClocks();
}

function applyOnTop(enabled) {
  config.on_top = Boolean(enabled);
  btnOnTop.classList.toggle('active', config.on_top);
  document.getElementById('set-ontop').checked = config.on_top;
  if (isTauri) invoke('set_window_on_top', { enabled: config.on_top });
  syncMenuLabels();
}

function applyLock(locked) {
  config.locked = Boolean(locked);
  body.classList.toggle('is-locked', config.locked);
  btnLock.classList.toggle('locked', config.locked);
  btnLock.setAttribute('aria-label', config.locked ? '解锁位置' : '锁定位置');
  btnLock.title = config.locked ? '解锁位置' : '锁定位置';
  objectShell.toggleAttribute('data-tauri-drag-region', !config.locked);
  if (isTauri) invoke('set_locked', { locked: config.locked });
  syncMenuLabels();
}

// ── settings ──────────────────────────────────────────────────────────────

async function saveConfig() {
  if (!isTauri) return;
  try { await invoke('save_config', { data: config }); }
  catch (e) { console.error('saveConfig', e); }
}

async function loadConfig() {
  if (!isTauri) return;
  try { config = normalizeConfig(await invoke('load_config')); }
  catch (e) { console.error('loadConfig', e); }
}

function populateTimezoneOptions() {
  const dl = document.getElementById('timezone-options');
  if (!dl) return;
  dl.innerHTML = '';
  TIMEZONES.forEach(tz => { const o = document.createElement('option'); o.value = tz; dl.appendChild(o); });
}

function resolveTimezone(value, fallback) {
  const q = value.trim().toLowerCase();
  if (!q) return fallback;
  return TIMEZONES.find(tz => tz.toLowerCase() === q)
    || TIMEZONES.find(tz => tz.toLowerCase().includes(q))
    || fallback;
}

function syncSettingsClockCountVisibility() {
  const sel = document.querySelector('input[name="clock-count"]:checked')?.value ?? config.clockCount;
  settingsPanel.classList.toggle('clock-count-1', Number(sel) === 1);
}

function syncMenuLabels() {
  document.getElementById('menu-pomodoro').textContent =
    pomodoroState.running ? '暂停番茄钟' : (pomodoroState.phase === 'idle' ? '开始番茄钟' : '继续番茄钟');
  document.getElementById('menu-format').textContent = config.timeFormat === '24' ? '切换 12h' : '切换 24h';
  document.getElementById('menu-lock').textContent = config.locked ? '解锁位置' : '锁定位置';
  document.getElementById('menu-ontop').textContent = config.on_top ? '取消置顶' : '始终置顶';
  btnPomodoro.classList.toggle('active', pomodoroState.running);
}

// ── floating surfaces ─────────────────────────────────────────────────────

function isSurfaceOpen() {
  return !contextMenu.classList.contains('hidden') || !settingsPanel.classList.contains('hidden');
}
function setSurfaceOpenClass() {
  body.classList.toggle('surface-open', isSurfaceOpen());
  scheduleHitRegionUpdate();
}
function positionSurface(el, x, y, offset = 10) {
  el.classList.remove('hidden');
  el.style.left = '0px'; el.style.top = '0px';

  const rect = el.getBoundingClientRect();
  const m = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = x + offset;
  let top  = y + offset;
  if (left + rect.width  > vw - m) left = x - rect.width  - offset;
  if (top  + rect.height > vh - m) top  = y - rect.height - offset;

  left = Math.round(Math.max(m, Math.min(vw - rect.width  - m, left)));
  top  = Math.round(Math.max(m, Math.min(vh - rect.height - m, top)));

  el.style.left = `${left}px`;
  el.style.top  = `${top}px`;
  setSurfaceOpenClass();
}
function closeContextMenu() { contextMenu.classList.add('hidden'); setSurfaceOpenClass(); }
function closeSettings() { settingsPanel.classList.add('hidden'); setSurfaceOpenClass(); }
function closeFloatingSurfaces() { closeContextMenu(); closeSettings(); }
function anchorFromElement(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.bottom };
}

function getContextMenuState() {
  return {
    locked: config.locked,
    on_top: config.on_top,
    clock_count: config.clockCount,
    mode: config.mode,
    theme: config.theme,
    surface_style: config.surfaceStyle,
    time_format: config.timeFormat,
    pomodoro_running: pomodoroState.running,
    pomodoro_idle: pomodoroState.phase === 'idle',
  };
}

async function openNativeContextMenu(x, y) {
  if (!isTauri) return false;
  try {
    await tauriInvoke('show_context_menu', { state: getContextMenuState(), x, y });
    closeContextMenu();
    return true;
  } catch (e) {
    console.warn('[native context menu]', e);
    if (isWindows) {
      setPomodoroStatus('右键菜单打开失败，请使用托盘菜单或设置按钮');
      return true;
    }
    return false;
  }
}

async function openNativeSettingsWindow() {
  if (!isTauri) return false;
  try {
    await tauriInvoke('show_settings_window');
    closeFloatingSurfaces();
    return true;
  } catch (e) {
    console.warn('[settings window]', e);
    return false;
  }
}

async function notifyMainWindowReady() {
  if (!isTauri) return;
  try {
    await tauriInvoke('main_window_ready');
  } catch (e) {
    console.warn('[main window ready]', e);
  }
}

// Returns screen bounds in viewport-relative CSS px; null if unavailable.
async function getDisplayBounds() {
  if (!isTauri) return null;
  try {
    const winMod = tauriApi.window;
    if (!winMod) return null;
    const win = winMod.getCurrentWindow?.();
    if (!win || typeof win.outerPosition !== 'function') return null;
    const [outerPos, monitor] = await Promise.all([
      win.outerPosition(),
      winMod.currentMonitor?.(),
    ]);
    if (!outerPos || !monitor) return null;
    const sf = monitor.scaleFactor ?? 1;
    const mL = monitor.position.x / sf;
    const mT = monitor.position.y / sf;
    const mR = mL + monitor.size.width / sf;
    const mB = mT + monitor.size.height / sf;
    const wL = outerPos.x / sf;
    const wT = outerPos.y / sf;
    return { left: mL - wL, top: mT - wT, right: mR - wL, bottom: mB - wT };
  } catch {
    return null;
  }
}

async function openContextMenu(event) {
  event.preventDefault();
  closeSettings(); syncMenuLabels();

  const cx = event.clientX;
  const cy = event.clientY;

  // In Tauri, use the OS popup menu anchored to the real right-click point.
  // HTML menus are clipped by the widget window and cannot behave like
  // desktop-pet context menus on Windows.
  if (await openNativeContextMenu(cx, cy)) return;

  // Unhide at origin to measure natural dimensions
  contextMenu.classList.remove('hidden');
  contextMenu.style.left = '0px';
  contextMenu.style.top = '0px';

  const rect = contextMenu.getBoundingClientRect();
  const menuW = rect.width;
  const menuH = rect.height;
  const m = 8;

  // Use actual screen bounds for flip direction; fall back to viewport
  const bounds = await getDisplayBounds();
  const limitR = bounds ? bounds.right  : window.innerWidth;
  const limitB = bounds ? bounds.bottom : window.innerHeight;

  let left = cx + 2;
  let top  = cy + 2;
  if (left + menuW > limitR - m) left = cx - menuW - 2;
  if (top  + menuH > limitB - m) top  = cy - menuH - 2;

  // Hard clamp to viewport (fixed elements cannot render outside the webview)
  left = Math.round(Math.max(m, Math.min(window.innerWidth  - menuW - m, left)));
  top  = Math.round(Math.max(m, Math.min(window.innerHeight - menuH - m, top)));

  contextMenu.style.left = `${left}px`;
  contextMenu.style.top  = `${top}px`;
  setSurfaceOpenClass();
}

async function openSettings(anchor = anchorFromElement(btnSettings)) {
  if (await openNativeSettingsWindow()) return;

  closeContextMenu();
  populateTimezoneOptions();
  document.getElementById('set-label-1').value = config.clocks[0].label;
  document.getElementById('set-label-2').value = config.clocks[1].label;
  document.getElementById('set-tz-1').value = config.clocks[0].tz;
  document.getElementById('set-tz-2').value = config.clocks[1].tz;
  document.getElementById('set-focus-minutes').value = String(config.pomodoro.focusMinutes);
  document.getElementById('set-break-minutes').value = String(config.pomodoro.breakMinutes);
  document.querySelectorAll('input[name="clock-count"]').forEach(i => { i.checked = Number(i.value) === config.clockCount; });
  document.querySelectorAll('input[name="theme"]').forEach(i => { i.checked = i.value === config.theme; });
  document.querySelectorAll('input[name="surface-style"]').forEach(i => { i.checked = i.value === config.surfaceStyle; });
  document.querySelectorAll('input[name="time-format"]').forEach(i => { i.checked = i.value === config.timeFormat; });
  document.getElementById('set-ontop').checked = config.on_top;
  document.getElementById('set-autostart').checked = config.autostart;
  applyOpacity(config.opacity);
  syncSettingsClockCountVisibility();
  positionSurface(settingsPanel, anchor.x, anchor.y, 8);
}

async function applySettings() {
  applyClockCount(document.querySelector('input[name="clock-count"]:checked')?.value ?? config.clockCount);
  config.clocks[0].label = document.getElementById('set-label-1').value.trim() || 'Clock 1';
  config.clocks[0].tz = resolveTimezone(document.getElementById('set-tz-1').value, config.clocks[0].tz);
  config.clocks[1].label = document.getElementById('set-label-2').value.trim() || 'Clock 2';
  config.clocks[1].tz = resolveTimezone(document.getElementById('set-tz-2').value, config.clocks[1].tz);
  applyTheme(document.querySelector('input[name="theme"]:checked')?.value ?? config.theme);
  applySurfaceStyle(document.querySelector('input[name="surface-style"]:checked')?.value ?? config.surfaceStyle);
  applyTimeFormat(document.querySelector('input[name="time-format"]:checked')?.value ?? config.timeFormat);
  applyOpacity(document.getElementById('set-opacity').value);
  applyOnTop(document.getElementById('set-ontop').checked);
  config.autostart = document.getElementById('set-autostart').checked;
  config.pomodoro = normalizePomodoro({
    focusMinutes: document.getElementById('set-focus-minutes').value,
    breakMinutes: document.getElementById('set-break-minutes').value,
  });
  if (isTauri) invoke('set_autostart', { enabled: config.autostart });
  buildClocks();
  await saveConfig();
  closeSettings();
}

// ── interaction ───────────────────────────────────────────────────────────

function isInteractiveTarget(target) {
  return Boolean(target.closest('button, input, label, #context-menu, #settings-panel, #hover-controls, #mode-bar'));
}
function showInteractionSurfaces() {
  if (body.classList.contains('is-hovering')) return; // already shown; hit-regions unchanged
  body.classList.add('is-hovering');
  scheduleHitRegionUpdate();
}
function hideInteractionSurfacesSoon() {
  window.setTimeout(() => {
    if (isSurfaceOpen()) return;
    body.classList.remove('is-hovering'); scheduleHitRegionUpdate();
  }, 190);
}

clockBody.addEventListener('pointerdown', showInteractionSurfaces);
// drag is handled natively via data-tauri-drag-region on #object-shell (sync, no IPC latency)
clockBody.addEventListener('contextmenu', openContextMenu);
clockBody.addEventListener('pointerenter', showInteractionSurfaces);
clockBody.addEventListener('pointermove', showInteractionSurfaces);
clockBody.addEventListener('pointerleave', hideInteractionSurfacesSoon);
objectShell.addEventListener('pointerenter', showInteractionSurfaces);
objectShell.addEventListener('pointermove', showInteractionSurfaces);
hoverControls.addEventListener('transitionend', scheduleHitRegionUpdate);
document.getElementById('mode-bar').addEventListener('transitionend', scheduleHitRegionUpdate);

btnSettings.addEventListener('click', () => {
  if (isTauri) { openSettings(anchorFromElement(btnSettings)); return; }
  if (settingsPanel.classList.contains('hidden')) openSettings(anchorFromElement(btnSettings));
  else closeSettings();
});
btnCloseSettings.addEventListener('click', closeSettings);
document.getElementById('btn-cancel').addEventListener('click', closeSettings);
document.getElementById('btn-apply').addEventListener('click', applySettings);

btnLock.addEventListener('click', async () => { applyLock(!config.locked); await saveConfig(); });
btnOnTop.addEventListener('click', async () => { applyOnTop(!config.on_top); await saveConfig(); });
btnPomodoro.addEventListener('click', togglePomodoro);
btnHide.addEventListener('click', () => { if (isTauri) invoke('hide_window'); });

document.querySelectorAll('input[name="clock-count"]').forEach(i => {
  i.addEventListener('change', syncSettingsClockCountVisibility);
});
modeBtns.forEach(b => b.addEventListener('click', async () => { applyMode(b.dataset.mode); await saveConfig(); }));
setOpacity.addEventListener('input', () => applyOpacity(setOpacity.value));

async function handleContextMenuAction(action, anchor) {
  if (!action) return;
  if (action === 'toggle-pomodoro') togglePomodoro();
  if (action === 'reset-pomodoro') resetPomodoro();
  if (action === 'set-count-single') applyClockCount(1);
  if (action === 'set-count-dual') applyClockCount(2);
  if (action === 'set-mode-digital') applyMode('digital');
  if (action === 'set-mode-analog') applyMode('analog');
  if (action === 'set-mode-both') applyMode('both');
  if (action === 'set-theme-classic') applyTheme('classic');
  if (action === 'set-theme-minimal') applyTheme('minimal');
  if (action === 'set-theme-cute') applyTheme('cute');
  if (action === 'set-theme-glass') applyTheme('glass');
  if (action === 'set-surface-transparent') applySurfaceStyle('transparent');
  if (action === 'set-surface-solid') applySurfaceStyle('solid');
  if (action === 'toggle-time-format') applyTimeFormat(config.timeFormat === '24' ? '12' : '24');
  if (action === 'toggle-lock') applyLock(!config.locked);
  if (action === 'toggle-ontop') applyOnTop(!config.on_top);
  if (action === 'open-settings') await openSettings(anchor || anchorFromElement(btnSettings));
  if (action !== 'open-settings') closeContextMenu();
  await saveConfig();
}

contextMenu.addEventListener('click', async event => {
  const action = event.target.closest('[data-menu-action]')?.dataset.menuAction;
  await handleContextMenuAction(action, { x: event.clientX, y: event.clientY });
});

document.addEventListener('pointerdown', event => {
  const inside = event.target.closest('#context-menu, #settings-panel, #hover-controls, #mode-bar, #object-shell');
  if (!inside) closeFloatingSurfaces();
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeFloatingSurfaces(); });
window.addEventListener('resize', scheduleHitRegionUpdate);

// ── hit regions ───────────────────────────────────────────────────────────

function isHitRegionVisible(el) {
  if (el.classList.contains('hidden')) return false;
  const s = window.getComputedStyle(el);
  if (s.display === 'none' || s.visibility === 'hidden' || s.pointerEvents === 'none') return false;
  if (Number(s.opacity) <= 0.03) return false;
  const r = el.getBoundingClientRect();
  return r.width > 2 && r.height > 2;
}

function cssPx(value, fallback = 0) {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

function elementRegionRadius(el, rect, pad = 0) {
  if (el.classList.contains('analog')) {
    return Math.max(rect.width, rect.height) / 2 + pad;
  }

  const s = window.getComputedStyle(el);
  const radius = Math.max(
    cssPx(s.borderTopLeftRadius),
    cssPx(s.borderTopRightRadius),
    cssPx(s.borderBottomRightRadius),
    cssPx(s.borderBottomLeftRadius),
    8
  );
  return radius + pad;
}

function pushRegion(regions, rect, scale, pad, radius) {
  regions.push({
    x: Math.round((rect.left - pad) * scale),
    y: Math.round((rect.top - pad) * scale),
    width: Math.round((rect.width + pad * 2) * scale),
    height: Math.round((rect.height + pad * 2) * scale),
    radius: Math.round(radius * scale),
  });
}

function pushElementRegion(regions, el, scale, pad = 3) {
  if (!isHitRegionVisible(el)) return;
  const rect = el.getBoundingClientRect();
  pushRegion(regions, rect, scale, pad, elementRegionRadius(el, rect, pad));
}

function collectClockObjectRegions(regions, scale) {
  const selectors = [
    '.fc-digit',
    '.fc-meta',
    '.fc-ampm',
    '.analog',
    '.dl-read',
    '.zone-meta',
    '.wp-pill',
    '#pomodoro-status:not(.hidden)',
  ];

  const seen = new Set();
  document.querySelectorAll(selectors.join(',')).forEach(el => {
    if (seen.has(el)) return;
    seen.add(el);
    pushElementRegion(regions, el, scale, el.classList.contains('analog') ? 6 : 4);
  });
}

function collectHitRegions() {
  const scale = window.devicePixelRatio || 1;
  const isSolid = body.classList.contains('surface-solid');

  const regions = [];

  // In solid mode the visible object is the whole backing plate. In transparent
  // mode, keep desktop-pet behavior: only visible clock parts receive hits.
  const clockRect = mainEl.getBoundingClientRect();
  if (isSolid && clockRect.width > 2 && clockRect.height > 2) {
    pushRegion(regions, clockRect, scale, 28, 28);
  } else {
    collectClockObjectRegions(regions, scale);
    if (!regions.length && clockRect.width > 2 && clockRect.height > 2) {
      pushRegion(regions, clockRect, scale, 8, 14);
    }
  }

  // control surfaces
  [...document.querySelectorAll('[data-hit-region]')]
    .filter(el => !el.id.startsWith('card-') && isHitRegionVisible(el))
    .forEach(el => {
      const rect = el.getBoundingClientRect();
      const radius = Number(el.dataset.hitRadius || 12);
      const pad = Number(el.dataset.hitPad || 0);
      regions.push({
        x: Math.round((rect.left - pad) * scale),
        y: Math.round((rect.top - pad) * scale),
        width: Math.round((rect.width + pad * 2) * scale),
        height: Math.round((rect.height + pad * 2) * scale),
        radius: Math.round((radius + pad) * scale),
      });
    });

  return regions;
}

async function applyHitRegionsNow() {
  hitRegionFrame = 0;
  if (!isTauri) return;
  try {
    await invoke('set_hit_test_regions', { regions: collectHitRegions() });
  } catch (e) {
    console.warn('[hit regions]', e);
  }
}

function updateHitRegions() {
  applyHitRegionsNow();
}
function scheduleHitRegionUpdate() {
  if (hitRegionFrame) return;
  hitRegionFrame = window.requestAnimationFrame(updateHitRegions);
}

// ── tauri events ──────────────────────────────────────────────────────────

if (isTauri) {
  listen('tray-set-lock', async e => { applyLock(Boolean(e.payload)); await saveConfig(); });
  listen('tray-set-theme', async e => { applyTheme(e.payload); await saveConfig(); });
  listen('tray-set-ontop', async e => { applyOnTop(Boolean(e.payload)); await saveConfig(); });
  listen('context-menu-action', async e => {
    await handleContextMenuAction(String(e.payload || ''), anchorFromElement(btnSettings));
  });
  listen('config-updated', async e => {
    config = normalizeConfig(e.payload);
    applyTheme(config.theme);
    applySurfaceStyle(config.surfaceStyle);
    applyClockCount(config.clockCount);
    applyMode(config.mode);
    applyTimeFormat(config.timeFormat);
    applyOpacity(config.opacity);
    applyLock(config.locked);
    applyOnTop(config.on_top);
    buildClocks();
  });
}

// ── init ──────────────────────────────────────────────────────────────────

async function init() {
  try {
    await loadConfig();

    applyTheme(config.theme);
    applySurfaceStyle(config.surfaceStyle);
    applyClockCount(config.clockCount);
    applyMode(config.mode);
    applyTimeFormat(config.timeFormat);
    applyOpacity(config.opacity);
    applyLock(config.locked);
    applyOnTop(config.on_top);
    resetPomodoro();

    buildClocks();
    startClock();
    await applyHitRegionsNow();
    await notifyMainWindowReady();
    window.setTimeout(scheduleHitRegionUpdate, 400);
  } catch (e) {
    console.error('init failed', e);
    setPomodoroStatus(`Error: ${String(e).slice(0, 70)}`);
  }
}

init();
})();
