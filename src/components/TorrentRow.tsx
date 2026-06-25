import { Component, Show } from "solid-js";
import { open } from "@tauri-apps/plugin-shell";
import { TorrentInfo, TorrentState, pauseTorrent, resumeTorrent, removeTorrent } from "../lib/commands";
import { formatBytes, formatProgress, formatSpeed, formatEta } from "../lib/format";

interface Props {
  torrent: TorrentInfo;
  selected: boolean;
  checked: boolean;
  onSelect: () => void;
  onCheck: (checked: boolean) => void;
  onUpdate: (id: string, patch: Partial<TorrentInfo>) => void;
  onRemove: (id: string) => void;
}

function stateLabel(state: TorrentState): { text: string; color: string } {
  switch (state.type) {
    case "initializing": return { text: "Initializing", color: "var(--blue)" };
    case "downloading":  return { text: "Downloading",  color: "var(--accent)" };
    case "seeding":      return { text: "Seeding",      color: "var(--green)" };
    case "paused":       return { text: "Paused",       color: "var(--yellow)" };
    case "error":        return { text: "Error",        color: "var(--red)" };
  }
}

const TorrentRow: Component<Props> = (props) => {
  const state = () => props.torrent.state;
  const label = () => stateLabel(state());

  const speed = () => {
    const s = state();
    if (s.type === "downloading") return `↓ ${formatSpeed(s.speed_down)}  ↑ ${formatSpeed(s.speed_up)}`;
    if (s.type === "seeding")     return `↑ ${formatSpeed(s.speed_up)}  Ratio: ${s.ratio.toFixed(2)}`;
    return "";
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

  // Icon and title for the pause/stop/resume toggle button.
  // Seeding → ⏹ Stop; downloading/initializing → ⏸ Pause; paused → ▶ Resume.
  const toggleAction = () => {
    const s = state();
    if (s.type === "paused")   return { icon: "▶", title: "Resume" };
    if (s.type === "seeding")  return { icon: "⏹", title: "Stop" };
    if (s.type === "error")    return null;
    return { icon: "⏸", title: "Pause" };
  };

  const handleToggle = async (e: MouseEvent) => {
    e.stopPropagation();
    try {
      if (state().type === "paused") {
        await resumeTorrent(props.torrent.id);
        props.onUpdate(props.torrent.id, { state: { type: "initializing" } });
      } else {
        await pauseTorrent(props.torrent.id);
        props.onUpdate(props.torrent.id, { state: { type: "paused" } });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleRemove = async (e: MouseEvent) => {
    e.stopPropagation();
    try {
      await removeTorrent(props.torrent.id);
      props.onRemove(props.torrent.id);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDblClick = () => {
    open(props.torrent.save_path).catch(console.error);
  };

  return (
    <div
      class="torrent-row"
      classList={{ selected: props.selected }}
      onClick={props.onSelect}
      onDblClick={handleDblClick}
    >
      <div class="torrent-row-checkbox" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={props.checked}
          onChange={(e) => props.onCheck(e.currentTarget.checked)}
        />
      </div>

      <div class="torrent-row-main">
        <div class="torrent-name">{props.torrent.name}</div>
        <div class="torrent-meta">
          <span style={{ color: label().color }}>{label().text}</span>
          <span class="torrent-meta-sep">·</span>
          <span>{formatBytes(props.torrent.size_bytes)}</span>
          <Show when={speed()}>
            <span class="torrent-meta-sep">·</span>
            <span>{speed()}</span>
          </Show>
          <Show when={eta()}>
            <span class="torrent-meta-sep">·</span>
            <span class="torrent-eta">ETA {eta()}</span>
          </Show>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" style={{ width: `${progress()}%` }} />
        </div>
      </div>

      <div class="torrent-row-actions">
        <Show when={toggleAction()}>
          {(action) => (
            <button class="btn-icon-sm" onClick={handleToggle} title={action().title}>
              {action().icon}
            </button>
          )}
        </Show>
        <button class="btn-icon-sm btn-danger" onClick={handleRemove} title="Remove">✕</button>
      </div>
    </div>
  );
};

export default TorrentRow;
