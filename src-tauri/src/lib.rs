pub mod commands;
pub mod db;
pub mod engine;
pub mod error;
pub mod webui;

use std::collections::HashSet;

use engine::{TorrentManager, TorrentState};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
use tracing::info;

pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "reslab_torrent_client_lib=debug,librqbit=info".into()),
        )
        .init();

    // Load persisted settings so TorrentManager starts with the correct download dir
    let settings = commands::settings::load_settings();
    let download_dir = std::path::PathBuf::from(&settings.download_path);
    let start_minimized = settings.start_minimized;

    // Initialize TorrentManager on the Tauri async runtime so that the librqbit
    // session's internal tasks share the same runtime for the lifetime of the app.
    let manager = tauri::async_runtime::block_on(TorrentManager::new(download_dir))
        .expect("Failed to initialize torrent engine");

    // Collect any .torrent path passed on the command line at startup
    let startup_torrent: Option<String> = std::env::args()
        .skip(1)
        .find(|a| a.to_lowercase().ends_with(".torrent"));

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        // Single-instance: when the app is already running and the user opens a
        // .torrent file, the OS launches a second process.  The plugin kills that
        // second process and fires this callback in the *first* instance instead.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
            if let Some(path) = argv.iter().skip(1).find(|a| a.to_lowercase().ends_with(".torrent")) {
                let _ = app.emit("open-torrent-file", path);
            }
        }))
        .manage(manager)
        .setup(move |app| {
            info!("Starting Torrent Client v{}", app.package_info().version);

            // ── System tray ──────────────────────────────────────────────
            let show_item = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("Torrent Client")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::DoubleClick { button: MouseButton::Left, .. } = event {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            if w.is_visible().unwrap_or(false) {
                                let _ = w.hide();
                            } else {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            // ── Hide to tray on close ─────────────────────────────────────
            let main_window = app
                .get_webview_window("main")
                .ok_or("main window not found")?;
            let win_clone = main_window.clone();
            main_window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = win_clone.hide();
                }
            });

            // When a .torrent file is being opened at launch, keep the window
            // visible so the user sees the "already in list" notice if needed.
            if start_minimized && startup_torrent.is_none() {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }

            // ── Open .torrent passed at launch (file-association / argv) ──
            if let Some(path) = startup_torrent {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    // Give the frontend time to mount and start listening
                    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                    let _ = app_handle.emit("open-torrent-file", path);
                });
            }

            // ── Background stats + download-complete notifications ─────────
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut interval =
                    tokio::time::interval(std::time::Duration::from_secs(1));
                // Track which torrent IDs are already known to be seeding so we
                // only fire the notification on the first transition.
                let mut seeding_ids: HashSet<String> = HashSet::new();

                loop {
                    interval.tick().await;
                    let manager = app_handle.state::<TorrentManager>();
                    let all = manager.get_all();

                    if !all.is_empty() {
                        let _ = app_handle.emit("torrent-stats", &all);
                    }

                    // Detect new completions
                    for info in &all {
                        if matches!(info.state, TorrentState::Seeding { .. }) {
                            if seeding_ids.insert(info.id.clone()) {
                                // First time we see this torrent seeding
                                let _ = app_handle
                                    .notification()
                                    .builder()
                                    .title("Download Complete")
                                    .body(&info.name)
                                    .show();
                            }
                        } else {
                            // If torrent is removed/re-added it can transition again
                            seeding_ids.remove(&info.id);
                        }
                    }
                    // Forget IDs of removed torrents
                    let current_ids: HashSet<&str> =
                        all.iter().map(|i| i.id.as_str()).collect();
                    seeding_ids.retain(|id| current_ids.contains(id.as_str()));
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::torrent::get_torrents,
            commands::torrent::add_torrent_magnet,
            commands::torrent::pause_torrent,
            commands::torrent::resume_torrent,
            commands::torrent::remove_torrent,
            commands::torrent::remove_torrent_with_data,
            commands::torrent::add_torrent_file,
            commands::torrent::get_torrent_details,
            commands::settings::get_settings,
            commands::settings::save_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
