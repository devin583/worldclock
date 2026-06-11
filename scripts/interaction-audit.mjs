import fs from 'node:fs';

const files = {
  main: fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8'),
  lib: fs.readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8'),
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
