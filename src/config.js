/* Shared, side-effect-free configuration helpers for the main and settings windows. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WCConfig = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const CONFIG_VERSION = 4;
  const TIMEZONES = Object.freeze([
    'Europe/Budapest', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Rome',
    'Europe/Madrid', 'Europe/Warsaw', 'Europe/Kyiv', 'Europe/Moscow', 'Europe/Istanbul',
    'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul', 'Asia/Singapore', 'Asia/Hong_Kong',
    'Asia/Kolkata', 'Asia/Kathmandu', 'Asia/Dubai', 'Asia/Karachi', 'Asia/Bangkok',
    'Asia/Jakarta', 'Australia/Sydney', 'Pacific/Auckland', 'Pacific/Honolulu',
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'America/Toronto', 'America/Sao_Paulo', 'America/Argentina/Buenos_Aires',
    'America/Mexico_City', 'Africa/Cairo', 'Africa/Lagos', 'Africa/Nairobi',
    'Atlantic/Reykjavik', 'UTC',
  ]);

  const THEME_VALUES = Object.freeze(['classic', 'minimal', 'cute', 'glass']);
  const SURFACE_STYLE_VALUES = Object.freeze(['transparent', 'solid']);
  const MODE_VALUES = Object.freeze(['digital', 'analog', 'both']);
  const TIME_FORMAT_VALUES = Object.freeze(['24', '12']);
  const LEGACY_THEME_MAP = Object.freeze({
    'minimal-glass': 'glass',
    mechanical: 'classic',
    'soft-companion': 'cute',
    flip: 'classic',
    boundless: 'minimal',
    dark: 'classic',
    light: 'minimal',
    'glass-pet': 'glass',
    'moon-cat': 'cute',
    'pixel-buddy': 'classic',
  });

  const DEFAULT_CONFIG = Object.freeze({
    version: CONFIG_VERSION,
    clocks: Object.freeze([
      Object.freeze({ label: 'Budapest', tz: 'Europe/Budapest' }),
      Object.freeze({ label: 'Beijing', tz: 'Asia/Shanghai' }),
    ]),
    clockCount: 2,
    mode: 'digital',
    showSeconds: false,
    locked: false,
    on_top: true,
    theme: 'classic',
    surfaceStyle: 'transparent',
    surfaceStyleExplicit: false,
    timeFormat: '24',
    opacity: 0.88,
    autostart: false,
    pomodoro: Object.freeze({ focusMinutes: 25, breakMinutes: 5 }),
  });

  const validTimeZoneCache = new Map();

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  }

  function cleanLabel(value, fallback) {
    if (typeof value !== 'string') return fallback;
    const label = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40);
    return label || fallback;
  }

  function isValidTimeZone(value) {
    if (typeof value !== 'string' || !value.trim() || value.length > 80) return false;
    const timeZone = value.trim();
    if (validTimeZoneCache.has(timeZone)) return validTimeZoneCache.get(timeZone);
    let valid = false;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone }).format(0);
      valid = true;
    } catch {}
    validTimeZoneCache.set(timeZone, valid);
    return valid;
  }

  function normalizeTheme(value) {
    const next = LEGACY_THEME_MAP[value] || value;
    return THEME_VALUES.includes(next) ? next : DEFAULT_CONFIG.theme;
  }

  function normalizeMode(value) {
    return MODE_VALUES.includes(value) ? value : DEFAULT_CONFIG.mode;
  }

  function normalizeSurfaceStyle(value) {
    return SURFACE_STYLE_VALUES.includes(value) ? value : DEFAULT_CONFIG.surfaceStyle;
  }

  function normalizeTimeFormat(value) {
    const next = String(value);
    return TIME_FORMAT_VALUES.includes(next) ? next : DEFAULT_CONFIG.timeFormat;
  }

  function normalizeClockCount(value) {
    return Number(value) === 1 ? 1 : 2;
  }

  function normalizeClock(value, fallback) {
    const timeZone = typeof value?.tz === 'string' ? value.tz.trim() : '';
    return {
      label: cleanLabel(value?.label, fallback.label),
      tz: isValidTimeZone(timeZone) ? timeZone : fallback.tz,
    };
  }

  function normalizePomodoro(value = {}) {
    return {
      focusMinutes: clampNumber(value?.focusMinutes, 1, 120, DEFAULT_CONFIG.pomodoro.focusMinutes),
      breakMinutes: clampNumber(value?.breakMinutes, 1, 60, DEFAULT_CONFIG.pomodoro.breakMinutes),
    };
  }

  function normalizeConfig(saved = {}) {
    const source = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
    const savedClocks = Array.isArray(source.clocks) ? source.clocks : [];
    const surfaceStyleExplicit = source.surfaceStyleExplicit === true;
    return {
      version: CONFIG_VERSION,
      clocks: [
        normalizeClock(savedClocks[0], DEFAULT_CONFIG.clocks[0]),
        normalizeClock(savedClocks[1], DEFAULT_CONFIG.clocks[1]),
      ],
      clockCount: normalizeClockCount(source.clockCount ?? DEFAULT_CONFIG.clockCount),
      mode: normalizeMode(source.mode),
      showSeconds: source.showSeconds === true,
      locked: source.locked === true,
      on_top: source.on_top !== false,
      theme: normalizeTheme(source.theme),
      surfaceStyle: surfaceStyleExplicit
        ? normalizeSurfaceStyle(source.surfaceStyle)
        : DEFAULT_CONFIG.surfaceStyle,
      surfaceStyleExplicit,
      timeFormat: normalizeTimeFormat(source.timeFormat),
      opacity: clampNumber(source.opacity, 0.72, 1, DEFAULT_CONFIG.opacity),
      autostart: source.autostart === true,
      pomodoro: normalizePomodoro(source.pomodoro),
    };
  }

  function resolveTimezone(value, fallback) {
    const input = String(value || '').trim();
    if (!input) return fallback;
    if (isValidTimeZone(input)) return input;
    const query = input.toLocaleLowerCase('en-US');
    return TIMEZONES.find((tz) => tz.toLocaleLowerCase('en-US').includes(query)) || fallback;
  }

  function preferredWindowSize(value) {
    const config = normalizeConfig(value);
    if (config.clockCount === 1) {
      if (config.mode === 'digital') return config.showSeconds
        ? { width: 580, height: 240 }
        : { width: 400, height: 220 };
      if (config.mode === 'analog') return { width: 420, height: 320 };
      return { width: 560, height: 320 };
    }
    if (config.mode === 'digital') return config.showSeconds
      ? { width: 820, height: 260 }
      : { width: 640, height: 260 };
    if (config.mode === 'analog') return { width: 660, height: 360 };
    return { width: 820, height: 390 };
  }

  function shouldFitWindow(previousValue, nextValue) {
    const previous = normalizeConfig(previousValue);
    const next = normalizeConfig(nextValue);
    return previous.clockCount !== next.clockCount
      || previous.mode !== next.mode
      || previous.showSeconds !== next.showSeconds;
  }

  function cloneConfig(value) {
    return normalizeConfig(value);
  }

  return Object.freeze({
    CONFIG_VERSION,
    DEFAULT_CONFIG,
    LEGACY_THEME_MAP,
    MODE_VALUES,
    SURFACE_STYLE_VALUES,
    THEME_VALUES,
    TIMEZONES,
    TIME_FORMAT_VALUES,
    clampNumber,
    cloneConfig,
    isValidTimeZone,
    normalizeClockCount,
    normalizeConfig,
    normalizeMode,
    normalizePomodoro,
    normalizeSurfaceStyle,
    normalizeTheme,
    normalizeTimeFormat,
    preferredWindowSize,
    resolveTimezone,
    shouldFitWindow,
  });
});
