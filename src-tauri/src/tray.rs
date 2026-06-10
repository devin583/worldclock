use tauri::{
    image::Image,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};

type TrayCheckItem = CheckMenuItem<tauri::Wry>;

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

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let show_hide = MenuItem::with_id(app, "show_hide", "显示 / 隐藏", true, None::<&str>)?;
    let reset_position =
        MenuItem::with_id(app, "reset_position", "重置窗口位置", true, None::<&str>)?;
    let open_settings = MenuItem::with_id(app, "open_settings", "打开设置", true, None::<&str>)?;
    let lock = CheckMenuItem::with_id(app, "lock", "锁定位置", true, false, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let theme_classic = CheckMenuItem::with_id(
        app,
        "theme_classic",
        "Classic 经典黑",
        true,
        true,
        None::<&str>,
    )?;
    let theme_minimal = CheckMenuItem::with_id(
        app,
        "theme_minimal",
        "Minimal 浅色",
        true,
        false,
        None::<&str>,
    )?;
    let theme_cute =
        CheckMenuItem::with_id(app, "theme_cute", "Cute 暖色", true, false, None::<&str>)?;
    let theme_glass =
        CheckMenuItem::with_id(app, "theme_glass", "Glass 玻璃", true, false, None::<&str>)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let ontop = CheckMenuItem::with_id(app, "toggle_ontop", "始终置顶", true, true, None::<&str>)?;
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
            "show_hide" => toggle_window(app),
            "reset_position" => crate::reset_main_window_position(app),
            "open_settings" => {
                let _ = crate::open_settings_window(app);
            }
            "lock" => {
                let checked = lock_item.is_checked().unwrap_or(false);
                let _ = app.emit("tray-set-lock", checked);
            }
            "theme_classic" => set_theme_from_tray(app, "classic"),
            "theme_minimal" => set_theme_from_tray(app, "minimal"),
            "theme_cute" => set_theme_from_tray(app, "cute"),
            "theme_glass" => set_theme_from_tray(app, "glass"),
            "toggle_ontop" => {
                let checked = ontop_item.is_checked().unwrap_or(true);
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.set_always_on_top(checked);
                }
                if let Some(win) = app.get_webview_window("settings") {
                    let _ = win.set_always_on_top(checked);
                }
                let _ = app.emit("tray-set-ontop", checked);
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
                toggle_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

pub fn set_lock_checked(app: &AppHandle, checked: bool) {
    if let Some(state) = app.try_state::<TrayMenuState>() {
        let _ = state.lock.set_checked(checked);
    }
}

pub fn set_theme_checked(app: &AppHandle, theme: &str) {
    if let Some(state) = app.try_state::<TrayMenuState>() {
        let theme = normalize_theme(theme);
        let _ = state.theme_classic.set_checked(theme == "classic");
        let _ = state.theme_minimal.set_checked(theme == "minimal");
        let _ = state.theme_cute.set_checked(theme == "cute");
        let _ = state.theme_glass.set_checked(theme == "glass");
    }
}

pub fn set_ontop_checked(app: &AppHandle, checked: bool) {
    if let Some(state) = app.try_state::<TrayMenuState>() {
        let _ = state.ontop.set_checked(checked);
    }
}

fn toggle_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
            let _ = win.show();
            let _ = win.set_focus();
        }
    }
}

fn set_theme_from_tray(app: &AppHandle, theme: &str) {
    set_theme_checked(app, theme);
    let _ = app.emit("tray-set-theme", theme);
}
