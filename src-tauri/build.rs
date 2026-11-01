fn main() {
    println!("cargo:rerun-if-changed=capabilities/default.json");
    println!("cargo:rerun-if-changed=capabilities/tray.json");
    // Application handlers are not scoped by a window capability unless they
    // participate in the application ACL. Do not omit new handlers here.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "send_to_ghost_engine",
            "get_system_status",
            "set_hardware_acceleration_preference",
            "get_desktop_timezone",
            "secure_store_upsert",
            "secure_store_get",
            "secure_store_list",
            "secure_store_remove",
            "offline_vault_get_key",
            "offline_vault_set_key",
            "set_stay_minimized",
            "tray_open",
            "tray_navigate",
            "tray_dismiss",
            "tray_exit",
            "vault_key_set",
            "vault_key_get",
            "vault_key_remove",
            "start_discord_rpc",
            "stop_discord_rpc",
            "install_linux_deb_update",
            "prepare_linux_deb_update",
            "notify_link_expiry",
            "clear_link_expiry_notifications",
            "watcher_insert_log",
            "watcher_get_logs",
            "watcher_clear_logs",
            "establish_secure_link",
            "anchor_link",
            "get_link_expiry",
            "set_badge_count",
        ]),
    ))
    .expect("failed to build application ACL");
}
