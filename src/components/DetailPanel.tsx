import { Component, createSignal, createEffect, createMemo, on, For, Show } from "solid-js";
import { getTorrentDetails, TorrentDetails, TorrentInfo } from "../lib/commands";

interface Props {
  torrent: TorrentInfo;
}

type Tab = "files" | "peers";

function fmtBytes(b: number): string {
  if (b === 0) return "0 B";
  if (b >= 1073741824) return (b / 1073741824).toFixed(2) + " GB";
  if (b >= 1048576) return (b / 1048576).toFixed(1) + " MB";
  if (b >= 1024) return (b / 1024).toFixed(0) + " KB";
  return b + " B";
}

const DetailPanel: Component<Props> = (props) => {
  const [tab, setTab] = createSignal<Tab>("files");
  const [details, setDetails] = createSignal<TorrentDetails | null>(null);
  const [error, setError] = createSignal("");
  const [loading, setLoading] = createSignal(false);

  // createMemo applies === before propagating — so on() only fires when the id
  // string actually changes (i.e. user switches to a different torrent), not on
  // every stats tick where props.torrent is a new object with the same id.
  const torrentId = createMemo(() => props.torrent.id);

  createEffect(on(torrentId, async (id) => {
    setDetails(null);
    setError("");
    setLoading(true);
    try {
      setDetails(await getTorrentDetails(id));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }));

  const files = () => details()?.files ?? [];
  const peers = () => details()?.peers ?? [];

  return (
    <div class="detail-panel">
      <div class="detail-tabs">
        <button
          class={`detail-tab${tab() === "files" ? " active" : ""}`}
          onClick={() => setTab("files")}
        >
          Files {files().length > 0 ? `(${files().length})` : ""}
        </button>
        <button
          class={`detail-tab${tab() === "peers" ? " active" : ""}`}
          onClick={() => setTab("peers")}
        >
          Peers
        </button>
        <div class="detail-torrent-name">{props.torrent.name}</div>
      </div>

      <div class="detail-body">
        <Show when={loading()}>
          <div class="detail-loading">Loading…</div>
        </Show>
        <Show when={error()}>
          <div class="detail-error">{error()}</div>
        </Show>

        <Show when={!loading() && !error()}>
          {/* FILES TAB */}
          <Show when={tab() === "files"}>
            <Show
              when={files().length > 0}
              fallback={<div class="detail-empty">No file information available yet</div>}
            >
              <table class="detail-table">
                <thead>
                  <tr>
                    <th class="col-name">Name</th>
                    <th class="col-progress-hdr">Progress</th>
                    <th class="col-size">Downloaded</th>
                    <th class="col-size">Size</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={files()}>
                    {(f, i) => {
                      // file_progress comes from the live torrent-stats stream every second.
                      // props.torrent is a reactive getter so this updates in place without
                      // re-running the For or remounting rows.
                      const downloaded = () => props.torrent.file_progress[i()] ?? 0;
                      const pct = () => f.size > 0 ? Math.min(100, (downloaded() / f.size) * 100) : 0;
                      const done = () => f.size > 0 && downloaded() >= f.size;
                      return (
                        <tr class={f.included ? "" : "excluded"}>
                          <td class="col-name" title={f.name}>{f.name}</td>
                          <td class="col-progress">
                            <div class="file-progress-bar">
                              <div
                                class={`file-progress-fill${done() ? " done" : ""}`}
                                style={{ width: `${pct().toFixed(1)}%` }}
                              />
                            </div>
                            <span class="file-progress-pct">
                              {done() ? "100%" : `${pct().toFixed(0)}%`}
                            </span>
                          </td>
                          <td class="col-size">{fmtBytes(downloaded())}</td>
                          <td class="col-size">{fmtBytes(f.size)}</td>
                        </tr>
                      );
                    }}
                  </For>
                </tbody>
              </table>
            </Show>
          </Show>

          {/* PEERS TAB */}
          <Show when={tab() === "peers"}>
            <Show
              when={peers().length > 0}
              fallback={<div class="detail-empty">No active peers</div>}
            >
              <table class="detail-table">
                <thead>
                  <tr>
                    <th class="col-addr">Address</th>
                    <th class="col-state">State</th>
                    <th class="col-speed">Downloaded</th>
                    <th class="col-speed">Uploaded</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={peers()}>
                    {(p) => (
                      <tr>
                        <td class="col-addr">{p.addr}</td>
                        <td class="col-state">{p.state}</td>
                        <td class="col-speed">{fmtBytes(p.downloaded_bytes)}</td>
                        <td class="col-speed">{fmtBytes(p.uploaded_bytes)}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </Show>
          </Show>
        </Show>
      </div>
    </div>
  );
};

export default DetailPanel;
