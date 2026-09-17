import { Component, createSignal, createEffect, createMemo, on, onMount, onCleanup, For, Show } from "solid-js";
import { getTorrentDetails, TorrentDetails, TorrentInfo } from "../lib/commands";

interface Props {
  torrent: TorrentInfo;
}

type Tab = "files" | "details" | "peers" | "speed";

const MAX_POINTS = 60;
const DEFAULT_PANEL_HEIGHT = 200;
const MIN_PANEL_HEIGHT = 120;
const PANEL_HEIGHT_KEY = "detail-panel-height";

interface SpeedPoint {
  down: number;
  up: number;
}

function fmtBytes(b: number): string {
  if (b === 0) return "0 B";
  if (b >= 1073741824) return (b / 1073741824).toFixed(2) + " GB";
  if (b >= 1048576) return (b / 1048576).toFixed(1) + " MB";
  if (b >= 1024) return (b / 1024).toFixed(0) + " KB";
  return b + " B";
}

function fmtSpeed(bps: number): string {
  return fmtBytes(bps) + "/s";
}

// SVG chart margins, in real CSS pixels — the viewBox is set to the chart's
// actual measured size (see ResizeObserver below), so these are literal pixels,
// not units scaled by a mismatched viewBox/container aspect ratio.
const CHART_PL = 44, CHART_PR = 10, CHART_PT = 8, CHART_PB = 20;

function maxWindowPanelHeight(): number {
  return Math.min(600, window.innerHeight - 250);
}

const DetailPanel: Component<Props> = (props) => {
  const [tab, setTab] = createSignal<Tab>("files");
  const [details, setDetails] = createSignal<TorrentDetails | null>(null);
  const [error, setError] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [speedHistory, setSpeedHistory] = createSignal<SpeedPoint[]>([]);

  const torrentId = createMemo(() => props.torrent.id);

  // Load file details and reset chart when the selected torrent changes.
  createEffect(on(torrentId, async (id) => {
    setDetails(null);
    setError("");
    setLoading(true);
    setSpeedHistory([]);
    try {
      setDetails(await getTorrentDetails(id));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }));

  // Push one data point per stats tick.
  createEffect(() => {
    const state = props.torrent.state;
    const down = state.type === "downloading" ? state.speed_down : 0;
    const up =
      state.type === "downloading" ? state.speed_up :
      state.type === "seeding"     ? state.speed_up : 0;
    setSpeedHistory(prev => {
      const next = [...prev, { down, up }];
      return next.length > MAX_POINTS ? next.slice(1) : next;
    });
  });

  const files = () => details()?.files ?? [];

  // ── Resizable panel height ──────────────────────────────────────────────

  const [panelHeight, setPanelHeight] = createSignal(
    Math.max(MIN_PANEL_HEIGHT, parseInt(localStorage.getItem(PANEL_HEIGHT_KEY) ?? "", 10) || DEFAULT_PANEL_HEIGHT)
  );

  let dragStartY = 0;
  let dragStartHeight = 0;
  let dragMaxHeight = DEFAULT_PANEL_HEIGHT;

  const clampPanelHeight = (h: number, max: number) => Math.max(MIN_PANEL_HEIGHT, Math.min(h, max));

  const handlePointerMove = (e: PointerEvent) => {
    // Dragging the handle up (smaller clientY) grows the panel, since it's docked to the bottom.
    setPanelHeight(clampPanelHeight(dragStartHeight + (dragStartY - e.clientY), dragMaxHeight));
  };

  const handlePointerUp = () => {
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
    document.body.style.userSelect = "";
    localStorage.setItem(PANEL_HEIGHT_KEY, String(panelHeight()));
  };

  const handlePointerDown = (e: PointerEvent) => {
    dragStartY = e.clientY;
    dragStartHeight = panelHeight();
    dragMaxHeight = maxWindowPanelHeight();
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  const handleResetHeight = () => {
    setPanelHeight(DEFAULT_PANEL_HEIGHT);
    localStorage.setItem(PANEL_HEIGHT_KEY, String(DEFAULT_PANEL_HEIGHT));
  };

  // Re-clamp if the window shrinks while the panel is open.
  onMount(() => {
    const onWindowResize = () => {
      const max = maxWindowPanelHeight();
      setPanelHeight(h => clampPanelHeight(h, max));
    };
    window.addEventListener("resize", onWindowResize);
    onCleanup(() => window.removeEventListener("resize", onWindowResize));
  });

  // ── Chart: measure the actual rendered size so the SVG viewBox always
  // matches it exactly — no distortion from a mismatched aspect ratio. ──────

  const [chartWidth, setChartWidth] = createSignal(0);
  const [chartHeight, setChartHeight] = createSignal(0);
  let chartObserver: ResizeObserver | undefined;

  // The <svg> only exists in the DOM while the Speed tab is shown (see the
  // `Show` below), so it's attached via a ref callback rather than onMount —
  // that fires each time the element (re)mounts, not just once for the panel.
  const attachChartRef = (el: SVGSVGElement) => {
    chartObserver?.disconnect();
    chartObserver = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setChartWidth(rect.width);
      setChartHeight(rect.height);
    });
    chartObserver.observe(el);
  };
  onCleanup(() => chartObserver?.disconnect());

  const chartInnerWidth = createMemo(() => Math.max(0, chartWidth() - CHART_PL - CHART_PR));
  const chartInnerHeight = createMemo(() => Math.max(0, chartHeight() - CHART_PT - CHART_PB));
  const chartBaseline = createMemo(() => CHART_PT + chartInnerHeight());

  // ── Chart computations ────────────────────────────────────────────────────

  const maxSpeed = createMemo(() => {
    const h = speedHistory();
    const all = h.flatMap(p => [p.down, p.up]);
    return Math.max(...all, 1024); // floor at 1 KB/s so y-axis always shows a range
  });

  const currentDown = () => {
    const s = props.torrent.state;
    return s.type === "downloading" ? s.speed_down : 0;
  };
  const currentUp = () => {
    const s = props.torrent.state;
    return s.type === "downloading" ? s.speed_up :
           s.type === "seeding"     ? s.speed_up : 0;
  };

  const linePoints = (field: "down" | "up") => createMemo(() => {
    const h = speedHistory();
    const max = maxSpeed();
    const iw = chartInnerWidth();
    const ih = chartInnerHeight();
    if (h.length < 2 || iw === 0) return "";
    return h.map((p, i) => {
      const x = CHART_PL + (i / (MAX_POINTS - 1)) * iw;
      const y = CHART_PT + ih - Math.min(1, p[field] / max) * ih;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
  });

  const areaPoints = (field: "down" | "up") => createMemo(() => {
    const h = speedHistory();
    const max = maxSpeed();
    const iw = chartInnerWidth();
    const ih = chartInnerHeight();
    if (h.length < 2 || iw === 0) return "";
    const body = h.map((p, i) => {
      const x = CHART_PL + (i / (MAX_POINTS - 1)) * iw;
      const y = CHART_PT + ih - Math.min(1, p[field] / max) * ih;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const x0 = CHART_PL.toFixed(1);
    const x1 = (CHART_PL + ((h.length - 1) / (MAX_POINTS - 1)) * iw).toFixed(1);
    const baseline = chartBaseline().toFixed(1);
    return `${x0},${baseline} ${body.join(" ")} ${x1},${baseline}`;
  });

  const downLine = linePoints("down");
  const upLine   = linePoints("up");
  const downArea = areaPoints("down");
  const upArea   = areaPoints("up");

  const yLabels = createMemo(() => {
    const max = maxSpeed();
    const ih = chartInnerHeight();
    return [0, 0.5, 1.0].map(f => ({
      y: (CHART_PT + ih - f * ih).toFixed(1),
      label: f === 0 ? "0" : fmtSpeed(max * f),
    }));
  });

  const hasData = () => speedHistory().length >= 2;
  const chartReady = () => chartWidth() > 0 && chartHeight() > 0;

  return (
    <div class="detail-panel" style={{ height: `${panelHeight()}px` }}>
      <div
        class="detail-resize-handle"
        onPointerDown={handlePointerDown}
        onDblClick={handleResetHeight}
        title="Drag to resize, double-click to reset"
      />

      <div class="detail-tabs">
        <button
          class={`detail-tab${tab() === "files" ? " active" : ""}`}
          onClick={() => setTab("files")}
        >
          Files {files().length > 0 ? `(${files().length})` : ""}
        </button>
        <button
          class={`detail-tab${tab() === "details" ? " active" : ""}`}
          onClick={() => setTab("details")}
        >
          Details
        </button>
        <button
          class={`detail-tab${tab() === "peers" ? " active" : ""}`}
          onClick={() => setTab("peers")}
        >
          Peers {(details()?.peers.length ?? 0) > 0 ? `(${details()!.peers.length})` : ""}
        </button>
        <button
          class={`detail-tab${tab() === "speed" ? " active" : ""}`}
          onClick={() => setTab("speed")}
        >
          Speed
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
          {/* ── FILES TAB ─────────────────────────────────────────── */}
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
                      const downloaded = () => props.torrent.file_progress[i()] ?? 0;
                      const pct  = () => f.size > 0 ? Math.min(100, (downloaded() / f.size) * 100) : 0;
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

          {/* ── DETAILS TAB ───────────────────────────────────────── */}
          <Show when={tab() === "details"}>
            <div class="detail-details-grid">
              <div class="detail-details-item">
                <span class="detail-details-label">Save Path</span>
                <span class="detail-details-value">{details()?.save_path ?? props.torrent.save_path}</span>
              </div>
              <div class="detail-details-item">
                <span class="detail-details-label">Hash</span>
                <span class="detail-details-value">{props.torrent.info_hash}</span>
              </div>
              <div class="detail-details-item">
                <span class="detail-details-label">Added On</span>
                <span class="detail-details-value">{new Date(props.torrent.added_at * 1000).toLocaleString()}</span>
              </div>
              <div class="detail-details-item">
                <span class="detail-details-label">Total Size</span>
                <span class="detail-details-value">{fmtBytes(props.torrent.size_bytes)}</span>
              </div>
              <div class="detail-details-item">
                <span class="detail-details-label">Uploaded</span>
                <span class="detail-details-value">{fmtBytes(props.torrent.uploaded_bytes)}</span>
              </div>
              <div class="detail-details-item">
                <span class="detail-details-label">Connected Peers</span>
                <span class="detail-details-value">{props.torrent.peers_connected}</span>
              </div>
            </div>
          </Show>

          {/* ── PEERS TAB ─────────────────────────────────────────── */}
          <Show when={tab() === "peers"}>
            <Show
              when={(details()?.peers.length ?? 0) > 0}
              fallback={<div class="detail-empty">No peers connected</div>}
            >
              <table class="detail-table">
                <thead>
                  <tr>
                    <th class="col-addr">Address</th>
                    <th class="col-state">State</th>
                    <th class="col-size">Downloaded</th>
                    <th class="col-size">Uploaded</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={details()!.peers}>
                    {(p) => (
                      <tr>
                        <td class="col-addr">{p.addr}</td>
                        <td class="col-state">{p.state}</td>
                        <td class="col-size">{fmtBytes(p.downloaded_bytes)}</td>
                        <td class="col-size">{fmtBytes(p.uploaded_bytes)}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </Show>
          </Show>

          {/* ── SPEED CHART TAB ───────────────────────────────────── */}
          <Show when={tab() === "speed"}>
            <div class="speed-chart-wrapper">
              {/* Live readout */}
              <div class="speed-legend">
                <span class="speed-legend-down">↓ {fmtSpeed(currentDown())}</span>
                <span class="speed-legend-up">↑ {fmtSpeed(currentUp())}</span>
              </div>

              <svg ref={attachChartRef} viewBox={`0 0 ${Math.max(chartWidth(), 1)} ${Math.max(chartHeight(), 1)}`} class="speed-chart">
                <Show when={chartReady()}>
                  {/* Y-axis grid + labels */}
                  <For each={yLabels()}>
                    {(l) => (
                      <g>
                        <line
                          x1={CHART_PL} y1={l.y}
                          x2={chartWidth() - CHART_PR} y2={l.y}
                          stroke="var(--border)" stroke-width="1"
                        />
                        <text
                          x={CHART_PL - 4} y={parseFloat(l.y) + 3}
                          text-anchor="end" font-size="10"
                          fill="var(--text-muted)"
                        >{l.label}</text>
                      </g>
                    )}
                  </For>

                  {/* X-axis baseline */}
                  <line
                    x1={CHART_PL} y1={chartBaseline()}
                    x2={chartWidth() - CHART_PR} y2={chartBaseline()}
                    stroke="var(--border)" stroke-width="1"
                  />

                  <Show when={hasData()}>
                    {/* Area fills */}
                    <polygon points={downArea()} fill="var(--accent)" opacity="0.1" />
                    <polygon points={upArea()}   fill="var(--green)"  opacity="0.1" />
                    {/* Lines */}
                    <polyline
                      points={downLine()}
                      fill="none" stroke="var(--accent)" stroke-width="1.5"
                      stroke-linejoin="round" stroke-linecap="round"
                    />
                    <polyline
                      points={upLine()}
                      fill="none" stroke="var(--green)" stroke-width="1.5"
                      stroke-linejoin="round" stroke-linecap="round"
                    />
                  </Show>

                  <Show when={!hasData()}>
                    <text x={chartWidth() / 2} y={chartHeight() / 2} text-anchor="middle" font-size="11" fill="var(--text-muted)">
                      Collecting data…
                    </text>
                  </Show>

                  {/* X label */}
                  <text x={CHART_PL + chartInnerWidth() / 2} y={chartHeight() - 4} text-anchor="middle" font-size="10" fill="var(--text-muted)">
                    last 60 s
                  </text>
                </Show>
              </svg>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
};

export default DetailPanel;
