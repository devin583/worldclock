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

const invoke = typeof tauriInvoke === 'function'
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

const THEME_VALUES = ['classic', 'glass-pet', 'moon-cat', 'pixel-buddy', 'flip'];
const THEME_CLASSES = THEME_VALUES.map(theme => `theme-${theme}`);
const LEGACY_THEME_MAP = {
  dark: 'classic',
  light: 'glass-pet',
};
const MODE_VALUES = ['digital', 'analog', 'both'];

const DEFAULT_CONFIG = {
  clocks: [
    { label: 'Budapest', tz: 'Europe/Budapest' },
    { label: 'Beijing',  tz: 'Asia/Shanghai' },
  ],
  clockCount: 2,
  mode: 'digital',
  locked: false,
  on_top: true,
  theme: 'classic',
  autostart: false,
};

let config = normalizeConfig();
let tickTimerId = null;

const body           = document.body;
const dragRegion     = document.getElementById('drag-region');
const appTitle       = document.getElementById('app-title');
const lockOverlay    = document.getElementById('lock-overlay');
const btnLock        = document.getElementById('btn-lock');
const btnSettings    = document.getElementById('btn-settings');
const btnHide        = document.getElementById('btn-hide');
const settingsPanel  = document.getElementById('settings-panel');
const modeBtns       = document.querySelectorAll('.mode-btn');
const cards          = [document.getElementById('card-1'), document.getElementById('card-2')];

body.classList.toggle('platform-windows', isWindows);

function normalizeTheme(theme) {
  const next = LEGACY_THEME_MAP[theme] || theme;
  return THEME_VALUES.includes(next) ? next : DEFAULT_CONFIG.theme;
}

function normalizeMode(mode) {
  return MODE_VALUES.includes(mode) ? mode : DEFAULT_CONFIG.mode;
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
    locked: Boolean(source.locked),
    on_top: source.on_top !== false,
    autostart: Boolean(source.autostart),
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
    const x1 = 100 + r1 * Math.cos(rad);
    const y1 = 100 + r1 * Math.sin(rad);
    const x2 = 100 + r2 * Math.cos(rad);
    const y2 = 100 + r2 * Math.sin(rad);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
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
    return;
  }

  el.innerHTML = [...value].map(char => {
    if (char === ':') return '<span class="flip-sep">:</span>';
    return `<span class="flip-char">${char}</span>`;
  }).join('');
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

function tick() {
  if (document.hidden) return;

  const now = new Date();
  const count = activeClockCount();

  for (let i = 0; i < 2; i++) {
    const idx = i + 1;
    if (i >= count) {
      clearClock(idx);
      continue;
    }

    const cl = config.clocks[i];
    const timeParts = new Intl.DateTimeFormat('en-GB', {
      timeZone: cl.tz,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(now);

    const get = type => timeParts.find(p => p.type === type)?.value ?? '00';
    const hh = get('hour');
    const mm = get('minute');
    const ss = get('second');

    renderDigitalTime(idx, `${hh}:${mm}:${ss}`);

    const dateStr = new Intl.DateTimeFormat('en-GB', {
      timeZone: cl.tz,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(now);
    document.getElementById(`date-${idx}`).textContent = dateStr;

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
}

function applyTheme(theme) {
  config.theme = normalizeTheme(theme);
  body.classList.remove(...THEME_CLASSES, 'theme-dark', 'theme-light');
  body.classList.add(`theme-${config.theme}`);
  document.querySelectorAll('input[name="theme"]').forEach(input => {
    input.checked = input.value === config.theme;
  });
  if (isTauri) invoke('set_theme', { theme: config.theme });
  tick();
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
}

function applyOnTop(enabled) {
  config.on_top = enabled;
  if (isTauri) invoke('set_window_on_top', { enabled });
}

function applyLock(locked) {
  config.locked = locked;
  lockOverlay.classList.add('hidden');
  body.classList.toggle('is-locked', locked);
  btnLock.classList.toggle('locked', locked);
  btnLock.setAttribute('aria-label', locked ? '解锁' : '锁定');
  btnLock.title = locked ? '解锁' : '锁定';
  if (isTauri) invoke('set_locked', { locked });
}

async function saveConfig() {
  if (!isTauri) return;
  try {
    await invoke('save_config', { data: config });
  } catch (e) {
    console.error('saveConfig', e);
  }
}

async function loadConfig() {
  if (!isTauri) return;
  try {
    const saved = await invoke('load_config');
    config = normalizeConfig(saved);
  } catch (e) {
    console.error('loadConfig', e);
  }
}

function syncSettingsClockCountVisibility() {
  const selected = document.querySelector('input[name="clock-count"]:checked')?.value ?? config.clockCount;
  settingsPanel.classList.toggle('clock-count-1', Number(selected) === 1);
}

function openSettings() {
  settingsPanel.classList.remove('hidden');
  populateTimezoneOptions();

  document.getElementById('set-label-1').value = config.clocks[0].label;
  document.getElementById('set-label-2').value = config.clocks[1].label;
  document.getElementById('set-tz-1').value = config.clocks[0].tz;
  document.getElementById('set-tz-2').value = config.clocks[1].tz;

  document.querySelectorAll('input[name="clock-count"]').forEach(input => {
    input.checked = Number(input.value) === config.clockCount;
  });
  document.querySelectorAll('input[name="theme"]').forEach(input => {
    input.checked = input.value === config.theme;
  });

  document.getElementById('set-ontop').checked = config.on_top;
  document.getElementById('set-autostart').checked = config.autostart;
  syncSettingsClockCountVisibility();
}

function closeSettings() {
  settingsPanel.classList.add('hidden');
}

async function applySettings() {
  applyClockCount(document.querySelector('input[name="clock-count"]:checked')?.value ?? 2);

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

  applyTheme(document.querySelector('input[name="theme"]:checked')?.value ?? DEFAULT_CONFIG.theme);
  applyOnTop(document.getElementById('set-ontop').checked);
  config.autostart = document.getElementById('set-autostart').checked;

  document.getElementById('label-1').textContent = config.clocks[0].label;
  document.getElementById('label-2').textContent = config.clocks[1].label;

  if (isTauri) {
    invoke('set_autostart', { enabled: config.autostart });
  }

  tick();
  await saveConfig();
  closeSettings();
}

dragRegion.addEventListener('pointerdown', event => {
  if (!isTauri || config.locked || event.button !== 0) return;
  invoke('start_dragging');
});

btnLock.addEventListener('click', async () => {
  applyLock(!config.locked);
  await saveConfig();
});

btnSettings.addEventListener('click', () => {
  if (settingsPanel.classList.contains('hidden')) openSettings();
  else closeSettings();
});

btnHide.addEventListener('click', () => {
  if (isTauri) invoke('hide_window');
});

document.getElementById('btn-apply').addEventListener('click', applySettings);
document.getElementById('btn-cancel').addEventListener('click', closeSettings);

document.querySelectorAll('input[name="clock-count"]').forEach(input => {
  input.addEventListener('change', syncSettingsClockCountVisibility);
});

modeBtns.forEach(button => button.addEventListener('click', () => {
  applyMode(button.dataset.mode);
  tick();
  saveConfig();
}));

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
    applyLock(config.locked);

    if (isTauri) {
      invoke('set_window_on_top', { enabled: config.on_top });
    }

    startClock();
    window.__worldClockMainLoaded = true;
  } catch (error) {
    console.error('init failed', error);
    appTitle.textContent = 'WorldClock Error';
  }
}

init();
})();
