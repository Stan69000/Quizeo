/// Deezer playlist fetching commands.
///
/// Handles extracting track information from Deezer playlists via the public API
/// and searching for those tracks on YouTube.

use crate::commands::analyze::AnalyzeState;
use crate::commands::cache::FetchCache;
use crate::commands::TrackInfo;
use crate::utils::sidecar::{find_sidecar, spawn_sidecar};
use reqwest::Client;
use serde::Deserialize;
use tauri::{command, AppHandle, Emitter, Manager, State};

/// Progress event emitted during Deezer playlist analysis.
#[derive(Debug, Clone, serde::Serialize)]
struct AnalyzeProgress {
    current: usize,
    total: usize,
    track_title: String,
    artist: String,
    status: String,
}

/// Dev-only logging macro. Compiles to nothing in release builds.
macro_rules! dev_log {
    ($($arg:tt)*) => {
        #[cfg(debug_assertions)]
        eprintln!("[deezer] {}", format!($($arg)*));
    };
}

#[derive(Debug, Deserialize)]
struct DeezerPlaylistResponse {
    tracks: DeezerTracksData,
}

#[derive(Debug, Deserialize)]
struct DeezerTracksData {
    data: Vec<DeezerTrack>,
    next: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DeezerTracksPage {
    data: Vec<DeezerTrack>,
    next: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DeezerTrack {
    #[allow(dead_code)]
    id: u64,
    title: String,
    #[serde(default)]
    duration: u32,
    artist: DeezerArtist,
    #[serde(default)]
    album: Option<DeezerAlbum>,
    /// 30s MP3 preview URL hosted by Deezer (used by the quiz mode)
    #[serde(default)]
    preview: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DeezerArtist {
    name: String,
}

#[derive(Debug, Deserialize)]
struct DeezerAlbum {
    title: String,
    #[serde(default)]
    cover_big: Option<String>,
    #[serde(default)]
    release_date: Option<String>,
}

/// Fetches all tracks from a Deezer playlist and searches for them on YouTube.
///
/// This command:
/// 1. Extracts the playlist ID from the URL
/// 2. Fetches all tracks from the playlist via the public Deezer API (handles pagination)
/// 3. For each track, searches YouTube and retrieves the video URL
/// 4. Returns a list of TrackInfo objects ready for download
#[command]
pub async fn fetch_deezer_playlist(
    app: AppHandle,
    analyze_state: State<'_, AnalyzeState>,
    cache: State<'_, FetchCache>,
    url: String,
) -> Result<Vec<TrackInfo>, String> {
    analyze_state.reset();
    dev_log!("Starting fetch for {}", url);

    let client = Client::new();

    let playlist_id = extract_playlist_id(&url)?;
    dev_log!("Extracted playlist ID: {}", playlist_id);

    // Fetch first page (embedded in playlist response)
    let playlist_url = format!("https://api.deezer.com/playlist/{}", playlist_id);
    dev_log!("Calling Deezer API: {}", playlist_url);

    let response = client
        .get(&playlist_url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch Deezer playlist: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Failed to fetch playlist (status {}): Make sure the playlist ID is correct",
            response.status()
        ));
    }

    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read Deezer response body: {}", e))?;

    dev_log!("API response received ({} bytes)", body.len());

    let playlist: DeezerPlaylistResponse = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse Deezer playlist response: {} (at byte {})", e, e.column()))?;

    let mut deezer_tracks = playlist.tracks.data;
    let mut next_url = playlist.tracks.next;
    dev_log!("First page: {} tracks loaded", deezer_tracks.len());

    // Handle pagination
    #[allow(unused_variables, unused_mut, unused_assignments)]
    let mut page_num = 1;
    while let Some(ref url) = next_url {
        page_num += 1;
        dev_log!("Pagination: loading page {}...", page_num);

        let response = client
            .get(url)
            .send()
            .await
            .map_err(|e| format!("Failed to fetch next page of tracks: {}", e))?;

        let page_body = response
            .text()
            .await
            .map_err(|e| format!("Failed to read tracks page body: {}", e))?;

        let page: DeezerTracksPage = serde_json::from_str(&page_body)
            .map_err(|e| format!("Failed to parse tracks page: {}", e))?;

        dev_log!("Page {}: {} additional tracks", page_num, page.data.len());
        deezer_tracks.extend(page.data);
        next_url = page.next;
    }

    if deezer_tracks.is_empty() {
        return Err("Playlist is empty".to_string());
    }

    dev_log!("Deezer total: {} tracks. Starting YouTube search...", deezer_tracks.len());

    // Find yt-dlp for YouTube search
    let yt_dlp_path = find_sidecar("yt-dlp").map_err(|e| {
        format!(
            "yt-dlp not found. Make sure it's installed or bundled with the app: {}",
            e
        )
    })?;

    let mut tracks = Vec::new();
    let total = deezer_tracks.len();

    for (idx, deezer_track) in deezer_tracks.iter().enumerate() {
        // Check cancel
        if analyze_state.is_cancelled() {
            dev_log!("Analysis cancelled at track {}/{}", idx + 1, total);
            break;
        }

        // Wait while paused
        while analyze_state.is_paused() {
            if analyze_state.is_cancelled() {
                break;
            }
            let progress = AnalyzeProgress {
                current: idx + 1,
                total,
                track_title: deezer_track.title.clone(),
                artist: deezer_track.artist.name.clone(),
                status: "paused".to_string(),
            };
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.emit("analyze-progress", &progress);
            }
            tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        }

        let search_query = format!(
            "ytsearch3:{} {}",
            deezer_track.artist.name, deezer_track.title
        );

        // Emit progress to frontend
        let progress = AnalyzeProgress {
            current: idx + 1,
            total,
            track_title: deezer_track.title.clone(),
            artist: deezer_track.artist.name.clone(),
            status: "searching".to_string(),
        };
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.emit("analyze-progress", &progress);
        }
        tokio::task::yield_now().await;

        // Check per-track cache first
        if let Some(cached_track) = cache.get_track(&search_query) {
            dev_log!("[{}/{}] Cache hit: {} - {}", idx + 1, total, deezer_track.artist.name, deezer_track.title);
            tracks.push(cached_track);
            continue;
        }

        dev_log!(
            "[{}/{}] YT search: {} - {}",
            idx + 1, total, deezer_track.artist.name, deezer_track.title
        );

        let yt_args = vec!["--dump-json".to_string(), search_query.clone()];

        // Spawn yt-dlp with PID tracking for cancellation
        let child = spawn_sidecar(&yt_dlp_path, &yt_args)?;

        if let Some(pid) = child.id() {
            *analyze_state.current_pid.lock().unwrap() = Some(pid);
        }

        let output = child
            .wait_with_output()
            .await
            .map_err(|e| format!("yt-dlp process error: {}", e))?;

        *analyze_state.current_pid.lock().unwrap() = None;

        // Check if cancelled during yt-dlp
        if analyze_state.is_cancelled() {
            dev_log!("Analysis cancelled during search for track {}/{}", idx + 1, total);
            break;
        }

        if output.status.success() {
            // ytsearch3 returns up to 3 JSON objects, one per line.
            let stdout = String::from_utf8_lossy(&output.stdout);
            let candidates: Vec<serde_json::Value> = stdout
                .lines()
                .filter(|l| !l.trim().is_empty())
                .filter_map(|l| serde_json::from_str(l).ok())
                .collect();

            let mut ids: Vec<&str> = candidates
                .iter()
                .filter_map(|v| v.get("id").and_then(|x| x.as_str()))
                .collect();

            if let Some(yt_id) = ids.first().copied() {
                let primary_thumb = candidates[0]
                    .get("thumbnail")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                let fallback_urls: Vec<String> = ids
                    .drain(1..)
                    .map(|id| format!("https://www.youtube.com/watch?v={}", id))
                    .collect();

                dev_log!(
                    "[{}/{}] Found: https://youtube.com/watch?v={} (+{} fallbacks)",
                    idx + 1, total, yt_id, fallback_urls.len()
                );

                let track_info = TrackInfo {
                    id: yt_id.to_string(),
                    title: deezer_track.title.clone(),
                    artist: deezer_track.artist.name.clone(),
                    url: format!("https://www.youtube.com/watch?v={}", yt_id),
                    thumbnail_url: primary_thumb,
                    duration_seconds: deezer_track.duration,
                    album: deezer_track.album.as_ref().map(|a| a.title.clone()),
                    album_cover_url: deezer_track.album.as_ref().and_then(|a| a.cover_big.clone()),
                    track_number: Some((idx + 1) as u32),
                    year: None,
                    fallback_urls,
                };

                cache.set_track(&search_query, &track_info);
                tracks.push(track_info);
            } else {
                dev_log!("[{}/{}] No YouTube results", idx + 1, total);
            }
        } else {
            #[allow(unused_variables)]
            let stderr = String::from_utf8_lossy(&output.stderr);
            dev_log!("[{}/{}] yt-dlp ERROR: {}", idx + 1, total, stderr);
        }
    }

    dev_log!("Search done: {}/{} tracks found on YouTube", tracks.len(), total);

    if tracks.is_empty() {
        return Err(
            "No tracks found or could not search YouTube for any of them".to_string(),
        );
    }

    Ok(tracks)
}

/// Fetches a single track from Deezer and searches for it on YouTube.
#[command]
pub async fn fetch_deezer_track(
    app: AppHandle,
    analyze_state: State<'_, AnalyzeState>,
    cache: State<'_, FetchCache>,
    url: String,
) -> Result<Vec<TrackInfo>, String> {
    analyze_state.reset();
    dev_log!("Starting track fetch for {}", url);

    let track_id = extract_track_id(&url)?;

    let client = Client::new();
    let api_url = format!("https://api.deezer.com/track/{}", track_id);
    dev_log!("Calling Deezer API: {}", api_url);

    let response = client
        .get(&api_url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch Deezer track: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Failed to fetch track (status {})", response.status()));
    }

    let body = response.text().await
        .map_err(|e| format!("Failed to read Deezer response: {}", e))?;

    #[derive(Deserialize)]
    struct DeezerSingleTrack {
        title: String,
        #[serde(default)]
        duration: u32,
        artist: DeezerArtist,
        #[serde(default)]
        album: Option<DeezerAlbum>,
    }

    let deezer_track: DeezerSingleTrack = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse Deezer track: {}", e))?;

    let search_query = format!("ytsearch3:{} {}", deezer_track.artist.name, deezer_track.title);

    // Check per-track cache
    if let Some(cached) = cache.get_track(&search_query) {
        dev_log!("Cache hit: {} - {}", deezer_track.artist.name, deezer_track.title);
        return Ok(vec![cached]);
    }

    dev_log!("YT search: {} - {}", deezer_track.artist.name, deezer_track.title);

    // Emit progress
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("analyze-progress", &AnalyzeProgress {
            current: 1,
            total: 1,
            track_title: deezer_track.title.clone(),
            artist: deezer_track.artist.name.clone(),
            status: "searching".to_string(),
        });
    }

    let yt_dlp_path = find_sidecar("yt-dlp").map_err(|e| format!("yt-dlp not found: {}", e))?;
    let yt_args = vec!["--dump-json".to_string(), search_query.clone()];

    let child = spawn_sidecar(&yt_dlp_path, &yt_args)?;
    if let Some(pid) = child.id() {
        *analyze_state.current_pid.lock().unwrap() = Some(pid);
    }

    let output = child.wait_with_output().await
        .map_err(|e| format!("yt-dlp process error: {}", e))?;
    *analyze_state.current_pid.lock().unwrap() = None;

    if analyze_state.is_cancelled() {
        return Ok(vec![]);
    }

    if !output.status.success() {
        return Err(format!("Failed to find track on YouTube"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let candidates: Vec<serde_json::Value> = stdout
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect();

    let mut ids: Vec<&str> = candidates
        .iter()
        .filter_map(|v| v.get("id").and_then(|x| x.as_str()))
        .collect();

    let yt_id = ids.first().copied()
        .ok_or_else(|| "No YouTube video found".to_string())?;
    let primary_thumb = candidates[0]
        .get("thumbnail")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let fallback_urls: Vec<String> = ids
        .drain(1..)
        .map(|id| format!("https://www.youtube.com/watch?v={}", id))
        .collect();

    let track_info = TrackInfo {
        id: yt_id.to_string(),
        title: deezer_track.title,
        artist: deezer_track.artist.name,
        url: format!("https://www.youtube.com/watch?v={}", yt_id),
        thumbnail_url: primary_thumb,
        duration_seconds: deezer_track.duration,
        album: deezer_track.album.as_ref().map(|a| a.title.clone()),
        album_cover_url: deezer_track.album.as_ref().and_then(|a| a.cover_big.clone()),
        track_number: Some(1),
        year: None,
        fallback_urls,
    };

    cache.set_track(&search_query, &track_info);
    Ok(vec![track_info])
}

/// Quiz-mode track: minimal info + a 30s preview URL straight from Deezer.
/// No YouTube search involved — the quiz plays the Deezer preview directly.
#[derive(Debug, Clone, serde::Serialize)]
pub struct QuizTrack {
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub cover_url: Option<String>,
    pub preview_url: String,
    pub year: Option<String>,
}

/// Fetches a Deezer playlist for the quiz mode.
///
/// Unlike `fetch_deezer_playlist`, this does NOT search YouTube — it just
/// returns Deezer's 30s preview URL for each track, which the quiz UI will
/// stream directly. Much faster (no yt-dlp involved).
#[command]
pub async fn fetch_deezer_playlist_for_quiz(
    url: String,
) -> Result<Vec<QuizTrack>, String> {
    dev_log!("Quiz fetch for {}", url);
    let client = Client::new();
    let playlist_id = extract_playlist_id(&url)?;
    let playlist_url = format!("https://api.deezer.com/playlist/{}", playlist_id);

    let response = client.get(&playlist_url).send().await
        .map_err(|e| format!("Failed to fetch Deezer playlist: {}", e))?;
    if !response.status().is_success() {
        return Err(format!("Failed to fetch playlist (status {})", response.status()));
    }
    let body = response.text().await
        .map_err(|e| format!("Failed to read Deezer response: {}", e))?;

    let playlist: DeezerPlaylistResponse = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse Deezer playlist: {}", e))?;

    let mut deezer_tracks = playlist.tracks.data;
    let mut next_url = playlist.tracks.next;
    while let Some(ref u) = next_url {
        let resp = client.get(u).send().await
            .map_err(|e| format!("Failed to fetch next page: {}", e))?;
        let page_body = resp.text().await
            .map_err(|e| format!("Failed to read page body: {}", e))?;
        let page: DeezerTracksPage = serde_json::from_str(&page_body)
            .map_err(|e| format!("Failed to parse page: {}", e))?;
        deezer_tracks.extend(page.data);
        next_url = page.next;
    }

    // Tracks without a preview URL can't be played in the quiz, so drop them.
    let tracks: Vec<QuizTrack> = deezer_tracks
        .into_iter()
        .filter_map(|t| {
            t.preview.filter(|p| !p.is_empty()).map(|preview_url| QuizTrack {
                title: t.title,
                artist: t.artist.name,
                album: t.album.as_ref().map(|a| a.title.clone()),
                cover_url: t.album.as_ref().and_then(|a| a.cover_big.clone()),
                preview_url,
                year: t.album.as_ref().and_then(|a| a.release_date.as_ref()).and_then(|d| d.get(..4)).map(|s| s.to_string()),
            })
        })
        .collect();

    if tracks.is_empty() {
        return Err("No previewable tracks in this playlist".to_string());
    }
    dev_log!("Quiz: {} tracks with preview", tracks.len());
    Ok(tracks)
}

/// Lightweight playlist info returned by the search endpoint.
#[derive(Debug, Clone, serde::Serialize)]
pub struct PlaylistSearchResult {
    pub id: u64,
    pub title: String,
    pub nb_tracks: u32,
    pub creator: String,
    pub picture_medium: String,
}

/// Searches Deezer playlists by keyword.
/// Uses the public API — no auth needed.
#[command]
pub async fn search_deezer_playlists(query: String) -> Result<Vec<PlaylistSearchResult>, String> {
    if query.trim().is_empty() {
        return Ok(vec![]);
    }

    #[derive(Deserialize)]
    struct SearchResponse {
        data: Vec<SearchItem>,
    }
    #[derive(Deserialize)]
    struct SearchItem {
        id: u64,
        title: String,
        #[serde(default)]
        nb_tracks: u32,
        #[serde(default)]
        picture_medium: Option<String>,
        #[serde(default)]
        creator: Option<SearchCreator>,
    }
    #[derive(Deserialize)]
    struct SearchCreator {
        name: String,
    }

    let client = Client::new();
    let response = client
        .get("https://api.deezer.com/search/playlist")
        .query(&[("q", query.trim()), ("limit", "24")])
        .send()
        .await
        .map_err(|e| format!("Deezer search failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Deezer search error ({})", response.status()));
    }

    let body = response.text().await
        .map_err(|e| format!("Failed to read search response: {}", e))?;

    let parsed: SearchResponse = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse search results: {}", e))?;

    let results = parsed.data
        .into_iter()
        .filter(|p| p.nb_tracks >= 5)
        .map(|p| PlaylistSearchResult {
            id: p.id,
            title: p.title,
            nb_tracks: p.nb_tracks,
            creator: p.creator.map(|c| c.name).unwrap_or_default(),
            picture_medium: p.picture_medium.unwrap_or_default(),
        })
        .collect();

    Ok(results)
}

/// Extracts the playlist ID from a Deezer playlist URL.
///
/// Supports formats like:
/// - https://www.deezer.com/playlist/1234567890
/// - https://www.deezer.com/fr/playlist/1234567890
/// - https://deezer.com/playlist/1234567890
fn extract_playlist_id(url: &str) -> Result<String, String> {
    if let Some(playlist_id) = url
        .split("playlist/")
        .nth(1)
        .and_then(|s| s.split('?').next())
        .and_then(|s| s.split('#').next())
    {
        if !playlist_id.is_empty() {
            return Ok(playlist_id.to_string());
        }
    }

    Err("Could not extract playlist ID from URL. Make sure it's a valid Deezer playlist URL."
        .to_string())
}

/// Extracts the track ID from a Deezer track URL.
fn extract_track_id(url: &str) -> Result<String, String> {
    if let Some(track_id) = url
        .split("track/")
        .nth(1)
        .and_then(|s| s.split('?').next())
        .and_then(|s| s.split('#').next())
    {
        if !track_id.is_empty() {
            return Ok(track_id.to_string());
        }
    }

    Err("Could not extract track ID from URL. Make sure it's a valid Deezer track URL.".to_string())
}
