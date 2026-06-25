import { Component, createSignal, createEffect, createMemo, on, For, Show } from "solid-js";
import { getTorrentDetails, TorrentDetails, TorrentInfo } from "../lib/commands";

interface Props {
  torrent: TorrentInfo;
}

type Tab = "files" | "speed";

const MAX_POINTS = 60;

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

// SVG chart coordinate constants (viewBox 0 0 400 100)
const PL = 50, PR = 8, PT = 6, PB = 18;
const IW = 400 - PL - PR;  // 342  — inner width
const IH = 100 - PT - PB;  // 76   — inner height
const BASELINE = PT + IH;  // 82

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
    if (h.length < 2) return "";
    return h.map((p, i) => {
      const x = PL + (i / (MAX_POINTS - 1)) * IW;
      const y = PT + IH - Math.min(1, p[field] / max) * IH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
  });

  const areaPoints = (field: "down" | "up") => createMemo(() => {
    const h = speedHistory();
    const max = maxSpeed();
    if (h.length < 2) return "";
    const body = h.map((p, i) => {
      const x = PL + (i / (MAX_POINTS - 1)) * IW;
      const y = PT + IH - Math.min(1, p[field] / max) * IH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const x0 = PL.toFixed(1);
    const x1 = (PL + ((h.length - 1) / (MAX_POINTS - 1)) * IW).toFixed(1);
    return `${x0},${BASELINE} ${body.join(" ")} ${x1},${BASELINE}`;
  });

  const downLine = linePoints("down");
  const upLine   = linePoints("up");
  const downArea = areaPoints("down");
  const upArea   = areaPoints("up");

  const yLabels = createMemo(() => {
    const max = maxSpeed();
    return [0, 0.5, 1.0].map(f => ({
      y: (PT + IH - f * IH).toFixed(1),
      label: f === 0 ? "0" : fmtSpeed(max * f),
    }));
  });

  const hasData = () => speedHistory().length >= 2;

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

          {/* ── SPEED CHART TAB ───────────────────────────────────── */}
          <Show when={tab() === "speed"}>
            <div class="speed-chart-wrapper">
              {/* Live readout */}
              <div class="speed-legend">
                <span class="speed-legend-down">↓ {fmtSpeed(currentDown())}</span>
                <span class="speed-legend-up">↑ {fmtSpeed(currentUp())}</span>
              </div>

              <svg viewBox="0 0 400 100" class="speed-chart" preserveAspectRatio="none">
                {/* Y-axis grid + labels */}
                <For each={yLabels()}>
                  {(l) => (
                    <g>
                      <line
                        x1={PL} y1={l.y}
                        x2={400 - PR} y2={l.y}
                        stroke="var(--border)" stroke-width="0.5"
                      />
                      <text
                        x={PL - 3} y={parseFloat(l.y) + 2.5}
                        text-anchor="end" font-size="6.5"
                        fill="var(--text-muted)"
                      >{l.label}</text>
                    </g>
                  )}
                </For>

                {/* X-axis baseline */}
                <line
                  x1={PL} y1={BASELINE}
                  x2={400 - PR} y2={BASELINE}
                  stroke="var(--border)" stroke-width="0.8"
                />

                <Show when={hasData()}>
                  {/* Area fills */}
                  <polygon points={downArea()} fill="var(--accent)" opacity="0.1" />
                  <polygon points={upArea()}   fill="var(--green)"  opacity="0.1" />
                  {/* Lines */}
                  <polyline
                    points={downLine()}
                    fill="none" stroke="var(--accent)" stroke-width="1.2"
                    stroke-linejoin="round" stroke-linecap="round"
                    vector-effect="non-scaling-stroke"
                  />
                  <polyline
                    points={upLine()}
                    fill="none" stroke="var(--green)" stroke-width="1.2"
                    stroke-linejoin="round" stroke-linecap="round"
                    vector-effect="non-scaling-stroke"
                  />
                </Show>

                <Show when={!hasData()}>
                  <text x="200" y="55" text-anchor="middle" font-size="9" fill="var(--text-muted)">
                    Collecting data…
                  </text>
                </Show>

                {/* X label */}
                <text x={PL + IW / 2} y="98" text-anchor="middle" font-size="6.5" fill="var(--text-muted)">
                  last 60 s
                </text>
              </svg>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
};

export default DetailPanel;
