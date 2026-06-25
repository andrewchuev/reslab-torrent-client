use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::engine::TorrentManager;
use crate::error::{AppError, Result};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub download_path: String,
    /// bytes/sec, 0 = unlimited
    pub max_download_speed: u64,
    /// bytes/sec, 0 = unlimited
    pub max_upload_speed: u64,
    pub max_active_torrents: u32,
    pub start_minimized: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            download_path: default_download_path(),
            max_download_speed: 0,
            max_upload_speed: 0,
            max_active_torrents: 5,
            start_minimized: false,
        }
    }
}

fn default_download_path() -> String {
    dirs_next::download_dir()
        .or_else(|| dirs_next::home_dir().map(|h| h.join("Downloads")))
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .to_string_lossy()
        .to_string()
}

fn config_path() -> anyhow::Result<PathBuf> {
    let dir = dirs_next::config_dir()
        .ok_or_else(|| anyhow::anyhow!("Cannot find config directory"))?
        .join("reslab-torrent-client");
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join("settings.toml"))
}

pub fn load_settings() -> AppSettings {
    (|| -> anyhow::Result<AppSettings> {
        let path = config_path()?;
        let content = std::fs::read_to_string(path)?;
        Ok(toml::from_str(&content)?)
    })()
    .unwrap_or_default()
}

#[tauri::command]
pub fn get_settings() -> Result<AppSettings> {
    Ok(load_settings())
}

#[tauri::command]
pub fn save_settings(settings: AppSettings, manager: State<TorrentManager>) -> Result<()> {
    // Persist to disk
    let path = config_path().map_err(AppError::Other)?;
    let content = toml::to_string_pretty(&settings).map_err(|e| AppError::Other(e.into()))?;
    std::fs::write(&path, content).map_err(AppError::Io)?;

    // Apply download path to the running engine immediately
    manager.set_download_dir(PathBuf::from(&settings.download_path));

    Ok(())
}
