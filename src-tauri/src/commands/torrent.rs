use tauri::State;

use crate::engine::{
    manager::{TorrentDetails, TorrentInfo, TorrentListing},
    TorrentManager,
};
use crate::error::Result;

#[tauri::command]
pub async fn get_torrents(manager: State<'_, TorrentManager>) -> Result<Vec<TorrentInfo>> {
    Ok(manager.get_all())
}

#[tauri::command]
pub async fn list_torrent_magnet(
    magnet: String,
    manager: State<'_, TorrentManager>,
) -> Result<TorrentListing> {
    manager.list_magnet(&magnet).await
}

#[tauri::command]
pub async fn list_torrent_file(
    path: String,
    manager: State<'_, TorrentManager>,
) -> Result<TorrentListing> {
    manager.list_torrent_file(&path).await
}

#[tauri::command]
pub async fn confirm_add_torrent(
    info_hash: String,
    file_indices: Option<Vec<usize>>,
    manager: State<'_, TorrentManager>,
) -> Result<TorrentInfo> {
    manager.confirm_add(&info_hash, file_indices).await
}

#[tauri::command]
pub fn cancel_torrent_listing(info_hash: String, manager: State<'_, TorrentManager>) {
    manager.cancel_listing(&info_hash);
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
pub async fn remove_torrent_with_data(
    id: String,
    manager: State<'_, TorrentManager>,
) -> Result<()> {
    manager.remove(&id, true).await
}

#[tauri::command]
pub fn get_torrent_details(
    id: String,
    manager: State<'_, TorrentManager>,
) -> Result<TorrentDetails> {
    manager.get_details(&id)
}
