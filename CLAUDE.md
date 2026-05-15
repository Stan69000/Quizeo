# Voyage DL

## Context

Desktop app for a kid travelling without a phone. The idea: download music as MP3 from YouTube or Deezer before leaving, so it can be played offline.

Initial inspiration: https://github.com/TannerNelson16/playlistdl (a Python/Flask web app). This project keeps the same idea but ships as a native desktop app built with Tauri.

**Note:** the app UI is in French on purpose (it's meant for the author's kid). Code, comments, commits and docs are in English.

## What the app does

The app has two modules, accessible from a home screen:

### Download module
1. The user pastes a URL (YouTube video/playlist, or Deezer playlist)
2. The app parses the URL and fetches the track list
3. For a playlist, the user picks which songs to download
4. Download as MP3 (or M4A) into the chosen folder
5. A persistent download queue handles multiple jobs; a MiniPlayer lets the user listen to already-downloaded tracks while downloading

### Quiz module (blind test)
- Loads a Deezer playlist and plays 30-second previews (or streams via yt-dlp when offline)
- **5 modes**: QCM (multiple choice), free text input, multiplayer (keyboard buzzers), chrono, elimination
- **3 guess targets**: title / artist / both / decade
- **4 difficulty levels** + customisable extract duration + pre-round countdown
- **Jukebox mode**: auto-advance between rounds, plays the full track in the MiniPlayer after each reveal
- Buzz sounds generated via Web Audio API (no external audio files)
- Playlist history with star ratings, best scores, and best chrono times
- Track enrichment: Wikipedia snippet (FR/EN, track > album > artist priority) + MusicBrainz metadata (label, country, year, genres)

## Tech stack

- **Frontend**: React 18 + TypeScript + Vite
- **Backend**: Rust via Tauri v2
- **Downloading**: `yt-dlp` (audio extraction) + `ffmpeg` (MP3 conversion), bundled as Tauri sidecars
- **Deezer**: Deezer public API to fetch playlists, then YouTube lookup via `yt-dlp ytsearch` for each track

## Layout

```
src/                    # React + TypeScript frontend
  App.tsx               # Top-level component, screen routing, download queue state
  types.ts              # Shared TypeScript types
  components/
    SetupScreen.tsx     # First launch: pick the download folder
    HomeScreen.tsx      # Home hub: navigate to Download or Quiz
    MainScreen.tsx      # Download screen: URL input + analysis
    TrackList.tsx       # Track list with selection
    DownloadProgress.tsx # Per-job download progress
    DownloadQueue.tsx   # Multi-job download queue
    MiniPlayer.tsx      # In-app audio player (downloaded files + jukebox)
    QuizScreen.tsx      # Full quiz/blind-test module (~2300 lines)
    Settings.tsx        # Settings modal
    Alert.tsx           # Alert component
  hooks/
    useConfig.ts        # Config read/write hook
    useDownloadedFiles.ts # Scan download folder + fuzzy isDownloaded()
    useTheme.ts         # Dark/light theme toggle (persisted in localStorage)

src-tauri/              # Rust + Tauri v2 backend
  src/
    main.rs             # Entry point
    lib.rs              # Module exports + Tauri state registration
    commands/
      mod.rs            # Shared types (TrackInfo, DownloadSummary, Config)
      config.rs         # Config read/save
      youtube.rs        # YouTube URL analysis via yt-dlp
      deezer.rs         # Deezer playlist fetch + YT search per track
      download.rs       # MP3/M4A download with progress events
      analyze.rs        # Cancel/pause state for Deezer YT-search loop
      cache.rs          # Two-level disk cache (URL→tracks, query→track)
      enrichment.rs     # Wikipedia + MusicBrainz enrichment; yt-dlp stream URLs
    utils/
      sidecar.rs        # Bundled yt-dlp/ffmpeg binary management
  scripts/
    build-ffmpeg-slim.sh # Custom slim ffmpeg build (macOS only)
```

### Navigation flow

```
setup → home → main (download)
             ↘ quiz
```

## Dev prerequisites

- Node.js >= 18
- Rust >= 1.70
- `yt-dlp` and `ffmpeg` on PATH (for dev) — in production the app ships its own sidecars
- Tauri CLI v2: `cargo install tauri-cli --version "^2"`

## Commands

```bash
npm install             # Install frontend deps
cargo tauri dev         # Run in dev mode
cargo tauri build       # Production build (.dmg / .msi)
```

## Conventions

- UI copy is French on purpose (see Context). Everything else — code, comments, commit messages, docs — is English.
- Shared Rust types live in `commands/mod.rs`
- External binaries (yt-dlp, ffmpeg) are managed through Tauri's sidecar system
- On macOS, ffmpeg is built slim from source (~2.5 MB) via `src-tauri/scripts/build-ffmpeg-slim.sh`; on Windows a prebuilt fat binary is downloaded
