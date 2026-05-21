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

    if let (Some(width), Some(height)) = (width, height) {
        let _ = window.set_size(Size::Physical(PhysicalSize { width, height }));
    }

    let x = window_state.get("x").and_then(|v| v.as_i64());
    let y = window_state.get("y").and_then(|v| v.as_i64());
    if let (Some(x), Some(y)) = (x, y) {
        let _ = window.set_position(Position::Physical(PhysicalPosition {
            x: x as i32,
            y: y as i32,
        }));
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

    config["window"] = serde_json::json!({
        "width": size.width.clamp(MIN_WINDOW_WIDTH, MAX_WINDOW_WIDTH),
        "height": size.height.clamp(MIN_WINDOW_HEIGHT, MAX_WINDOW_HEIGHT),
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
