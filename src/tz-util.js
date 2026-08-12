/* ───────────────────────────────────────────────────────────
   TZ — shared, DST-safe timezone helpers.

   This file intentionally uses a tiny UMD wrapper: browsers keep the
   historical window.TZ API, while Node tests import this exact production
   module with require().
   ─────────────────────────────────────────────────────────── */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TZ = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const WD_KEY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const FORMATTERS = new Map();

  function instantDate(instant) {
    const d = instant === undefined
      ? new Date()
      : instant instanceof Date
        ? new Date(instant.getTime())
        : new Date(instant);
    if (!Number.isFinite(d.getTime())) throw new RangeError('Invalid instant');
    return d;
  }

  function formatterFor(tz) {
    let formatter = FORMATTERS.get(tz);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        calendar: 'gregory',
        numberingSystem: 'latn',
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      FORMATTERS.set(tz, formatter);
    }
    return formatter;
  }

  function zonedParts(tz, d) {
    const values = {};
    for (const item of formatterFor(tz).formatToParts(d)) {
      if (item.type !== 'literal') values[item.type] = item.value;
    }
    // hourCycle=h23 should make midnight 00. The fallback protects older
    // WebViews whose Intl implementation still emits 24.
    let hour = Number(values.hour);
    if (hour === 24) hour = 0;
    return {
      year: Number(values.year),
      month: Number(values.month),
      date: Number(values.day),
      day: WD_KEY[values.weekday],
      h: hour,
      m: Number(values.minute),
      s: Number(values.second),
      ms: d.getUTCMilliseconds(),
    };
  }

  // Time-of-day parts for a zone (or system-local when tz is empty).
  // `instant` accepts Date, epoch milliseconds, or an ISO date string.
  function parts(tz, instant) {
    const d = instantDate(instant);
    if (tz) return zonedParts(tz, d);
    return {
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      date: d.getDate(),
      day: d.getDay(),
      h: d.getHours(),
      m: d.getMinutes(),
      s: d.getSeconds(),
      ms: d.getMilliseconds(),
    };
  }

  // UTC offset in minutes at the supplied instant. Converting numeric wall
  // clock parts to a UTC epoch avoids Date(localeString), whose parsing is
  // locale-dependent and gives incorrect answers at DST transitions.
  function offsetMin(tz, instant) {
    const d = instantDate(instant);
    if (!tz) return -d.getTimezoneOffset();
    const p = zonedParts(tz, d);
    const wallAsUtc = Date.UTC(p.year, p.month - 1, p.date, p.h, p.m, p.s);
    const instantToSecond = Math.floor(d.getTime() / 1000) * 1000;
    return Math.round((wallAsUtc - instantToSecond) / 60000);
  }

  // "UTC+8" / "UTC−4:30"
  function offsetLabel(tz, instant) {
    const offset = offsetMin(tz, instant);
    const sign = offset < 0 ? '\u2212' : '+';
    const absolute = Math.abs(offset);
    const hours = Math.floor(absolute / 60);
    const minutes = absolute % 60;
    return 'UTC' + sign + hours + (minutes ? ':' + String(minutes).padStart(2, '0') : '');
  }

  function hourAmount(minutes) {
    const value = Math.abs(minutes) / 60;
    if (Number.isInteger(value)) return String(value);
    // IANA offsets are minute-granular. Two decimals preserve common :30 and
    // :45 zones rather than rounding a 45-minute offset to a misleading .8.
    return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  }

  // Difference target − home, formatted in the given language.
  function diffText(tz, home, lang, homeLabel, short, instant) {
    const d = instantDate(instant);
    const difference = offsetMin(tz, d) - offsetMin(home, d);
    const ahead = difference > 0;
    const amount = hourAmount(difference);
    if (short) {
      if (difference === 0) return (homeLabel || '') + (lang === 'en' ? ' same' : ' 同步');
      return (homeLabel ? homeLabel + ' ' : '') + (ahead ? '+' : '\u2212') + amount + 'h';
    }
    if (difference === 0) {
      return lang === 'en'
        ? 'Same as ' + (homeLabel || 'home')
        : '与' + (homeLabel || '本地') + '同步';
    }
    if (lang === 'en') return (ahead ? '+' : '\u2212') + amount + 'h vs ' + (homeLabel || 'home');
    return '比' + (homeLabel || '本地') + (ahead ? '快' : '慢') + amount + '小时';
  }

  // True when it is daytime in the zone (06:00–18:00).
  function isDay(tz, instant) {
    const hour = parts(tz, instant).h;
    return hour >= 6 && hour < 18;
  }

  return {
    parts,
    offsetMin,
    offsetLabel,
    diffText,
    isDay,
    WD_ZH: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
    WD_EN: ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'],
  };
});
