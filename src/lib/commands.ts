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
}

export const getTorrents = () => invoke<TorrentInfo[]>("get_torrents");
export const addTorrentMagnet = (magnet: string) => invoke<TorrentInfo>("add_torrent_magnet", { magnet });
export const addTorrentFile = (path: string) => invoke<TorrentInfo>("add_torrent_file", { path });
export const pauseTorrent = (id: string) => invoke<void>("pause_torrent", { id });
export const resumeTorrent = (id: string) => invoke<void>("resume_torrent", { id });
export const removeTorrent = (id: string) => invoke<void>("remove_torrent", { id });
export const removeTorrentWithData = (id: string) => invoke<void>("remove_torrent_with_data", { id });
export const getSettings = () => invoke<AppSettings>("get_settings");
export const saveSettings = (settings: AppSettings) => invoke<void>("save_settings", { settings });
export const getTorrentDetails = (id: string) => invoke<TorrentDetails>("get_torrent_details", { id });
