import { Component, createSignal, createMemo, onMount, onCleanup, For, Show } from "solid-js";
import { listen } from "@tauri-apps/api/event";
import { getTorrents, addTorrentFile, addTorrentMagnet, pauseTorrent, resumeTorrent, removeTorrent, removeTorrentWithData, TorrentInfo } from "./lib/commands";
import Toolbar from "./components/Toolbar";
import TorrentRow from "./components/TorrentRow";
import Settings from "./components/Settings";
import DetailPanel from "./components/DetailPanel";
import { loadTheme, applyTheme, Theme } from "./lib/theme";
import "./App.css";

const ZOOM_LEVELS = [0.7, 0.8, 0.9, 1.0, 1.5, 2.0, 2.5, 3.0];
const DEFAULT_ZOOM_IDX = 3;

type SortField = "name" | "size" | "progress" | "speed" | "status";
type SortDir = "asc" | "desc";

const STATUS_ORDER: Record<string, number> = {
  downloading: 0,
  initializing: 1,
  seeding: 2,
  paused: 3,
  error: 4,
};

function torrentProgress(t: TorrentInfo): number {
  if (t.size_bytes === 0) return 0;
  return t.downloaded_bytes / t.size_bytes;
}

function torrentSpeed(t: TorrentInfo): number {
  if (t.state.type === "downloading") return t.state.speed_down;
  if (t.state.type === "seeding") return t.state.speed_up;
  return 0;
}

const App: Component = () => {
  const [theme, setTheme] = createSignal<Theme>(loadTheme());
  applyTheme(theme()); // apply immediately before first paint

  const toggleTheme = () => {
    const next: Theme = theme() === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
  };

  const [torrents, setTorrents] = createSignal<TorrentInfo[]>([]);
  const [showSettings, setShowSettings] = createSignal(false);
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [dragging, setDragging] = createSignal(false);
  const [dropError, setDropError] = createSignal("");
  const [infoMsg, setInfoMsg] = createSignal("");
  const [checkedIds, setCheckedIds] = createSignal<Set<string>>(new Set());
  const [sortField, setSortField] = createSignal<SortField>("name");
  const [sortDir, setSortDir] = createSignal<SortDir>("asc");

  const savedZoom = parseInt(localStorage.getItem("zoom-idx") ?? String(DEFAULT_ZOOM_IDX));
  const [zoomIdx, setZoomIdx] = createSignal(
    isNaN(savedZoom) ? DEFAULT_ZOOM_IDX : Math.max(0, Math.min(savedZoom, ZOOM_LEVELS.length - 1))
  );

  const zoom = () => ZOOM_LEVELS[zoomIdx()];
  const zoomIn = () => setZoomIdx((i) => Math.min(i + 1, ZOOM_LEVELS.length - 1));
  const zoomOut = () => setZoomIdx((i) => Math.max(i - 1, 0));
  const zoomReset = () => setZoomIdx(DEFAULT_ZOOM_IDX);

  const applyZoom = () => {
    const z = zoom();
    (document.documentElement.style as any).zoom = String(z);
    // Compensate height: at zoom != 1, 100vh is in unzoomed px.
    // Setting height to (100/z)vh ensures the app visually fills the window.
    const appEl = document.querySelector<HTMLElement>(".app");
    if (appEl) appEl.style.height = `${(100 / z).toFixed(4)}vh`;
    localStorage.setItem("zoom-idx", String(zoomIdx()));
  };
  applyZoom();

  const handleSort = (field: SortField) => {
    if (sortField() === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const selectedTorrent = createMemo(() =>
    torrents().find((t) => t.id === selectedId()) ?? null
  );

  const sortedTorrents = createMemo(() => {
    const list = [...torrents()];
    const dir = sortDir() === "asc" ? 1 : -1;
    const field = sortField();
    list.sort((a, b) => {
      switch (field) {
        case "name":    return dir * a.name.localeCompare(b.name);
        case "size":    return dir * (a.size_bytes - b.size_bytes);
        case "progress":return dir * (torrentProgress(a) - torrentProgress(b));
        case "speed":   return dir * (torrentSpeed(a) - torrentSpeed(b));
        case "status": {
          const oa = STATUS_ORDER[a.state.type] ?? 9;
          const ob = STATUS_ORDER[b.state.type] ?? 9;
          return dir * (oa - ob) || a.name.localeCompare(b.name);
        }
      }
    });
    return list;
  });

  const handleKeyDown = async (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === "=" || e.key === "+") { e.preventDefault(); zoomIn(); applyZoom(); }
      if (e.key === "-") { e.preventDefault(); zoomOut(); applyZoom(); }
      if (e.key === "0") { e.preventDefault(); zoomReset(); applyZoom(); }

      // Ctrl+V when focus is NOT inside a text input → paste magnet/URL
      if (e.key === "v") {
        const tag = (document.activeElement as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        e.preventDefault();
        try {
          const text = (await navigator.clipboard.readText()).trim();
          if (text.startsWith("magnet:") || text.startsWith("http://") || text.startsWith("https://")) {
            const torrent = await addTorrentMagnet(text);
            handleAdded(torrent);
          }
        } catch {
          // clipboard empty or denied — ignore silently
        }
      }
    }
  };

  const handleDroppedPaths = async (paths: string[]) => {
    const torrentPaths = paths.filter((p) => p.toLowerCase().endsWith(".torrent"));
    if (torrentPaths.length === 0) {
      setDropError("Only .torrent files are supported");
      setTimeout(() => setDropError(""), 3000);
      return;
    }
    for (const path of torrentPaths) {
      try {
        const torrent = await addTorrentFile(path);
        handleAdded(torrent);
      } catch (e) {
        setDropError(String(e));
        setTimeout(() => setDropError(""), 4000);
      }
    }
  };

  onMount(async () => {
    applyZoom(); // correct .app height after DOM is rendered
    window.addEventListener("keydown", handleKeyDown);

    try {
      const list = await getTorrents();
      setTorrents(list);
    } catch (e) {
      console.error("Failed to load torrents:", e);
    } finally {
      setLoading(false);
    }

    const unlistenStats = await listen<TorrentInfo[]>("torrent-stats", (event) => {
      const snapshot = event.payload;
      setTorrents((prev) => {
        const existing = new Map(prev.map((t) => [t.id, t]));
        return snapshot.map((info) => {
          const current = existing.get(info.id);
          return current ? { ...current, ...info } : info;
        });
      });
    });

    const unlistenEnter = await listen("tauri://drag-enter", () => setDragging(true));
    const unlistenLeave = await listen("tauri://drag-leave", () => setDragging(false));
    const unlistenDrop = await listen<{ paths: string[] }>("tauri://drag-drop", (event) => {
      setDragging(false);
      handleDroppedPaths(event.payload.paths);
    });

    // Fired when the app is opened via a .torrent file association (both fresh
    // launch and single-instance forwarding from a second process).
    const unlistenOpenFile = await listen<string>("open-torrent-file", async (event) => {
      try {
        const torrent = await addTorrentFile(event.payload);
        handleAdded(torrent);
      } catch (e) {
        setDropError(String(e));
        setTimeout(() => setDropError(""), 4000);
      }
    });

    onCleanup(() => {
      unlistenStats();
      unlistenEnter();
      unlistenLeave();
      unlistenDrop();
      unlistenOpenFile();
      window.removeEventListener("keydown", handleKeyDown);
    });
  });

  const handleAdded = (torrent: TorrentInfo) => {
    setTorrents((prev) => {
      if (prev.some((t) => t.id === torrent.id)) {
        setInfoMsg(`"${torrent.name}" is already in the queue`);
        setTimeout(() => setInfoMsg(""), 4000);
        return prev;
      }
      return [torrent, ...prev];
    });
    setSelectedId(torrent.id);
  };

  const handleUpdate = (id: string, patch: Partial<TorrentInfo>) => {
    setTorrents((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };

  const handleRemove = (id: string) => {
    setTorrents((prev) => prev.filter((t) => t.id !== id));
    if (selectedId() === id) setSelectedId(null);
    setCheckedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
  };

  const handleCheck = (id: string, checked: boolean) => {
    setCheckedIds((prev) => {
      const n = new Set(prev);
      if (checked) n.add(id); else n.delete(id);
      return n;
    });
  };

  const handleSelectAll = () => setCheckedIds(new Set(torrents().map((t) => t.id)));
  const handleDeselectAll = () => setCheckedIds(new Set<string>());

  const handleGroupAction = async (action: "start" | "pause" | "stop" | "remove" | "remove-with-data") => {
    const ids = [...checkedIds()];
    for (const id of ids) {
      try {
        switch (action) {
          case "start":
            await resumeTorrent(id);
            handleUpdate(id, { state: { type: "initializing" } });
            break;
          case "pause":
          case "stop":
            await pauseTorrent(id);
            handleUpdate(id, { state: { type: "paused" } });
            break;
          case "remove":
            await removeTorrent(id);
            handleRemove(id);
            break;
          case "remove-with-data":
            await removeTorrentWithData(id);
            handleRemove(id);
            break;
        }
      } catch (e) {
        console.error(e);
      }
    }
    setCheckedIds(new Set<string>());
  };

  const SortBtn: Component<{ field: SortField; label: string }> = (p) => (
    <button
      class={`sort-btn${sortField() === p.field ? " active" : ""}`}
      onClick={() => handleSort(p.field)}
      title={`Sort by ${p.label}`}
    >
      {p.label}
      <Show when={sortField() === p.field}>
        <span class="sort-arrow">{sortDir() === "asc" ? " ↑" : " ↓"}</span>
      </Show>
    </button>
  );

  return (
    <div class="app">
      <Toolbar onAdded={handleAdded} onOpenSettings={() => setShowSettings(true)} theme={theme()} onToggleTheme={toggleTheme} />
      <Show when={showSettings()}>
        <Settings onClose={() => setShowSettings(false)} />
      </Show>

      <div class="main-area">
        {/* Group action toolbar */}
        <Show when={checkedIds().size > 0}>
          <div class="group-toolbar">
            <span class="group-count">{checkedIds().size} selected</span>
            <div class="group-toolbar-sep" />
            <button class="group-btn" onClick={() => handleGroupAction("start")} title="Resume selected">▶ Start</button>
            <button class="group-btn" onClick={() => handleGroupAction("pause")} title="Pause selected">⏸ Pause</button>
            <button class="group-btn" onClick={() => handleGroupAction("stop")} title="Stop selected">⏹ Stop</button>
            <button class="group-btn group-btn-danger" onClick={() => handleGroupAction("remove")} title="Remove selected">✕ Remove</button>
            <button class="group-btn group-btn-danger" onClick={() => handleGroupAction("remove-with-data")} title="Remove selected and delete files">🗑 Remove + Data</button>
            <span class="group-toolbar-spacer" />
            <button class="group-btn" onClick={handleSelectAll}>Select all</button>
            <button class="group-btn" onClick={handleDeselectAll}>✕ Clear</button>
          </div>
        </Show>

        {/* Sort bar */}
        <Show when={torrents().length > 1}>
          <div class="sort-bar">
            <span class="sort-label">Sort:</span>
            <SortBtn field="name" label="Name" />
            <SortBtn field="status" label="Status" />
            <SortBtn field="progress" label="Progress" />
            <SortBtn field="speed" label="Speed" />
            <SortBtn field="size" label="Size" />
          </div>
        </Show>

        <div class="torrent-list">
          <Show when={!loading()} fallback={<div class="empty-state">Loading...</div>}>
            <Show
              when={sortedTorrents().length > 0}
              fallback={
                <div class="empty-state">
                  <div class="empty-icon">⬇</div>
                  <div class="empty-title">No torrents yet</div>
                  <div class="empty-desc">
                    Click "+ Add Torrent", "Open File", or drop a .torrent file here
                  </div>
                </div>
              }
            >
              <For each={sortedTorrents()}>
                {(torrent) => (
                  <TorrentRow
                    torrent={torrent}
                    selected={selectedId() === torrent.id}
                    checked={checkedIds().has(torrent.id)}
                    onSelect={() => setSelectedId(torrent.id)}
                    onCheck={(v) => handleCheck(torrent.id, v)}
                    onUpdate={handleUpdate}
                    onRemove={handleRemove}
                  />
                )}
              </For>
            </Show>
          </Show>
        </div>

        <Show when={selectedTorrent() !== null}>
          <DetailPanel torrent={selectedTorrent()!} />
        </Show>
      </div>

      <div class="statusbar">
        <Show when={dropError()}>
          <span class="statusbar-error">{dropError()}</span>
        </Show>
        <Show when={!dropError() && infoMsg()}>
          <span class="statusbar-info">{infoMsg()}</span>
        </Show>
        <Show when={!dropError() && !infoMsg()}>
          <span>{torrents().length} torrent{torrents().length !== 1 ? "s" : ""}</span>
        </Show>
        <span class="statusbar-spacer" />
        <div class="zoom-controls">
          <button class="zoom-btn" onClick={() => { zoomOut(); applyZoom(); }} disabled={zoomIdx() === 0} title="Zoom out (Ctrl+-)">−</button>
          <button class="zoom-label" onClick={() => { zoomReset(); applyZoom(); }} title="Reset zoom (Ctrl+0)">
            {Math.round(zoom() * 100)}%
          </button>
          <button class="zoom-btn" onClick={() => { zoomIn(); applyZoom(); }} disabled={zoomIdx() === ZOOM_LEVELS.length - 1} title="Zoom in (Ctrl+=)">+</button>
        </div>
      </div>

      <Show when={dragging()}>
        <div class="drop-overlay">
          <div class="drop-hint">
            <div class="drop-icon">⬇</div>
            <div class="drop-text">Drop .torrent file to add</div>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default App;
