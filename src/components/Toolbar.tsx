import { Component, createSignal } from "solid-js";
import { open } from "@tauri-apps/plugin-dialog";
import { TorrentSource } from "../lib/commands";
import { Theme } from "../lib/theme";

interface Props {
  onAddSource: (source: TorrentSource) => void;
  onOpenSettings: () => void;
  theme: Theme;
  onToggleTheme: () => void;
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

  return (
    <>
      <div class="toolbar">
        <button class="btn-primary" onClick={openDialog}>
          + Add Torrent
        </button>
        <button class="btn-ghost" onClick={handleOpenFile}>
          Open File
        </button>
        <button
          class="btn-ghost btn-clipboard"
          onClick={handlePasteAndAdd}
          disabled={clipLoading()}
          title="Paste magnet or .torrent URL from clipboard"
        >
          {clipLoading() ? "…" : "Paste Link"}
        </button>
        <span class="toolbar-spacer" />
        <button
          class="btn-icon theme-toggle"
          onClick={props.onToggleTheme}
          title={props.theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {props.theme === "dark" ? "☀" : "☾"}
        </button>
        <button class="btn-icon" title="Settings" onClick={props.onOpenSettings}>⚙</button>
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
