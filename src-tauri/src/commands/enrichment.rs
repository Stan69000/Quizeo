/// Track enrichment + YouTube stream URL lookup via yt-dlp.
///
/// Priority for the "interesting snippet": track page > album page > artist page.
/// A song's Wikipedia article (e.g. "No Time To Die") contains anecdotes, chart
/// positions, context — far more useful for a quiz than a dry artist biography.

use crate::utils::sidecar::{find_sidecar, run_sidecar_command_async};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::command;

#[derive(Debug, Serialize, Default)]
pub struct TrackEnrichment {
    /// Best interesting snippet (track > album > artist), ≤ 300 chars.
    pub wiki_snippet: Option<String>,
    /// Label that identifies what the snippet is about ("No Time To Die", "Billie Eilish"…).
    pub wiki_subject: Option<String>,
    /// Record label from MusicBrainz.
    pub mb_label: Option<String>,
    /// Release country code from MusicBrainz (e.g. "FR", "US").
    pub mb_country: Option<String>,
    /// Release year from MusicBrainz (4-digit string).
    pub mb_year: Option<String>,
    /// Genre tags from MusicBrainz (up to 3).
    pub mb_tags: Vec<String>,
}

// ── Wikipedia ────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct WikiSummary {
    #[serde(rename = "type")]
    kind: String,
    extract: Option<String>,
}

async fn wiki_summary(client: &Client, lang: &str, title: &str) -> Option<String> {
    let slug = title.replace(' ', "_");
    let url = format!(
        "https://{lang}.wikipedia.org/api/rest_v1/page/summary/{}",
        urlencoding::encode(&slug)
    );
    let resp = client
        .get(&url)
        .header("User-Agent", "Quizeo/1.2.3 (tauri)")
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let data: WikiSummary = resp.json().await.ok()?;
    if data.kind == "disambiguation" {
        return None;
    }
    data.extract.filter(|e| !e.is_empty())
}

/// Try FR first, then EN.
async fn wiki_fr_en(client: &Client, title: &str) -> Option<String> {
    if let Some(e) = wiki_summary(client, "fr", title).await {
        return Some(e);
    }
    wiki_summary(client, "en", title).await
}

// ── MusicBrainz release (label / country / year) ────────────────────────────

#[derive(Deserialize, Default)]
struct MbReleaseSearch {
    releases: Option<Vec<MbRelease>>,
}

#[derive(Deserialize)]
struct MbRelease {
    date: Option<String>,
    country: Option<String>,
    #[serde(rename = "label-info")]
    label_info: Option<Vec<MbLabelInfo>>,
}

#[derive(Deserialize)]
struct MbLabelInfo {
    label: Option<MbLabel>,
}

#[derive(Deserialize)]
struct MbLabel {
    name: Option<String>,
}

async fn fetch_mb_release(client: &Client, album: &str, artist: &str) -> Option<MbRelease> {
    let query = format!(r#"release:"{album}" AND artist:"{artist}""#);
    let url = format!(
        "https://musicbrainz.org/ws/2/release?query={}&fmt=json&limit=1",
        urlencoding::encode(&query)
    );
    let resp = client
        .get(&url)
        .header("User-Agent", "Quizeo/1.2.3 (tauri; contact@quizeo.app)")
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let data: MbReleaseSearch = resp.json().await.ok()?;
    data.releases?.into_iter().next()
}

// ── MusicBrainz artist tags (genres) ─────────────────────────────────────────

#[derive(Deserialize)]
struct MbArtistSearch {
    artists: Option<Vec<MbArtist>>,
}

#[derive(Deserialize)]
struct MbArtist {
    tags: Option<Vec<MbTag>>,
}

#[derive(Deserialize)]
struct MbTag {
    name: String,
    count: i64,
}

async fn fetch_mb_tags(client: &Client, artist: &str) -> Vec<String> {
    let query = format!(r#"artist:"{artist}""#);
    let url = format!(
        "https://musicbrainz.org/ws/2/artist?query={}&fmt=json&limit=1",
        urlencoding::encode(&query)
    );
    let resp = match client
        .get(&url)
        .header("User-Agent", "Quizeo/1.2.3 (tauri; contact@quizeo.app)")
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => r,
        _ => return vec![],
    };
    let data: MbArtistSearch = match resp.json().await {
        Ok(d) => d,
        Err(_) => return vec![],
    };
    let mut tags: Vec<MbTag> = data
        .artists
        .and_then(|a| a.into_iter().next())
        .and_then(|a| a.tags)
        .unwrap_or_default();
    // Sort by vote count descending, take top 3.
    tags.sort_by(|a, b| b.count.cmp(&a.count));
    tags.into_iter()
        .take(3)
        .map(|t| {
            // Capitalize first letter.
            let mut s = t.name;
            if let Some(c) = s.get_mut(0..1) {
                c.make_ascii_uppercase();
            }
            s
        })
        .collect()
}

// ── Tauri command ────────────────────────────────────────────────────────────

#[command]
pub async fn fetch_track_enrichment(
    artist: String,
    album: Option<String>,
    title: String,
) -> TrackEnrichment {
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .unwrap_or_default();

    // Run all fetches concurrently.
    let wiki_track_fut = wiki_fr_en(&client, &title);
    let wiki_album_fut = async {
        if let Some(ref a) = album {
            wiki_fr_en(&client, a).await
        } else {
            None
        }
    };
    let wiki_artist_fut = wiki_fr_en(&client, &artist);
    let mb_release_fut = async {
        if let Some(ref a) = album {
            fetch_mb_release(&client, a, &artist).await
        } else {
            None
        }
    };
    let mb_tags_fut = fetch_mb_tags(&client, &artist);

    let (wiki_track, wiki_album, wiki_artist, mb, mb_tags) = tokio::join!(
        wiki_track_fut,
        wiki_album_fut,
        wiki_artist_fut,
        mb_release_fut,
        mb_tags_fut
    );

    // Pick the most interesting snippet: track > album > artist.
    let (wiki_snippet, wiki_subject) = if let Some(text) = wiki_track {
        (Some(text.chars().take(300).collect()), Some(title.clone()))
    } else if let Some(text) = wiki_album {
        let subj = album.clone().unwrap_or_default();
        (Some(text.chars().take(300).collect()), Some(subj))
    } else if let Some(text) = wiki_artist {
        (Some(text.chars().take(300).collect()), Some(artist.clone()))
    } else {
        (None, None)
    };

    let mb_label = mb
        .as_ref()
        .and_then(|r| r.label_info.as_ref())
        .and_then(|li| li.first())
        .and_then(|l| l.label.as_ref())
        .and_then(|l| l.name.clone());
    let mb_country = mb.as_ref().and_then(|r| r.country.clone());
    let mb_year = mb
        .as_ref()
        .and_then(|r| r.date.as_deref())
        .map(|d| d.chars().take(4).collect::<String>())
        .filter(|s| !s.is_empty());

    TrackEnrichment {
        wiki_snippet,
        wiki_subject,
        mb_label,
        mb_country,
        mb_year,
        mb_tags,
    }
}

// ── YouTube stream URL (for in-app playback without downloading) ─────────────

/// Ask yt-dlp for the direct audio stream URL of a YouTube search result.
/// The frontend can set this as the `<audio>` src and play it in-app.
#[command]
pub async fn get_youtube_stream_url(query: String) -> Result<String, String> {
    let yt_dlp = find_sidecar("yt-dlp")
        .map_err(|e| format!("yt-dlp introuvable : {e}"))?;

    // Prefer M4A (natively decoded by WKWebView / AVFoundation).
    let args = vec![
        "-f".to_string(),
        "bestaudio[ext=m4a]/bestaudio/best".to_string(),
        "--get-url".to_string(),
        "--no-playlist".to_string(),
        format!("ytsearch1:{query}"),
    ];

    let output = run_sidecar_command_async(&yt_dlp, &args).await?;

    // yt-dlp may print multiple lines (one per format); take the first URL.
    let url = output
        .lines()
        .find(|l| l.starts_with("http"))
        .map(|l| l.trim().to_string())
        .ok_or_else(|| "Aucun stream trouvé".to_string())?;

    Ok(url)
}

/// Ask yt-dlp for the YouTube video ID of a search result.
/// Returns the bare ID (e.g. "dQw4w9WgXcQ") so the frontend can embed it.
#[command]
pub async fn get_youtube_video_id(query: String) -> Result<String, String> {
    let yt_dlp = find_sidecar("yt-dlp")
        .map_err(|e| format!("yt-dlp introuvable : {e}"))?;

    let args = vec![
        "--print".to_string(),
        "id".to_string(),
        "--no-playlist".to_string(),
        format!("ytsearch1:{query}"),
    ];

    let output = run_sidecar_command_async(&yt_dlp, &args).await?;

    let id = output
        .lines()
        .find(|l| !l.trim().is_empty())
        .map(|l| l.trim().to_string())
        .ok_or_else(|| "Aucun résultat YouTube".to_string())?;

    Ok(id)
}
