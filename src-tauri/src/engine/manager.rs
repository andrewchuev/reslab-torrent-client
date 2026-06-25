use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use librqbit::{
    AddTorrent, AddTorrentOptions, AddTorrentResponse, Api, ManagedTorrent, Session,
    SessionOptions, SessionPersistenceConfig, TorrentStatsState,
};
use serde::{Deserialize, Serialize};
use tracing::info;

use crate::error::{AppError, Result};

type ManagedTorrentHandle = Arc<ManagedTorrent>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TorrentState {
    Initializing,
    Downloading { progress: f32, speed_down: u64, speed_up: u64 },
    Seeding { speed_up: u64, ratio: f32 },
    Paused,
    Error { reason: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TorrentInfo {
    pub id: String,
    pub name: String,
    pub info_hash: String,
    pub size_bytes: u64,
    pub downloaded_bytes: u64,
    pub uploaded_bytes: u64,
    pub state: TorrentState,
    pub save_path: String,
    pub added_at: i64,
    pub peers_connected: u32,
    /// Per-file downloaded bytes, indexed same as the files list from get_torrent_details.
    pub file_progress: Vec<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileInfo {
    pub name: String,
    pub size: u64,
    pub included: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerInfo {
    pub addr: String,
    pub state: String,
    pub downloaded_bytes: u64,
    pub uploaded_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TorrentDetails {
    pub files: Vec<FileInfo>,
    pub peers: Vec<PeerInfo>,
}

fn build_info(info_hash: &str, handle: &ManagedTorrentHandle, save_path: &str, added_at: i64) -> TorrentInfo {
    let stats = handle.stats();
    let file_progress = stats.file_progress.clone();
    let name = handle
        .name()
        .unwrap_or_else(|| format!("Torrent {}", info_hash.get(..8).unwrap_or(info_hash)));

    let state = match stats.state {
        // Paused must be checked before finished: a seeding torrent keeps
        // stats.finished == true even after being paused.
        TorrentStatsState::Paused => TorrentState::Paused,
        TorrentStatsState::Error => TorrentState::Error {
            reason: stats.error.unwrap_or_else(|| "Unknown error".into()),
        },
        _ if stats.finished => {
            let speed_up = stats.live.as_ref().map(|l| l.upload_speed.as_bytes()).unwrap_or(0);
            let ratio = if stats.total_bytes > 0 {
                stats.uploaded_bytes as f32 / stats.total_bytes as f32
            } else {
                0.0
            };
            TorrentState::Seeding { speed_up, ratio }
        }
        TorrentStatsState::Initializing => TorrentState::Initializing,
        TorrentStatsState::Live => {
            let speed_down =
                stats.live.as_ref().map(|l| l.download_speed.as_bytes()).unwrap_or(0);
            let speed_up =
                stats.live.as_ref().map(|l| l.upload_speed.as_bytes()).unwrap_or(0);
            let progress = if stats.total_bytes > 0 {
                stats.progress_bytes as f32 / stats.total_bytes as f32
            } else {
                0.0
            };
            TorrentState::Downloading { progress, speed_down, speed_up }
        }
    };

    TorrentInfo {
        id: info_hash.to_string(),
        name,
        info_hash: info_hash.to_string(),
        size_bytes: stats.total_bytes,
        downloaded_bytes: stats.progress_bytes,
        uploaded_bytes: stats.uploaded_bytes,
        state,
        save_path: save_path.to_string(),
        added_at,
        peers_connected: 0,
        file_progress,
    }
}

struct TorrentEntry {
    handle: ManagedTorrentHandle,
    save_path: String,
    /// Internal librqbit ID (usize), needed for Api calls.
    torrent_id: usize,
    /// Unix timestamp when the torrent was first added; set once and never updated.
    added_at: i64,
}

pub struct TorrentManager {
    session: Arc<Session>,
    /// Cached Api handle — avoids cloning the session on every call.
    api: Api,
    /// Keyed by info_hash string, which is stable across restarts.
    torrents: Arc<RwLock<HashMap<String, TorrentEntry>>>,
    download_dir: RwLock<PathBuf>,
    /// The directory the librqbit Session was created with. We pass output_folder=None
    /// when the current download_dir matches this, so librqbit auto-creates subfolders
    /// for multi-file torrents (e.g. Downloads/TorrentName/). If the user changed the
    /// download dir in Settings, we fall back to an explicit path (no auto-subfolder).
    initial_download_dir: PathBuf,
}

impl TorrentManager {
    pub async fn new(download_dir: PathBuf) -> anyhow::Result<Self> {
        let session = Session::new_with_opts(
            download_dir.clone(),
            SessionOptions {
                persistence: Some(SessionPersistenceConfig::Json { folder: None }),
                ..Default::default()
            },
        )
        .await?;
        info!("librqbit session started, download dir: {}", download_dir.display());

        let api = Api::new(session.clone(), None);

        // Collect (id, handle) while holding the session lock, then release it
        // before calling api_torrent_details (which also needs the lock).
        let restored: Vec<(usize, ManagedTorrentHandle)> = session.with_torrents(|iter| {
            iter.map(|(id, h)| (id, h.clone())).collect()
        });

        let now = chrono::Utc::now().timestamp();
        let torrents: HashMap<String, TorrentEntry> = restored
            .into_iter()
            .map(|(id, handle)| {
                let info_hash = handle.info_hash().as_string();
                let save_path = api
                    .api_torrent_details(librqbit::api::TorrentIdOrHash::Id(id))
                    .map(|d| d.output_folder)
                    .unwrap_or_else(|_| download_dir.to_string_lossy().into_owned());
                (info_hash, TorrentEntry { handle, save_path, torrent_id: id, added_at: now })
            })
            .collect();

        if !torrents.is_empty() {
            info!("Restored {} torrent(s) from previous session", torrents.len());
        }

        Ok(Self {
            session,
            api,
            torrents: Arc::new(RwLock::new(torrents)),
            initial_download_dir: download_dir.clone(),
            download_dir: RwLock::new(download_dir),
        })
    }

    pub fn get_all(&self) -> Vec<TorrentInfo> {
        self.torrents
            .read()
            .expect("torrents lock poisoned")
            .iter()
            .map(|(info_hash, entry)| {
                build_info(info_hash, &entry.handle, &entry.save_path, entry.added_at)
            })
            .collect()
    }

    pub fn set_download_dir(&self, path: PathBuf) {
        *self.download_dir.write().expect("download_dir lock poisoned") = path;
    }

    pub fn get_details(&self, id: &str) -> Result<TorrentDetails> {
        let guard = self.torrents.read().expect("torrents lock poisoned");
        let entry = guard
            .get(id)
            .ok_or_else(|| AppError::TorrentNotFound(id.to_string()))?;

        let handle = entry.handle.clone();
        let torrent_id = entry.torrent_id;
        drop(guard);

        let files = self.api
            .api_torrent_details(librqbit::api::TorrentIdOrHash::Id(torrent_id))
            .map_err(|e| AppError::Other(anyhow::anyhow!("{e}")))?
            .files
            .unwrap_or_default()
            .into_iter()
            .map(|f| FileInfo { name: f.name, size: f.length, included: f.included })
            .collect::<Vec<_>>();

        // Peers via live state (empty if torrent is paused/initializing)
        let peers = handle
            .live()
            .map(|live| {
                live.per_peer_stats_snapshot(Default::default())
                    .peers
                    .into_iter()
                    .map(|(addr, p)| PeerInfo {
                        addr,
                        state: p.state.to_string(),
                        downloaded_bytes: p.counters.fetched_bytes,
                        uploaded_bytes: p.counters.uploaded_bytes,
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        Ok(TorrentDetails { files, peers })
    }

    async fn add_inner(&self, source: AddTorrent<'_>) -> Result<TorrentInfo> {
        let current_dir = self.download_dir.read().expect("download_dir lock poisoned").clone();

        // When current_dir matches the session's initial dir, pass output_folder=None so
        // librqbit auto-creates a named subfolder for multi-file torrents (e.g.
        // Downloads/TorrentName/). When the user changed the dir in Settings we must pass
        // it explicitly — no auto-subfolder in that case, which is an accepted limitation.
        let output_folder = if current_dir != self.initial_download_dir {
            Some(current_dir.to_string_lossy().to_string())
        } else {
            None
        };

        let opts = AddTorrentOptions {
            output_folder,
            overwrite: true,
            ..Default::default()
        };

        let response = self
            .session
            .add_torrent(source, Some(opts))
            .await
            .map_err(AppError::Other)?;

        let (torrent_id, handle) = match response {
            AddTorrentResponse::Added(id, h) => (id, h),
            AddTorrentResponse::AlreadyManaged(_id, h) => {
                // Return the existing entry so the frontend can select it without
                // creating a duplicate row.
                let info_hash = h.info_hash().as_string();
                let guard = self.torrents.read().expect("torrents lock poisoned");
                if let Some(entry) = guard.get(&info_hash) {
                    return Ok(build_info(&info_hash, &h, &entry.save_path, entry.added_at));
                }
                // Not in our map yet (can happen during startup restore); fall through.
                drop(guard);
                let torrent_id = h.id();
                (torrent_id, h)
            }
            AddTorrentResponse::ListOnly(_) => {
                return Err(AppError::Other(anyhow::anyhow!("Torrent is list-only")))
            }
        };

        // Read back the actual save path — for multi-file torrents this includes the
        // auto-generated subfolder (e.g. "D:\Downloads\Acronis Disk Director 12.5.0.163").
        let save_path = self.api
            .api_torrent_details(librqbit::api::TorrentIdOrHash::Id(torrent_id))
            .map(|d| d.output_folder)
            .unwrap_or_else(|_| current_dir.to_string_lossy().to_string());

        let info_hash = handle.info_hash().as_string();
        let added_at = chrono::Utc::now().timestamp();
        let info = build_info(&info_hash, &handle, &save_path, added_at);
        info!("Added: {} ({})", info.name, info_hash.get(..8).unwrap_or(&info_hash));

        self.torrents
            .write()
            .expect("torrents lock poisoned")
            .insert(info_hash, TorrentEntry { handle, save_path, torrent_id, added_at });
        Ok(info)
    }

    pub async fn add_magnet(&self, url: &str) -> Result<TorrentInfo> {
        let is_magnet = url.starts_with("magnet:");
        let is_http = url.starts_with("http://") || url.starts_with("https://");
        if !is_magnet && !is_http {
            return Err(AppError::InvalidMagnet(url.to_string()));
        }
        self.add_inner(AddTorrent::from_url(url)).await
    }

    pub async fn add_torrent_file(&self, path: &str) -> Result<TorrentInfo> {
        let bytes = tokio::fs::read(path).await.map_err(AppError::Io)?;
        self.add_inner(AddTorrent::from_bytes(bytes)).await
    }

    pub async fn pause(&self, id: &str) -> Result<()> {
        let handle = self.get_handle(id)?;
        self.session.pause(&handle).await.map_err(AppError::Other)
    }

    pub async fn resume(&self, id: &str) -> Result<()> {
        let handle = self.get_handle(id)?;
        self.session.unpause(&handle).await.map_err(AppError::Other)
    }

    pub async fn remove(&self, id: &str, delete_files: bool) -> Result<()> {
        let entry = self
            .torrents
            .write()
            .expect("torrents lock poisoned")
            .remove(id)
            .ok_or_else(|| AppError::TorrentNotFound(id.to_string()))?;

        let torrent_id = entry.handle.id();
        self.session
            .delete(librqbit::api::TorrentIdOrHash::Id(torrent_id), delete_files)
            .await
            .map_err(AppError::Other)
    }

    fn get_handle(&self, id: &str) -> Result<ManagedTorrentHandle> {
        self.torrents
            .read()
            .expect("torrents lock poisoned")
            .get(id)
            .map(|e| e.handle.clone())
            .ok_or_else(|| AppError::TorrentNotFound(id.to_string()))
    }
}
