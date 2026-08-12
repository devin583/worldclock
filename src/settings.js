(() => {
  'use strict';

  const tauriApi = window.__TAURI__ ?? {};
  const tauriInvoke = tauriApi.core?.invoke;
  const tauriListen = tauriApi.event?.listen;
  const isTauri = typeof tauriInvoke === 'function';
  const LOCAL_KEY = 'worldclock-config-preview';
  const Config = window.WCConfig;

  if (!Config) throw new Error('config.js must load before settings.js');

  const {
    DEFAULT_CONFIG,
    TIMEZONES,
    normalizeClockCount,
    normalizeConfig,
    resolveTimezone,
    shouldFitWindow,
  } = Config;

  let config = normalizeConfig();
  let unlistenConfig = null;
  const $ = (id) => document.getElementById(id);
  const statusText = $('status-text');

  const invoke = isTauri
    ? async (command, args) => tauriInvoke(command, args)
    : async (command, args) => {
        if (command === 'load_config') {
          const raw = localStorage.getItem(LOCAL_KEY);
          return raw ? JSON.parse(raw) : null;
        }
        if (command === 'save_config') {
          localStorage.setItem(LOCAL_KEY, JSON.stringify(args.data));
        }
        if (command === 'get_autostart') return false;
        return null;
      };

  function setRadio(name, value) {
    document.querySelectorAll(`input[name="${name}"]`).forEach((input) => {
      input.checked = input.value === String(value);
    });
  }

  function checkedValue(name, fallback) {
    return document.querySelector(`input[name="${name}"]:checked`)?.value ?? fallback;
  }

  function setStatus(text, isError = false) {
    statusText.textContent = text;
    statusText.classList.toggle('is-error', isError);
    if (text && !isError) {
      window.setTimeout(() => {
        if (statusText.textContent === text) statusText.textContent = '';
      }, 2400);
    }
  }

  function populateTimezoneOptions() {
    const dataList = $('timezone-options');
    dataList.replaceChildren(...TIMEZONES.map((timeZone) => {
      const option = document.createElement('option');
      option.value = timeZone;
      return option;
    }));
  }

  function syncClockCountVisibility() {
    const count = normalizeClockCount(checkedValue('clock-count', config.clockCount));
    document.body.classList.toggle('clock-count-1', count === 1);
  }

  function applyConfigToForm(value) {
    config = normalizeConfig(value);
    $('set-label-1').value = config.clocks[0].label;
    $('set-tz-1').value = config.clocks[0].tz;
    $('set-label-2').value = config.clocks[1].label;
    $('set-tz-2').value = config.clocks[1].tz;
    $('set-opacity').value = String(config.opacity);
    $('set-show-seconds').checked = config.showSeconds;
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
    return normalizeConfig({
      ...config,
      clockCount: checkedValue('clock-count', config.clockCount),
      mode: checkedValue('mode', config.mode),
      showSeconds: $('set-show-seconds').checked,
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
          label: $('set-label-1').value,
          tz: resolveTimezone($('set-tz-1').value, config.clocks[0].tz),
        },
        {
          label: $('set-label-2').value,
          tz: resolveTimezone($('set-tz-2').value, config.clocks[1].tz),
        },
      ],
      pomodoro: {
        focusMinutes: $('set-focus-minutes').value,
        breakMinutes: $('set-break-minutes').value,
      },
    });
  }

  async function applyNativeChange(command, nextArgs, previousArgs, rollbackStack, changed) {
    if (!isTauri || !changed) return;
    rollbackStack.push(async () => invoke(command, previousArgs));
    await invoke(command, nextArgs);
  }

  async function persistTransaction(previousValue, nextValue) {
    const previous = normalizeConfig(previousValue);
    const next = normalizeConfig(nextValue);
    const rollbacks = [];
    const shouldFit = shouldFitWindow(previous, next);

    try {
      const originalBounds = isTauri && shouldFit
        ? await invoke('get_main_window_bounds')
        : null;
      await applyNativeChange(
        'set_theme', { theme: next.theme }, { theme: previous.theme }, rollbacks,
        previous.theme !== next.theme,
      );
      await applyNativeChange(
        'set_window_on_top', { enabled: next.on_top }, { enabled: previous.on_top }, rollbacks,
        previous.on_top !== next.on_top,
      );
      await applyNativeChange(
        'set_locked', { locked: next.locked }, { locked: previous.locked }, rollbacks,
        previous.locked !== next.locked,
      );
      await applyNativeChange(
        'set_autostart', { enabled: next.autostart }, { enabled: previous.autostart }, rollbacks,
        previous.autostart !== next.autostart,
      );
      if (isTauri && shouldFit) {
        // Restore the user's exact pre-transaction size and position if either
        // fitting or the later config write fails.
        rollbacks.push(async () => invoke('restore_main_window_bounds', { bounds: originalBounds }));
        await invoke('fit_window_to_layout', {
          clockCount: next.clockCount,
          mode: next.mode,
          showSeconds: next.showSeconds,
        });
      }
      await invoke('save_config', { data: next });
      return next;
    } catch (error) {
      for (const rollback of rollbacks.reverse()) {
        try { await rollback(); } catch (rollbackError) {
          console.error('[settings] rollback failed', rollbackError);
        }
      }
      throw error;
    }
  }

  async function loadConfig() {
    try {
      const saved = await invoke('load_config');
      const next = normalizeConfig(saved);
      if (isTauri) {
        const actualAutostart = await invoke('get_autostart');
        if (typeof actualAutostart === 'boolean') next.autostart = actualAutostart;
      }
      applyConfigToForm(next);
    } catch (error) {
      console.warn('[settings] load failed', error);
      applyConfigToForm(DEFAULT_CONFIG);
      setStatus('读取设置失败，已使用安全默认值', true);
    }
  }

  async function applySettings() {
    const button = $('btn-apply');
    if (button.disabled) return;
    const previous = normalizeConfig(config);
    const next = readFormConfig();
    button.disabled = true;
    setStatus('正在应用…');

    try {
      const committed = await persistTransaction(previous, next);
      applyConfigToForm(committed);
      setStatus('已应用');
    } catch (error) {
      console.error('[settings] apply failed', error);
      applyConfigToForm(previous);
      setStatus(`应用失败：${String(error).slice(0, 72)}`, true);
    } finally {
      button.disabled = false;
    }
  }

  async function closeSettings() {
    if (isTauri) {
      try {
        await invoke('close_settings_window');
        return;
      } catch (error) {
        console.warn('[settings] close failed', error);
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
      if (event.key === 'Escape') void closeSettings();
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void applySettings();
    });
  }

  async function init() {
    populateTimezoneOptions();
    bindEvents();
    await loadConfig();
    if (isTauri && typeof tauriListen === 'function') {
      unlistenConfig = await tauriListen('config-updated', (event) => {
        applyConfigToForm(event.payload);
      });
    }
  }

  window.addEventListener('pagehide', () => {
    if (typeof unlistenConfig === 'function') unlistenConfig();
    unlistenConfig = null;
  });

  void init();
})();
