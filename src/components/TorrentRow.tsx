import { Component, Show } from "solid-js";
import { open } from "@tauri-apps/plugin-shell";
import { TorrentInfo, TorrentState, getTorrentDetails } from "../lib/commands";
import { formatBytes, formatProgress, formatSpeed, formatEta } from "../lib/format";
import { DownloadIcon, UploadIcon, ClockIcon } from "./Icons";

interface Props {
  torrent: TorrentInfo;
  selected: boolean;
  onSelect: (e: MouseEvent) => void;
}

function stateInfo(state: TorrentState): { text: string; color: string; dot: string; glow: boolean } {
  switch (state.type) {
    case "initializing": return { text: "Initializing", color: "var(--blue)",   dot: "var(--blue)",   glow: true };
    case "downloading":  return { text: "Downloading",  color: "var(--blue)",   dot: "var(--blue)",   glow: true };
    case "seeding":      return { text: "Seeding",      color: "var(--green)",  dot: "var(--green)",  glow: true };
    case "paused":       return { text: "Paused",       color: "var(--text-muted)", dot: "var(--text-muted)", glow: false };
    case "error":        return { text: "Error",        color: "var(--red)",    dot: "var(--red)",    glow: false };
  }
}

const TorrentRow: Component<Props> = (props) => {
  const state = () => props.torrent.state;
  const info = () => stateInfo(state());

  const downSpeed = () => {
    const s = state();
    return s.type === "downloading" ? s.speed_down : 0;
  };
  const upSpeed = () => {
    const s = state();
    if (s.type === "downloading") return s.speed_up;
    if (s.type === "seeding") return s.speed_up;
    return 0;
  };

  const eta = () => {
    const s = state();
    if (s.type !== "downloading") return "";
    return formatEta(props.torrent.size_bytes - props.torrent.downloaded_bytes, s.speed_down);
  };

  const progress = () => {
    const s = state();
    if (s.type === "downloading") return s.progress * 100;
    if (s.type === "seeding")     return 100;
    return formatProgress(props.torrent.downloaded_bytes, props.torrent.size_bytes);
  };

  // Fetch a fresh save path rather than trusting the cached torrent.save_path,
  // which is set once at add time and can be stale for magnet links whose
  // per-torrent subfolder is only created after metadata resolves.
  const handleDblClick = async () => {
    try {
      const details = await getTorrentDetails(props.torrent.id);
      await open(details.save_path);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div
      class="torrent-row"
      classList={{ selected: props.selected }}
      onClick={props.onSelect}
      onDblClick={handleDblClick}
    >
      <div class="torrent-col-name">
        <span
          class="torrent-dot"
          style={{ background: info().dot, "box-shadow": info().glow ? `0 0 8px 0 ${info().dot}` : "none" }}
        />
        <div class="torrent-name-block">
          <div class="torrent-name">{props.torrent.name}</div>
          <div class="torrent-status" style={{ color: info().color }}>{info().text}</div>
        </div>
      </div>

      <div class="torrent-col-size mono">
        <span class="torrent-col-primary">{formatBytes(props.torrent.size_bytes)}</span>
        <span class="torrent-col-secondary">{formatBytes(props.torrent.downloaded_bytes)} done</span>
      </div>

      <div class="torrent-col-speed mono">
        <span class="torrent-speed-down"><DownloadIcon size={11} /> {formatSpeed(downSpeed())}</span>
        <span class="torrent-speed-up"><UploadIcon size={11} /> {formatSpeed(upSpeed())}</span>
      </div>

      <div class="torrent-col-eta mono">
        <Show when={eta()} fallback={<span class="torrent-col-secondary">–</span>}>
          <ClockIcon size={11} class="torrent-col-secondary" />
          {eta()}
        </Show>
      </div>

      <div class="torrent-col-progress">
        <div class="progress-bar">
          <div class="progress-fill" style={{ width: `${progress()}%`, background: info().dot }} />
        </div>
        <span class="torrent-progress-pct mono">{Math.round(progress())}%</span>
      </div>
    </div>
  );
};

export default TorrentRow;
