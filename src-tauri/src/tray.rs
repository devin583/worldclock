use tauri::{
    AppHandle, Emitter, Manager,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let show_hide   = MenuItem::with_id(app, "show_hide",    "显示 / 隐藏",     true, None::<&str>)?;
    let lock        = MenuItem::with_id(app, "lock",         "🔒 锁定 / 解锁",   true, None::<&str>)?;
    let sep1        = PredefinedMenuItem::separator(app)?;
    let light_mode  = MenuItem::with_id(app, "theme_light",  "☀ 浅色模式",      true, None::<&str>)?;
    let dark_mode   = MenuItem::with_id(app, "theme_dark",   "🌙 深色模式",      true, None::<&str>)?;
    let sep2        = PredefinedMenuItem::separator(app)?;
    let ontop       = MenuItem::with_id(app, "toggle_ontop", "始终置顶 / 取消",  true, None::<&str>)?;
    let sep3        = PredefinedMenuItem::separator(app)?;
    let quit        = MenuItem::with_id(app, "quit",         "退出 WorldClock",  true, None::<&str>)?;

    let menu = Menu::with_items(app, &[
        &show_hide, &lock, &sep1,
        &light_mode, &dark_mode, &sep2,
        &ontop, &sep3, &quit,
    ])?;

    let Some(icon) = app.default_window_icon() else {
        eprintln!("tray setup skipped: default window icon is unavailable");
        return Ok(());
    };

    TrayIconBuilder::new()
        .icon(icon.clone())
        .menu(&menu)
        .tooltip("WorldClock")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show_hide"   => toggle_window(app),
            "lock"        => { let _ = app.emit("tray-toggle-lock", ()); }
            "theme_light" => { let _ = app.emit("tray-set-theme", "light"); }
            "theme_dark"  => { let _ = app.emit("tray-set-theme", "dark"); }
            "toggle_ontop"=> { let _ = app.emit("tray-toggle-ontop", ()); }
            "quit"        => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event {
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
