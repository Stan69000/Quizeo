/**
 * Type definitions for Voyage DL
 */

export interface TrackInfo {
  id: string;
  title: string;
  artist: string;
  url: string;
  thumbnail_url: string;
  duration_seconds: number;
  album?: string;
  album_cover_url?: string;
  track_number?: number;
  year?: string;
}

export interface AppConfig {
  download_dir: string;
  audio_format: string;
}

export interface DownloadProgressEvent {
  current: number;
  total: number;
  track_title: string;
  track_id: string;
  status: 'downloading' | 'completed' | 'error' | 'cancelled';
}

export interface DownloadResult {
  successful: number;
  failed: number;
  errors: string[];
}

export interface SelectedTrack extends TrackInfo {
  selected: boolean;
}

export interface AnalyzeProgressEvent {
  current: number;
  total: number;
  track_title: string;
  artist: string;
  status: string;
}

export interface QuizTrack {
  title: string;
  artist: string;
  album: string | null;
  cover_url: string | null;
  preview_url: string;
  year?: string | null;
}

export interface AudioFileInfo {
  path: string;
  name: string;
}

export interface PlaylistSearchResult {
  id: number;
  title: string;
  nb_tracks: number;
  creator: string;
  picture_medium: string;
}

export type QuizMode = 'qcm' | 'free' | 'multi' | 'chrono' | 'elimination';
export type QuizTarget = 'title' | 'artist' | 'both' | 'decade';
export type QuizDifficulty = 'easy' | 'medium' | 'hard' | 'expert';

export interface QuizSettings {
  mode: QuizMode;
  target: QuizTarget;
  difficulty: QuizDifficulty;
  players: string[]; // multi mode only
  /** Custom extract length in seconds. 0 means "use difficulty default". */
  customDuration: number;
  /** Pre-round countdown in seconds (0 = no countdown). */
  countdown: number;
  /** Jukebox: auto-advance + play full song in MiniPlayer after each reveal. */
  jukebox: boolean;
  /** Keyboard buzz keys, one per player (empty string = no key assigned). */
  keyBindings: string[];
}
