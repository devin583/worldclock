use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let show_hide = MenuItem::with_id(app, "show_hide", "显示 / 隐藏", true, None::<&str>)?;
    let lock = CheckMenuItem::with_id(app, "lock", "锁定位置", true, false, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let light_mode =
        CheckMenuItem::with_id(app, "theme_light", "浅色模式", true, false, None::<&str>)?;
    let dark_mode =
        CheckMenuItem::with_id(app, "theme_dark", "深色模式", true, true, None::<&str>)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let ontop = CheckMenuItem::with_id(app, "toggle_ontop", "始终置顶", true, true, None::<&str>)?;
    let sep3 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出 WorldClock", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &show_hide,
            &lock,
            &sep1,
            &light_mode,
            &dark_mode,
            &sep2,
            &ontop,
            &sep3,
            &quit,
        ],
    )?;

    let Some(icon) = app.default_window_icon() else {
        eprintln!("tray setup skipped: default window icon is unavailable");
        return Ok(());
    };

    let lock_item = lock.clone();
    let light_item = light_mode.clone();
    let dark_item = dark_mode.clone();
    let ontop_item = ontop.clone();

    TrayIconBuilder::new()
        .icon(icon.clone())
        .menu(&menu)
        .tooltip("WorldClock")
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "show_hide" => toggle_window(app),
            "lock" => {
                let checked = lock_item.is_checked().unwrap_or(false);
                let _ = app.emit("tray-set-lock", checked);
            }
            "theme_light" => {
                let _ = light_item.set_checked(true);
                let _ = dark_item.set_checked(false);
                let _ = app.emit("tray-set-theme", "light");
            }
            "theme_dark" => {
                let _ = light_item.set_checked(false);
                let _ = dark_item.set_checked(true);
                let _ = app.emit("tray-set-theme", "dark");
            }
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
