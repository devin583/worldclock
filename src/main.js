(() => {
if (window.__worldClockMainBootstrapped) {
  window.__worldClockMainStarted = true;
  window.__worldClockMainLoaded = true;
  return;
}

window.__worldClockMainBootstrapped = true;
window.__worldClockMainStarted = true;
window.__worldClockMainLoaded = false;

/* ── Tauri API shim：浏览器预览时降级为 no-op ── */

const tauriApi = window.__TAURI__ ?? {};
const tauriInvoke = tauriApi.core?.invoke;
const tauriListen = tauriApi.event?.listen;
const isTauri = typeof tauriInvoke === 'function';

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

/* ── 时区列表 ── */
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

/* ── 默认配置 ── */
const DEFAULT_CONFIG = {
  clocks: [
    { label: 'Budapest', tz: 'Europe/Budapest' },
    { label: 'Beijing',  tz: 'Asia/Shanghai'   },
  ],
  mode:      'digital',
  locked:    false,
  on_top:    true,
  theme:     'dark',
  autostart: false,
};

let config = { ...DEFAULT_CONFIG };

/* ── DOM refs ── */
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

/* ── 填充时区下拉 ── */
function populateTzSelect(sel, current) {
  sel.innerHTML = '';
  TIMEZONES.forEach(tz => {
    const opt = document.createElement('option');
    opt.value = tz;
    opt.textContent = tz;
    if (tz === current) opt.selected = true;
    sel.appendChild(opt);
  });
}

/* ── 绘制刻度 ── */
function drawTicks(svgGroupId, accentVar) {
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
    line.setAttribute('x1', x1); line.setAttribute('y1', y1);
    line.setAttribute('x2', x2); line.setAttribute('y2', y2);
    line.setAttribute('stroke', 'var(--tick-color)');
    line.setAttribute('stroke-width', isHour ? 2 : 1);
    g.appendChild(line);
  }
}

/* ── 更新指针 ── */
function setHand(id, angleDeg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.transform = `rotate(${angleDeg}deg)`;
  el.setAttribute('transform', `rotate(${angleDeg} 100 100)`);
}

/* ── 时差文字 ── */
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
      return (parseInt(m[2]) + (parseInt(m[3] ?? 0) / 60)) * (m[1] === '+' ? 1 : -1);
    } catch (error) {
      console.warn('offset fallback', tz, error);
      return 0;
    }
  };
  const diff = offset(now, tz2) - offset(now, tz1);
  const sign = diff >= 0 ? '+' : '';
  return `${sign}${diff}h · 对比 ${config.clocks[0].label}`;
}

/* ── 主时钟更新循环 ── */
function tick() {
  const now = new Date();

  config.clocks.forEach((cl, i) => {
    const idx = i + 1;

    /* 格式化时间 */
    const timeParts = new Intl.DateTimeFormat('en-GB', {
      timeZone: cl.tz,
      hour:   '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).formatToParts(now);

    const get = type => timeParts.find(p => p.type === type)?.value ?? '00';
    const hh = get('hour'), mm = get('minute'), ss = get('second');

    document.getElementById(`digital-${idx}`).textContent = `${hh}:${mm}:${ss}`;

    /* 日期 */
    const dateStr = new Intl.DateTimeFormat('en-GB', {
      timeZone: cl.tz, weekday: 'short', day: 'numeric', month: 'short',
    }).format(now);
    document.getElementById(`date-${idx}`).textContent = dateStr;

    /* 指针角度 */
    const h = parseInt(hh) % 12;
    const m = parseInt(mm);
    const s = parseInt(ss);
    setHand(`hour-${idx}`,   (h + m / 60) * 30);
    setHand(`minute-${idx}`, (m + s / 60) * 6);
    setHand(`second-${idx}`, s * 6);
  });

  /* 时差（clock 2 相对 clock 1） */
  if (config.clocks.length >= 2) {
    document.getElementById('offset-2').textContent =
      offsetText(config.clocks[0].tz, config.clocks[1].tz);
    document.getElementById('offset-1').textContent = '';
  }
}

/* ── 应用显示模式 ── */
function applyMode(mode) {
  config.mode = mode;
  cards.forEach(c => {
    c.className = 'clock-card';
    c.classList.add(`mode-${mode}`);
  });
  modeBtns.forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
}

/* ── 应用主题 ── */
function applyTheme(theme) {
  config.theme = theme;
  body.classList.remove('theme-dark', 'theme-light');
  body.classList.add(`theme-${theme}`);
  if (isTauri) invoke('set_theme', { theme });
}

/* ── 锁定 ── */
function applyLock(locked) {
  config.locked = locked;
  lockOverlay.classList.add('hidden');
  body.classList.toggle('is-locked', locked);
  btnLock.textContent = locked ? '🔒' : '🔓';
  btnLock.title = locked ? '解锁' : '锁定';
  if (isTauri) invoke('set_locked', { locked });
}

/* ── 持久化存储（Rust ファイル I/O） ── */
async function saveConfig() {
  if (!isTauri) return;
  try {
    await invoke('save_config', { data: config });
  } catch (e) { console.error('saveConfig', e); }
}

async function loadConfig() {
  if (!isTauri) return;
  try {
    const saved = await invoke('load_config');
    if (saved) config = { ...DEFAULT_CONFIG, ...saved };
  } catch (e) { console.error('loadConfig', e); }
}

/* ── 设置面板 ── */
function openSettings() {
  settingsPanel.classList.remove('hidden');

  const tz1 = document.getElementById('set-tz-1');
  const tz2 = document.getElementById('set-tz-2');
  populateTzSelect(tz1, config.clocks[0].tz);
  populateTzSelect(tz2, config.clocks[1].tz);

  document.getElementById('set-label-1').value = config.clocks[0].label;
  document.getElementById('set-label-2').value = config.clocks[1].label;

  document.querySelectorAll('input[name="theme"]').forEach(r => {
    r.checked = r.value === config.theme;
  });
  document.getElementById('set-ontop').checked    = config.on_top;
  document.getElementById('set-autostart').checked = config.autostart;
}

function closeSettings() {
  settingsPanel.classList.add('hidden');
}

async function applySettings() {
  config.clocks[0].label = document.getElementById('set-label-1').value.trim() || 'Clock 1';
  config.clocks[0].tz    = document.getElementById('set-tz-1').value;
  config.clocks[1].label = document.getElementById('set-label-2').value.trim() || 'Clock 2';
  config.clocks[1].tz    = document.getElementById('set-tz-2').value;

  const themeVal = document.querySelector('input[name="theme"]:checked')?.value ?? 'dark';
  applyTheme(themeVal);

  config.on_top    = document.getElementById('set-ontop').checked;
  config.autostart = document.getElementById('set-autostart').checked;

  document.getElementById('label-1').textContent = config.clocks[0].label;
  document.getElementById('label-2').textContent = config.clocks[1].label;

  if (isTauri) {
    invoke('set_always_on_top', { on_top: config.on_top });
    invoke('set_autostart', { enabled: config.autostart });
  }

  await saveConfig();
  closeSettings();
}

/* ── 事件绑定 ── */
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

modeBtns.forEach(b => b.addEventListener('click', () => {
  applyMode(b.dataset.mode);
  saveConfig();
}));

/* ── Tauri 事件监听（来自托盘） ── */
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
    config.on_top = Boolean(e.payload);
    invoke('set_always_on_top', { on_top: config.on_top });
    await saveConfig();
  });
}

/* ── 初始化 ── */
async function init() {
  try {
    await loadConfig();

    drawTicks('ticks-1');
    drawTicks('ticks-2');

    document.getElementById('label-1').textContent = config.clocks[0].label;
    document.getElementById('label-2').textContent = config.clocks[1].label;

    applyTheme(config.theme);
    applyMode(config.mode);
    applyLock(config.locked);

    if (isTauri) {
      invoke('set_always_on_top', { on_top: config.on_top });
    }

    tick();
    setInterval(tick, 1000);
    window.__worldClockMainLoaded = true;
  } catch (error) {
    console.error('init failed', error);
    appTitle.textContent = 'WorldClock Error';
  }
}

init();
})();
