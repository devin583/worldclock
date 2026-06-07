use tauri::{
    image::Image,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};

type TrayCheckItem = CheckMenuItem<tauri::Wry>;

pub struct TrayMenuState {
    lock: TrayCheckItem,
    theme_minimal_glass: TrayCheckItem,
    theme_mechanical: TrayCheckItem,
    theme_soft_companion: TrayCheckItem,
    theme_flip: TrayCheckItem,
    ontop: TrayCheckItem,
}

impl TrayMenuState {
    fn new(
        lock: TrayCheckItem,
        theme_minimal_glass: TrayCheckItem,
        theme_mechanical: TrayCheckItem,
        theme_soft_companion: TrayCheckItem,
        theme_flip: TrayCheckItem,
        ontop: TrayCheckItem,
    ) -> Self {
        Self {
            lock,
            theme_minimal_glass,
            theme_mechanical,
            theme_soft_companion,
            theme_flip,
            ontop,
        }
    }
}

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let show_hide = MenuItem::with_id(app, "show_hide", "显示 / 隐藏", true, None::<&str>)?;
    let reset_position =
        MenuItem::with_id(app, "reset_position", "重置窗口位置", true, None::<&str>)?;
    let lock = CheckMenuItem::with_id(app, "lock", "锁定位置", true, false, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let theme_minimal_glass = CheckMenuItem::with_id(
        app,
        "theme_minimal_glass",
        "Minimal Glass",
        true,
        true,
        None::<&str>,
    )?;
    let theme_mechanical = CheckMenuItem::with_id(
        app,
        "theme_mechanical",
        "Mechanical",
        true,
        false,
        None::<&str>,
    )?;
    let theme_soft_companion = CheckMenuItem::with_id(
        app,
        "theme_soft_companion",
        "Soft Companion",
        true,
        false,
        None::<&str>,
    )?;
    let theme_flip =
        CheckMenuItem::with_id(app, "theme_flip", "Flip Clock", true, false, None::<&str>)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let ontop = CheckMenuItem::with_id(app, "toggle_ontop", "始终置顶", true, true, None::<&str>)?;
    let sep3 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出 WorldClock", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &show_hide,
            &reset_position,
            &lock,
            &sep1,
            &theme_minimal_glass,
            &theme_mechanical,
            &theme_soft_companion,
            &theme_flip,
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
        theme_minimal_glass.clone(),
        theme_mechanical.clone(),
        theme_soft_companion.clone(),
        theme_flip.clone(),
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
            "lock" => {
                let checked = lock_item.is_checked().unwrap_or(false);
                let _ = app.emit("tray-set-lock", checked);
            }
            "theme_minimal_glass" => set_theme_from_tray(app, "minimal-glass"),
            "theme_mechanical" => set_theme_from_tray(app, "mechanical"),
            "theme_soft_companion" => set_theme_from_tray(app, "soft-companion"),
            "theme_flip" => set_theme_from_tray(app, "flip"),
            "toggle_ontop" => {
                let checked = ontop_item.is_checked().unwrap_or(true);
                if let Some(win) = app.get_webview_window("main") {
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
        let _ = state
            .theme_minimal_glass
            .set_checked(theme == "minimal-glass");
        let _ = state.theme_mechanical.set_checked(theme == "mechanical");
        let _ = state
            .theme_soft_companion
            .set_checked(theme == "soft-companion");
        let _ = state.theme_flip.set_checked(theme == "flip");
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
