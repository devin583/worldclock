(() => {
const tauriApi = window.__TAURI__ ?? {};
const tauriInvoke = tauriApi.core?.invoke;
const tauriListen = tauriApi.event?.listen;
const isTauri = typeof tauriInvoke === 'function';
const LOCAL_KEY = 'worldclock-config-preview';

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
const LEGACY_THEME_MAP = {
  'minimal-glass': 'glass',
  'mechanical': 'classic',
  'soft-companion': 'cute',
  'flip': 'classic',
  'boundless': 'minimal',
  'dark': 'classic',
  'light': 'minimal',
};
const SURFACE_STYLE_VALUES = ['transparent', 'solid'];
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
  surfaceStyleExplicit: false,
  timeFormat: '24',
  opacity: 0.88,
  autostart: false,
  pomodoro: { focusMinutes: 25, breakMinutes: 5 },
};

let config = normalizeConfig();

const $ = (id) => document.getElementById(id);
const statusText = $('status-text');

const invoke = isTauri
  ? async (cmd, args) => tauriInvoke(cmd, args)
  : async (cmd, args) => {
      if (cmd === 'load_config') {
        const raw = localStorage.getItem(LOCAL_KEY);
        return raw ? JSON.parse(raw) : null;
      }
      if (cmd === 'save_config') {
        localStorage.setItem(LOCAL_KEY, JSON.stringify(args.data));
        return null;
      }
      return null;
    };

const listen = typeof tauriListen === 'function' ? tauriListen : async () => () => {};

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
  const surfaceStyleExplicit = src.surfaceStyleExplicit === true;
  return {
    ...DEFAULT_CONFIG,
    ...src,
    clocks: [
      normalizeClock(savedClocks[0], DEFAULT_CONFIG.clocks[0]),
      normalizeClock(savedClocks[1], DEFAULT_CONFIG.clocks[1]),
    ],
    clockCount: normalizeClockCount(src.clockCount ?? DEFAULT_CONFIG.clockCount),
    mode: normalizeMode(src.mode),
    theme: normalizeTheme(src.theme),
    surfaceStyle: surfaceStyleExplicit ? normalizeSurfaceStyle(src.surfaceStyle) : DEFAULT_CONFIG.surfaceStyle,
    surfaceStyleExplicit,
    timeFormat: normalizeTimeFormat(src.timeFormat),
    opacity: clampNumber(src.opacity, 0.72, 1, DEFAULT_CONFIG.opacity),
    locked: Boolean(src.locked),
    on_top: src.on_top !== false,
    autostart: Boolean(src.autostart),
    pomodoro: normalizePomodoro(src.pomodoro),
  };
}

function setRadio(name, value) {
  document.querySelectorAll(`input[name="${name}"]`).forEach((input) => {
    input.checked = input.value === String(value);
  });
}

function checkedValue(name, fallback) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value ?? fallback;
}

function resolveTimezone(value, fallback) {
  const q = String(value || '').trim().toLowerCase();
  if (!q) return fallback;
  return TIMEZONES.find((tz) => tz.toLowerCase() === q)
    || TIMEZONES.find((tz) => tz.toLowerCase().includes(q))
    || fallback;
}

function setStatus(text) {
  statusText.textContent = text;
  if (text) window.setTimeout(() => {
    if (statusText.textContent === text) statusText.textContent = '';
  }, 2200);
}

function populateTimezoneOptions() {
  const dl = $('timezone-options');
  dl.innerHTML = '';
  TIMEZONES.forEach((tz) => {
    const option = document.createElement('option');
    option.value = tz;
    dl.appendChild(option);
  });
}

function syncClockCountVisibility() {
  const count = normalizeClockCount(checkedValue('clock-count', config.clockCount));
  document.body.classList.toggle('clock-count-1', count === 1);
}

function applyConfigToForm(next) {
  config = normalizeConfig(next);
  $('set-label-1').value = config.clocks[0].label;
  $('set-tz-1').value = config.clocks[0].tz;
  $('set-label-2').value = config.clocks[1].label;
  $('set-tz-2').value = config.clocks[1].tz;
  $('set-opacity').value = String(config.opacity);
  $('set-locked').checked = config.locked;
  $('set-ontop').checked = config.on_top;
  $('set-autostart').checked = config.autostart;
  $('set-focus-minutes').value = String(config.pomodoro.focusMinutes);
  $('set-break-minutes').value = String(config.pomodoro.breakMinutes);
  setRadio('clock-count', config.clockCount);
  setRadio('mode', config.mode);
  setRadio('theme', config.theme);
  setRadio('surface-style', config.surfaceStyle);
  setRadio('time-format', config.timeFormat);
  syncClockCountVisibility();
}

function readFormConfig() {
  const next = normalizeConfig({
    ...config,
    clockCount: checkedValue('clock-count', config.clockCount),
    mode: checkedValue('mode', config.mode),
    theme: checkedValue('theme', config.theme),
    surfaceStyle: checkedValue('surface-style', config.surfaceStyle),
    surfaceStyleExplicit: true,
    timeFormat: checkedValue('time-format', config.timeFormat),
    opacity: $('set-opacity').value,
    locked: $('set-locked').checked,
    on_top: $('set-ontop').checked,
    autostart: $('set-autostart').checked,
    clocks: [
      {
        label: $('set-label-1').value.trim() || DEFAULT_CONFIG.clocks[0].label,
        tz: resolveTimezone($('set-tz-1').value, config.clocks[0].tz),
      },
      {
        label: $('set-label-2').value.trim() || DEFAULT_CONFIG.clocks[1].label,
        tz: resolveTimezone($('set-tz-2').value, config.clocks[1].tz),
      },
    ],
    pomodoro: {
      focusMinutes: $('set-focus-minutes').value,
      breakMinutes: $('set-break-minutes').value,
    },
  });
  return next;
}

async function loadConfig() {
  try {
    const saved = await invoke('load_config');
    applyConfigToForm(saved);
  } catch (e) {
    console.warn('[settings] load failed', e);
    applyConfigToForm(DEFAULT_CONFIG);
    setStatus('读取设置失败，已使用默认值');
  }
}

async function applySettings() {
  const next = readFormConfig();
  config = next;
  applyConfigToForm(next);

  try {
    await invoke('save_config', { data: next });
    await invoke('set_theme', { theme: next.theme });
    await invoke('set_window_on_top', { enabled: next.on_top });
    await invoke('set_locked', { locked: next.locked });
    await invoke('set_autostart', { enabled: next.autostart });
    setStatus('已应用');
  } catch (e) {
    console.error('[settings] apply failed', e);
    setStatus('应用失败');
  }
}

async function closeSettings() {
  if (isTauri) {
    try {
      await invoke('close_settings_window');
      return;
    } catch (e) {
      console.warn('[settings] close failed', e);
    }
  }
  window.close();
}

function bindEvents() {
  document.querySelectorAll('input[name="clock-count"]').forEach((input) => {
    input.addEventListener('change', syncClockCountVisibility);
  });
  $('btn-apply').addEventListener('click', applySettings);
  $('btn-cancel').addEventListener('click', closeSettings);
  $('btn-close').addEventListener('click', closeSettings);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeSettings();
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') applySettings();
  });
}

async function init() {
  populateTimezoneOptions();
  bindEvents();
  await loadConfig();
  if (isTauri) {
    listen('config-updated', (event) => {
      applyConfigToForm(event.payload);
    });
  }
}

init();
})();
