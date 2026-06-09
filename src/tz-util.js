/* ───────────────────────────────────────────────────────────
   TZ — shared timezone helpers (window.TZ). Load before the clock
   scripts. Everything is computed from the real IANA database via
   Intl, so DST is handled correctly.
   ─────────────────────────────────────────────────────────── */
(function () {
  const WD_KEY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  // time-of-day parts for a zone (or local when tz is empty)
  function parts(tz) {
    const now = new Date();
    if (!tz) {
      return {
        h: now.getHours(), m: now.getMinutes(), s: now.getSeconds(),
        ms: now.getMilliseconds(), day: now.getDay(),
        date: now.getDate(), month: now.getMonth() + 1,
      };
    }
    const f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      weekday: 'short', day: 'numeric', month: 'numeric',
    });
    const p = {};
    for (const x of f.formatToParts(now)) p[x.type] = x.value;
    let h = parseInt(p.hour, 10); if (h === 24) h = 0;
    return {
      h, m: parseInt(p.minute, 10), s: parseInt(p.second, 10),
      ms: now.getMilliseconds(), day: WD_KEY[p.weekday],
      date: parseInt(p.day, 10), month: parseInt(p.month, 10),
    };
  }

  // UTC offset in minutes for a zone right now (local when tz empty)
  function offsetMin(tz) {
    const d = new Date();
    if (!tz) return -d.getTimezoneOffset();
    const u = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
    const t = new Date(d.toLocaleString('en-US', { timeZone: tz }));
    return Math.round((t - u) / 60000);
  }

  // "UTC+8" / "UTC−4:30"
  function offsetLabel(tz) {
    const o = offsetMin(tz);
    const sign = o < 0 ? '\u2212' : '+';
    const a = Math.abs(o);
    const hh = Math.floor(a / 60);
    const mm = a % 60;
    return 'UTC' + sign + hh + (mm ? ':' + String(mm).padStart(2, '0') : '');
  }

  // difference target − home, formatted in the given language
  function diffText(tz, home, lang, homeLabel, short) {
    const d = (offsetMin(tz) - offsetMin(home)) / 60;
    const ahead = d > 0;
    const a = Math.abs(d);
    const num = Number.isInteger(a) ? a : a.toFixed(1);
    if (short) {
      if (d === 0) return (homeLabel || '') + (lang === 'en' ? ' same' : ' 同步');
      return (homeLabel ? homeLabel + ' ' : '') + (ahead ? '+' : '\u2212') + num + 'h';
    }
    if (d === 0) return lang === 'en' ? 'Same as ' + (homeLabel || 'home') : '与' + (homeLabel || '本地') + '同步';
    if (lang === 'en') return (ahead ? '+' : '\u2212') + num + 'h vs ' + (homeLabel || 'home');
    return '比' + (homeLabel || '本地') + (ahead ? '快' : '慢') + num + '小时';
  }

  // true when it's daytime in the zone (06:00–18:00)
  function isDay(tz) {
    const h = parts(tz).h;
    return h >= 6 && h < 18;
  }

  window.TZ = { parts, offsetMin, offsetLabel, diffText, isDay,
    WD_ZH: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
    WD_EN: ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] };
})();
