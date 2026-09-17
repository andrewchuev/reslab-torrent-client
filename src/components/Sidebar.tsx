import { Component, createMemo } from "solid-js";
import { TorrentInfo } from "../lib/commands";
import { ActivityIcon, DownloadIcon, UploadIcon, CheckCircleIcon, SettingsIcon } from "./Icons";

export type StatusFilter = "all" | "downloading" | "seeding" | "completed";

interface Props {
  torrents: TorrentInfo[];
  filter: StatusFilter;
  onFilterChange: (f: StatusFilter) => void;
  onOpenSettings: () => void;
}

function isCompleted(t: TorrentInfo): boolean {
  return t.size_bytes > 0 && t.downloaded_bytes >= t.size_bytes;
}

const Sidebar: Component<Props> = (props) => {
  const counts = createMemo(() => {
    const list = props.torrents;
    let downloading = 0;
    let seeding = 0;
    let completed = 0;
    for (const t of list) {
      if (t.state.type === "downloading" || t.state.type === "initializing") downloading++;
      if (t.state.type === "seeding") seeding++;
      if (isCompleted(t)) completed++;
    }
    return { all: list.length, downloading, seeding, completed };
  });

  const items: { key: StatusFilter; label: string; icon: Component<{ size?: number; class?: string }> }[] = [
    { key: "all", label: "All Torrents", icon: ActivityIcon },
    { key: "downloading", label: "Downloading", icon: DownloadIcon },
    { key: "seeding", label: "Seeding", icon: UploadIcon },
    { key: "completed", label: "Completed", icon: CheckCircleIcon },
  ];

  return (
    <aside class="sidebar">
      <div class="sidebar-logo">
        <div class="sidebar-logo-mark">
          <DownloadIcon size={16} />
        </div>
        <span class="sidebar-logo-text">ResTorrent</span>
      </div>

      <nav class="sidebar-nav">
        <div class="sidebar-nav-label">Status</div>
        {items.map((item) => (
          <button
            class="sidebar-nav-btn"
            classList={{ active: props.filter === item.key }}
            onClick={() => props.onFilterChange(item.key)}
          >
            <item.icon size={15} />
            <span class="sidebar-nav-btn-label">{item.label}</span>
            <span class="sidebar-nav-badge">{counts()[item.key]}</span>
          </button>
        ))}
      </nav>

      <div class="sidebar-footer">
        <button class="sidebar-settings-btn" onClick={props.onOpenSettings}>
          <SettingsIcon size={15} />
          <span>Settings</span>
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
