import { invoke } from "@tauri-apps/api/core";

export type TorrentState =
  | { type: "initializing" }
  | { type: "paused" }
  | { type: "downloading"; progress: number; speed_down: number; speed_up: number }
  | { type: "seeding"; speed_up: number; ratio: number }
  | { type: "error"; reason: string };

export interface TorrentInfo {
  id: string;
  name: string;
  info_hash: string;
  size_bytes: number;
  downloaded_bytes: number;
  uploaded_bytes: number;
  state: TorrentState;
  save_path: string;
  added_at: number;
  peers_connected: number;
  file_progress: number[];
}

export interface AppSettings {
  download_path: string;
  max_download_speed: number;
  max_upload_speed: number;
  max_active_torrents: number;
  start_minimized: boolean;
}

export interface FileInfo {
  name: string;
  size: number;
  included: boolean;
  components: string[];
  padding: boolean;
}

export interface PeerInfo {
  addr: string;
  state: string;
  downloaded_bytes: number;
  uploaded_bytes: number;
}

export interface TorrentDetails {
  files: FileInfo[];
  peers: PeerInfo[];
  save_path: string;
}

export interface TorrentListing {
  info_hash: string;
  name: string;
  output_folder: string;
  files: FileInfo[];
}

// A torrent source the user hasn't confirmed adding yet — magnet/URL text or a
// local .torrent file path. Listed first (list_torrent_magnet/file) so the user
// can pick which files to download before confirm_add_torrent starts it.
export type TorrentSource =
  | { kind: "magnet"; value: string }
  | { kind: "file"; path: string };

export const getTorrents = () => invoke<TorrentInfo[]>("get_torrents");
export const listTorrentMagnet = (magnet: string) => invoke<TorrentListing>("list_torrent_magnet", { magnet });
export const listTorrentFile = (path: string) => invoke<TorrentListing>("list_torrent_file", { path });
// fileIndices: null means "download everything" — kept distinct from an explicit
// list of every index, since librqbit treats those differently (see FileSelectionDialog).
export const confirmAddTorrent = (infoHash: string, fileIndices: number[] | null) =>
  invoke<TorrentInfo>("confirm_add_torrent", { infoHash, fileIndices });
export const cancelTorrentListing = (infoHash: string) => invoke<void>("cancel_torrent_listing", { infoHash });
export const pauseTorrent = (id: string) => invoke<void>("pause_torrent", { id });
export const resumeTorrent = (id: string) => invoke<void>("resume_torrent", { id });
export const removeTorrent = (id: string) => invoke<void>("remove_torrent", { id });
export const removeTorrentWithData = (id: string) => invoke<void>("remove_torrent_with_data", { id });
export const getSettings = () => invoke<AppSettings>("get_settings");
export const saveSettings = (settings: AppSettings) => invoke<void>("save_settings", { settings });
export const getTorrentDetails = (id: string) => invoke<TorrentDetails>("get_torrent_details", { id });
