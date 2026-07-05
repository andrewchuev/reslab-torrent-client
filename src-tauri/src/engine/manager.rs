use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, PoisonError, RwLock, RwLockReadGuard, RwLockWriteGuard};

use librqbit::{
    AddTorrent, AddTorrentOptions, AddTorrentResponse, Api, ManagedTorrent, Session,
    SessionOptions, SessionPersistenceConfig, TorrentStats, TorrentStatsState,
};
use serde::{Deserialize, Serialize};
use tracing::info;

use crate::error::{AppError, Result};

type ManagedTorrentHandle = Arc<ManagedTorrent>;

/// Acquires a read lock, recovering the inner data if a prior panic poisoned it
/// instead of poisoning every subsequent call across the app.
fn read_lock<T>(lock: &RwLock<T>) -> RwLockReadGuard<'_, T> {
    lock.read().unwrap_or_else(PoisonError::into_inner)
}

/// Acquires a write lock, recovering the inner data if a prior panic poisoned it
/// instead of poisoning every subsequent call across the app.
fn write_lock<T>(lock: &RwLock<T>) -> RwLockWriteGuard<'_, T> {
    lock.write().unwrap_or_else(PoisonError::into_inner)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TorrentState {
    Initializing,
    Downloading {
        progress: f32,
        speed_down: u64,
        speed_up: u64,
    },
    Seeding {
        speed_up: u64,
        ratio: f32,
    },
    Paused,
    Error {
        reason: String,
    },
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
    /// Path components, e.g. ["folder", "sub", "file.mp4"]; used to group files by folder.
    pub components: Vec<String>,
    pub padding: bool,
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
    /// Current output folder, always freshly read (unlike `TorrentInfo::save_path`,
    /// which is cached at add time and can go stale for magnet links).
    pub save_path: String,
}

/// A torrent whose metadata has been resolved but that hasn't been started yet —
/// the user picks which files to download before it's handed to `confirm_add`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TorrentListing {
    pub info_hash: String,
    pub name: String,
    pub output_folder: String,
    pub files: Vec<FileInfo>,
}

/// Inputs needed to derive `TorrentState`, decoupled from librqbit's `TorrentStats`
/// so the derivation logic below can be unit-tested without a live torrent.
struct StateInputs {
    state: TorrentStatsState,
    error: Option<String>,
    finished: bool,
    total_bytes: u64,
    progress_bytes: u64,
    uploaded_bytes: u64,
    download_speed: u64,
    upload_speed: u64,
}

impl From<&TorrentStats> for StateInputs {
    fn from(stats: &TorrentStats) -> Self {
        Self {
            state: stats.state,
            error: stats.error.clone(),
            finished: stats.finished,
            total_bytes: stats.total_bytes,
            progress_bytes: stats.progress_bytes,
            uploaded_bytes: stats.uploaded_bytes,
            download_speed: stats
                .live
                .as_ref()
                .map_or(0, |l| l.download_speed.as_bytes()),
            upload_speed: stats.live.as_ref().map_or(0, |l| l.upload_speed.as_bytes()),
        }
    }
}

fn derive_state(inputs: &StateInputs) -> TorrentState {
    match inputs.state {
        // Paused must be checked before finished: a seeding torrent keeps
        // stats.finished == true even after being paused.
        TorrentStatsState::Paused => TorrentState::Paused,
        TorrentStatsState::Error => TorrentState::Error {
            reason: inputs
                .error
                .clone()
                .unwrap_or_else(|| "Unknown error".into()),
        },
        _ if inputs.finished => {
            let ratio = if inputs.total_bytes > 0 {
                inputs.uploaded_bytes as f32 / inputs.total_bytes as f32
            } else {
                0.0
            };
            TorrentState::Seeding {
                speed_up: inputs.upload_speed,
                ratio,
            }
        }
        TorrentStatsState::Initializing => TorrentState::Initializing,
        TorrentStatsState::Live => {
            let progress = if inputs.total_bytes > 0 {
                inputs.progress_bytes as f32 / inputs.total_bytes as f32
            } else {
                0.0
            };
            TorrentState::Downloading {
                progress,
                speed_down: inputs.download_speed,
                speed_up: inputs.upload_speed,
            }
        }
    }
}

fn build_info(
    info_hash: &str,
    handle: &ManagedTorrentHandle,
    save_path: &str,
    added_at: i64,
) -> TorrentInfo {
    let stats = handle.stats();
    let file_progress = stats.file_progress.clone();
    let name = handle
        .name()
        .unwrap_or_else(|| format!("Torrent {}", info_hash.get(..8).unwrap_or(info_hash)));
    let peers_connected = stats
        .live
        .as_ref()
        .map_or(0, |l| l.snapshot.peer_stats.live);
    let state = derive_state(&StateInputs::from(&stats));

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
        peers_connected,
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
    /// Raw `.torrent` bytes for listings awaiting file-selection confirmation, keyed by
    /// info_hash. Populated by `list_inner`, consumed by `confirm_add`/`cancel_listing`.
    pending_listings: RwLock<HashMap<String, Vec<u8>>>,
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
        info!(
            "librqbit session started, download dir: {}",
            download_dir.display()
        );

        let api = Api::new(session.clone(), None);

        // Collect (id, handle) while holding the session lock, then release it
        // before calling api_torrent_details (which also needs the lock).
        let restored: Vec<(usize, ManagedTorrentHandle)> =
            session.with_torrents(|iter| iter.map(|(id, h)| (id, h.clone())).collect());

        let now = chrono::Utc::now().timestamp();
        let torrents: HashMap<String, TorrentEntry> = restored
            .into_iter()
            .map(|(id, handle)| {
                let info_hash = handle.info_hash().as_string();
                let save_path = api
                    .api_torrent_details(librqbit::api::TorrentIdOrHash::Id(id))
                    .map_or_else(
                        |_| download_dir.to_string_lossy().into_owned(),
                        |d| d.output_folder,
                    );
                (
                    info_hash,
                    TorrentEntry {
                        handle,
                        save_path,
                        torrent_id: id,
                        added_at: now,
                    },
                )
            })
            .collect();

        if !torrents.is_empty() {
            info!(
                "Restored {} torrent(s) from previous session",
                torrents.len()
            );
        }

        Ok(Self {
            session,
            api,
            torrents: Arc::new(RwLock::new(torrents)),
            initial_download_dir: download_dir.clone(),
            download_dir: RwLock::new(download_dir),
            pending_listings: RwLock::new(HashMap::new()),
        })
    }

    pub fn get_all(&self) -> Vec<TorrentInfo> {
        read_lock(&self.torrents)
            .iter()
            .map(|(info_hash, entry)| {
                build_info(info_hash, &entry.handle, &entry.save_path, entry.added_at)
            })
            .collect()
    }

    pub fn set_download_dir(&self, path: PathBuf) {
        *write_lock(&self.download_dir) = path;
    }

    pub fn get_details(&self, id: &str) -> Result<TorrentDetails> {
        let guard = read_lock(&self.torrents);
        let entry = guard
            .get(id)
            .ok_or_else(|| AppError::TorrentNotFound(id.to_string()))?;

        let handle = entry.handle.clone();
        let torrent_id = entry.torrent_id;
        drop(guard);

        let details = self
            .api
            .api_torrent_details(librqbit::api::TorrentIdOrHash::Id(torrent_id))
            .map_err(|e| AppError::Other(anyhow::anyhow!("{e}")))?;

        let save_path = details.output_folder;
        let files = details
            .files
            .unwrap_or_default()
            .into_iter()
            .map(|f| FileInfo {
                name: f.name,
                size: f.length,
                included: f.included,
                components: f.components,
                padding: f.attributes.padding,
            })
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

        Ok(TorrentDetails {
            files,
            peers,
            save_path,
        })
    }

    async fn add_inner(
        &self,
        source: AddTorrent<'_>,
        only_files: Option<Vec<usize>>,
    ) -> Result<TorrentInfo> {
        let current_dir = read_lock(&self.download_dir).clone();

        // When current_dir matches the session's initial dir, pass output_folder=None so
        // librqbit auto-creates a named subfolder for multi-file torrents (e.g.
        // Downloads/TorrentName/). When the user changed the dir in Settings we must pass
        // it explicitly — no auto-subfolder in that case, which is an accepted limitation.
        let output_folder = if current_dir == self.initial_download_dir {
            None
        } else {
            Some(current_dir.to_string_lossy().to_string())
        };

        let opts = AddTorrentOptions {
            output_folder,
            overwrite: true,
            only_files,
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
                let guard = read_lock(&self.torrents);
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
        let save_path = self
            .api
            .api_torrent_details(librqbit::api::TorrentIdOrHash::Id(torrent_id))
            .map_or_else(
                |_| current_dir.to_string_lossy().to_string(),
                |d| d.output_folder,
            );

        let info_hash = handle.info_hash().as_string();
        let added_at = chrono::Utc::now().timestamp();
        let info = build_info(&info_hash, &handle, &save_path, added_at);
        info!(
            "Added: {} ({})",
            info.name,
            info_hash.get(..8).unwrap_or(&info_hash)
        );

        write_lock(&self.torrents).insert(
            info_hash,
            TorrentEntry {
                handle,
                save_path,
                torrent_id,
                added_at,
            },
        );
        Ok(info)
    }

    pub async fn list_magnet(&self, url: &str) -> Result<TorrentListing> {
        validate_source_url(url)?;
        self.list_inner(AddTorrent::from_url(url)).await
    }

    pub async fn list_torrent_file(&self, path: &str) -> Result<TorrentListing> {
        let bytes = tokio::fs::read(path).await.map_err(AppError::Io)?;
        self.list_inner(AddTorrent::from_bytes(bytes)).await
    }

    /// Resolves a torrent's metadata without starting the download, so the caller can
    /// present a file-selection dialog before `confirm_add` actually starts it.
    async fn list_inner(&self, source: AddTorrent<'_>) -> Result<TorrentListing> {
        let opts = AddTorrentOptions {
            list_only: true,
            ..Default::default()
        };
        let response = self
            .session
            .add_torrent(source, Some(opts))
            .await
            .map_err(AppError::Other)?;

        let listing = match response {
            AddTorrentResponse::ListOnly(l) => l,
            // list_only always yields ListOnly (checked before the AlreadyManaged path);
            // any duplicate torrent is instead caught by confirm_add -> add_inner.
            _ => {
                return Err(AppError::Other(anyhow::anyhow!(
                    "expected a list-only response"
                )))
            }
        };

        let info_hash = listing.info_hash.as_string();
        let name = listing
            .info
            .name()
            .map(|n| n.into_owned())
            .unwrap_or_else(|| "Unknown torrent".to_string());
        let output_folder = listing.output_folder.to_string_lossy().to_string();
        let preselected = listing.only_files.as_deref();

        let files = listing
            .info
            .iter_file_details()
            .enumerate()
            .map(|(idx, d)| {
                let attrs = d.attrs();
                FileInfo {
                    name: d.filename.to_string(),
                    size: d.len,
                    included: preselected.map(|o| o.contains(&idx)).unwrap_or(true),
                    components: d.filename.to_vec(),
                    padding: attrs.padding,
                }
            })
            .collect();

        write_lock(&self.pending_listings)
            .insert(info_hash.clone(), listing.torrent_bytes.to_vec());

        Ok(TorrentListing {
            info_hash,
            name,
            output_folder,
            files,
        })
    }

    /// Starts a torrent previously resolved via `list_magnet`/`list_torrent_file`,
    /// downloading only the given file indices.
    pub async fn confirm_add(
        &self,
        info_hash: &str,
        file_indices: Vec<usize>,
    ) -> Result<TorrentInfo> {
        let bytes = write_lock(&self.pending_listings)
            .remove(info_hash)
            .ok_or_else(|| AppError::TorrentNotFound(info_hash.to_string()))?;
        self.add_inner(AddTorrent::from_bytes(bytes), Some(file_indices))
            .await
    }

    /// Discards a pending listing the user didn't confirm, so it doesn't linger in memory.
    pub fn cancel_listing(&self, info_hash: &str) {
        write_lock(&self.pending_listings).remove(info_hash);
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
        let entry = write_lock(&self.torrents)
            .remove(id)
            .ok_or_else(|| AppError::TorrentNotFound(id.to_string()))?;

        let torrent_id = entry.handle.id();
        self.session
            .delete(librqbit::api::TorrentIdOrHash::Id(torrent_id), delete_files)
            .await
            .map_err(AppError::Other)
    }

    fn get_handle(&self, id: &str) -> Result<ManagedTorrentHandle> {
        read_lock(&self.torrents)
            .get(id)
            .map(|e| e.handle.clone())
            .ok_or_else(|| AppError::TorrentNotFound(id.to_string()))
    }
}

/// Validates that a torrent source is a magnet link or an http(s) URL to a `.torrent` file.
fn validate_source_url(url: &str) -> Result<()> {
    let is_magnet = url.starts_with("magnet:");
    let is_http = url.starts_with("http://") || url.starts_with("https://");
    if is_magnet || is_http {
        Ok(())
    } else {
        Err(AppError::InvalidMagnet(url.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn inputs(
        state: TorrentStatsState,
        finished: bool,
        total: u64,
        progress: u64,
        uploaded: u64,
    ) -> StateInputs {
        StateInputs {
            state,
            error: None,
            finished,
            total_bytes: total,
            progress_bytes: progress,
            uploaded_bytes: uploaded,
            download_speed: 100,
            upload_speed: 50,
        }
    }

    #[test]
    fn paused_takes_priority_over_finished() {
        // A seeding torrent keeps `finished == true` after being paused; Paused must win.
        let state = derive_state(&inputs(TorrentStatsState::Paused, true, 100, 100, 10));
        assert_eq!(state, TorrentState::Paused);
    }

    #[test]
    fn error_state_carries_reason() {
        let mut i = inputs(TorrentStatsState::Error, false, 100, 0, 0);
        i.error = Some("disk full".to_string());
        assert_eq!(state_reason(derive_state(&i)), "disk full");
    }

    fn state_reason(state: TorrentState) -> String {
        match state {
            TorrentState::Error { reason } => reason,
            other => panic!("expected Error state, got {other:?}"),
        }
    }

    #[test]
    fn finished_reports_seeding_with_ratio() {
        let state = derive_state(&inputs(TorrentStatsState::Live, true, 200, 200, 100));
        match state {
            TorrentState::Seeding { speed_up, ratio } => {
                assert_eq!(speed_up, 50);
                assert_eq!(ratio, 0.5);
            }
            other => panic!("expected Seeding state, got {other:?}"),
        }
    }

    #[test]
    fn seeding_ratio_is_zero_for_empty_torrent() {
        // total_bytes == 0 must not divide by zero.
        let state = derive_state(&inputs(TorrentStatsState::Live, true, 0, 0, 0));
        match state {
            TorrentState::Seeding { ratio, .. } => assert_eq!(ratio, 0.0),
            other => panic!("expected Seeding state, got {other:?}"),
        }
    }

    #[test]
    fn live_reports_downloading_with_progress() {
        let state = derive_state(&inputs(TorrentStatsState::Live, false, 200, 50, 0));
        match state {
            TorrentState::Downloading {
                progress,
                speed_down,
                speed_up,
            } => {
                assert_eq!(progress, 0.25);
                assert_eq!(speed_down, 100);
                assert_eq!(speed_up, 50);
            }
            other => panic!("expected Downloading state, got {other:?}"),
        }
    }

    #[test]
    fn initializing_state_maps_through() {
        let state = derive_state(&inputs(TorrentStatsState::Initializing, false, 0, 0, 0));
        assert_eq!(state, TorrentState::Initializing);
    }

    #[test]
    fn validate_source_url_accepts_magnet_and_http() {
        assert!(validate_source_url("magnet:?xt=urn:btih:abc").is_ok());
        assert!(validate_source_url("http://example.com/a.torrent").is_ok());
        assert!(validate_source_url("https://example.com/a.torrent").is_ok());
    }

    #[test]
    fn validate_source_url_rejects_other_schemes() {
        assert!(validate_source_url("ftp://example.com/a.torrent").is_err());
        assert!(validate_source_url("not a url").is_err());
    }
}
