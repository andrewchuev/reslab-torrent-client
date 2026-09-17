import { Component, createSignal } from "solid-js";
import { open } from "@tauri-apps/plugin-dialog";
import { TorrentSource } from "../lib/commands";
import { Theme } from "../lib/theme";
import {
  LinkIcon, FilePlusIcon, ClipboardIcon, PlayIcon, PauseIcon, SquareIcon, TrashIcon, TrashDataIcon,
  SearchIcon, SunIcon, MoonIcon,
} from "./Icons";

export type GroupAction = "start" | "pause" | "stop" | "remove" | "remove-with-data";

interface Props {
  onAddSource: (source: TorrentSource) => void;
  theme: Theme;
  onToggleTheme: () => void;
  selectedCount: number;
  onGroupAction: (action: GroupAction) => void;
  search: string;
  onSearchChange: (v: string) => void;
}

function isTorrentUrl(s: string): boolean {
  return s.startsWith("magnet:") || ((s.startsWith("http://") || s.startsWith("https://")) && s.includes(".torrent"));
}

async function readClipboard(): Promise<string> {
  try {
    return (await navigator.clipboard.readText()).trim();
  } catch {
    return "";
  }
}

const Toolbar: Component<Props> = (props) => {
  const [showDialog, setShowDialog] = createSignal(false);
  const [magnet, setMagnet] = createSignal("");
  const [error, setError] = createSignal("");
  const [clipLoading, setClipLoading] = createSignal(false);

  const openDialog = async () => {
    // Pre-fill from clipboard if it looks like a torrent URL
    const clip = await readClipboard();
    setMagnet(isTorrentUrl(clip) ? clip : "");
    setError("");
    setShowDialog(true);
  };

  const handleAdd = () => {
    const m = magnet().trim();
    if (!m) return;
    props.onAddSource({ kind: "magnet", value: m });
    setMagnet("");
    setShowDialog(false);
  };

  const handlePasteAndAdd = async () => {
    setClipLoading(true);
    const clip = await readClipboard();
    setClipLoading(false);
    if (!clip) {
      setError("Clipboard is empty");
      return;
    }
    if (!isTorrentUrl(clip)) {
      // Not a ready-to-add URL — open dialog pre-filled so user can inspect/edit
      setMagnet(clip);
      setError("");
      setShowDialog(true);
      return;
    }
    props.onAddSource({ kind: "magnet", value: clip });
  };

  const handleOpenFile = async () => {
    const path = await open({
      multiple: false,
      filters: [{ name: "Torrent", extensions: ["torrent"] }],
    });
    if (!path) return;
    props.onAddSource({ kind: "file", path: path as string });
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") handleAdd();
    if (e.key === "Escape") setShowDialog(false);
  };

  const noSelection = () => props.selectedCount === 0;

  return (
    <>
      <div class="toolbar">
        <button class="btn-primary" onClick={openDialog}>
          <LinkIcon size={14} /> Add Link
        </button>
        <button class="btn-ghost" onClick={handleOpenFile}>
          <FilePlusIcon size={14} /> Add File
        </button>
        <button
          class="toolbar-icon-btn"
          onClick={handlePasteAndAdd}
          disabled={clipLoading()}
          title="Paste magnet or .torrent URL from clipboard"
        >
          <ClipboardIcon size={15} />
        </button>

        <div class="toolbar-divider" />

        <div class="toolbar-icon-group">
          <button class="toolbar-icon-btn" disabled={noSelection()} onClick={() => props.onGroupAction("start")} title="Resume selected">
            <PlayIcon size={15} />
          </button>
          <button class="toolbar-icon-btn" disabled={noSelection()} onClick={() => props.onGroupAction("pause")} title="Pause selected">
            <PauseIcon size={15} />
          </button>
          <button class="toolbar-icon-btn" disabled={noSelection()} onClick={() => props.onGroupAction("stop")} title="Stop selected">
            <SquareIcon size={13} />
          </button>
          <button class="toolbar-icon-btn toolbar-icon-btn-danger" disabled={noSelection()} onClick={() => props.onGroupAction("remove")} title="Remove selected">
            <TrashIcon size={15} />
          </button>
          <button class="toolbar-icon-btn toolbar-icon-btn-danger" disabled={noSelection()} onClick={() => props.onGroupAction("remove-with-data")} title="Remove selected and delete files">
            <TrashDataIcon size={15} />
          </button>
        </div>

        <span class="toolbar-spacer" />

        <div class="search-box">
          <SearchIcon size={14} class="search-icon" />
          <input
            type="text"
            class="search-input"
            placeholder="Search torrents..."
            value={props.search}
            onInput={(e) => props.onSearchChange(e.currentTarget.value)}
          />
        </div>

        <button
          class="toolbar-icon-btn theme-toggle"
          onClick={props.onToggleTheme}
          title={props.theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {props.theme === "dark" ? <SunIcon size={15} /> : <MoonIcon size={15} />}
        </button>
      </div>

      {showDialog() && (
        <div class="dialog-backdrop" onClick={() => setShowDialog(false)}>
          <div class="dialog" onClick={(e) => e.stopPropagation()}>
            <div class="dialog-title">Add Torrent</div>
            <input
              class="dialog-input"
              placeholder="magnet:?xt=urn:btih:… or https://example.com/file.torrent"
              value={magnet()}
              onInput={(e) => setMagnet(e.currentTarget.value)}
              onKeyDown={handleKeyDown}
              autofocus
            />
            {error() && <div class="dialog-error">{error()}</div>}
            <div class="dialog-actions">
              <button class="btn-ghost" onClick={() => setShowDialog(false)}>Cancel</button>
              <button class="btn-primary" onClick={handleAdd} disabled={!magnet().trim()}>
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Toolbar;
