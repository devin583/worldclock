#[cfg(target_os = "windows")]
mod tray;

use serde::Deserialize;
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Emitter, LogicalPosition, Manager, PhysicalPosition, PhysicalSize, Position, Size,
    WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

const MIN_WINDOW_WIDTH: u32 = 360;
const MIN_WINDOW_HEIGHT: u32 = 220;
const MAX_WINDOW_WIDTH: u32 = 1200;
const MAX_WINDOW_HEIGHT: u32 = 680;
const DEFAULT_WINDOW_WIDTH: u32 = 860;
const DEFAULT_WINDOW_HEIGHT: u32 = 360;
const SETTINGS_WINDOW_WIDTH: f64 = 430.0;
const SETTINGS_WINDOW_HEIGHT: f64 = 640.0;
const MIN_VISIBLE_WIDTH: i32 = 80;
const MIN_VISIBLE_HEIGHT: i32 = 80;
const MAIN_READY_FALLBACK_MS: u64 = 5_000;

#[derive(Clone, Default)]
struct MainWindowReadyState(Arc<AtomicBool>);

#[derive(Default)]
struct ContextMenuAnchorState(Mutex<Option<(f64, f64)>>);

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
    clock_count: u8,
    mode: String,
    theme: String,
    surface_style: String,
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

fn clamp_position(value: i32, min: i32, max: i32) -> i32 {
    if min > max {
        min
    } else {
        value.clamp(min, max)
    }
}

fn context_menu_anchor(window: &WebviewWindow, x: f64, y: f64) -> Option<(f64, f64)> {
    let main_pos = window.outer_position().ok()?;
    let monitor = window.current_monitor().ok().flatten()?;
    let scale = monitor.scale_factor().max(1.0);

    Some((main_pos.x as f64 / scale + x, main_pos.y as f64 / scale + y))
}

fn set_context_settings_anchor(app: &AppHandle, anchor: Option<(f64, f64)>) {
    if let Some(state) = app.try_state::<ContextMenuAnchorState>() {
        if let Ok(mut stored) = state.0.lock() {
            *stored = anchor;
        }
    }
}

fn take_context_settings_anchor(app: &AppHandle) -> Option<(f64, f64)> {
    let state = app.try_state::<ContextMenuAnchorState>()?;
    let anchor = state.0.lock().ok()?.take();
    anchor
}

fn clear_context_settings_anchor(app: &AppHandle) {
    set_context_settings_anchor(app, None);
}

fn settings_window_position(
    window: &WebviewWindow,
    anchor: Option<(f64, f64)>,
) -> Option<(f64, f64)> {
    let main_pos = window.outer_position().ok()?;
    let main_size = window.outer_size().ok()?;
    let monitor = window.current_monitor().ok().flatten()?;
    let scale = monitor.scale_factor().max(1.0);
    let work_area = monitor.work_area();
    let work_pos = work_area.position;
    let work_size = work_area.size;

    let settings_w = (SETTINGS_WINDOW_WIDTH * scale).round() as i32;
    let settings_h = (SETTINGS_WINDOW_HEIGHT * scale).round() as i32;
    let gap = (14.0 * scale).round() as i32;
    let work_left = work_pos.x;
    let work_top = work_pos.y;
    let work_right = work_left.saturating_add(work_size.width as i32);
    let work_bottom = work_top.saturating_add(work_size.height as i32);
    let mut left;
    let mut top;

    if let Some((anchor_x, anchor_y)) = anchor {
        let anchor_x = (anchor_x * scale).round() as i32;
        let anchor_y = (anchor_y * scale).round() as i32;
        left = anchor_x.saturating_add(gap);
        top = anchor_y.saturating_add(gap);

        if left.saturating_add(settings_w) > work_right {
            left = anchor_x.saturating_sub(settings_w).saturating_sub(gap);
        }
        if top.saturating_add(settings_h) > work_bottom {
            top = anchor_y.saturating_sub(settings_h).saturating_sub(gap);
        }
    } else {
        left = main_pos
            .x
            .saturating_add(main_size.width as i32)
            .saturating_add(gap);
        top = main_pos.y;

        if left.saturating_add(settings_w) > work_right {
            left = main_pos.x.saturating_sub(settings_w).saturating_sub(gap);
        }
    }

    left = clamp_position(
        left,
        work_left + gap,
        work_right.saturating_sub(settings_w + gap),
    );
    top = clamp_position(
        top,
        work_top + gap,
        work_bottom.saturating_sub(settings_h + gap),
    );

    Some((left as f64 / scale, top as f64 / scale))
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

fn reveal_main_window(window: &WebviewWindow, focus: bool) {
    let _ = window.show();
    if focus {
        let _ = window.set_focus();
    }
}

fn mark_main_window_ready(app: &AppHandle) {
    if let Some(state) = app.try_state::<MainWindowReadyState>() {
        state.0.store(true, Ordering::SeqCst);
    }
}

fn schedule_main_ready_fallback(app: AppHandle, ready_state: MainWindowReadyState) {
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(MAIN_READY_FALLBACK_MS));
        if ready_state.0.load(Ordering::SeqCst) {
            return;
        }

        log_startup("frontend ready timeout; showing main window fallback");
        let app_for_main = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Some(window) = app_for_main.get_webview_window("main") {
                reveal_main_window(&window, true);
            }
        });
    });
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
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.set_always_on_top(enabled);
    } else {
        let _ = window.set_always_on_top(enabled);
    }

    if let Some(settings) = app.get_webview_window("settings") {
        let _ = settings.set_always_on_top(enabled);
    }

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
fn main_window_ready(app: AppHandle, window: WebviewWindow) {
    mark_main_window_ready(&app);
    reveal_main_window(&window, true);
    log_startup("frontend ready; main window shown");
}

pub(crate) fn open_settings_window(app: &AppHandle) -> Result<(), String> {
    if let Some(settings) = app.get_webview_window("settings") {
        let _ = settings.show();
        let _ = settings.set_focus();
        return Ok(());
    }

    let main = app.get_webview_window("main");
    let mut builder =
        WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("settings.html".into()))
            .title("WorldClock Settings")
            .inner_size(SETTINGS_WINDOW_WIDTH, SETTINGS_WINDOW_HEIGHT)
            .min_inner_size(390.0, 520.0)
            .max_inner_size(520.0, 760.0)
            .decorations(false)
            .shadow(true)
            .resizable(false)
            .skip_taskbar(true)
            .focused(true);

    #[cfg(not(target_os = "macos"))]
    {
        builder = builder.transparent(true);
    }

    let on_top = load_config_value(&app)
        .and_then(|config| config.get("on_top").and_then(|v| v.as_bool()))
        .unwrap_or(true);
    builder = builder.always_on_top(on_top);

    if let Some(main_window) = main.as_ref() {
        let anchor = take_context_settings_anchor(app);
        if let Some((x, y)) = settings_window_position(main_window, anchor) {
            builder = builder.position(x, y);
        } else {
            builder = builder.center();
        }
    } else {
        builder = builder.center();
    }

    builder.build().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn show_settings_window(app: AppHandle) -> Result<(), String> {
    open_settings_window(&app)
}

#[tauri::command]
fn close_settings_window(app: AppHandle, window: WebviewWindow) {
    if window.label() == "settings" {
        let _ = window.close();
    } else if let Some(settings) = app.get_webview_window("settings") {
        let _ = settings.close();
    }
}

#[tauri::command]
fn show_context_menu(
    app: AppHandle,
    window: WebviewWindow,
    state: ContextMenuState,
    x: f64,
    y: f64,
) -> Result<(), String> {
    let anchor_x = if x.is_finite() { x.max(0.0) } else { 0.0 };
    let anchor_y = if y.is_finite() { y.max(0.0) } else { 0.0 };
    set_context_settings_anchor(&app, context_menu_anchor(&window, anchor_x, anchor_y));

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
    let count_single = CheckMenuItem::with_id(
        &app,
        "context_count_single",
        "单时钟",
        true,
        state.clock_count == 1,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let count_dual = CheckMenuItem::with_id(
        &app,
        "context_count_dual",
        "双时钟",
        true,
        state.clock_count != 1,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let count_menu = Submenu::with_items(&app, "时钟数量", true, &[&count_single, &count_dual])
        .map_err(|e| e.to_string())?;

    let mode_digital = CheckMenuItem::with_id(
        &app,
        "context_mode_digital",
        "数字",
        true,
        state.mode == "digital",
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let mode_analog = CheckMenuItem::with_id(
        &app,
        "context_mode_analog",
        "指针",
        true,
        state.mode == "analog",
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let mode_both = CheckMenuItem::with_id(
        &app,
        "context_mode_both",
        "双显",
        true,
        state.mode == "both",
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let mode_menu = Submenu::with_items(
        &app,
        "显示模式",
        true,
        &[&mode_digital, &mode_analog, &mode_both],
    )
    .map_err(|e| e.to_string())?;
    let theme_classic = CheckMenuItem::with_id(
        &app,
        "context_theme_classic",
        "Classic 经典黑",
        true,
        state.theme == "classic",
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let theme_minimal = CheckMenuItem::with_id(
        &app,
        "context_theme_minimal",
        "Minimal 浅色",
        true,
        state.theme == "minimal",
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let theme_cute = CheckMenuItem::with_id(
        &app,
        "context_theme_cute",
        "Cute 暖色",
        true,
        state.theme == "cute",
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let theme_glass = CheckMenuItem::with_id(
        &app,
        "context_theme_glass",
        "Glass 玻璃",
        true,
        state.theme == "glass",
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let theme_menu = Submenu::with_items(
        &app,
        "外观主题",
        true,
        &[&theme_classic, &theme_minimal, &theme_cute, &theme_glass],
    )
    .map_err(|e| e.to_string())?;
    let surface_transparent = CheckMenuItem::with_id(
        &app,
        "context_surface_transparent",
        "透明物件",
        true,
        state.surface_style == "transparent",
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let surface_solid = CheckMenuItem::with_id(
        &app,
        "context_surface_solid",
        "带底板",
        true,
        state.surface_style == "solid",
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let surface_menu = Submenu::with_items(
        &app,
        "背景样式",
        true,
        &[&surface_transparent, &surface_solid],
    )
    .map_err(|e| e.to_string())?;

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
    let sep4 = PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?;
    let quit = MenuItem::with_id(&app, "context_quit", "退出 WorldClock", true, None::<&str>)
        .map_err(|e| e.to_string())?;

    let menu = Menu::with_items(
        &app,
        &[
            &count_menu,
            &mode_menu,
            &theme_menu,
            &surface_menu,
            &sep1,
            &pomodoro,
            &reset_pomodoro,
            &sep2,
            &time_format,
            &lock,
            &ontop,
            &sep3,
            &settings,
            &reset_window,
            &hide,
            &sep4,
            &quit,
        ],
    )
    .map_err(|e| e.to_string())?;

    window
        .popup_menu_at(
            &menu,
            Position::Logical(LogicalPosition {
                x: anchor_x,
                y: anchor_y,
            }),
        )
        .map_err(|e| e.to_string())
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
        let max_diameter = region.width.min(region.height).max(0);
        let corner_diameter = radius.saturating_mul(2).min(max_diameter);
        let next = if corner_diameter > 0 {
            unsafe {
                CreateRoundRectRgn(left, top, right, bottom, corner_diameter, corner_diameter)
            }
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
    write_config_value(&app, &next)?;
    let _ = app.emit("config-updated", next);
    Ok(())
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
    clear_context_settings_anchor(app);
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
            "context_count_single" => emit_context_action(app, "set-count-single"),
            "context_count_dual" => emit_context_action(app, "set-count-dual"),
            "context_mode_digital" => emit_context_action(app, "set-mode-digital"),
            "context_mode_analog" => emit_context_action(app, "set-mode-analog"),
            "context_mode_both" => emit_context_action(app, "set-mode-both"),
            "context_theme_classic" => emit_context_action(app, "set-theme-classic"),
            "context_theme_minimal" => emit_context_action(app, "set-theme-minimal"),
            "context_theme_cute" => emit_context_action(app, "set-theme-cute"),
            "context_theme_glass" => emit_context_action(app, "set-theme-glass"),
            "context_surface_transparent" => emit_context_action(app, "set-surface-transparent"),
            "context_surface_solid" => emit_context_action(app, "set-surface-solid"),
            "context_toggle_time_format" => emit_context_action(app, "toggle-time-format"),
            "context_toggle_lock" => emit_context_action(app, "toggle-lock"),
            "context_toggle_ontop" => emit_context_action(app, "toggle-ontop"),
            "context_open_settings" => {
                let _ = open_settings_window(app);
            }
            "context_reset_window" => {
                clear_context_settings_anchor(app);
                reset_main_window_position(app);
            }
            "context_hide_window" => {
                clear_context_settings_anchor(app);
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            "context_quit" => {
                clear_context_settings_anchor(app);
                app.exit(0);
            }
            _ => {}
        })
        .setup(|_app| {
            log_startup("setup() entered");
            let main_ready = MainWindowReadyState::default();
            _app.manage(main_ready.clone());
            _app.manage(ContextMenuAnchorState::default());

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
                schedule_main_ready_fallback(_app.handle().clone(), main_ready);
                log_startup("main window restored; waiting for frontend ready");
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
            main_window_ready,
            show_settings_window,
            close_settings_window,
            show_context_menu,
            set_hit_test_regions,
            set_autostart,
            save_config,
            load_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running WorldClock");
}
