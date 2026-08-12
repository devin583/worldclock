use tauri::{
    image::Image,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};

type TrayCheckItem = CheckMenuItem<tauri::Wry>;

pub struct TrayPreferences {
    pub locked: bool,
    pub on_top: bool,
    pub theme: String,
}

pub struct TrayMenuState {
    lock: TrayCheckItem,
    theme_classic: TrayCheckItem,
    theme_minimal: TrayCheckItem,
    theme_cute: TrayCheckItem,
    theme_glass: TrayCheckItem,
    ontop: TrayCheckItem,
}

impl TrayMenuState {
    fn new(
        lock: TrayCheckItem,
        theme_classic: TrayCheckItem,
        theme_minimal: TrayCheckItem,
        theme_cute: TrayCheckItem,
        theme_glass: TrayCheckItem,
        ontop: TrayCheckItem,
    ) -> Self {
        Self {
            lock,
            theme_classic,
            theme_minimal,
            theme_cute,
            theme_glass,
            ontop,
        }
    }
}

fn normalize_theme(theme: &str) -> &str {
    match theme {
        "minimal-glass" | "glass-pet" => "glass",
        "mechanical" | "flip" | "dark" => "classic",
        "soft-companion" | "moon-cat" => "cute",
        "boundless" | "light" => "minimal",
        "classic" | "minimal" | "cute" | "glass" => theme,
        _ => "classic",
    }
}

pub fn setup_tray(app: &AppHandle, preferences: TrayPreferences) -> tauri::Result<()> {
    let show_hide = MenuItem::with_id(app, "show_hide", "显示 / 隐藏", true, None::<&str>)?;
    let reset_position =
        MenuItem::with_id(app, "reset_position", "重置窗口位置", true, None::<&str>)?;
    let open_settings = MenuItem::with_id(app, "open_settings", "打开设置", true, None::<&str>)?;
    let lock = CheckMenuItem::with_id(
        app,
        "lock",
        "锁定位置",
        true,
        preferences.locked,
        None::<&str>,
    )?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let initial_theme = normalize_theme(&preferences.theme);
    let theme_classic = CheckMenuItem::with_id(
        app,
        "theme_classic",
        "Classic 经典黑",
        true,
        initial_theme == "classic",
        None::<&str>,
    )?;
    let theme_minimal = CheckMenuItem::with_id(
        app,
        "theme_minimal",
        "Minimal 浅色",
        true,
        initial_theme == "minimal",
        None::<&str>,
    )?;
    let theme_cute = CheckMenuItem::with_id(
        app,
        "theme_cute",
        "Cute 暖色",
        true,
        initial_theme == "cute",
        None::<&str>,
    )?;
    let theme_glass = CheckMenuItem::with_id(
        app,
        "theme_glass",
        "Glass 玻璃",
        true,
        initial_theme == "glass",
        None::<&str>,
    )?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let ontop = CheckMenuItem::with_id(
        app,
        "toggle_ontop",
        "始终置顶",
        true,
        preferences.on_top,
        None::<&str>,
    )?;
    let sep3 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出 WorldClock", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &show_hide,
            &reset_position,
            &open_settings,
            &lock,
            &sep1,
            &theme_classic,
            &theme_minimal,
            &theme_cute,
            &theme_glass,
            &sep2,
            &ontop,
            &sep3,
            &quit,
        ],
    )?;

    let icon = Image::from_bytes(include_bytes!("../icons/tray.png"))?;

    let lock_item = lock.clone();
    let ontop_item = ontop.clone();

    app.manage(TrayMenuState::new(
        lock.clone(),
        theme_classic.clone(),
        theme_minimal.clone(),
        theme_cute.clone(),
        theme_glass.clone(),
        ontop.clone(),
    ));

    TrayIconBuilder::new()
        .icon(icon)
        .icon_as_template(true)
        .menu(&menu)
        .tooltip("WorldClock")
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "show_hide" => {
                if let Err(error) = toggle_window(app) {
                    crate::log_startup(&format!("tray show/hide failed: {error}"));
                }
            }
            "reset_position" => {
                if let Err(error) = crate::reset_main_window_position(app) {
                    crate::log_startup(&format!("tray reset position failed: {error}"));
                }
            }
            "open_settings" => {
                if let Err(error) = crate::open_settings_window(app) {
                    crate::log_startup(&format!("tray open settings failed: {error}"));
                }
            }
            "lock" => match lock_item.is_checked() {
                Ok(checked) => {
                    if let Err(error) = app.emit("tray-set-lock", checked) {
                        crate::log_startup(&format!("tray lock event failed: {error}"));
                    }
                }
                Err(error) => {
                    crate::log_startup(&format!("read tray lock state failed: {error}"));
                }
            },
            "theme_classic" => log_theme_result(set_theme_from_tray(app, "classic")),
            "theme_minimal" => log_theme_result(set_theme_from_tray(app, "minimal")),
            "theme_cute" => log_theme_result(set_theme_from_tray(app, "cute")),
            "theme_glass" => log_theme_result(set_theme_from_tray(app, "glass")),
            "toggle_ontop" => {
                let checked = match ontop_item.is_checked() {
                    Ok(checked) => checked,
                    Err(error) => {
                        crate::log_startup(&format!("read tray on-top state failed: {error}"));
                        return;
                    }
                };
                if let Some(win) = app.get_webview_window("main") {
                    if let Err(error) = win.set_always_on_top(checked) {
                        crate::log_startup(&format!("tray set main on-top failed: {error}"));
                    }
                }
                if let Some(win) = app.get_webview_window("settings") {
                    if let Err(error) = win.set_always_on_top(checked) {
                        crate::log_startup(&format!("tray set settings on-top failed: {error}"));
                    }
                }
                if let Err(error) = app.emit("tray-set-ontop", checked) {
                    crate::log_startup(&format!("tray on-top event failed: {error}"));
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Err(error) = toggle_window(tray.app_handle()) {
                    crate::log_startup(&format!("tray click show/hide failed: {error}"));
                }
            }
        })
        .build(app)?;

    Ok(())
}

pub fn set_lock_checked(app: &AppHandle, checked: bool) -> Result<(), String> {
    if let Some(state) = app.try_state::<TrayMenuState>() {
        state
            .lock
            .set_checked(checked)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn set_theme_checked(app: &AppHandle, theme: &str) -> Result<(), String> {
    if let Some(state) = app.try_state::<TrayMenuState>() {
        let theme = normalize_theme(theme);
        state
            .theme_classic
            .set_checked(theme == "classic")
            .map_err(|error| error.to_string())?;
        state
            .theme_minimal
            .set_checked(theme == "minimal")
            .map_err(|error| error.to_string())?;
        state
            .theme_cute
            .set_checked(theme == "cute")
            .map_err(|error| error.to_string())?;
        state
            .theme_glass
            .set_checked(theme == "glass")
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn set_ontop_checked(app: &AppHandle, checked: bool) -> Result<(), String> {
    if let Some(state) = app.try_state::<TrayMenuState>() {
        state
            .ontop
            .set_checked(checked)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn toggle_window(app: &AppHandle) -> Result<(), String> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    if win.is_visible().map_err(|error| error.to_string())? {
        win.hide().map_err(|error| error.to_string())?;
    } else {
        win.show().map_err(|error| error.to_string())?;
        win.unminimize().map_err(|error| error.to_string())?;
        win.set_focus().map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn set_theme_from_tray(app: &AppHandle, theme: &str) -> Result<(), String> {
    set_theme_checked(app, theme)?;
    app.emit("tray-set-theme", theme)
        .map_err(|error| error.to_string())
}

fn log_theme_result(result: Result<(), String>) {
    if let Err(error) = result {
        crate::log_startup(&format!("tray theme update failed: {error}"));
    }
}
