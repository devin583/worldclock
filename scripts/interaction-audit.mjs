import fs from 'node:fs';

const files = {
  index: fs.readFileSync(new URL('../src/index.html', import.meta.url), 'utf8'),
  main: fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8'),
  settings: fs.readFileSync(new URL('../src/settings.js', import.meta.url), 'utf8'),
  style: fs.readFileSync(new URL('../src/style.css', import.meta.url), 'utf8'),
  lib: fs.readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8'),
  tauri: fs.readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'),
};

const hasRust = (pattern) => pattern.test(files.lib);

const checks = [
  {
    name: 'right click is bound on the clock body',
    ok: files.main.includes("clockBody.addEventListener('contextmenu', openContextMenu)"),
  },
  {
    name: 'frontend passes click coordinates to native context menu',
    ok: files.main.includes("tauriInvoke('show_context_menu', { state: getContextMenuState(), x, y })"),
  },
  {
    name: 'Windows native menu failure does not fall back to clipped HTML menu',
    ok: /catch \(e\)[\s\S]*if \(isWindows\)[\s\S]*return true;/.test(files.main),
  },
  {
    name: 'Rust context command accepts logical click coordinates',
    ok: /fn show_context_menu\([\s\S]*x: f64,[\s\S]*y: f64,/.test(files.lib),
  },
  {
    name: 'native context menu is anchored with popup_menu_at',
    ok: files.lib.includes('.popup_menu_at('),
  },
  {
    name: 'unanchored native popup_menu is not used for the body context menu',
    ok: !files.lib.includes('window.popup_menu(&menu)'),
  },
  {
    name: 'frontend sends Windows hit-test regions to native code',
    ok: files.main.includes("invoke('set_hit_test_regions', { regions: collectHitRegions() })"),
  },
  {
    name: 'Windows native code applies real window regions',
    ok: files.lib.includes('SetWindowRgn') && files.lib.includes('CreateRoundRectRgn'),
  },
  {
    name: 'transparent mode uses visible clock objects instead of one rectangular webview',
    ok: files.main.includes('collectClockObjectRegions(regions, scale);')
      && !files.main.includes('const isSolid')
      && !/pushRegion\(regions,\s*clockRect,\s*scale,\s*28,\s*28\)/.test(files.main),
  },
  {
    name: 'main clock surface does not render a stretched rectangular backing plate',
    ok: !files.style.includes('body.surface-solid #main::before')
      && !/#main::before[\s\S]*background:/.test(files.style),
  },
  {
    name: 'main window native rectangular shadow is disabled for object-style transparency',
    ok: files.tauri.includes('"transparent": true')
      && files.tauri.includes('"shadow": false'),
  },
  {
    name: 'Windows transparent compositing avoids backdrop-filter ghosting on clock objects',
    ok: files.style.includes('body.platform-windows .fc-meta')
      && files.style.includes('backdrop-filter: none !important'),
  },
  {
    name: 'main hover control strip is removed in favor of native right click and tray menus',
    ok: !files.index.includes('id="hover-controls"')
      && !files.main.includes('hoverControls')
      && !files.main.includes('is-hovering')
      && !files.style.includes('#hover-controls'),
  },
  {
    name: 'main window starts hidden until frontend hit regions are ready',
    ok: files.tauri.includes('"visible": false'),
  },
  {
    name: 'frontend applies hit regions before showing the main window',
    ok: /await applyHitRegionsNow\(\);[\s\S]*await notifyMainWindowReady\(\);/.test(files.main),
  },
  {
    name: 'Rust exposes a frontend-ready command to reveal the main window',
    ok: files.lib.includes('fn main_window_ready') && files.lib.includes('main_window_ready,'),
  },
  {
    name: 'startup has a fallback reveal if frontend readiness fails',
    ok: files.lib.includes('frontend ready timeout; showing main window fallback'),
  },
  {
    name: 'native context menu stores the right-click point for settings placement',
    ok: hasRust(/set_context_settings_anchor\(\s*&app,\s*context_menu_anchor\(&window,\s*anchor_x,\s*anchor_y\)\s*\)/),
  },
  {
    name: 'settings opened from native context menu uses the stored click anchor',
    ok: files.lib.includes('let anchor = take_context_settings_anchor(app);')
      && files.lib.includes('settings_window_position(main_window, anchor)'),
  },
  {
    name: 'context menu opens settings natively instead of bouncing through the webview',
    ok: hasRust(/"context_open_settings"\s*=>\s*\{\s*let _ = open_settings_window\(app\);\s*\}/),
  },
  {
    name: 'main script is cache-busted so webview upgrades do not run stale interaction code',
    ok: /<script\s+src="main\.js\?v=[^"]+"><\/script>/.test(files.index),
  },
  {
    name: 'display mode is controlled by settings and native context menu, not a bottom webview bar',
    ok: !files.index.includes('id="mode-bar"')
      && !files.main.includes('modeBar')
      && !files.style.includes('#mode-bar')
      && files.index.includes('name="mode" value="digital"')
      && files.index.includes('name="mode" value="analog"')
      && files.index.includes('name="mode" value="both"')
      && files.lib.includes('"context_mode_digital"')
      && files.lib.includes('"context_mode_analog"')
      && files.lib.includes('"context_mode_both"'),
  },
  {
    name: 'main clock dragging is explicit and not delegated to stale data-tauri-drag-region',
    ok: !/id="object-shell"[^>]*data-tauri-drag-region/.test(files.index)
      && files.main.includes("clockBody.addEventListener('pointerdown', handleClockPointerDown)")
      && files.main.includes('function canStartClockDrag')
      && files.main.includes('!config.locked'),
  },
  {
    name: 'Windows drag fallback moves the native window when start_dragging is unreliable',
    ok: files.main.includes("tauriInvoke('begin_window_drag'")
      && files.main.includes("tauriInvoke('move_window_drag'")
      && files.main.includes("tauriInvoke('end_window_drag'")
      && files.lib.includes('fn begin_window_drag')
      && files.lib.includes('fn move_window_drag')
      && files.lib.includes('fn end_window_drag')
      && files.lib.includes('DragMoveState::default()'),
  },
  {
    name: 'legacy solid backing configs migrate back to transparent object mode',
    ok: files.main.includes('surfaceStyleExplicit')
      && files.settings.includes('surfaceStyleExplicit')
      && /surfaceStyle:\s*surfaceStyleExplicit\s*\?\s*normalizeSurfaceStyle/.test(files.main),
  },
];

const failures = [];
for (const check of checks) {
  const line = `${check.ok ? 'PASS' : 'FAIL'} ${check.name}`;
  console.log(line);
  if (!check.ok) failures.push(line);
}

if (failures.length) {
  console.error(`\n${failures.length} interaction checks failed.`);
  process.exit(1);
}
