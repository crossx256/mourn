// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Must run before Tauri creates WebView2/WebKitGTK. Hardware mode remains
    // the default and delegates GPU selection to the OS and driver.
    mourn_desktop_lib::apply_graphics_preference();

    // IMPORTANT: the real app entry point lives in lib.rs (`run()`), which
    // registers every plugin, Tauri command, the system tray, the watcher DB,
    // close-to-tray handling, and the window show-fallback. We MUST call it
    // here on every platform. A prior "linux optimization" replaced this with
    // a bare `tauri::Builder::default()` stub, which bypassed the entire real
    // app — window never showed (process sat in task manager) and commands
    // were "not found" in prod.
    mourn_desktop_lib::run();
}
