#[cfg(target_os = "windows")]
mod tray;

use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_autostart::MacosLauncher;

/* ── Tauri 命令（前端通过 invoke 调用） ── */

#[tauri::command]
fn hide_window(window: WebviewWindow) {
    let _ = window.hide();
}

#[tauri::command]
fn set_always_on_top(window: WebviewWindow, on_top: bool) {
    let _ = window.set_always_on_top(on_top);
}

#[tauri::command]
fn set_locked(_window: WebviewWindow, locked: bool) {
    let _ = locked;
}

#[tauri::command]
fn set_theme(_app: AppHandle, theme: String) {
    // 主题切换纯前端处理，此处预留给未来系统级处理
    let _ = theme;
}

#[tauri::command]
fn resize_window(window: WebviewWindow, width: u32, height: u32) {
    let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize {
        width,
        height,
    }));
}

#[tauri::command]
async fn save_config(app: AppHandle, data: serde_json::Value) -> Result<(), String> {
    use std::fs;
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("config.json");
    fs::write(path, data.to_string()).map_err(|e| e.to_string())
}

#[tauri::command]
async fn load_config(app: AppHandle) -> Result<Option<serde_json::Value>, String> {
    use std::fs;
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let path = dir.join("config.json");
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let value: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(Some(value))
}

#[tauri::command]
async fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let mgr = app.autolaunch();
    if enabled {
        mgr.enable().map_err(|e| e.to_string())
    } else {
        mgr.disable().map_err(|e| e.to_string())
    }
}

/* ── 应用入口 ── */
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .setup(|_app| {
            #[cfg(target_os = "windows")]
            tray::setup_tray(_app.handle())?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            hide_window,
            set_always_on_top,
            set_locked,
            set_theme,
            resize_window,
            set_autostart,
            save_config,
            load_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running WorldClock");
}
