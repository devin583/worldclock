import fs from 'node:fs';

const files = {
  main: fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8'),
  lib: fs.readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8'),
  tauri: fs.readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'),
};

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
    ok: /if \(isSolid[\s\S]*pushRegion\(regions, clockRect[\s\S]*else \{[\s\S]*collectClockObjectRegions\(regions, scale\)/.test(files.main),
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
