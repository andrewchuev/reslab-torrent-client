use tauri::State;

use crate::engine::{manager::{TorrentDetails, TorrentInfo}, TorrentManager};
use crate::error::Result;

#[tauri::command]
pub async fn get_torrents(manager: State<'_, TorrentManager>) -> Result<Vec<TorrentInfo>> {
    Ok(manager.get_all())
}

#[tauri::command]
pub async fn add_torrent_magnet(
    magnet: String,
    manager: State<'_, TorrentManager>,
) -> Result<TorrentInfo> {
    manager.add_magnet(&magnet).await
}

#[tauri::command]
pub async fn pause_torrent(id: String, manager: State<'_, TorrentManager>) -> Result<()> {
    manager.pause(&id).await
}

#[tauri::command]
pub async fn resume_torrent(id: String, manager: State<'_, TorrentManager>) -> Result<()> {
    manager.resume(&id).await
}

#[tauri::command]
pub async fn remove_torrent(id: String, manager: State<'_, TorrentManager>) -> Result<()> {
    manager.remove(&id, false).await
}

#[tauri::command]
pub async fn remove_torrent_with_data(id: String, manager: State<'_, TorrentManager>) -> Result<()> {
    manager.remove(&id, true).await
}

#[tauri::command]
pub async fn add_torrent_file(
    path: String,
    manager: State<'_, TorrentManager>,
) -> Result<TorrentInfo> {
    manager.add_torrent_file(&path).await
}

#[tauri::command]
pub fn get_torrent_details(id: String, manager: State<'_, TorrentManager>) -> Result<TorrentDetails> {
    manager.get_details(&id)
}
