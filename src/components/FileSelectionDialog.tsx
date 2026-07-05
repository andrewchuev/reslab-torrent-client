import { Component, createEffect, createMemo, createSignal, onCleanup, onMount, For, Show } from "solid-js";
import { FileInfo, TorrentListing } from "../lib/commands";

interface Props {
  listing: TorrentListing | null;
  loading: boolean;
  error: string;
  onConfirm: (fileIndices: number[]) => void;
  onCancel: () => void;
}

type TreeFile = { kind: "file"; index: number; name: string; size: number };
type TreeFolder = { kind: "folder"; name: string; children: TreeNode[] };
type TreeNode = TreeFile | TreeFolder;

// Padding files exist only for piece-alignment, not real content — excluded
// from the tree and from selection entirely (mirrors librqbit's own web UI).
function buildTree(files: FileInfo[]): TreeNode[] {
  const root: TreeNode[] = [];
  files.forEach((f, index) => {
    if (f.padding) return;
    const parts = f.components.length > 0 ? f.components : [f.name];
    let siblings = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      let folder = siblings.find((n): n is TreeFolder => n.kind === "folder" && n.name === part);
      if (!folder) {
        folder = { kind: "folder", name: part, children: [] };
        siblings.push(folder);
      }
      siblings = folder.children;
    }
    siblings.push({ kind: "file", index, name: parts[parts.length - 1] ?? f.name, size: f.size });
  });
  return root;
}

function collectIndices(node: TreeNode): number[] {
  return node.kind === "file" ? [node.index] : node.children.flatMap(collectIndices);
}

function fmtBytes(b: number): string {
  if (b === 0) return "0 B";
  if (b >= 1073741824) return (b / 1073741824).toFixed(2) + " GB";
  if (b >= 1048576) return (b / 1048576).toFixed(1) + " MB";
  if (b >= 1024) return (b / 1024).toFixed(0) + " KB";
  return b + " B";
}

const TriCheckbox: Component<{ checked: boolean; indeterminate: boolean; onChange: () => void }> = (p) => {
  let ref: HTMLInputElement | undefined;
  createEffect(() => {
    if (ref) ref.indeterminate = p.indeterminate;
  });
  return (
    <input
      type="checkbox"
      ref={ref}
      checked={p.checked}
      onClick={(e) => e.stopPropagation()}
      onChange={p.onChange}
    />
  );
};

const FileSelectionDialog: Component<Props> = (props) => {
  const [selected, setSelected] = createSignal<Set<number>>(new Set());

  // Reset selection to the (server-suggested) default whenever a new listing arrives.
  createEffect(() => {
    const listing = props.listing;
    if (!listing) return;
    setSelected(new Set(listing.files.flatMap((f, i) => (!f.padding && f.included ? [i] : []))));
  });

  const tree = createMemo(() => (props.listing ? buildTree(props.listing.files) : []));

  const selectableCount = createMemo(() => props.listing?.files.filter((f) => !f.padding).length ?? 0);

  const totalSize = createMemo(() => {
    const listing = props.listing;
    if (!listing) return 0;
    const sel = selected();
    return listing.files.reduce((sum, f, i) => (sel.has(i) ? sum + f.size : sum), 0);
  });

  const toggleIndices = (indices: number[], select: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const i of indices) {
        if (select) next.add(i);
        else next.delete(i);
      }
      return next;
    });
  };

  const checkAll = () => {
    const listing = props.listing;
    if (!listing) return;
    setSelected(new Set(listing.files.flatMap((f, i) => (f.padding ? [] : [i]))));
  };

  const uncheckAll = () => setSelected(new Set<number>());

  const nodeState = (node: TreeNode, sel: Set<number>): "all" | "none" | "some" => {
    const indices = collectIndices(node);
    const selectedCount = indices.filter((i) => sel.has(i)).length;
    if (selectedCount === 0) return "none";
    return selectedCount === indices.length ? "all" : "some";
  };

  const Node: Component<{ node: TreeNode; depth: number }> = (p) => {
    const state = () => nodeState(p.node, selected());
    const toggle = () => toggleIndices(collectIndices(p.node), state() !== "all");

    return (
      <div>
        <div class="file-tree-row" style={{ "padding-left": `${p.depth * 18}px` }} onClick={toggle}>
          <TriCheckbox checked={state() === "all"} indeterminate={state() === "some"} onChange={toggle} />
          <span class={p.node.kind === "folder" ? "file-tree-folder" : "file-tree-file"}>
            {p.node.kind === "folder" ? "📁" : "📄"} {p.node.name}
          </span>
          <Show when={p.node.kind === "file"}>
            <span class="file-tree-size">{fmtBytes((p.node as TreeFile).size)}</span>
          </Show>
        </div>
        <Show when={p.node.kind === "folder"}>
          <For each={(p.node as TreeFolder).children}>{(child) => <Node node={child} depth={p.depth + 1} />}</For>
        </Show>
      </div>
    );
  };

  const dismiss = () => {
    if (!props.loading) props.onCancel();
  };

  onMount(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  return (
    <div class="dialog-backdrop" onClick={dismiss}>
      <div class="dialog file-selection-dialog" onClick={(e) => e.stopPropagation()}>
        <div class="dialog-title">Select Files</div>

        <Show when={props.loading}>
          <div class="detail-loading">Resolving torrent metadata…</div>
        </Show>

        <Show when={props.error}>
          <div class="dialog-error">{props.error}</div>
          <div class="dialog-actions">
            <button class="btn-ghost" onClick={props.onCancel}>Close</button>
          </div>
        </Show>

        <Show when={!props.loading && !props.error && props.listing}>
          {(listing) => (
            <>
              <div class="file-selection-meta">
                <div class="file-selection-name" title={listing().name}>{listing().name}</div>
                <div class="file-selection-path">{listing().output_folder}</div>
              </div>
              <div class="file-tree">
                <For each={tree()}>{(node) => <Node node={node} depth={0} />}</For>
              </div>
              <div class="file-selection-footer">
                <span>
                  {selected().size} of {selectableCount()} files selected · {fmtBytes(totalSize())}
                </span>
                <span class="file-selection-footer-spacer" />
                <button class="group-btn" onClick={checkAll}>Check All</button>
                <button class="group-btn" onClick={uncheckAll}>Uncheck All</button>
              </div>
              <div class="dialog-actions">
                <button class="btn-ghost" onClick={props.onCancel}>Cancel</button>
                <button
                  class="btn-primary"
                  disabled={selected().size === 0}
                  onClick={() => props.onConfirm([...selected()])}
                >
                  Add
                </button>
              </div>
            </>
          )}
        </Show>
      </div>
    </div>
  );
};

export default FileSelectionDialog;
