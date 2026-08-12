(() => {
if (window.__worldClockMainBootstrapped) return;
window.__worldClockMainBootstrapped = true;

const tauriApi = window.__TAURI__ ?? {};
const tauriInvoke = tauriApi.core?.invoke;
const tauriListen = tauriApi.event?.listen;
const isTauri = typeof tauriInvoke === 'function';
const isWindows = /Windows/i.test(navigator.userAgent);
const Config = window.WCConfig;

if (!Config) throw new Error('config.js must load before main.js');

const {
  DEFAULT_CONFIG,
  MODE_VALUES,
  SURFACE_STYLE_VALUES,
  THEME_VALUES,
  TIMEZONES,
  clampNumber,
  normalizeClockCount,
  normalizeConfig,
  normalizeMode,
  normalizePomodoro,
  normalizeSurfaceStyle,
  normalizeTheme,
  normalizeTimeFormat,
  resolveTimezone,
  shouldFitWindow,
} = Config;
const THEME_CLASSES = THEME_VALUES.map((theme) => `theme-${theme}`);
const SURFACE_STYLE_CLASSES = SURFACE_STYLE_VALUES.map((style) => `surface-${style}`);

const invoke = isTauri
  ? async (cmd, args) => tauriInvoke(cmd, args)
  : async (cmd, args) => { console.log('[invoke noop]', cmd, args); return null; };

const listen = typeof tauriListen === 'function' ? tauriListen : async () => () => {};

let config = normalizeConfig();
let hitRegionFrame = 0;
let dragPointerId = null;
let dragFrame = 0;
let dragLastPoint = null;
let dragUsedManualMove = false;
let lastFocusedElement = null;
const unlistenCallbacks = [];

const body = document.body;
const clockBody = document.getElementById('clock-body');
const objectShell = document.getElementById('object-shell');
const mainEl = document.getElementById('main');
const contextMenu = document.getElementById('context-menu');
const settingsPanel = document.getElementById('settings-panel');
const pomodoroStatus = document.getElementById('pomodoro-status');
const btnCloseSettings = document.getElementById('btn-close-settings');
const setOpacity = document.getElementById('set-opacity');
const setShowSeconds = document.getElementById('set-show-seconds');

const pomodoroState = { phase: 'idle', running: false, durationMs: 0, remainingMs: 0, endAt: 0 };

body.classList.toggle('platform-windows', isWindows);

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
  body.classList.toggle('shows-seconds', config.showSeconds);
  body.classList.toggle('hides-seconds', !config.showSeconds);

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
    if (config.showSeconds) a.setAttribute('seconds', '');
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
    if (config.showSeconds) d.setAttribute('seconds', '');
    if (hour12) d.setAttribute('hour12', '');
    mainEl.appendChild(d);
  } else {
    // digital
    const f = document.createElement('flip-clock');
    f.setAttribute('variant', variant);
    f.setAttribute('fields', config.showSeconds ? 'hms' : 'hm');
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
      if (config.showSeconds) d.setAttribute('seconds', '');
      if (hour12) d.setAttribute('hour12', '');
      wrap.appendChild(d);
    });
    mainEl.appendChild(wrap);
  } else {
    const wp = document.createElement('world-pair');
    window.WCWorldClock.configureWorldPair(wp, {
      type: mode === 'analog' ? 'analog' : 'digital',
      layout: 'row',
      variant,
      colorScheme: scheme,
      lang,
      clockA,
      clockB,
      showSeconds: config.showSeconds,
      hour12,
    });
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
  startClock();
}
function pausePomodoro() {
  if (!pomodoroState.running) return;
  pomodoroState.remainingMs = Math.max(0, pomodoroState.endAt - Date.now());
  pomodoroState.running = false; pomodoroState.endAt = 0;
  updatePomodoro();
  stopClock();
}
function resumePomodoro() {
  if (pomodoroState.phase === 'idle' || pomodoroState.remainingMs <= 0) { startPomodoro('focus'); return; }
  pomodoroState.running = true;
  pomodoroState.endAt = Date.now() + pomodoroState.remainingMs;
  updatePomodoro();
  startClock();
}
function resetPomodoro() {
  Object.assign(pomodoroState, { phase: 'idle', running: false, durationMs: 0, remainingMs: 0, endAt: 0 });
  body.classList.remove('pomodoro-active', 'pomodoro-paused', 'pomodoro-done');
  body.style.setProperty('--progress', '0deg');
  setPomodoroStatus(''); syncMenuLabels();
  stopClock();
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
  stopClock();
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
  if (tickTimerId !== null || !pomodoroState.running || document.hidden) return;
  const schedule = () => {
    if (!pomodoroState.running || document.hidden) { tickTimerId = null; return; }
    tick();
    const delay = Math.max(100, 1000 - (Date.now() % 1000));
    tickTimerId = window.setTimeout(schedule, delay);
  };
  schedule();
}
function stopClock() {
  if (tickTimerId === null) return;
  window.clearTimeout(tickTimerId); tickTimerId = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopClock();
  else if (pomodoroState.running) startClock();
});

// ── apply functions ───────────────────────────────────────────────────────

function applyMode(mode, options = {}) {
  config.mode = normalizeMode(mode);
  document.querySelectorAll('input[name="mode"]').forEach(i => { i.checked = i.value === config.mode; });
  if (options.rebuild !== false) buildClocks();
}

function applyTheme(theme, options = {}) {
  config.theme = normalizeTheme(theme);
  body.classList.remove(...THEME_CLASSES);
  body.classList.add(`theme-${config.theme}`);
  document.querySelectorAll('input[name="theme"]').forEach(i => { i.checked = i.value === config.theme; });
  if (options.rebuild !== false) buildClocks();
}

function applySurfaceStyle(style, options = {}) {
  config.surfaceStyle = normalizeSurfaceStyle(style);
  if (options.explicit) config.surfaceStyleExplicit = true;
  body.classList.remove(...SURFACE_STYLE_CLASSES);
  body.classList.add(`surface-${config.surfaceStyle}`);
  document.querySelectorAll('input[name="surface-style"]').forEach(i => { i.checked = i.value === config.surfaceStyle; });
  scheduleHitRegionUpdate();
}

function applyClockCount(count, options = {}) {
  config.clockCount = normalizeClockCount(count);
  body.classList.toggle('clock-count-1', config.clockCount === 1);
  body.classList.toggle('clock-count-2', config.clockCount === 2);
  document.querySelectorAll('input[name="clock-count"]').forEach(i => { i.checked = Number(i.value) === config.clockCount; });
  syncSettingsClockCountVisibility();
  if (options.rebuild !== false) buildClocks();
}

function applyOpacity(value) {
  config.opacity = clampNumber(value, 0.72, 1, DEFAULT_CONFIG.opacity);
  body.style.setProperty('--clock-opacity', String(config.opacity));
  const t = (config.opacity - 0.72) / 0.28;
  const lerp = (a, b) => a + (b - a) * Math.max(0, Math.min(1, t));
  body.style.setProperty('--local-dark-transparent', `rgba(6, 8, 12, ${lerp(0.52, 0.74).toFixed(3)})`);
  body.style.setProperty('--local-dark-solid', `rgba(6, 8, 12, ${lerp(0.78, 0.92).toFixed(3)})`);
  body.style.setProperty('--local-light-transparent', `rgba(255, 250, 242, ${lerp(0.74, 0.92).toFixed(3)})`);
  body.style.setProperty('--local-light-solid', `rgba(255, 250, 242, ${lerp(0.90, 1.00).toFixed(3)})`);
  setOpacity.value = String(config.opacity);
  scheduleHitRegionUpdate();
}

function applyTimeFormat(value, options = {}) {
  config.timeFormat = normalizeTimeFormat(value);
  document.querySelectorAll('input[name="time-format"]').forEach(i => { i.checked = i.value === config.timeFormat; });
  syncMenuLabels();
  if (options.rebuild !== false) buildClocks();
}

function applyShowSeconds(enabled, options = {}) {
  config.showSeconds = Boolean(enabled);
  setShowSeconds.checked = config.showSeconds;
  if (options.rebuild !== false) buildClocks();
}

function applyOnTop(enabled) {
  config.on_top = Boolean(enabled);
  document.getElementById('set-ontop').checked = config.on_top;
  syncMenuLabels();
}

function applyLock(locked) {
  config.locked = Boolean(locked);
  body.classList.toggle('is-locked', config.locked);
  syncMenuLabels();
}

function renderConfig(next) {
  config = normalizeConfig(next);
  applyTheme(config.theme, { rebuild: false });
  applySurfaceStyle(config.surfaceStyle);
  applyClockCount(config.clockCount, { rebuild: false });
  applyMode(config.mode, { rebuild: false });
  applyTimeFormat(config.timeFormat, { rebuild: false });
  applyShowSeconds(config.showSeconds, { rebuild: false });
  applyOpacity(config.opacity);
  applyLock(config.locked);
  applyOnTop(config.on_top);
  buildClocks();
}

// ── settings ──────────────────────────────────────────────────────────────

async function saveConfig(next = config) {
  if (!isTauri) return;
  await invoke('save_config', { data: normalizeConfig(next) });
}

async function loadConfig() {
  if (!isTauri) return;
  config = normalizeConfig(await invoke('load_config'));
  const actualAutostart = await invoke('get_autostart');
  if (typeof actualAutostart === 'boolean') config.autostart = actualAutostart;
}

async function syncNativePreferences(previous, next, options = {}) {
  if (!isTauri) return async () => {};
  const force = options.force === true;
  const shouldFit = options.fit === true;
  const rollbacks = [];
  const applyChange = async (command, nextArgs, previousArgs, changed) => {
    if (!changed) return;
    rollbacks.push(async () => invoke(command, previousArgs));
    await invoke(command, nextArgs);
  };
  const rollback = async () => {
    for (const undo of rollbacks.reverse()) {
      try { await undo(); } catch (error) { console.error('[config rollback]', error); }
    }
  };

  try {
    const originalBounds = shouldFit
      ? await invoke('get_main_window_bounds')
      : null;
    await applyChange(
      'set_theme', { theme: next.theme }, { theme: previous.theme },
      force || previous.theme !== next.theme,
    );
    await applyChange(
      'set_window_on_top', { enabled: next.on_top }, { enabled: previous.on_top },
      force || previous.on_top !== next.on_top,
    );
    await applyChange(
      'set_locked', { locked: next.locked }, { locked: previous.locked },
      force || previous.locked !== next.locked,
    );
    await applyChange(
      'set_autostart', { enabled: next.autostart }, { enabled: previous.autostart },
      previous.autostart !== next.autostart,
    );
    if (shouldFit) {
      // Register the exact rollback before fitting: the native command can resize
      // successfully and still fail while persisting its new window state.
      rollbacks.push(async () => invoke('restore_main_window_bounds', { bounds: originalBounds }));
      await invoke('fit_window_to_layout', {
        clockCount: next.clockCount,
        mode: next.mode,
        showSeconds: next.showSeconds,
      });
    }
    return rollback;
  } catch (error) {
    await rollback();
    throw error;
  }
}

async function commitConfig(next, options = {}) {
  const previous = normalizeConfig(config);
  const normalized = normalizeConfig(next);
  let rollback = async () => {};
  try {
    rollback = await syncNativePreferences(previous, normalized, options);
    await saveConfig(normalized);
  } catch (error) {
    await rollback();
    renderConfig(previous);
    throw error;
  }
  renderConfig(normalized);
  return normalized;
}

function populateTimezoneOptions() {
  const dl = document.getElementById('timezone-options');
  if (!dl) return;
  dl.innerHTML = '';
  TIMEZONES.forEach(tz => { const o = document.createElement('option'); o.value = tz; dl.appendChild(o); });
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
function closeSettings() {
  if (settingsPanel.classList.contains('hidden')) return;
  settingsPanel.classList.add('hidden');
  clockBody.inert = false;
  setSurfaceOpenClass();
  if (lastFocusedElement?.isConnected) lastFocusedElement.focus();
  lastFocusedElement = null;
}
function closeFloatingSurfaces() { closeContextMenu(); closeSettings(); }
function clockAnchor() {
  const r = clockBody.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
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

async function openSettings(anchor = clockAnchor()) {
  if (await openNativeSettingsWindow()) return;

  closeContextMenu();
  lastFocusedElement = document.activeElement;
  populateTimezoneOptions();
  document.getElementById('set-label-1').value = config.clocks[0].label;
  document.getElementById('set-label-2').value = config.clocks[1].label;
  document.getElementById('set-tz-1').value = config.clocks[0].tz;
  document.getElementById('set-tz-2').value = config.clocks[1].tz;
  document.getElementById('set-focus-minutes').value = String(config.pomodoro.focusMinutes);
  document.getElementById('set-break-minutes').value = String(config.pomodoro.breakMinutes);
  document.querySelectorAll('input[name="clock-count"]').forEach(i => { i.checked = Number(i.value) === config.clockCount; });
  document.querySelectorAll('input[name="mode"]').forEach(i => { i.checked = i.value === config.mode; });
  document.querySelectorAll('input[name="theme"]').forEach(i => { i.checked = i.value === config.theme; });
  document.querySelectorAll('input[name="surface-style"]').forEach(i => { i.checked = i.value === config.surfaceStyle; });
  document.querySelectorAll('input[name="time-format"]').forEach(i => { i.checked = i.value === config.timeFormat; });
  setShowSeconds.checked = config.showSeconds;
  document.getElementById('set-ontop').checked = config.on_top;
  document.getElementById('set-autostart').checked = config.autostart;
  applyOpacity(config.opacity);
  syncSettingsClockCountVisibility();
  positionSurface(settingsPanel, anchor.x, anchor.y, 8);
  clockBody.inert = true;
  settingsPanel.querySelector('input, button')?.focus();
}

async function applySettings() {
  const button = document.getElementById('btn-apply');
  const next = normalizeConfig({
    ...config,
    clockCount: document.querySelector('input[name="clock-count"]:checked')?.value,
    mode: document.querySelector('input[name="mode"]:checked')?.value,
    showSeconds: setShowSeconds.checked,
    clocks: [
      {
        label: document.getElementById('set-label-1').value,
        tz: resolveTimezone(document.getElementById('set-tz-1').value, config.clocks[0].tz),
      },
      {
        label: document.getElementById('set-label-2').value,
        tz: resolveTimezone(document.getElementById('set-tz-2').value, config.clocks[1].tz),
      },
    ],
    theme: document.querySelector('input[name="theme"]:checked')?.value,
    surfaceStyle: document.querySelector('input[name="surface-style"]:checked')?.value,
    surfaceStyleExplicit: true,
    timeFormat: document.querySelector('input[name="time-format"]:checked')?.value,
    opacity: document.getElementById('set-opacity').value,
    on_top: document.getElementById('set-ontop').checked,
    autostart: document.getElementById('set-autostart').checked,
    pomodoro: normalizePomodoro({
      focusMinutes: document.getElementById('set-focus-minutes').value,
      breakMinutes: document.getElementById('set-break-minutes').value,
    }),
  });
  const shouldFit = shouldFitWindow(config, next);
  button.disabled = true;
  try {
    await commitConfig(next, { fit: shouldFit });
    closeSettings();
  } catch (error) {
    console.error('[settings] apply failed', error);
    setPomodoroStatus(`设置未保存：${String(error).slice(0, 64)}`);
    settingsPanel.focus();
  } finally {
    button.disabled = false;
  }
}

// ── interaction ───────────────────────────────────────────────────────────

function isInteractiveTarget(target) {
  return Boolean(target.closest('button, input, label, #context-menu, #settings-panel'));
}
function isClockDragTarget(target) {
  return Boolean(target.closest(
    '#object-shell, #main, .single-wrap, .dual-both-wrap, .world-pair, .wp-zone, .wp-mid, .flip-clock, .fc-row, .fc-pair, .fc-digit, .fc-meta, .fc-ampm, .analog, .dual, .dl-read, .zone-meta, .wp-pill'
  ));
}
function canStartClockDrag(event) {
  return isTauri
    && event.button === 0
    && !config.locked
    && !isSurfaceOpen()
    && !isInteractiveTarget(event.target)
    && isClockDragTarget(event.target);
}
function dragPoint(event) {
  return { screenX: event.screenX, screenY: event.screenY };
}

async function requestNativeDrag() {
  if (!isTauri) return false;
  try {
    await tauriInvoke('start_dragging');
    return true;
  } catch (e) {
    console.warn('[native drag]', e);
    return false;
  }
}

async function beginManualDrag(event) {
  dragPointerId = event.pointerId;
  dragLastPoint = dragPoint(event);
  dragUsedManualMove = false;
  body.classList.add('is-dragging');
  try { clockBody.setPointerCapture(event.pointerId); } catch {}

  try {
    await tauriInvoke('begin_window_drag', dragLastPoint);
  } catch (e) {
    console.warn('[manual drag begin]', e);
    dragPointerId = null;
    dragLastPoint = null;
    body.classList.remove('is-dragging');
    try { clockBody.releasePointerCapture(event.pointerId); } catch {}
    await requestNativeDrag();
  }
}

function flushManualDragMove() {
  dragFrame = 0;
  if (dragPointerId === null || !dragLastPoint) return;
  dragUsedManualMove = true;
  void tauriInvoke('move_window_drag', dragLastPoint).catch((e) => {
    console.warn('[manual drag move]', e);
  });
}

function queueManualDragMove(event) {
  if (dragPointerId !== event.pointerId) return;
  dragLastPoint = dragPoint(event);
  if (dragFrame) return;
  dragFrame = window.requestAnimationFrame(flushManualDragMove);
}

async function endManualDrag(event) {
  if (dragPointerId !== event.pointerId) return;
  if (dragFrame) {
    window.cancelAnimationFrame(dragFrame);
    dragFrame = 0;
  }
  try { clockBody.releasePointerCapture(event.pointerId); } catch {}
  dragPointerId = null;
  dragLastPoint = null;
  body.classList.remove('is-dragging');
  try {
    await tauriInvoke('end_window_drag');
  } catch (e) {
    console.warn('[manual drag end]', e);
  }
  if (dragUsedManualMove) {
    scheduleHitRegionUpdate();
  }
  dragUsedManualMove = false;
}

async function cancelManualDrag() {
  if (dragPointerId === null) return;
  if (dragFrame) {
    window.cancelAnimationFrame(dragFrame);
    dragFrame = 0;
  }
  dragPointerId = null;
  dragLastPoint = null;
  dragUsedManualMove = false;
  body.classList.remove('is-dragging');
  try {
    await tauriInvoke('end_window_drag');
  } catch (e) {
    console.warn('[manual drag cancel]', e);
  }
}

function handleClockPointerDown(event) {
  if (!canStartClockDrag(event)) return;

  event.preventDefault();
  closeFloatingSurfaces();

  if (isWindows) {
    void beginManualDrag(event);
    return;
  }

  void requestNativeDrag();
}

clockBody.addEventListener('pointerdown', handleClockPointerDown);
clockBody.addEventListener('contextmenu', openContextMenu);
clockBody.addEventListener('pointermove', queueManualDragMove);
clockBody.addEventListener('pointerup', endManualDrag);
clockBody.addEventListener('pointercancel', endManualDrag);
btnCloseSettings.addEventListener('click', closeSettings);
document.getElementById('btn-cancel').addEventListener('click', closeSettings);
document.getElementById('btn-apply').addEventListener('click', applySettings);

document.querySelectorAll('input[name="clock-count"]').forEach(i => {
  i.addEventListener('change', syncSettingsClockCountVisibility);
});
setOpacity.addEventListener('input', () => applyOpacity(setOpacity.value));

async function handleContextMenuAction(action, anchor) {
  if (!action) return;
  if (action === 'toggle-pomodoro') { togglePomodoro(); closeContextMenu(); return; }
  if (action === 'reset-pomodoro') { resetPomodoro(); closeContextMenu(); return; }
  if (action === 'open-settings') { await openSettings(anchor || clockAnchor()); return; }

  const next = normalizeConfig(config);
  let fit = false;
  if (action === 'set-count-single') { next.clockCount = 1; fit = true; }
  if (action === 'set-count-dual') { next.clockCount = 2; fit = true; }
  if (action === 'set-mode-digital') { next.mode = 'digital'; fit = true; }
  if (action === 'set-mode-analog') { next.mode = 'analog'; fit = true; }
  if (action === 'set-mode-both') { next.mode = 'both'; fit = true; }
  if (action === 'set-theme-classic') next.theme = 'classic';
  if (action === 'set-theme-minimal') next.theme = 'minimal';
  if (action === 'set-theme-cute') next.theme = 'cute';
  if (action === 'set-theme-glass') next.theme = 'glass';
  if (action === 'set-surface-transparent') { next.surfaceStyle = 'transparent'; next.surfaceStyleExplicit = true; }
  if (action === 'set-surface-solid') { next.surfaceStyle = 'solid'; next.surfaceStyleExplicit = true; }
  if (action === 'toggle-time-format') next.timeFormat = config.timeFormat === '24' ? '12' : '24';
  if (action === 'toggle-lock') next.locked = !config.locked;
  if (action === 'toggle-ontop') next.on_top = !config.on_top;

  try {
    await commitConfig(next, { fit });
  } catch (error) {
    console.error('[menu] action failed', action, error);
    setPomodoroStatus(`操作失败：${String(error).slice(0, 64)}`);
  } finally {
    closeContextMenu();
  }
}

contextMenu.addEventListener('click', async event => {
  const action = event.target.closest('[data-menu-action]')?.dataset.menuAction;
  await handleContextMenuAction(action, { x: event.clientX, y: event.clientY });
});

document.addEventListener('pointerdown', event => {
  const inside = event.target.closest('#context-menu, #settings-panel, #object-shell');
  if (!inside) closeFloatingSurfaces();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { closeFloatingSurfaces(); return; }
  if (event.key !== 'Tab' || settingsPanel.classList.contains('hidden')) return;
  const focusable = [...settingsPanel.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((element) => !element.disabled && element.getClientRects().length > 0);
  if (!focusable.length) { event.preventDefault(); settingsPanel.focus(); return; }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault(); last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault(); first.focus();
  }
});
window.addEventListener('blur', () => { void cancelManualDrag(); });
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

  const regions = [];

  // Desktop-object behavior: only visible clock parts receive hits. Avoid a
  // stretched rectangular window region because it leaves artifacts on Win11.
  const clockRect = mainEl.getBoundingClientRect();
  collectClockObjectRegions(regions, scale);
  if (!regions.length && clockRect.width > 2 && clockRect.height > 2) {
    pushRegion(regions, clockRect, scale, 8, 14);
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

async function registerTauriListeners() {
  if (!isTauri) return;
  const on = async (eventName, callback) => {
    const unlisten = await listen(eventName, callback);
    if (typeof unlisten === 'function') unlistenCallbacks.push(unlisten);
  };
  await on('tray-set-lock', async (event) => {
    await commitConfig({ ...config, locked: Boolean(event.payload) });
  });
  await on('tray-set-theme', async (event) => {
    await commitConfig({ ...config, theme: event.payload });
  });
  await on('tray-set-ontop', async (event) => {
    await commitConfig({ ...config, on_top: Boolean(event.payload) });
  });
  await on('context-menu-action', async (event) => {
    await handleContextMenuAction(String(event.payload || ''), clockAnchor());
  });
  await on('config-updated', (event) => renderConfig(event.payload));
}

window.addEventListener('pagehide', () => {
  stopClock();
  for (const unlisten of unlistenCallbacks.splice(0)) {
    try { unlisten(); } catch {}
  }
});

window.addEventListener('error', (event) => {
  if (event?.message) setPomodoroStatus(`错误：${String(event.message).slice(0, 72)}`);
});
window.addEventListener('unhandledrejection', (event) => {
  console.error('[unhandled rejection]', event.reason);
  if (event?.reason) setPomodoroStatus(`错误：${String(event.reason).slice(0, 72)}`);
});

// ── init ──────────────────────────────────────────────────────────────────

async function init() {
  try {
    await loadConfig();

    renderConfig(config);
    await syncNativePreferences(config, config, { force: true });
    resetPomodoro();

    await registerTauriListeners();
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
