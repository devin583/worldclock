(() => {
if (window.__worldClockMainBootstrapped) {
  window.__worldClockMainStarted = true;
  window.__worldClockMainLoaded = true;
  return;
}

window.__worldClockMainBootstrapped = true;
window.__worldClockMainStarted = true;
window.__worldClockMainLoaded = false;

const tauriApi = window.__TAURI__ ?? {};
const tauriInvoke = tauriApi.core?.invoke;
const tauriListen = tauriApi.event?.listen;
const isTauri = typeof tauriInvoke === 'function';
const isWindows = /Windows/i.test(navigator.userAgent);

const invoke = isTauri
  ? async (cmd, args) => {
      try {
        return await tauriInvoke(cmd, args);
      } catch (error) {
        console.warn('[invoke failed]', cmd, error);
        return null;
      }
    }
  : async (cmd, args) => { console.log('[invoke noop]', cmd, args); return null; };

const listen = typeof tauriListen === 'function'
  ? tauriListen
  : async () => () => {};

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

const THEME_VALUES = ['minimal-glass', 'mechanical', 'soft-companion', 'flip'];
const THEME_CLASSES = THEME_VALUES.map(theme => `theme-${theme}`);
const LEGACY_THEME_MAP = {
  dark: 'minimal-glass',
  light: 'minimal-glass',
  classic: 'minimal-glass',
  'glass-pet': 'minimal-glass',
  'moon-cat': 'soft-companion',
  'pixel-buddy': 'mechanical',
};
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
  theme: 'minimal-glass',
  timeFormat: '24',
  opacity: 0.9,
  autostart: false,
  pomodoro: {
    focusMinutes: 25,
    breakMinutes: 5,
  },
};

let config = normalizeConfig();
let tickTimerId = null;
let lastRenderedSecond = '';
let hitRegionFrame = 0;

const body = document.body;
const stage = document.getElementById('stage');
const clockBody = document.getElementById('clock-body');
const objectShell = document.getElementById('object-shell');
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
const cards = [document.getElementById('card-1'), document.getElementById('card-2')];
const menuOpacity = document.getElementById('menu-opacity');
const setOpacity = document.getElementById('set-opacity');

const pomodoroState = {
  phase: 'idle',
  running: false,
  durationMs: 0,
  remainingMs: 0,
  endAt: 0,
};

body.classList.toggle('platform-windows', isWindows);

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalizeTheme(theme) {
  const next = LEGACY_THEME_MAP[theme] || theme;
  return THEME_VALUES.includes(next) ? next : DEFAULT_CONFIG.theme;
}

function normalizeMode(mode) {
  return MODE_VALUES.includes(mode) ? mode : DEFAULT_CONFIG.mode;
}

function normalizeTimeFormat(value) {
  return TIME_FORMAT_VALUES.includes(String(value)) ? String(value) : DEFAULT_CONFIG.timeFormat;
}

function normalizeClock(clock, fallback) {
  return {
    label: typeof clock?.label === 'string' && clock.label.trim()
      ? clock.label.trim()
      : fallback.label,
    tz: TIMEZONES.includes(clock?.tz) ? clock.tz : fallback.tz,
  };
}

function normalizeClockCount(value) {
  return Number(value) === 1 ? 1 : 2;
}

function normalizePomodoro(value = {}) {
  return {
    focusMinutes: clampNumber(value.focusMinutes, 1, 120, DEFAULT_CONFIG.pomodoro.focusMinutes),
    breakMinutes: clampNumber(value.breakMinutes, 1, 60, DEFAULT_CONFIG.pomodoro.breakMinutes),
  };
}

function normalizeConfig(saved = {}) {
  const source = saved && typeof saved === 'object' ? saved : {};
  const savedClocks = Array.isArray(source.clocks) ? source.clocks : [];
  const clocks = [
    normalizeClock(savedClocks[0], DEFAULT_CONFIG.clocks[0]),
    normalizeClock(savedClocks[1], DEFAULT_CONFIG.clocks[1]),
  ];

  return {
    ...DEFAULT_CONFIG,
    ...source,
    clocks,
    clockCount: normalizeClockCount(source.clockCount ?? DEFAULT_CONFIG.clockCount),
    mode: normalizeMode(source.mode),
    theme: normalizeTheme(source.theme),
    timeFormat: normalizeTimeFormat(source.timeFormat),
    opacity: clampNumber(source.opacity, 0.55, 1, DEFAULT_CONFIG.opacity),
    locked: Boolean(source.locked),
    on_top: source.on_top !== false,
    autostart: Boolean(source.autostart),
    pomodoro: normalizePomodoro(source.pomodoro),
  };
}

function activeClockCount() {
  return normalizeClockCount(config.clockCount);
}

function populateTimezoneOptions() {
  const datalist = document.getElementById('timezone-options');
  if (!datalist) return;
  datalist.innerHTML = '';
  TIMEZONES.forEach(tz => {
    const opt = document.createElement('option');
    opt.value = tz;
    datalist.appendChild(opt);
  });
}

function resolveTimezone(value, fallback) {
  const query = value.trim().toLowerCase();
  if (!query) return fallback;
  return TIMEZONES.find(tz => tz.toLowerCase() === query)
    || TIMEZONES.find(tz => tz.toLowerCase().includes(query))
    || fallback;
}

function drawTicks(svgGroupId) {
  const g = document.getElementById(svgGroupId);
  if (!g) return;
  g.innerHTML = '';
  for (let i = 0; i < 60; i++) {
    const angle = (i / 60) * 360;
    const isHour = i % 5 === 0;
    const r1 = isHour ? 80 : 88;
    const r2 = 93;
    const rad = (angle - 90) * Math.PI / 180;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', 100 + r1 * Math.cos(rad));
    line.setAttribute('y1', 100 + r1 * Math.sin(rad));
    line.setAttribute('x2', 100 + r2 * Math.cos(rad));
    line.setAttribute('y2', 100 + r2 * Math.sin(rad));
    line.setAttribute('stroke', 'var(--tick-color)');
    line.setAttribute('stroke-width', isHour ? 2 : 1);
    g.appendChild(line);
  }
}

function setHand(id, angleDeg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.transform = `rotate(${angleDeg}deg)`;
  el.setAttribute('transform', `rotate(${angleDeg} 100 100)`);
}

function renderDigitalTime(index, value) {
  const el = document.getElementById(`digital-${index}`);
  if (!el) return;

  if (config.theme !== 'flip') {
    el.textContent = value;
  } else {
    el.innerHTML = [...value].map(char => {
      if (char === ':') return '<span class="flip-sep">:</span>';
      return `<span class="flip-char">${char}</span>`;
    }).join('');
  }

  if (value !== el.dataset.lastValue) {
    el.dataset.lastValue = value;
    el.classList.remove('time-pulse');
    void el.offsetWidth;
    el.classList.add('time-pulse');
  }
}

function offsetText(tz1, tz2) {
  const now = new Date();
  const offset = (d, tz) => {
    try {
      const s = new Intl.DateTimeFormat('en', {
        timeZone: tz, hour: 'numeric', hour12: false, timeZoneName: 'shortOffset'
      }).formatToParts(d);
      const tzPart = s.find(p => p.type === 'timeZoneName')?.value ?? 'UTC+0';
      const m = tzPart.match(/([+-])(\d+)(?::(\d+))?/);
      if (!m) return 0;
      return (parseInt(m[2], 10) + (parseInt(m[3] ?? 0, 10) / 60)) * (m[1] === '+' ? 1 : -1);
    } catch (error) {
      console.warn('offset fallback', tz, error);
      return 0;
    }
  };
  const diff = offset(now, tz2) - offset(now, tz1);
  const sign = diff >= 0 ? '+' : '';
  return `${sign}${diff}h · 对比 ${config.clocks[0].label}`;
}

function clearClock(index) {
  const digital = document.getElementById(`digital-${index}`);
  const date = document.getElementById(`date-${index}`);
  const offset = document.getElementById(`offset-${index}`);
  if (digital) digital.textContent = '';
  if (date) date.textContent = '';
  if (offset) offset.textContent = '';
}

function tickClocks(now) {
  const count = activeClockCount();

  for (let i = 0; i < 2; i++) {
    const idx = i + 1;
    if (i >= count) {
      clearClock(idx);
      continue;
    }

    const cl = config.clocks[i];
    const formatterLocale = config.timeFormat === '12' ? 'en-US' : 'en-GB';
    const timeParts = new Intl.DateTimeFormat(formatterLocale, {
      timeZone: cl.tz,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: config.timeFormat === '12',
    }).formatToParts(now);

    const get = type => timeParts.find(p => p.type === type)?.value ?? '00';
    const hh = get('hour');
    const mm = get('minute');
    const ss = get('second');
    const period = timeParts.find(p => p.type === 'dayPeriod')?.value ?? '';

    renderDigitalTime(idx, `${hh}:${mm}:${ss}`);

    const dateStr = new Intl.DateTimeFormat('en-GB', {
      timeZone: cl.tz,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(now);
    document.getElementById(`date-${idx}`).textContent = period ? `${dateStr} · ${period}` : dateStr;

    const h = parseInt(hh, 10) % 12;
    const m = parseInt(mm, 10);
    const s = parseInt(ss, 10);
    setHand(`hour-${idx}`, (h + m / 60) * 30);
    setHand(`minute-${idx}`, (m + s / 60) * 6);
    setHand(`second-${idx}`, s * 6);
  }

  document.getElementById('offset-1').textContent = '';
  document.getElementById('offset-2').textContent =
    count >= 2 ? offsetText(config.clocks[0].tz, config.clocks[1].tz) : '';
}

function pomodoroDuration(phase) {
  const minutes = phase === 'break'
    ? config.pomodoro.breakMinutes
    : config.pomodoro.focusMinutes;
  return minutes * 60 * 1000;
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function setPomodoroStatus(text) {
  if (!text) {
    pomodoroStatus.classList.add('hidden');
    pomodoroStatus.textContent = '';
    return;
  }
  pomodoroStatus.textContent = text;
  pomodoroStatus.classList.remove('hidden');
}

function startPomodoro(phase = 'focus') {
  const durationMs = pomodoroDuration(phase);
  pomodoroState.phase = phase;
  pomodoroState.running = true;
  pomodoroState.durationMs = durationMs;
  pomodoroState.remainingMs = durationMs;
  pomodoroState.endAt = Date.now() + durationMs;
  body.classList.remove('pomodoro-done');
  updatePomodoro();
}

function pausePomodoro() {
  if (!pomodoroState.running) return;
  pomodoroState.remainingMs = Math.max(0, pomodoroState.endAt - Date.now());
  pomodoroState.running = false;
  pomodoroState.endAt = 0;
  updatePomodoro();
}

function resumePomodoro() {
  if (pomodoroState.phase === 'idle' || pomodoroState.remainingMs <= 0) {
    startPomodoro('focus');
    return;
  }
  pomodoroState.running = true;
  pomodoroState.endAt = Date.now() + pomodoroState.remainingMs;
  updatePomodoro();
}

function resetPomodoro() {
  pomodoroState.phase = 'idle';
  pomodoroState.running = false;
  pomodoroState.durationMs = 0;
  pomodoroState.remainingMs = 0;
  pomodoroState.endAt = 0;
  body.classList.remove('pomodoro-active', 'pomodoro-paused', 'pomodoro-done');
  body.style.setProperty('--progress', '0deg');
  setPomodoroStatus('');
  syncMenuLabels();
}

function togglePomodoro() {
  if (pomodoroState.running) {
    pausePomodoro();
  } else {
    resumePomodoro();
  }
  syncMenuLabels();
}

function completePomodoro() {
  const wasFocus = pomodoroState.phase === 'focus';
  pomodoroState.running = false;
  pomodoroState.remainingMs = 0;
  pomodoroState.endAt = 0;
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
    if (pomodoroState.remainingMs <= 0) {
      completePomodoro();
      return;
    }
  }

  const elapsed = pomodoroState.durationMs - pomodoroState.remainingMs;
  const progress = pomodoroState.durationMs > 0 ? (elapsed / pomodoroState.durationMs) * 360 : 0;
  const phaseText = pomodoroState.phase === 'break' ? '休息' : '专注';
  body.classList.toggle('pomodoro-active', pomodoroState.running);
  body.classList.toggle('pomodoro-paused', !pomodoroState.running);
  body.style.setProperty('--progress', `${Math.max(0, Math.min(360, progress))}deg`);
  setPomodoroStatus(`${phaseText} ${formatDuration(pomodoroState.remainingMs)}${pomodoroState.running ? '' : ' 暂停'}`);
}

function tick() {
  if (document.hidden) return;
  const now = new Date();
  const secondKey = `${now.getHours()}:${now.getMinutes()}:${now.getSeconds()}`;
  tickClocks(now);
  updatePomodoro();
  if (secondKey !== lastRenderedSecond) {
    lastRenderedSecond = secondKey;
    scheduleHitRegionUpdate();
  }
}

function startClock() {
  if (tickTimerId !== null) return;
  tick();
  tickTimerId = window.setInterval(tick, 1000);
}

function stopClock() {
  if (tickTimerId === null) return;
  window.clearInterval(tickTimerId);
  tickTimerId = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopClock();
  else startClock();
});

function applyMode(mode) {
  config.mode = normalizeMode(mode);
  cards.forEach(card => {
    card.className = 'clock-card';
    card.classList.add(`mode-${config.mode}`);
  });
  modeBtns.forEach(button => {
    button.classList.toggle('active', button.dataset.mode === config.mode);
  });
  tick();
  scheduleHitRegionUpdate();
}

function applyTheme(theme) {
  config.theme = normalizeTheme(theme);
  body.classList.remove(...THEME_CLASSES, 'theme-dark', 'theme-light', 'theme-classic', 'theme-glass-pet', 'theme-moon-cat', 'theme-pixel-buddy');
  body.classList.add(`theme-${config.theme}`);
  document.querySelectorAll('input[name="theme"]').forEach(input => {
    input.checked = input.value === config.theme;
  });
  if (isTauri) invoke('set_theme', { theme: config.theme });
  tick();
  scheduleHitRegionUpdate();
}

function applyClockCount(count) {
  config.clockCount = normalizeClockCount(count);
  body.classList.toggle('clock-count-1', config.clockCount === 1);
  body.classList.toggle('clock-count-2', config.clockCount === 2);
  cards[1]?.setAttribute('aria-hidden', config.clockCount === 1 ? 'true' : 'false');
  document.querySelectorAll('input[name="clock-count"]').forEach(input => {
    input.checked = Number(input.value) === config.clockCount;
  });
  syncSettingsClockCountVisibility();
  tick();
  scheduleHitRegionUpdate();
}

function applyOpacity(value) {
  config.opacity = clampNumber(value, 0.55, 1, DEFAULT_CONFIG.opacity);
  body.style.setProperty('--clock-opacity', String(config.opacity));
  menuOpacity.value = String(config.opacity);
  setOpacity.value = String(config.opacity);
  scheduleHitRegionUpdate();
}

function applyTimeFormat(value) {
  config.timeFormat = normalizeTimeFormat(value);
  document.querySelectorAll('input[name="time-format"]').forEach(input => {
    input.checked = input.value === config.timeFormat;
  });
  syncMenuLabels();
  tick();
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
  if (isTauri) invoke('set_locked', { locked: config.locked });
  syncMenuLabels();
}

async function saveConfig() {
  if (!isTauri) return;
  try {
    await invoke('save_config', { data: config });
  } catch (error) {
    console.error('saveConfig', error);
  }
}

async function loadConfig() {
  if (!isTauri) return;
  try {
    const saved = await invoke('load_config');
    config = normalizeConfig(saved);
  } catch (error) {
    console.error('loadConfig', error);
  }
}

function syncSettingsClockCountVisibility() {
  const selected = document.querySelector('input[name="clock-count"]:checked')?.value ?? config.clockCount;
  settingsPanel.classList.toggle('clock-count-1', Number(selected) === 1);
}

function syncMenuLabels() {
  document.getElementById('menu-pomodoro').textContent = pomodoroState.running
    ? '暂停番茄钟'
    : (pomodoroState.phase === 'idle' ? '开始番茄钟' : '继续番茄钟');
  document.getElementById('menu-format').textContent = config.timeFormat === '24' ? '切换 12h' : '切换 24h';
  document.getElementById('menu-lock').textContent = config.locked ? '解锁位置' : '锁定位置';
  document.getElementById('menu-ontop').textContent = config.on_top ? '取消置顶' : '始终置顶';
  btnPomodoro.classList.toggle('active', pomodoroState.running);
}

function isSurfaceOpen() {
  return !contextMenu.classList.contains('hidden') || !settingsPanel.classList.contains('hidden');
}

function setSurfaceOpenClass() {
  body.classList.toggle('surface-open', isSurfaceOpen());
  scheduleHitRegionUpdate();
}

function positionSurface(element, x, y, offset = 10) {
  element.classList.remove('hidden');
  element.style.left = '0px';
  element.style.top = '0px';

  const rect = element.getBoundingClientRect();
  const margin = 8;
  let left = x + offset;
  let top = y + offset;

  if (left + rect.width > window.innerWidth - margin) left = x - rect.width - offset;
  if (top + rect.height > window.innerHeight - margin) top = y - rect.height - offset;

  left = Math.max(margin, Math.min(window.innerWidth - rect.width - margin, left));
  top = Math.max(margin, Math.min(window.innerHeight - rect.height - margin, top));

  element.style.left = `${Math.round(left)}px`;
  element.style.top = `${Math.round(top)}px`;
  setSurfaceOpenClass();
}

function closeContextMenu() {
  contextMenu.classList.add('hidden');
  setSurfaceOpenClass();
}

function closeSettings() {
  settingsPanel.classList.add('hidden');
  setSurfaceOpenClass();
}

function closeFloatingSurfaces() {
  closeContextMenu();
  closeSettings();
}

function anchorFromElement(element) {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.bottom,
  };
}

function openContextMenu(event) {
  event.preventDefault();
  closeSettings();
  syncMenuLabels();
  positionSurface(contextMenu, event.clientX, event.clientY, 2);
}

function openSettings(anchor = anchorFromElement(btnSettings)) {
  closeContextMenu();
  populateTimezoneOptions();

  document.getElementById('set-label-1').value = config.clocks[0].label;
  document.getElementById('set-label-2').value = config.clocks[1].label;
  document.getElementById('set-tz-1').value = config.clocks[0].tz;
  document.getElementById('set-tz-2').value = config.clocks[1].tz;
  document.getElementById('set-focus-minutes').value = String(config.pomodoro.focusMinutes);
  document.getElementById('set-break-minutes').value = String(config.pomodoro.breakMinutes);

  document.querySelectorAll('input[name="clock-count"]').forEach(input => {
    input.checked = Number(input.value) === config.clockCount;
  });
  document.querySelectorAll('input[name="theme"]').forEach(input => {
    input.checked = input.value === config.theme;
  });
  document.querySelectorAll('input[name="time-format"]').forEach(input => {
    input.checked = input.value === config.timeFormat;
  });

  document.getElementById('set-ontop').checked = config.on_top;
  document.getElementById('set-autostart').checked = config.autostart;
  applyOpacity(config.opacity);
  syncSettingsClockCountVisibility();
  positionSurface(settingsPanel, anchor.x, anchor.y, 8);
}

async function applySettings() {
  applyClockCount(document.querySelector('input[name="clock-count"]:checked')?.value ?? config.clockCount);

  config.clocks[0].label = document.getElementById('set-label-1').value.trim() || 'Clock 1';
  config.clocks[0].tz = resolveTimezone(
    document.getElementById('set-tz-1').value,
    config.clocks[0].tz
  );
  config.clocks[1].label = document.getElementById('set-label-2').value.trim() || 'Clock 2';
  config.clocks[1].tz = resolveTimezone(
    document.getElementById('set-tz-2').value,
    config.clocks[1].tz
  );

  applyTheme(document.querySelector('input[name="theme"]:checked')?.value ?? config.theme);
  applyTimeFormat(document.querySelector('input[name="time-format"]:checked')?.value ?? config.timeFormat);
  applyOpacity(document.getElementById('set-opacity').value);
  applyOnTop(document.getElementById('set-ontop').checked);
  config.autostart = document.getElementById('set-autostart').checked;
  config.pomodoro = normalizePomodoro({
    focusMinutes: document.getElementById('set-focus-minutes').value,
    breakMinutes: document.getElementById('set-break-minutes').value,
  });

  document.getElementById('label-1').textContent = config.clocks[0].label;
  document.getElementById('label-2').textContent = config.clocks[1].label;

  if (isTauri) {
    invoke('set_autostart', { enabled: config.autostart });
  }

  tick();
  await saveConfig();
  closeSettings();
}

function isInteractiveTarget(target) {
  return Boolean(target.closest('button, input, label, #context-menu, #settings-panel, #hover-controls, #mode-bar'));
}

function showInteractionSurfaces() {
  body.classList.add('is-hovering');
  scheduleHitRegionUpdate();
}

function hideInteractionSurfacesSoon() {
  window.setTimeout(() => {
    if (isSurfaceOpen()) return;
    body.classList.remove('is-hovering');
    scheduleHitRegionUpdate();
  }, 190);
}

clockBody.addEventListener('pointerdown', event => {
  showInteractionSurfaces();
  if (event.button !== 0 || config.locked || isInteractiveTarget(event.target)) return;
  if (isTauri) invoke('start_dragging');
});

clockBody.addEventListener('contextmenu', openContextMenu);

clockBody.addEventListener('pointerenter', showInteractionSurfaces);
clockBody.addEventListener('pointermove', showInteractionSurfaces);
clockBody.addEventListener('pointerleave', hideInteractionSurfacesSoon);
objectShell.addEventListener('pointerenter', showInteractionSurfaces);
objectShell.addEventListener('pointermove', showInteractionSurfaces);
hoverControls.addEventListener('transitionend', scheduleHitRegionUpdate);
document.getElementById('mode-bar').addEventListener('transitionend', scheduleHitRegionUpdate);

btnSettings.addEventListener('click', () => {
  if (settingsPanel.classList.contains('hidden')) openSettings(anchorFromElement(btnSettings));
  else closeSettings();
});

btnCloseSettings.addEventListener('click', closeSettings);
document.getElementById('btn-cancel').addEventListener('click', closeSettings);
document.getElementById('btn-apply').addEventListener('click', applySettings);

btnLock.addEventListener('click', async () => {
  applyLock(!config.locked);
  await saveConfig();
});

btnOnTop.addEventListener('click', async () => {
  applyOnTop(!config.on_top);
  await saveConfig();
});

btnPomodoro.addEventListener('click', togglePomodoro);

btnHide.addEventListener('click', () => {
  if (isTauri) invoke('hide_window');
});

document.querySelectorAll('input[name="clock-count"]').forEach(input => {
  input.addEventListener('change', syncSettingsClockCountVisibility);
});

modeBtns.forEach(button => button.addEventListener('click', async () => {
  applyMode(button.dataset.mode);
  await saveConfig();
}));

menuOpacity.addEventListener('input', () => applyOpacity(menuOpacity.value));
menuOpacity.addEventListener('change', saveConfig);
setOpacity.addEventListener('input', () => applyOpacity(setOpacity.value));

contextMenu.addEventListener('click', async event => {
  const action = event.target.closest('[data-menu-action]')?.dataset.menuAction;
  if (!action) return;

  if (action === 'toggle-pomodoro') togglePomodoro();
  if (action === 'reset-pomodoro') resetPomodoro();
  if (action === 'toggle-time-format') applyTimeFormat(config.timeFormat === '24' ? '12' : '24');
  if (action === 'toggle-lock') applyLock(!config.locked);
  if (action === 'toggle-ontop') applyOnTop(!config.on_top);
  if (action === 'open-settings') openSettings({ x: event.clientX, y: event.clientY });

  if (action !== 'open-settings') closeContextMenu();
  await saveConfig();
});

document.addEventListener('pointerdown', event => {
  const insideSurface = event.target.closest('#context-menu, #settings-panel, #hover-controls, #mode-bar, #object-shell');
  if (!insideSurface) closeFloatingSurfaces();
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeFloatingSurfaces();
});

window.addEventListener('resize', scheduleHitRegionUpdate);

function isHitRegionVisible(element) {
  if (element.classList.contains('hidden')) return false;
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (style.pointerEvents === 'none') return false;
  if (Number(style.opacity) <= 0.03) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 2 && rect.height > 2;
}

function collectHitRegions() {
  const scale = window.devicePixelRatio || 1;
  return [...document.querySelectorAll('[data-hit-region]')]
    .filter(isHitRegionVisible)
    .map(element => {
      const rect = element.getBoundingClientRect();
      const radius = Number(element.dataset.hitRadius || 12);
      const pad = Number(element.dataset.hitPad || 0);
      const left = Math.max(0, rect.left - pad);
      const top = Math.max(0, rect.top - pad);
      const right = Math.min(window.innerWidth, rect.right + pad);
      const bottom = Math.min(window.innerHeight, rect.bottom + pad);
      return {
        x: Math.round(left * scale),
        y: Math.round(top * scale),
        width: Math.round((right - left) * scale),
        height: Math.round((bottom - top) * scale),
        radius: Math.round((radius + pad) * scale),
      };
    });
}

function updateHitRegions() {
  hitRegionFrame = 0;
  if (!isTauri) return;
  const regions = collectHitRegions();
  invoke('set_hit_test_regions', { regions });
}

function scheduleHitRegionUpdate() {
  if (hitRegionFrame) return;
  hitRegionFrame = window.requestAnimationFrame(updateHitRegions);
}

if (isTauri) {
  listen('tray-set-lock', async e => {
    applyLock(Boolean(e.payload));
    await saveConfig();
  });
  listen('tray-set-theme', async e => {
    applyTheme(e.payload);
    await saveConfig();
  });
  listen('tray-set-ontop', async e => {
    applyOnTop(Boolean(e.payload));
    await saveConfig();
  });
}

async function init() {
  try {
    await loadConfig();

    drawTicks('ticks-1');
    drawTicks('ticks-2');

    document.getElementById('label-1').textContent = config.clocks[0].label;
    document.getElementById('label-2').textContent = config.clocks[1].label;

    applyTheme(config.theme);
    applyClockCount(config.clockCount);
    applyMode(config.mode);
    applyTimeFormat(config.timeFormat);
    applyOpacity(config.opacity);
    applyLock(config.locked);
    applyOnTop(config.on_top);
    resetPomodoro();

    startClock();
    scheduleHitRegionUpdate();
    window.setTimeout(scheduleHitRegionUpdate, 300);
    window.__worldClockMainLoaded = true;
  } catch (error) {
    console.error('init failed', error);
    setPomodoroStatus(`WorldClock Error: ${String(error).slice(0, 70)}`);
  }
}

init();
})();
