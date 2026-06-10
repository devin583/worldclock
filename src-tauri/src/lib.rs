#[cfg(target_os = "windows")]
mod tray;

use serde::Deserialize;
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Position, Size, WebviewWindow,
    WindowEvent,
};

const MIN_WINDOW_WIDTH: u32 = 360;
const MIN_WINDOW_HEIGHT: u32 = 220;
const MAX_WINDOW_WIDTH: u32 = 1200;
const MAX_WINDOW_HEIGHT: u32 = 680;
const DEFAULT_WINDOW_WIDTH: u32 = 860;
const DEFAULT_WINDOW_HEIGHT: u32 = 360;
const MIN_VISIBLE_WIDTH: i32 = 80;
const MIN_VISIBLE_HEIGHT: i32 = 80;

#[derive(Debug, Deserialize)]
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
struct HitTestRegion {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    radius: i32,
}

#[derive(Debug, Deserialize)]
struct ContextMenuState {
    locked: bool,
    on_top: bool,
    time_format: String,
    pomodoro_running: bool,
    pomodoro_idle: bool,
}

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
    let _ = (window, theme);
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
fn show_context_menu(
    app: AppHandle,
    window: WebviewWindow,
    state: ContextMenuState,
) -> Result<(), String> {
    let pomodoro_label = if state.pomodoro_running {
        "暂停番茄钟"
    } else if state.pomodoro_idle {
        "开始番茄钟"
    } else {
        "继续番茄钟"
    };
    let time_format_label = if state.time_format == "24" {
        "切换 12 小时制"
    } else {
        "切换 24 小时制"
    };

    let pomodoro = MenuItem::with_id(
        &app,
        "context_toggle_pomodoro",
        pomodoro_label,
        true,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let reset_pomodoro = MenuItem::with_id(
        &app,
        "context_reset_pomodoro",
        "重置番茄钟",
        true,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let sep1 = PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?;
    let time_format = MenuItem::with_id(
        &app,
        "context_toggle_time_format",
        time_format_label,
        true,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let lock = CheckMenuItem::with_id(
        &app,
        "context_toggle_lock",
        "锁定位置",
        true,
        state.locked,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let ontop = CheckMenuItem::with_id(
        &app,
        "context_toggle_ontop",
        "始终置顶",
        true,
        state.on_top,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let sep2 = PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?;
    let settings = MenuItem::with_id(
        &app,
        "context_open_settings",
        "打开设置",
        true,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let reset_window = MenuItem::with_id(
        &app,
        "context_reset_window",
        "重置窗口位置",
        true,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let hide = MenuItem::with_id(
        &app,
        "context_hide_window",
        "最小化到托盘",
        true,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let sep3 = PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?;
    let quit = MenuItem::with_id(&app, "context_quit", "退出 WorldClock", true, None::<&str>)
        .map_err(|e| e.to_string())?;

    let menu = Menu::with_items(
        &app,
        &[
            &pomodoro,
            &reset_pomodoro,
            &sep1,
            &time_format,
            &lock,
            &ontop,
            &sep2,
            &settings,
            &reset_window,
            &hide,
            &sep3,
            &quit,
        ],
    )
    .map_err(|e| e.to_string())?;

    window.popup_menu(&menu).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_hit_test_regions(window: WebviewWindow, regions: Vec<HitTestRegion>) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        apply_hit_test_regions(&window, &regions)?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (window, regions);
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn apply_hit_test_regions(window: &WebviewWindow, regions: &[HitTestRegion]) -> Result<(), String> {
    use std::ptr::null_mut;
    use windows_sys::Win32::Graphics::Gdi::{
        CombineRgn, CreateRectRgn, CreateRoundRectRgn, DeleteObject, SetWindowRgn, RGN_OR,
    };

    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    let hwnd = hwnd.0 as windows_sys::Win32::Foundation::HWND;

    if regions.is_empty() {
        let result = unsafe { SetWindowRgn(hwnd, null_mut(), 1) };
        if result == 0 {
            return Err("SetWindowRgn failed while clearing region".to_string());
        }
        return Ok(());
    }

    let combined = unsafe { CreateRectRgn(0, 0, 0, 0) };
    if combined.is_null() {
        return Err("CreateRectRgn failed".to_string());
    }

    for region in regions {
        if region.width <= 0 || region.height <= 0 {
            continue;
        }

        let left = region.x;
        let top = region.y;
        let right = region.x.saturating_add(region.width);
        let bottom = region.y.saturating_add(region.height);
        let radius = region.radius.max(0);
        let next = if radius > 0 {
            unsafe { CreateRoundRectRgn(left, top, right, bottom, radius, radius) }
        } else {
            unsafe { CreateRectRgn(left, top, right, bottom) }
        };

        if next.is_null() {
            continue;
        }

        unsafe {
            CombineRgn(combined, combined, next, RGN_OR);
            DeleteObject(next);
        }
    }

    let result = unsafe { SetWindowRgn(hwnd, combined, 1) };
    if result == 0 {
        unsafe {
            DeleteObject(combined);
        }
        return Err("SetWindowRgn failed".to_string());
    }

    Ok(())
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

fn emit_context_action(app: &AppHandle, action: &str) {
    let _ = app.emit("context-menu-action", action);
}

/* ── 应用入口 ── */
pub fn run() {
    std::panic::set_hook(Box::new(|panic_info| {
        log_startup(&format!("panic: {panic_info}"));
    }));

    log_startup("run() entered");

    tauri::Builder::default()
        .on_menu_event(|app, event| match event.id().as_ref() {
            "context_toggle_pomodoro" => emit_context_action(app, "toggle-pomodoro"),
            "context_reset_pomodoro" => emit_context_action(app, "reset-pomodoro"),
            "context_toggle_time_format" => emit_context_action(app, "toggle-time-format"),
            "context_toggle_lock" => emit_context_action(app, "toggle-lock"),
            "context_toggle_ontop" => emit_context_action(app, "toggle-ontop"),
            "context_open_settings" => emit_context_action(app, "open-settings"),
            "context_reset_window" => reset_main_window_position(app),
            "context_hide_window" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            "context_quit" => app.exit(0),
            _ => {}
        })
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
                apply_premium_window_effect(&window, "classic");

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
            show_context_menu,
            set_hit_test_regions,
            set_autostart,
            save_config,
            load_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running WorldClock");
}
