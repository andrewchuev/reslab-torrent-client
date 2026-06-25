# Torrent Client

A lightweight, cross-platform BitTorrent client built with **Rust + Tauri 2** and a **SolidJS** frontend.

---

## Features

- **Magnet links & .torrent files** — add torrents by URL, file picker, drag & drop, or paste from clipboard
- **Real-time stats** — download/upload speed, progress, and peer count updated every second
- **Detail panel** — per-file progress bars and active peer list for the selected torrent
- **System tray** — runs in the background; hide to tray on close, re-open with a click
- **Download-complete notifications** — desktop notification when a torrent finishes
- **Settings** — configurable download folder, speed limits, and startup behavior (persisted to TOML)
- **Sort & zoom** — sort by name, status, progress, speed or size; UI zoom via Ctrl +/−/0
- **DHT** — decentralised peer discovery, no tracker required for magnet links

---

## Screenshots

> *Coming soon — contributions welcome!*

---

## Installation

Download the latest release for your platform from the [Releases](https://github.com/andrewchuev/reslab-torrent-client/releases) page:

| Platform | File |
|----------|------|
| Windows  | `Torrent Client_x.x.x_x64-setup.exe` or `.msi` |
| macOS    | `Torrent Client_x.x.x_universal.dmg` (Intel + Apple Silicon) |
| Linux    | `torrent-client_x.x.x_amd64.AppImage` or `.deb` |

### Notes

- **macOS:** If you see *"unidentified developer"* — right-click the `.app` → **Open**.
- **Windows:** SmartScreen may warn about an unknown publisher — click **More info → Run anyway**.
- **Linux AppImage:** `chmod +x torrent-client_*.AppImage && ./torrent-client_*.AppImage`

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | [Tauri 2](https://tauri.app) |
| Backend / business logic | Rust (stable) |
| BitTorrent engine | [librqbit 9](https://github.com/ikatson/rqbit) |
| Frontend | [SolidJS](https://solidjs.com) + TypeScript |
| Frontend build | [Vite](https://vitejs.dev) |
| Config persistence | TOML (`~/.config/reslab-torrent-client/settings.toml`) |

---

## Building from Source

### Prerequisites

- [Rust](https://rustup.rs) stable toolchain
- [Node.js](https://nodejs.org) LTS
- Platform system libraries:

  **Ubuntu / Debian:**
  ```bash
  sudo apt-get install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf
  ```

  **macOS:** Xcode Command Line Tools (`xcode-select --install`)

  **Windows:** [Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) + [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (pre-installed on Windows 11)

### Run in development

```bash
git clone https://github.com/andrewchuev/reslab-torrent-client.git
cd reslab-torrent-client
npm install
npm run tauri dev
```

### Build release binary

```bash
npm run tauri build
```

Output is in `src-tauri/target/release/bundle/`.

---

## Release Process

Releases are built automatically by GitHub Actions for all three platforms whenever a version tag is pushed:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The workflow produces a Draft GitHub Release with all platform installers attached.

---

## Project Structure

```
reslab-torrent-client/
├── src/                        # SolidJS frontend
│   ├── App.tsx                 # Root component, layout, drag-drop, sorting
│   ├── lib/commands.ts         # Typed Tauri IPC wrappers
│   └── components/
│       ├── Toolbar.tsx         # Add torrent, open file, paste link
│       ├── TorrentRow.tsx      # Single torrent list item
│       ├── DetailPanel.tsx     # Files + peers for selected torrent
│       └── Settings.tsx        # Settings modal
└── src-tauri/                  # Rust backend
    └── src/
        ├── lib.rs              # App setup, tray, background stats emitter
        ├── engine/
        │   └── manager.rs      # TorrentManager wrapping librqbit Session
        ├── commands/
        │   ├── torrent.rs      # Tauri commands: add, pause, resume, remove, details
        │   └── settings.rs     # Tauri commands: get/save settings + TOML I/O
        └── error.rs            # AppError with Tauri-serializable impl
```

---

## Roadmap

- [ ] Per-file selection (download only chosen files)
- [ ] Tracker list tab in detail panel
- [ ] Sequential download mode for streaming
- [ ] RSS feed / auto-download rules
- [ ] Code signing for Windows & macOS releases
- [ ] Dark / light theme toggle

---

## Contributing

Issues and pull requests are welcome. For significant changes please open an issue first to discuss the approach.

```bash
# Run type checks
npx tsc --noEmit

# Run Rust checks
cargo clippy --manifest-path src-tauri/Cargo.toml
```

---

## License

MIT — see [LICENSE](LICENSE) for details.
