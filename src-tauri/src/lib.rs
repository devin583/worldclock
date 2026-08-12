#[cfg(target_os = "windows")]
mod tray;

use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, PhysicalPosition, PhysicalSize,
    Position, Size, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

const MIN_WINDOW_WIDTH: f64 = 360.0;
const MIN_WINDOW_HEIGHT: f64 = 200.0;
const MAX_WINDOW_WIDTH: f64 = 1200.0;
const MAX_WINDOW_HEIGHT: f64 = 680.0;
const DEFAULT_WINDOW_WIDTH: f64 = 640.0;
const DEFAULT_WINDOW_HEIGHT: f64 = 260.0;
const SETTINGS_WINDOW_WIDTH: f64 = 430.0;
const SETTINGS_WINDOW_HEIGHT: f64 = 640.0;
const MIN_VISIBLE_WIDTH: i32 = 80;
const MIN_VISIBLE_HEIGHT: i32 = 80;
const MAIN_READY_FALLBACK_MS: u64 = 5_000;
const WINDOW_STATE_VERSION: u64 = 2;
const WINDOW_SIZE_UNIT: &str = "logical";
const WINDOW_POSITION_UNIT: &str = "physical";
const WORK_AREA_MARGIN_LOGICAL: f64 = 12.0;
const MIN_RESTORABLE_PHYSICAL_WIDTH: u32 = 160;
const MIN_RESTORABLE_PHYSICAL_HEIGHT: u32 = 100;
const MAX_RESTORABLE_PHYSICAL_DIMENSION: u32 = 32_768;
const MAX_RESTORABLE_POSITION_ABS: i64 = 1_000_000;

#[derive(Clone, Default)]
struct MainWindowReadyState(Arc<AtomicBool>);

#[derive(Default)]
struct ConfigIoState(Mutex<()>);

#[derive(Default)]
struct ContextMenuAnchorState(Mutex<Option<(f64, f64)>>);

#[derive(Debug, Clone, Copy)]
struct DragMoveSnapshot {
    start_cursor_x: f64,
    start_cursor_y: f64,
    start_window_x: i32,
    start_window_y: i32,
    scale: f64,
}

#[derive(Default)]
struct DragMoveState(Mutex<Option<DragMoveSnapshot>>);

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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MainWindowBounds {
    width: u32,
    height: u32,
    x: i32,
    y: i32,
}

fn startup_log_path() -> PathBuf {
    std::env::temp_dir().join("worldclock-startup.log")
}

pub(crate) fn log_startup(message: &str) {
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

#[derive(Debug)]
enum ConfigReadError {
    Io(String),
    Corrupt(String),
}

fn config_backup_path(path: &Path) -> PathBuf {
    path.with_file_name("config.json.bak")
}

fn config_temp_path(path: &Path) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    path.with_file_name(format!("config.json.tmp-{}-{stamp}", std::process::id()))
}

fn quarantine_path(path: &Path) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    path.with_file_name(format!("config.corrupt-{stamp}.json"))
}

fn value_is_nonempty_string(value: Option<&serde_json::Value>) -> bool {
    value
        .and_then(serde_json::Value::as_str)
        .is_some_and(|value| !value.trim().is_empty() && value.len() <= 128)
}

fn reject_unknown_keys(
    object: &serde_json::Map<String, serde_json::Value>,
    allowed: &[&str],
    context: &str,
) -> Result<(), String> {
    if let Some(key) = object.keys().find(|key| !allowed.contains(&key.as_str())) {
        return Err(format!("{context}.{key} is not supported"));
    }
    Ok(())
}

fn validate_config_value(value: &serde_json::Value, require_core: bool) -> Result<(), String> {
    let object = value
        .as_object()
        .ok_or_else(|| "config root must be a JSON object".to_string())?;
    reject_unknown_keys(
        object,
        &[
            "version",
            "clocks",
            "clockCount",
            "mode",
            "showSeconds",
            "locked",
            "on_top",
            "theme",
            "surfaceStyle",
            "surfaceStyleExplicit",
            "timeFormat",
            "opacity",
            "autostart",
            "pomodoro",
            "window",
        ],
        "config",
    )?;

    if require_core || object.contains_key("clocks") {
        let clocks = object
            .get("clocks")
            .and_then(serde_json::Value::as_array)
            .ok_or_else(|| "config.clocks must be an array".to_string())?;
        if clocks.is_empty() || clocks.len() > 2 {
            return Err("config.clocks must contain one or two clocks".to_string());
        }
        for (index, clock) in clocks.iter().enumerate() {
            let clock = clock
                .as_object()
                .ok_or_else(|| format!("config.clocks[{index}] must be an object"))?;
            reject_unknown_keys(clock, &["label", "tz"], &format!("config.clocks[{index}]"))?;
            if !value_is_nonempty_string(clock.get("label")) {
                return Err(format!(
                    "config.clocks[{index}].label must be a non-empty string"
                ));
            }
            if !value_is_nonempty_string(clock.get("tz")) {
                return Err(format!(
                    "config.clocks[{index}].tz must be a non-empty string"
                ));
            }
        }
    }

    if require_core || object.contains_key("clockCount") {
        match object.get("clockCount").and_then(serde_json::Value::as_u64) {
            Some(1 | 2) => {}
            _ => return Err("config.clockCount must be 1 or 2".to_string()),
        }
    }

    if require_core || object.contains_key("mode") {
        match object.get("mode").and_then(serde_json::Value::as_str) {
            Some("digital" | "analog" | "both") => {}
            _ => return Err("config.mode must be digital, analog, or both".to_string()),
        }
    }

    for (key, allowed) in [
        (
            "theme",
            &[
                "classic",
                "minimal",
                "cute",
                "glass",
                "minimal-glass",
                "mechanical",
                "soft-companion",
                "flip",
                "boundless",
                "dark",
                "light",
                "glass-pet",
                "moon-cat",
                "pixel-buddy",
            ][..],
        ),
        ("surfaceStyle", &["transparent", "solid"][..]),
        ("timeFormat", &["12", "24"][..]),
    ] {
        if let Some(item) = object.get(key) {
            let item = item
                .as_str()
                .ok_or_else(|| format!("config.{key} must be a string"))?;
            if !allowed.contains(&item) {
                return Err(format!("config.{key} has an unsupported value"));
            }
        }
    }

    for key in [
        "locked",
        "on_top",
        "autostart",
        "surfaceStyleExplicit",
        "showSeconds",
    ] {
        if object.get(key).is_some_and(|item| item.as_bool().is_none()) {
            return Err(format!("config.{key} must be a boolean"));
        }
    }

    if let Some(opacity) = object.get("opacity") {
        let opacity = opacity
            .as_f64()
            .ok_or_else(|| "config.opacity must be a number".to_string())?;
        if !opacity.is_finite() || !(0.0..=1.0).contains(&opacity) {
            return Err("config.opacity must be between 0 and 1".to_string());
        }
    }

    if let Some(pomodoro) = object.get("pomodoro") {
        let pomodoro = pomodoro
            .as_object()
            .ok_or_else(|| "config.pomodoro must be an object".to_string())?;
        reject_unknown_keys(
            pomodoro,
            &["focusMinutes", "breakMinutes"],
            "config.pomodoro",
        )?;
        for (key, max) in [("focusMinutes", 120_u64), ("breakMinutes", 60_u64)] {
            let minutes = pomodoro
                .get(key)
                .and_then(serde_json::Value::as_u64)
                .ok_or_else(|| format!("config.pomodoro.{key} must be an integer"))?;
            if !(1..=max).contains(&minutes) {
                return Err(format!("config.pomodoro.{key} is out of range"));
            }
        }
    }

    if let Some(window) = object.get("window") {
        let window = window
            .as_object()
            .ok_or_else(|| "config.window must be an object".to_string())?;
        reject_unknown_keys(
            window,
            &[
                "width",
                "height",
                "x",
                "y",
                "sizeUnit",
                "positionUnit",
                "scaleFactor",
                "stateVersion",
            ],
            "config.window",
        )?;
        for key in ["width", "height"] {
            let dimension = window
                .get(key)
                .and_then(serde_json::Value::as_f64)
                .ok_or_else(|| format!("config.window.{key} must be a number"))?;
            if !dimension.is_finite() || dimension <= 0.0 || dimension > 16_384.0 {
                return Err(format!("config.window.{key} is out of range"));
            }
        }
        for key in ["x", "y"] {
            if window
                .get(key)
                .is_some_and(|coordinate| coordinate.as_i64().is_none())
            {
                return Err(format!("config.window.{key} must be an integer"));
            }
        }
    }

    Ok(())
}

fn isolate_corrupt_config(path: &Path, reason: &str) -> ConfigReadError {
    let isolated = quarantine_path(path);
    match fs::rename(path, &isolated) {
        Ok(()) => ConfigReadError::Corrupt(format!("{reason}; moved to {}", isolated.display())),
        Err(error) => ConfigReadError::Corrupt(format!(
            "{reason}; failed to isolate {}: {error}",
            path.display()
        )),
    }
}

fn read_config_file(path: &Path) -> Result<Option<serde_json::Value>, ConfigReadError> {
    if !path.exists() {
        let backup = config_backup_path(path);
        if backup.exists() {
            fs::rename(&backup, path).map_err(|error| {
                ConfigReadError::Io(format!("restore config backup failed: {error}"))
            })?;
        } else {
            return Ok(None);
        }
    }

    let content = fs::read_to_string(path)
        .map_err(|error| ConfigReadError::Io(format!("read config failed: {error}")))?;
    let value: serde_json::Value = serde_json::from_str(&content)
        .map_err(|error| isolate_corrupt_config(path, &format!("invalid JSON: {error}")))?;
    validate_config_value(&value, false)
        .map_err(|error| isolate_corrupt_config(path, &format!("invalid config: {error}")))?;
    Ok(Some(value))
}

fn write_config_file(path: &Path, value: &serde_json::Value) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    let temp = config_temp_path(path);
    let backup = config_backup_path(path);

    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temp)
        .map_err(|error| format!("create temporary config failed: {error}"))?;
    if let Err(error) = file.write_all(&bytes).and_then(|()| file.sync_all()) {
        let _ = fs::remove_file(&temp);
        return Err(format!("write temporary config failed: {error}"));
    }
    drop(file);

    if backup.exists() {
        if let Err(error) = fs::remove_file(&backup) {
            let _ = fs::remove_file(&temp);
            return Err(format!("remove stale config backup failed: {error}"));
        }
    }
    let had_existing = path.exists();
    if had_existing {
        if let Err(error) = fs::rename(path, &backup) {
            let _ = fs::remove_file(&temp);
            return Err(format!("create config backup failed: {error}"));
        }
    }

    if let Err(error) = fs::rename(&temp, path) {
        let _ = fs::remove_file(&temp);
        if had_existing {
            if let Err(restore_error) = fs::rename(&backup, path) {
                return Err(format!(
                    "replace config failed: {error}; backup remains at {} because restore failed: {restore_error}",
                    backup.display()
                ));
            }
        }
        return Err(format!("replace config failed: {error}"));
    }

    if had_existing {
        if let Err(error) = fs::remove_file(&backup) {
            log_startup(&format!("remove config backup failed: {error}"));
        }
    }
    Ok(())
}

fn load_config_value(app: &AppHandle) -> Option<serde_json::Value> {
    let path = config_path(app).ok()?;
    let state = app.try_state::<ConfigIoState>();
    let _guard = state.as_ref().and_then(|state| state.0.lock().ok());
    match read_config_file(&path) {
        Ok(value) => value,
        Err(ConfigReadError::Io(error) | ConfigReadError::Corrupt(error)) => {
            log_startup(&error);
            None
        }
    }
}

fn update_config_value<F>(app: &AppHandle, update: F) -> Result<serde_json::Value, String>
where
    F: FnOnce(&mut serde_json::Value) -> Result<(), String>,
{
    let path = config_path(app)?;
    let state = app.try_state::<ConfigIoState>();
    let _guard = state
        .as_ref()
        .map(|state| {
            state
                .0
                .lock()
                .map_err(|_| "config I/O lock poisoned".to_string())
        })
        .transpose()?;
    let mut value = match read_config_file(&path) {
        Ok(Some(value)) => value,
        Ok(None) => serde_json::json!({}),
        Err(ConfigReadError::Corrupt(error)) => {
            log_startup(&error);
            serde_json::json!({})
        }
        Err(ConfigReadError::Io(error)) => return Err(error),
    };
    update(&mut value)?;
    validate_config_value(&value, false)?;
    write_config_file(&path, &value)?;
    Ok(value)
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

#[derive(Debug, Clone, Copy, PartialEq)]
struct WindowLogicalSize {
    width: f64,
    height: f64,
}

#[derive(Debug, Clone, Copy)]
struct PhysicalWorkArea {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

fn preferred_layout_size(clock_count: u8, mode: &str, show_seconds: bool) -> WindowLogicalSize {
    match (clock_count, mode, show_seconds) {
        (1, "digital", false) => WindowLogicalSize {
            width: 400.0,
            height: 220.0,
        },
        (1, "digital", true) => WindowLogicalSize {
            width: 580.0,
            height: 240.0,
        },
        (1, "analog", _) => WindowLogicalSize {
            width: 420.0,
            height: 320.0,
        },
        (1, "both", _) => WindowLogicalSize {
            width: 560.0,
            height: 320.0,
        },
        (_, "analog", _) => WindowLogicalSize {
            width: 660.0,
            height: 360.0,
        },
        (_, "both", _) => WindowLogicalSize {
            width: 820.0,
            height: 390.0,
        },
        (_, "digital", true) => WindowLogicalSize {
            width: 820.0,
            height: 260.0,
        },
        _ => WindowLogicalSize {
            width: 640.0,
            height: 260.0,
        },
    }
}

fn normalize_saved_logical_size(
    width: f64,
    height: f64,
    size_unit: Option<&str>,
    scale_factor: f64,
) -> WindowLogicalSize {
    let scale_factor = if scale_factor.is_finite() && scale_factor > 0.0 {
        scale_factor
    } else {
        1.0
    };
    let (width, height) = if size_unit == Some(WINDOW_SIZE_UNIT) {
        (width, height)
    } else {
        // v0.3.x persisted inner_size() directly, which is expressed in physical pixels.
        (width / scale_factor, height / scale_factor)
    };

    WindowLogicalSize {
        width: width.clamp(MIN_WINDOW_WIDTH, MAX_WINDOW_WIDTH),
        height: height.clamp(MIN_WINDOW_HEIGHT, MAX_WINDOW_HEIGHT),
    }
}

fn fit_logical_size_to_work_area(
    desired: WindowLogicalSize,
    work_width_physical: u32,
    work_height_physical: u32,
    scale_factor: f64,
) -> WindowLogicalSize {
    let scale_factor = scale_factor.max(0.1);
    let available_width =
        (work_width_physical as f64 / scale_factor - WORK_AREA_MARGIN_LOGICAL * 2.0).max(1.0);
    let available_height =
        (work_height_physical as f64 / scale_factor - WORK_AREA_MARGIN_LOGICAL * 2.0).max(1.0);

    WindowLogicalSize {
        width: desired
            .width
            .clamp(MIN_WINDOW_WIDTH.min(available_width), MAX_WINDOW_WIDTH)
            .min(available_width),
        height: desired
            .height
            .clamp(MIN_WINDOW_HEIGHT.min(available_height), MAX_WINDOW_HEIGHT)
            .min(available_height),
    }
}

fn clamp_full_window_position(
    position: PhysicalPosition<i32>,
    width: u32,
    height: u32,
    work: PhysicalWorkArea,
) -> PhysicalPosition<i32> {
    let max_x = work
        .x
        .saturating_add(work.width.saturating_sub(width) as i32);
    let max_y = work
        .y
        .saturating_add(work.height.saturating_sub(height) as i32);
    PhysicalPosition {
        x: clamp_position(position.x, work.x, max_x),
        y: clamp_position(position.y, work.y, max_y),
    }
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

fn window_scale_factor(window: &WebviewWindow) -> f64 {
    window
        .current_monitor()
        .ok()
        .flatten()
        .map(|monitor| monitor.scale_factor())
        .unwrap_or_else(|| window.scale_factor().unwrap_or(1.0))
        .max(0.1)
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
        let main_right = main_pos.x.saturating_add(main_size.width as i32);
        left = main_right.saturating_add(gap);
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

pub(crate) fn reset_main_window_position(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    let current_scale = window.scale_factor().unwrap_or(1.0).max(0.1);
    let size = window.inner_size().unwrap_or(PhysicalSize {
        width: (DEFAULT_WINDOW_WIDTH * current_scale).round() as u32,
        height: (DEFAULT_WINDOW_HEIGHT * current_scale).round() as u32,
    });
    let logical =
        normalize_saved_logical_size(size.width as f64, size.height as f64, None, current_scale);
    let monitor = app
        .primary_monitor()
        .map_err(|error| error.to_string())?
        .or_else(|| window.current_monitor().ok().flatten());
    let logical = monitor.as_ref().map_or(logical, |monitor| {
        let work = monitor.work_area();
        fit_logical_size_to_work_area(
            logical,
            work.size.width,
            work.size.height,
            monitor.scale_factor(),
        )
    });
    window
        .set_size(Size::Logical(LogicalSize {
            width: logical.width,
            height: logical.height,
        }))
        .map_err(|error| error.to_string())?;

    let target_scale = monitor
        .as_ref()
        .map(|monitor| monitor.scale_factor())
        .unwrap_or(current_scale)
        .max(0.1);
    let physical_width = (logical.width * target_scale).round() as u32;
    let physical_height = (logical.height * target_scale).round() as u32;
    if let Some(position) = centered_position(app, physical_width, physical_height) {
        window
            .set_position(Position::Physical(position))
            .map_err(|error| error.to_string())?;
    }
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    save_window_state(app, &window)
}

fn restore_window_state(app: &AppHandle, window: &WebviewWindow) {
    let Some(config) = load_config_value(app) else {
        return;
    };
    let Some(window_state) = config.get("window") else {
        return;
    };

    let saved_width = window_state
        .get("width")
        .and_then(serde_json::Value::as_f64)
        .unwrap_or(DEFAULT_WINDOW_WIDTH);
    let saved_height = window_state
        .get("height")
        .and_then(serde_json::Value::as_f64)
        .unwrap_or(DEFAULT_WINDOW_HEIGHT);
    let saved_x = window_state
        .get("x")
        .and_then(serde_json::Value::as_i64)
        .map(|value| value as i32);
    let saved_y = window_state
        .get("y")
        .and_then(serde_json::Value::as_i64)
        .map(|value| value as i32);
    let size_unit = window_state
        .get("sizeUnit")
        .and_then(serde_json::Value::as_str);

    let saved_monitor = saved_x.zip(saved_y).and_then(|(x, y)| {
        app.available_monitors().ok()?.into_iter().find(|monitor| {
            let area = monitor.work_area();
            x >= area.position.x
                && y >= area.position.y
                && x < area.position.x.saturating_add(area.size.width as i32)
                && y < area.position.y.saturating_add(area.size.height as i32)
        })
    });
    let monitor = saved_monitor
        .or_else(|| window.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    let scale = monitor
        .as_ref()
        .map(|monitor| monitor.scale_factor())
        .unwrap_or_else(|| window.scale_factor().unwrap_or(1.0))
        .max(0.1);
    let logical = normalize_saved_logical_size(saved_width, saved_height, size_unit, scale);
    let logical = monitor.as_ref().map_or(logical, |monitor| {
        let work = monitor.work_area();
        fit_logical_size_to_work_area(
            logical,
            work.size.width,
            work.size.height,
            monitor.scale_factor(),
        )
    });
    if let Err(error) = window.set_size(Size::Logical(LogicalSize {
        width: logical.width,
        height: logical.height,
    })) {
        log_startup(&format!("restore window size failed: {error}"));
    }

    let physical_width = (logical.width * scale).round() as u32;
    let physical_height = (logical.height * scale).round() as u32;

    if let (Some(x), Some(y)) = (saved_x, saved_y) {
        let position = safe_window_position(app, x, y, physical_width, physical_height);
        if let Err(error) = window.set_position(Position::Physical(position)) {
            log_startup(&format!("restore window position failed: {error}"));
        }
    } else if let Some(position) = centered_position(app, physical_width, physical_height) {
        if let Err(error) = window.set_position(Position::Physical(position)) {
            log_startup(&format!("center window failed: {error}"));
        }
    }
}

fn save_window_state(app: &AppHandle, window: &WebviewWindow) -> Result<(), String> {
    let size = window.inner_size().map_err(|error| error.to_string())?;
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let scale = window.scale_factor().unwrap_or(1.0).max(0.1);

    let width = (size.width as f64 / scale).clamp(MIN_WINDOW_WIDTH, MAX_WINDOW_WIDTH);
    let height = (size.height as f64 / scale).clamp(MIN_WINDOW_HEIGHT, MAX_WINDOW_HEIGHT);
    let position = safe_window_position(app, position.x, position.y, size.width, size.height);

    let window_state = serde_json::json!({
        "width": width,
        "height": height,
        "x": position.x,
        "y": position.y,
        "sizeUnit": WINDOW_SIZE_UNIT,
        "positionUnit": WINDOW_POSITION_UNIT,
        "scaleFactor": scale,
        "stateVersion": WINDOW_STATE_VERSION
    });

    update_config_value(app, |config| {
        config["window"] = window_state;
        Ok(())
    })?;
    Ok(())
}

fn validate_main_window_bounds(bounds: &MainWindowBounds) -> Result<(), String> {
    if !(MIN_RESTORABLE_PHYSICAL_WIDTH..=MAX_RESTORABLE_PHYSICAL_DIMENSION).contains(&bounds.width)
    {
        return Err(format!(
            "bounds.width must be between {MIN_RESTORABLE_PHYSICAL_WIDTH} and {MAX_RESTORABLE_PHYSICAL_DIMENSION} physical pixels"
        ));
    }
    if !(MIN_RESTORABLE_PHYSICAL_HEIGHT..=MAX_RESTORABLE_PHYSICAL_DIMENSION)
        .contains(&bounds.height)
    {
        return Err(format!(
            "bounds.height must be between {MIN_RESTORABLE_PHYSICAL_HEIGHT} and {MAX_RESTORABLE_PHYSICAL_DIMENSION} physical pixels"
        ));
    }
    if i64::from(bounds.x).abs() > MAX_RESTORABLE_POSITION_ABS {
        return Err(format!(
            "bounds.x must be between -{MAX_RESTORABLE_POSITION_ABS} and {MAX_RESTORABLE_POSITION_ABS} physical pixels"
        ));
    }
    if i64::from(bounds.y).abs() > MAX_RESTORABLE_POSITION_ABS {
        return Err(format!(
            "bounds.y must be between -{MAX_RESTORABLE_POSITION_ABS} and {MAX_RESTORABLE_POSITION_ABS} physical pixels"
        ));
    }
    Ok(())
}

fn main_window_bounds(window: &WebviewWindow) -> Result<MainWindowBounds, String> {
    let size = window.inner_size().map_err(|error| error.to_string())?;
    let position = window.outer_position().map_err(|error| error.to_string())?;
    Ok(MainWindowBounds {
        width: size.width,
        height: size.height,
        x: position.x,
        y: position.y,
    })
}

fn reveal_main_window(window: &WebviewWindow, focus: bool) -> Result<(), String> {
    window.show().map_err(|error| error.to_string())?;
    if focus {
        window.set_focus().map_err(|error| error.to_string())?;
    }
    Ok(())
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
                if let Err(error) = reveal_main_window(&window, true) {
                    log_startup(&format!("fallback reveal failed: {error}"));
                }
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
fn hide_window(window: WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|error| error.to_string())
}

#[tauri::command]
fn reset_window_position(app: AppHandle) -> Result<(), String> {
    reset_main_window_position(&app)
}

#[tauri::command]
fn get_main_window_bounds(app: AppHandle) -> Result<MainWindowBounds, String> {
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    main_window_bounds(&main)
}

#[tauri::command]
fn restore_main_window_bounds(app: AppHandle, bounds: MainWindowBounds) -> Result<(), String> {
    validate_main_window_bounds(&bounds)?;
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;

    main.set_size(Size::Physical(PhysicalSize {
        width: bounds.width,
        height: bounds.height,
    }))
    .map_err(|error| format!("restore main window size failed: {error}"))?;
    main.set_position(Position::Physical(PhysicalPosition {
        x: bounds.x,
        y: bounds.y,
    }))
    .map_err(|error| format!("restore main window position failed: {error}"))?;

    let actual = main_window_bounds(&main)?;
    if actual != bounds {
        return Err(format!(
            "operating system did not restore the exact main window bounds (requested {}x{} at {},{}; actual {}x{} at {},{})",
            bounds.width,
            bounds.height,
            bounds.x,
            bounds.y,
            actual.width,
            actual.height,
            actual.x,
            actual.y
        ));
    }

    save_window_state(&app, &main)
}

#[tauri::command]
fn set_window_on_top(app: AppHandle, window: WebviewWindow, enabled: bool) -> Result<(), String> {
    if let Some(main) = app.get_webview_window("main") {
        main.set_always_on_top(enabled)
            .map_err(|error| error.to_string())?;
    } else {
        window
            .set_always_on_top(enabled)
            .map_err(|error| error.to_string())?;
    }

    if let Some(settings) = app.get_webview_window("settings") {
        settings
            .set_always_on_top(enabled)
            .map_err(|error| error.to_string())?;
    }

    #[cfg(target_os = "windows")]
    tray::set_ontop_checked(&app, enabled)?;

    #[cfg(not(target_os = "windows"))]
    let _ = app;

    Ok(())
}

#[tauri::command]
fn set_locked(app: AppHandle, locked: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    tray::set_lock_checked(&app, locked)?;

    #[cfg(not(target_os = "windows"))]
    let _ = (app, locked);

    Ok(())
}

#[tauri::command]
fn set_theme(app: AppHandle, theme: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        tray::set_theme_checked(&app, &theme)?;
        if let Some(window) = app.get_webview_window("main") {
            apply_premium_window_effect(&window, &theme);
        }
    }

    #[cfg(not(target_os = "windows"))]
    let _ = (app, theme);

    Ok(())
}

#[tauri::command]
fn fit_window_to_layout(
    app: AppHandle,
    window: WebviewWindow,
    clock_count: u8,
    mode: String,
    show_seconds: bool,
) -> Result<(), String> {
    if !matches!(clock_count, 1 | 2) {
        return Err("clock_count must be 1 or 2".to_string());
    }
    if !matches!(mode.as_str(), "digital" | "analog" | "both") {
        return Err("mode must be digital, analog, or both".to_string());
    }

    let main = app.get_webview_window("main").unwrap_or(window);
    let monitor = main
        .current_monitor()
        .map_err(|error| error.to_string())?
        .or_else(|| app.primary_monitor().ok().flatten())
        .ok_or_else(|| "no monitor is available".to_string())?;
    let work = monitor.work_area();
    let scale = monitor.scale_factor().max(0.1);
    let desired = preferred_layout_size(clock_count, &mode, show_seconds);
    let fitted = fit_logical_size_to_work_area(desired, work.size.width, work.size.height, scale);
    let position = main.outer_position().unwrap_or(work.position);
    let physical_width = (fitted.width * scale).round() as u32;
    let physical_height = (fitted.height * scale).round() as u32;
    let position = clamp_full_window_position(
        position,
        physical_width,
        physical_height,
        PhysicalWorkArea {
            x: work.position.x,
            y: work.position.y,
            width: work.size.width,
            height: work.size.height,
        },
    );

    main.set_size(Size::Logical(LogicalSize {
        width: fitted.width,
        height: fitted.height,
    }))
    .map_err(|error| error.to_string())?;
    main.set_position(Position::Physical(position))
        .map_err(|error| error.to_string())?;
    main.show().map_err(|error| error.to_string())?;
    save_window_state(&app, &main)
}

#[tauri::command]
fn start_dragging(window: WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}

#[tauri::command]
fn begin_window_drag(
    app: AppHandle,
    window: WebviewWindow,
    screen_x: f64,
    screen_y: f64,
) -> Result<(), String> {
    let position = window.outer_position().map_err(|e| e.to_string())?;
    let scale = window_scale_factor(&window);
    let state = app.state::<DragMoveState>();
    let mut drag = state
        .0
        .lock()
        .map_err(|_| "drag state lock poisoned".to_string())?;

    *drag = Some(DragMoveSnapshot {
        start_cursor_x: screen_x * scale,
        start_cursor_y: screen_y * scale,
        start_window_x: position.x,
        start_window_y: position.y,
        scale,
    });

    Ok(())
}

#[tauri::command]
fn move_window_drag(
    app: AppHandle,
    window: WebviewWindow,
    screen_x: f64,
    screen_y: f64,
) -> Result<(), String> {
    let state = app.state::<DragMoveState>();
    let drag = state
        .0
        .lock()
        .map_err(|_| "drag state lock poisoned".to_string())?
        .as_ref()
        .copied();

    let Some(drag) = drag else {
        return Ok(());
    };

    let next_x = drag.start_window_x as f64 + (screen_x * drag.scale - drag.start_cursor_x);
    let next_y = drag.start_window_y as f64 + (screen_y * drag.scale - drag.start_cursor_y);

    window
        .set_position(Position::Physical(PhysicalPosition {
            x: next_x.round() as i32,
            y: next_y.round() as i32,
        }))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn end_window_drag(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    let state = app.state::<DragMoveState>();
    if let Ok(mut drag) = state.0.lock() {
        *drag = None;
    }
    save_window_state(&app, &window)
}

#[tauri::command]
fn main_window_ready(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    mark_main_window_ready(&app);
    reveal_main_window(&window, true)?;
    log_startup("frontend ready; main window shown");
    Ok(())
}

pub(crate) fn open_settings_window(app: &AppHandle) -> Result<(), String> {
    if let Some(settings) = app.get_webview_window("settings") {
        settings.show().map_err(|error| error.to_string())?;
        settings.set_focus().map_err(|error| error.to_string())?;
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

    let on_top = load_config_value(app)
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
fn close_settings_window(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    if window.label() == "settings" {
        window.close().map_err(|error| error.to_string())?;
    } else if let Some(settings) = app.get_webview_window("settings") {
        settings.close().map_err(|error| error.to_string())?;
    }
    Ok(())
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
        "局部底色",
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
    validate_config_value(&data, true)?;
    let next = update_config_value(&app, |existing| {
        let existing_window = existing.get("window").cloned();
        *existing = data;
        if let Some(window_state) = existing_window {
            existing["window"] = window_state;
        }
        Ok(())
    })?;
    if let Err(error) = app.emit("config-updated", next) {
        log_startup(&format!("emit config-updated failed: {error}"));
    }
    Ok(())
}

#[tauri::command]
async fn load_config(app: AppHandle) -> Result<Option<serde_json::Value>, String> {
    let path = config_path(&app)?;
    let state = app.try_state::<ConfigIoState>();
    let _guard = state
        .as_ref()
        .map(|state| {
            state
                .0
                .lock()
                .map_err(|_| "config I/O lock poisoned".to_string())
        })
        .transpose()?;
    match read_config_file(&path) {
        Ok(value) => Ok(value),
        Err(ConfigReadError::Corrupt(error)) => {
            log_startup(&error);
            Ok(None)
        }
        Err(ConfigReadError::Io(error)) => Err(error),
    }
}

#[tauri::command]
async fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    let _ = app;
    set_autostart_enabled(enabled)
}

#[cfg(any(target_os = "windows", test))]
fn parse_autostart_executable(command: &str) -> Option<PathBuf> {
    let command = command.trim();
    if command.is_empty() {
        return None;
    }

    let executable = if command.starts_with('"') || command.ends_with('"') {
        if command.len() < 3 || !command.starts_with('"') || !command.ends_with('"') {
            return None;
        }
        let executable = &command[1..command.len() - 1];
        if executable.is_empty() || executable.contains('"') {
            return None;
        }
        executable
    } else if command.contains('"') {
        return None;
    } else {
        command
    };

    Some(PathBuf::from(executable))
}

#[cfg(any(target_os = "windows", test))]
fn normalized_windows_path(path: &Path) -> String {
    let mut normalized = path.to_string_lossy().replace('/', "\\");
    if normalized
        .get(..8)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case(r"\\?\UNC\"))
    {
        normalized = format!(r"\\{}", &normalized[8..]);
    } else if normalized.starts_with(r"\\?\") {
        normalized.drain(..4);
    }

    while normalized.len() > 3 && normalized.ends_with('\\') {
        normalized.pop();
    }
    normalized.to_lowercase()
}

#[cfg(any(target_os = "windows", test))]
fn autostart_command_matches_current_with(
    command: &str,
    current_exe: &Path,
    target_exists: impl Fn(&Path) -> bool,
    canonicalize: impl Fn(&Path) -> Option<PathBuf>,
) -> bool {
    let Some(target) = parse_autostart_executable(command) else {
        return false;
    };
    if !target_exists(&target) {
        return false;
    }

    let comparable_target = canonicalize(&target).unwrap_or(target);
    let comparable_current = canonicalize(current_exe).unwrap_or_else(|| current_exe.to_path_buf());
    normalized_windows_path(&comparable_target) == normalized_windows_path(&comparable_current)
}

#[cfg(target_os = "windows")]
fn set_autostart_enabled(enabled: bool) -> Result<(), String> {
    use std::io::ErrorKind;
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let run_path = r"Software\Microsoft\Windows\CurrentVersion\Run";
    if enabled {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let command = format!("\"{}\"", exe.display());
        let (run_key, _) = hkcu
            .create_subkey(run_path)
            .map_err(|error| format!("open Windows startup registry key failed: {error}"))?;
        run_key
            .set_value("WorldClock", &command)
            .map_err(|error| format!("set Windows startup registry value failed: {error}"))?;
    } else {
        let run_key = match hkcu.open_subkey_with_flags(run_path, winreg::enums::KEY_SET_VALUE) {
            Ok(key) => key,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(format!("open Windows startup registry key failed: {error}")),
        };
        match run_key.delete_value("WorldClock") {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!(
                    "delete Windows startup registry value failed: {error}"
                ))
            }
        }
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn set_autostart_enabled(_enabled: bool) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "windows")]
fn autostart_enabled() -> Result<bool, String> {
    use std::io::ErrorKind;
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let run_key = match hkcu.open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Run") {
        Ok(key) => key,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(format!("open Windows startup registry key failed: {error}")),
    };
    match run_key.get_value::<String, _>("WorldClock") {
        Ok(command) => {
            let current_exe = std::env::current_exe().map_err(|error| {
                format!("resolve current executable for autostart failed: {error}")
            })?;
            Ok(autostart_command_matches_current_with(
                &command,
                &current_exe,
                Path::exists,
                |path| fs::canonicalize(path).ok(),
            ))
        }
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!(
            "read Windows startup registry value failed: {error}"
        )),
    }
}

#[cfg(not(target_os = "windows"))]
fn autostart_enabled() -> Result<bool, String> {
    Ok(false)
}

#[tauri::command]
async fn get_autostart() -> Result<bool, String> {
    autostart_enabled()
}

fn emit_context_action(app: &AppHandle, action: &str) {
    clear_context_settings_anchor(app);
    if let Err(error) = app.emit("context-menu-action", action) {
        log_startup(&format!("emit context action {action} failed: {error}"));
    }
}

/* ── 应用入口 ── */
pub fn run() {
    std::panic::set_hook(Box::new(|panic_info| {
        log_startup(&format!("panic: {panic_info}"));
    }));

    log_startup("run() entered");

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                if let Err(error) = window.show() {
                    log_startup(&format!("single-instance show failed: {error}"));
                }
                if let Err(error) = window.unminimize() {
                    log_startup(&format!("single-instance unminimize failed: {error}"));
                }
                if let Err(error) = window.set_focus() {
                    log_startup(&format!("single-instance focus failed: {error}"));
                }
            } else {
                log_startup("single-instance callback could not find main window");
            }
        }))
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
                if let Err(error) = open_settings_window(app) {
                    log_startup(&format!("context open settings failed: {error}"));
                }
            }
            "context_reset_window" => {
                clear_context_settings_anchor(app);
                if let Err(error) = reset_main_window_position(app) {
                    log_startup(&format!("context reset window failed: {error}"));
                }
            }
            "context_hide_window" => {
                clear_context_settings_anchor(app);
                if let Some(window) = app.get_webview_window("main") {
                    if let Err(error) = window.hide() {
                        log_startup(&format!("context hide window failed: {error}"));
                    }
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
            _app.manage(ConfigIoState::default());
            _app.manage(ContextMenuAnchorState::default());
            _app.manage(DragMoveState::default());

            let initial_config = load_config_value(_app.handle());
            let initial_on_top = initial_config
                .as_ref()
                .and_then(|config| config.get("on_top"))
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(true);
            #[cfg(target_os = "windows")]
            let initial_locked = initial_config
                .as_ref()
                .and_then(|config| config.get("locked"))
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false);
            #[cfg(target_os = "windows")]
            let initial_theme = initial_config
                .as_ref()
                .and_then(|config| config.get("theme"))
                .and_then(serde_json::Value::as_str)
                .unwrap_or("classic")
                .to_string();

            #[cfg(target_os = "windows")]
            if let Err(err) = tray::setup_tray(
                _app.handle(),
                tray::TrayPreferences {
                    locked: initial_locked,
                    on_top: initial_on_top,
                    theme: initial_theme.clone(),
                },
            ) {
                log_startup(&format!("tray setup failed: {err}"));
            } else {
                log_startup("tray setup finished");
            }

            if let Some(window) = _app.get_webview_window("main") {
                #[cfg(target_os = "windows")]
                apply_premium_window_effect(&window, &initial_theme);

                if let Err(error) = window.set_always_on_top(initial_on_top) {
                    log_startup(&format!("restore always-on-top failed: {error}"));
                }

                let app_handle = _app.handle().clone();
                let state_window = window.clone();
                window.on_window_event(move |event| match event {
                    WindowEvent::Focused(false) | WindowEvent::Destroyed => {
                        if let Err(error) = save_window_state(&app_handle, &state_window) {
                            log_startup(&format!("save window state failed: {error}"));
                        }
                    }
                    WindowEvent::CloseRequested { api, .. } => {
                        #[cfg(target_os = "windows")]
                        api.prevent_close();
                        if let Err(error) = save_window_state(&app_handle, &state_window) {
                            log_startup(&format!("save window state on close failed: {error}"));
                        }
                        #[cfg(target_os = "windows")]
                        {
                            if let Err(error) = state_window.hide() {
                                log_startup(&format!("hide main window on close failed: {error}"));
                            }
                        }
                        #[cfg(not(target_os = "windows"))]
                        let _ = api;
                    }
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
            get_main_window_bounds,
            restore_main_window_bounds,
            set_window_on_top,
            fit_window_to_layout,
            set_locked,
            set_theme,
            start_dragging,
            begin_window_drag,
            move_window_drag,
            end_window_drag,
            main_window_ready,
            show_settings_window,
            close_settings_window,
            show_context_menu,
            set_hit_test_regions,
            set_autostart,
            get_autostart,
            save_config,
            load_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running WorldClock");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preferred_sizes_cover_single_and_dual_laptop_layouts() {
        assert_eq!(
            preferred_layout_size(1, "digital", false),
            WindowLogicalSize {
                width: 400.0,
                height: 220.0
            }
        );
        assert_eq!(
            preferred_layout_size(1, "digital", true),
            WindowLogicalSize {
                width: 580.0,
                height: 240.0
            }
        );
        assert_eq!(
            preferred_layout_size(2, "digital", false),
            WindowLogicalSize {
                width: 640.0,
                height: 260.0
            }
        );
        assert_eq!(
            preferred_layout_size(2, "digital", true),
            WindowLogicalSize {
                width: 820.0,
                height: 260.0
            }
        );
        assert_eq!(
            preferred_layout_size(1, "analog", false),
            WindowLogicalSize {
                width: 420.0,
                height: 320.0
            }
        );
        assert_eq!(
            preferred_layout_size(2, "analog", true),
            WindowLogicalSize {
                width: 660.0,
                height: 360.0
            }
        );
        assert_eq!(
            preferred_layout_size(1, "both", false),
            WindowLogicalSize {
                width: 560.0,
                height: 320.0
            }
        );
        assert_eq!(
            preferred_layout_size(2, "both", true),
            WindowLogicalSize {
                width: 820.0,
                height: 390.0
            }
        );
    }

    #[test]
    fn legacy_physical_size_is_migrated_to_logical_pixels() {
        assert_eq!(
            normalize_saved_logical_size(960.0, 390.0, None, 1.5),
            WindowLogicalSize {
                width: 640.0,
                height: 260.0
            }
        );
        assert_eq!(
            normalize_saved_logical_size(640.0, 260.0, Some("logical"), 1.5),
            WindowLogicalSize {
                width: 640.0,
                height: 260.0
            }
        );
    }

    #[test]
    fn desired_size_is_limited_to_monitor_work_area() {
        assert_eq!(
            fit_logical_size_to_work_area(
                WindowLogicalSize {
                    width: 820.0,
                    height: 390.0
                },
                1366,
                768,
                1.25
            ),
            WindowLogicalSize {
                width: 820.0,
                height: 390.0
            }
        );
        assert_eq!(
            fit_logical_size_to_work_area(
                WindowLogicalSize {
                    width: 820.0,
                    height: 390.0
                },
                400,
                300,
                1.0
            ),
            WindowLogicalSize {
                width: 376.0,
                height: 276.0
            }
        );
    }

    #[test]
    fn fitted_position_remains_inside_negative_origin_monitor() {
        assert_eq!(
            clamp_full_window_position(
                PhysicalPosition { x: 100, y: -900 },
                640,
                260,
                PhysicalWorkArea {
                    x: -1920,
                    y: -1080,
                    width: 1920,
                    height: 1040
                }
            ),
            PhysicalPosition { x: -640, y: -900 }
        );
        assert_eq!(
            clamp_full_window_position(
                PhysicalPosition { x: -2500, y: 400 },
                640,
                260,
                PhysicalWorkArea {
                    x: -1920,
                    y: 0,
                    width: 1920,
                    height: 1040
                }
            ),
            PhysicalPosition { x: -1920, y: 400 }
        );
    }

    #[test]
    fn config_validation_accepts_normalized_data_and_rejects_bad_core_fields() {
        let valid = serde_json::json!({
            "clocks": [
                { "label": "Budapest", "tz": "Europe/Budapest" },
                { "label": "Beijing", "tz": "Asia/Shanghai" }
            ],
            "clockCount": 2,
            "mode": "digital",
            "theme": "classic",
            "surfaceStyle": "transparent",
            "timeFormat": "24",
            "showSeconds": false,
            "opacity": 0.88,
            "pomodoro": { "focusMinutes": 25, "breakMinutes": 5 }
        });
        assert!(validate_config_value(&valid, true).is_ok());

        let mut invalid_count = valid.clone();
        invalid_count["clockCount"] = serde_json::json!(3);
        assert_eq!(
            validate_config_value(&invalid_count, true).unwrap_err(),
            "config.clockCount must be 1 or 2"
        );

        let mut unknown_field = valid.clone();
        unknown_field["unexpected"] = serde_json::json!(true);
        assert_eq!(
            validate_config_value(&unknown_field, true).unwrap_err(),
            "config.unexpected is not supported"
        );

        let mut invalid_clock = valid;
        invalid_clock["clocks"][0]["tz"] = serde_json::json!("");
        assert!(validate_config_value(&invalid_clock, true)
            .unwrap_err()
            .contains("tz must be a non-empty string"));
    }

    #[test]
    fn config_file_write_replaces_content_and_cleans_backup() {
        let directory = tempfile::tempdir().expect("create temp directory");
        let path = directory.path().join("config.json");
        let first = serde_json::json!({ "clockCount": 1, "mode": "digital" });
        let second = serde_json::json!({ "clockCount": 2, "mode": "analog" });

        write_config_file(&path, &first).expect("write first config");
        write_config_file(&path, &second).expect("replace config");

        assert_eq!(read_config_file(&path).expect("read config"), Some(second));
        assert!(!config_backup_path(&path).exists());
    }

    #[test]
    fn corrupt_config_is_isolated_and_returns_corrupt_error() {
        let directory = tempfile::tempdir().expect("create temp directory");
        let path = directory.path().join("config.json");
        fs::write(&path, b"{not-json").expect("seed corrupt config");

        assert!(matches!(
            read_config_file(&path),
            Err(ConfigReadError::Corrupt(_))
        ));
        assert!(!path.exists());
        assert!(fs::read_dir(directory.path())
            .expect("list temp directory")
            .flatten()
            .any(|entry| entry
                .file_name()
                .to_string_lossy()
                .starts_with("config.corrupt-")));
    }

    #[test]
    fn main_window_bounds_contract_is_physical_and_strict() {
        let bounds = MainWindowBounds {
            width: 820,
            height: 390,
            x: -1280,
            y: 64,
        };
        assert!(validate_main_window_bounds(&bounds).is_ok());
        assert_eq!(
            serde_json::to_value(bounds).expect("serialize bounds"),
            serde_json::json!({ "width": 820, "height": 390, "x": -1280, "y": 64 })
        );
        assert!(
            serde_json::from_value::<MainWindowBounds>(serde_json::json!({
                "width": 820,
                "height": 390,
                "x": -1280,
                "y": 64,
                "scaleFactor": 1.25
            }))
            .is_err()
        );

        let invalid_width = MainWindowBounds { width: 0, ..bounds };
        assert!(validate_main_window_bounds(&invalid_width).is_err());
        let invalid_position = MainWindowBounds {
            x: 1_000_001,
            ..bounds
        };
        assert!(validate_main_window_bounds(&invalid_position).is_err());
    }

    #[test]
    fn autostart_match_requires_the_existing_current_executable() {
        let directory = tempfile::tempdir().expect("create temp directory");
        let current = directory.path().join("WorldClock.exe");
        let other = directory.path().join("OtherClock.exe");
        fs::write(&current, b"world clock").expect("seed current executable");
        fs::write(&other, b"other clock").expect("seed other executable");

        let command = format!("\"{}\"", current.display());
        assert!(autostart_command_matches_current_with(
            &command,
            &current,
            Path::exists,
            |path| fs::canonicalize(path).ok(),
        ));
        assert!(!autostart_command_matches_current_with(
            &format!("\"{}\"", other.display()),
            &current,
            Path::exists,
            |path| fs::canonicalize(path).ok(),
        ));
        assert!(!autostart_command_matches_current_with(
            &format!("\"{}\"", directory.path().join("missing.exe").display()),
            &current,
            Path::exists,
            |path| fs::canonicalize(path).ok(),
        ));
    }

    #[test]
    fn autostart_match_handles_windows_case_separators_and_canonical_aliases() {
        assert!(autostart_command_matches_current_with(
            r#""C:\Apps\WorldClock.exe""#,
            Path::new("c:/apps/WORLDCLOCK.EXE"),
            |_| true,
            |_| None,
        ));
        assert!(autostart_command_matches_current_with(
            r#""C:\Apps\WorldClock-link.exe""#,
            Path::new(r"C:\Apps\WorldClock.exe"),
            |_| true,
            |path| {
                if path
                    .to_string_lossy()
                    .to_ascii_lowercase()
                    .contains("worldclock-link.exe")
                {
                    Some(PathBuf::from(r"\\?\C:\Apps\WorldClock.exe"))
                } else {
                    Some(path.to_path_buf())
                }
            },
        ));
        assert!(!autostart_command_matches_current_with(
            r#""C:\Apps\WorldClock.exe" --hidden"#,
            Path::new(r"C:\Apps\WorldClock.exe"),
            |_| true,
            |_| None,
        ));
    }
}
