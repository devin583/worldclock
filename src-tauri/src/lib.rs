#[cfg(target_os = "windows")]
mod tray;

use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
};
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, Position, Size, WebviewWindow, WindowEvent,
};

const MIN_WINDOW_WIDTH: u32 = 360;
const MIN_WINDOW_HEIGHT: u32 = 180;
const MAX_WINDOW_WIDTH: u32 = 900;
const MAX_WINDOW_HEIGHT: u32 = 560;
const DEFAULT_WINDOW_WIDTH: u32 = 416;
const DEFAULT_WINDOW_HEIGHT: u32 = 200;
const MIN_VISIBLE_WIDTH: i32 = 80;
const MIN_VISIBLE_HEIGHT: i32 = 80;

fn startup_log_path() -> PathBuf {
    std::env::temp_dir().join("worldclock-startup.log")
}

fn log_startup(message: &str) {
    let line = format!("{message}\n");
    let _ = fs::create_dir_all(std::env::temp_dir());
    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(startup_log_path())
    {
        let _ = file.write_all(line.as_bytes());
    }
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("config.json"))
}

fn load_config_value(app: &AppHandle) -> Option<serde_json::Value> {
    let path = config_path(app).ok()?;
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

fn write_config_value(app: &AppHandle, value: &serde_json::Value) -> Result<(), String> {
    let path = config_path(app)?;
    fs::write(path, value.to_string()).map_err(|e| e.to_string())
}

fn centered_position(app: &AppHandle, width: u32, height: u32) -> Option<PhysicalPosition<i32>> {
    let monitor = app.primary_monitor().ok().flatten()?;
    let work_area = monitor.work_area();
    let work_pos = work_area.position;
    let work_size = work_area.size;
    let x = work_pos.x + ((work_size.width.saturating_sub(width)) / 2) as i32;
    let y = work_pos.y + ((work_size.height.saturating_sub(height)) / 2) as i32;

    Some(PhysicalPosition { x, y })
}

fn is_position_visible(app: &AppHandle, x: i32, y: i32, width: u32, height: u32) -> bool {
    let Ok(monitors) = app.available_monitors() else {
        return true;
    };
    if monitors.is_empty() {
        return true;
    }

    let right = x.saturating_add(width as i32);
    let bottom = y.saturating_add(height as i32);

    monitors.iter().any(|monitor| {
        let work_area = monitor.work_area();
        let area_x = work_area.position.x;
        let area_y = work_area.position.y;
        let area_right = area_x.saturating_add(work_area.size.width as i32);
        let area_bottom = area_y.saturating_add(work_area.size.height as i32);

        let visible_width = right.min(area_right) - x.max(area_x);
        let visible_height = bottom.min(area_bottom) - y.max(area_y);

        visible_width >= MIN_VISIBLE_WIDTH && visible_height >= MIN_VISIBLE_HEIGHT
    })
}

fn safe_window_position(
    app: &AppHandle,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> PhysicalPosition<i32> {
    if is_position_visible(app, x, y, width, height) {
        return PhysicalPosition { x, y };
    }

    log_startup("saved window position is off-screen; resetting to primary monitor center");
    centered_position(app, width, height).unwrap_or(PhysicalPosition { x: 80, y: 80 })
}

pub(crate) fn reset_main_window_position(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    let size = window.inner_size().unwrap_or(PhysicalSize {
        width: DEFAULT_WINDOW_WIDTH,
        height: DEFAULT_WINDOW_HEIGHT,
    });
    let width = size.width.clamp(MIN_WINDOW_WIDTH, MAX_WINDOW_WIDTH);
    let height = size.height.clamp(MIN_WINDOW_HEIGHT, MAX_WINDOW_HEIGHT);

    let _ = window.set_size(Size::Physical(PhysicalSize { width, height }));
    if let Some(position) = centered_position(app, width, height) {
        let _ = window.set_position(Position::Physical(position));
    }
    let _ = window.show();
    let _ = window.set_focus();
    save_window_state(app, &window);
}

fn restore_window_state(app: &AppHandle, window: &WebviewWindow) {
    let Some(config) = load_config_value(app) else {
        return;
    };
    let Some(window_state) = config.get("window") else {
        return;
    };

    let width = window_state
        .get("width")
        .and_then(|v| v.as_u64())
        .map(|v| (v as u32).clamp(MIN_WINDOW_WIDTH, MAX_WINDOW_WIDTH));
    let height = window_state
        .get("height")
        .and_then(|v| v.as_u64())
        .map(|v| (v as u32).clamp(MIN_WINDOW_HEIGHT, MAX_WINDOW_HEIGHT));

    let width = width.unwrap_or(DEFAULT_WINDOW_WIDTH);
    let height = height.unwrap_or(DEFAULT_WINDOW_HEIGHT);

    if width >= MIN_WINDOW_WIDTH && height >= MIN_WINDOW_HEIGHT {
        let _ = window.set_size(Size::Physical(PhysicalSize { width, height }));
    }

    let x = window_state.get("x").and_then(|v| v.as_i64());
    let y = window_state.get("y").and_then(|v| v.as_i64());
    if let (Some(x), Some(y)) = (x, y) {
        let position = safe_window_position(app, x as i32, y as i32, width, height);
        let _ = window.set_position(Position::Physical(position));
    } else if let Some(position) = centered_position(app, width, height) {
        let _ = window.set_position(Position::Physical(position));
    }
}

fn save_window_state(app: &AppHandle, window: &WebviewWindow) {
    let Ok(size) = window.inner_size() else {
        return;
    };
    let Ok(position) = window.outer_position() else {
        return;
    };

    let mut config = load_config_value(app)
        .filter(|value| value.is_object())
        .unwrap_or_else(|| serde_json::json!({}));

    let width = size.width.clamp(MIN_WINDOW_WIDTH, MAX_WINDOW_WIDTH);
    let height = size.height.clamp(MIN_WINDOW_HEIGHT, MAX_WINDOW_HEIGHT);
    let position = safe_window_position(app, position.x, position.y, width, height);

    config["window"] = serde_json::json!({
        "width": width,
        "height": height,
        "x": position.x,
        "y": position.y
    });

    if let Err(err) = write_config_value(app, &config) {
        log_startup(&format!("save window state failed: {err}"));
    }
}

#[cfg(target_os = "windows")]
fn apply_premium_window_effect(window: &WebviewWindow, theme: &str) {
    use tauri::window::{Effect, EffectsBuilder};

    let effect = if theme == "light" {
        Effect::MicaLight
    } else {
        Effect::MicaDark
    };

    if let Err(err) = window.set_effects(EffectsBuilder::new().effect(effect).build()) {
        log_startup(&format!("window effects failed: {err}"));
    }
}

/* ── Tauri 命令（前端通过 invoke 调用） ── */

#[tauri::command]
fn hide_window(window: WebviewWindow) {
    let _ = window.hide();
}

#[tauri::command]
fn reset_window_position(app: AppHandle) {
    reset_main_window_position(&app);
}

#[tauri::command]
fn set_window_on_top(app: AppHandle, window: WebviewWindow, enabled: bool) {
    let _ = window.set_always_on_top(enabled);

    #[cfg(target_os = "windows")]
    tray::set_ontop_checked(&app, enabled);

    #[cfg(not(target_os = "windows"))]
    let _ = app;
}

#[tauri::command]
fn set_locked(app: AppHandle, locked: bool) {
    #[cfg(target_os = "windows")]
    tray::set_lock_checked(&app, locked);

    #[cfg(not(target_os = "windows"))]
    let _ = (app, locked);
}

#[tauri::command]
fn set_theme(app: AppHandle, theme: String) {
    #[cfg(target_os = "windows")]
    {
        tray::set_theme_checked(&app, &theme);
        if let Some(window) = app.get_webview_window("main") {
            apply_premium_window_effect(&window, &theme);
        }
    }

    #[cfg(not(target_os = "windows"))]
    let _ = (app, theme);
}

#[tauri::command]
fn start_dragging(window: WebviewWindow) {
    let _ = window.start_dragging();
}

#[tauri::command]
async fn save_config(app: AppHandle, data: serde_json::Value) -> Result<(), String> {
    let existing_window = load_config_value(&app).and_then(|value| value.get("window").cloned());
    let mut next = data;
    if let Some(window_state) = existing_window {
        next["window"] = window_state;
    }
    write_config_value(&app, &next)
}

#[tauri::command]
async fn load_config(app: AppHandle) -> Result<Option<serde_json::Value>, String> {
    let path = config_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let value: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(Some(value))
}

#[tauri::command]
async fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    let _ = app;
    set_autostart_enabled(enabled)?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn set_autostart_enabled(enabled: bool) -> Result<(), String> {
    let run_key = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
    let status = if enabled {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let exe = exe
            .to_str()
            .ok_or_else(|| "executable path is not valid UTF-8".to_string())?;
        std::process::Command::new("reg")
            .args(["add", run_key, "/v", "WorldClock", "/t", "REG_SZ", "/d"])
            .arg(exe)
            .args(["/f"])
            .status()
            .map_err(|e| e.to_string())?
    } else {
        std::process::Command::new("reg")
            .args(["delete", run_key, "/v", "WorldClock", "/f"])
            .status()
            .map_err(|e| e.to_string())?
    };

    if enabled && !status.success() {
        return Err(format!("reg command failed with status {status}"));
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn set_autostart_enabled(_enabled: bool) -> Result<(), String> {
    Ok(())
}

/* ── 应用入口 ── */
pub fn run() {
    std::panic::set_hook(Box::new(|panic_info| {
        log_startup(&format!("panic: {panic_info}"));
    }));

    log_startup("run() entered");

    tauri::Builder::default()
        .setup(|_app| {
            log_startup("setup() entered");

            #[cfg(target_os = "windows")]
            if let Err(err) = tray::setup_tray(_app.handle()) {
                log_startup(&format!("tray setup failed: {err}"));
            } else {
                log_startup("tray setup finished");
            }

            if let Some(window) = _app.get_webview_window("main") {
                #[cfg(target_os = "windows")]
                apply_premium_window_effect(&window, "dark");

                let app_handle = _app.handle().clone();
                let state_window = window.clone();
                window.on_window_event(move |event| match event {
                    WindowEvent::Focused(false)
                    | WindowEvent::CloseRequested { .. }
                    | WindowEvent::Destroyed => save_window_state(&app_handle, &state_window),
                    _ => {}
                });

                restore_window_state(_app.handle(), &window);
                let _ = window.show();
                let _ = window.set_focus();
                log_startup("main window show/focus requested");
            } else {
                log_startup("main window not found in setup");
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            hide_window,
            reset_window_position,
            set_window_on_top,
            set_locked,
            set_theme,
            start_dragging,
            set_autostart,
            save_config,
            load_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running WorldClock");
}
