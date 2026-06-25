import { Component, createSignal, onMount, Show } from "solid-js";
import { open } from "@tauri-apps/plugin-dialog";
import { AppSettings, getSettings, saveSettings } from "../lib/commands";

interface Props {
  onClose: () => void;
}

const Settings: Component<Props> = (props) => {
  const [settings, setSettings] = createSignal<AppSettings | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [saved, setSaved] = createSignal(false);
  const [error, setError] = createSignal("");

  onMount(async () => {
    try {
      setSettings(await getSettings());
    } catch (e) {
      setError(String(e));
    }
  });

  const update = (patch: Partial<AppSettings>) =>
    setSettings((s) => s ? { ...s, ...patch } : s);

  const handleBrowse = async () => {
    const dir = await open({ directory: true, multiple: false });
    if (dir) update({ download_path: dir as string });
  };

  const handleSave = async () => {
    const s = settings();
    if (!s) return;
    setSaving(true);
    setError("");
    try {
      await saveSettings(s);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const formatSpeed = (bytes: number) => {
    if (bytes === 0) return "Unlimited";
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB/s`;
    return `${(bytes / 1024).toFixed(0)} KB/s`;
  };

  return (
    <div class="dialog-backdrop" onClick={props.onClose}>
      <div class="dialog settings-dialog" onClick={(e) => e.stopPropagation()}>
        <div class="settings-header">
          <div class="dialog-title">Settings</div>
          <button class="btn-icon-sm" onClick={props.onClose}>✕</button>
        </div>

        <Show when={settings()} fallback={<div class="settings-loading">Loading…</div>}>
          <div class="settings-body">

            <div class="settings-group">
              <div class="settings-group-label">Downloads</div>

              <div class="settings-row">
                <label class="settings-label">Download folder</label>
                <div class="settings-path-row">
                  <input
                    class="dialog-input settings-path-input"
                    value={settings()!.download_path}
                    onInput={(e) => update({ download_path: e.currentTarget.value })}
                  />
                  <button class="btn-ghost" onClick={handleBrowse}>Browse…</button>
                </div>
              </div>

              <div class="settings-row">
                <label class="settings-label">Max simultaneous torrents</label>
                <div class="settings-stepper">
                  <button
                    class="zoom-btn"
                    onClick={() => update({ max_active_torrents: Math.max(1, settings()!.max_active_torrents - 1) })}
                    disabled={settings()!.max_active_torrents <= 1}
                  >−</button>
                  <span class="settings-stepper-val">{settings()!.max_active_torrents}</span>
                  <button
                    class="zoom-btn"
                    onClick={() => update({ max_active_torrents: settings()!.max_active_torrents + 1 })}
                  >+</button>
                </div>
              </div>
            </div>

            <div class="settings-group">
              <div class="settings-group-label">Speed limits</div>

              <div class="settings-row">
                <label class="settings-label">
                  Download limit <span class="settings-hint">{formatSpeed(settings()!.max_download_speed)}</span>
                </label>
                <div class="settings-slider-row">
                  <span class="settings-hint">0</span>
                  <input
                    type="range" min="0" max="104857600" step="102400"
                    value={settings()!.max_download_speed}
                    onInput={(e) => update({ max_download_speed: Number(e.currentTarget.value) })}
                    class="settings-slider"
                  />
                  <span class="settings-hint">100 MB/s</span>
                </div>
              </div>

              <div class="settings-row">
                <label class="settings-label">
                  Upload limit <span class="settings-hint">{formatSpeed(settings()!.max_upload_speed)}</span>
                </label>
                <div class="settings-slider-row">
                  <span class="settings-hint">0</span>
                  <input
                    type="range" min="0" max="104857600" step="102400"
                    value={settings()!.max_upload_speed}
                    onInput={(e) => update({ max_upload_speed: Number(e.currentTarget.value) })}
                    class="settings-slider"
                  />
                  <span class="settings-hint">100 MB/s</span>
                </div>
              </div>
            </div>

            <div class="settings-group">
              <div class="settings-group-label">Startup</div>
              <div class="settings-row settings-row-check">
                <label class="settings-label">Start minimized to tray</label>
                <input
                  type="checkbox"
                  class="settings-checkbox"
                  checked={settings()!.start_minimized}
                  onChange={(e) => update({ start_minimized: e.currentTarget.checked })}
                />
              </div>
            </div>

          </div>

          {error() && <div class="dialog-error" style={{ margin: "0 20px 12px" }}>{error()}</div>}

          <div class="settings-footer">
            <button class="btn-ghost" onClick={props.onClose}>Cancel</button>
            <button class="btn-primary" onClick={handleSave} disabled={saving()}>
              {saved() ? "✓ Saved" : saving() ? "Saving…" : "Save"}
            </button>
          </div>
        </Show>
      </div>
    </div>
  );
};

export default Settings;
