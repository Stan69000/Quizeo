/**
 * Type definitions for Quizeo
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

export type QuizMode = 'qcm' | 'free' | 'multi' | 'chrono' | 'elimination' | 'network';
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
  /** Network mode: WebSocket server URL (e.g. wss://quiz.stan-bouchet.fr). */
  serverUrl: string;
}

// ── Network multiplayer types ─────────────────────────────────────────────────

export type NetworkPhase =
  | 'idle'
  | 'connecting'
  | 'lobby'
  | 'countdown'
  | 'playing'
  | 'reveal'
  | 'scoreboard'
  | 'final'
  | 'error';

export interface NetworkPlayer {
  name: string;
  score: number;
  streak: number;
  rank: number;
}

export interface ScoreDelta {
  name: string;
  delta: number;
  correct: boolean;
}

/** Outbound messages from the host (Tauri) to the game server. */
export type HostOutMessage =
  | { type: 'start_game'; total_rounds: number }
  | { type: 'start_round'; options: string[]; correct_index: number; duration_ms: number }
  | { type: 'countdown_ack' }
  | { type: 'reveal_answer' }
  | { type: 'show_scoreboard' }
  | { type: 'next_round' }
  | { type: 'end_game' }
  | { type: 'kick_player'; name: string };

/** Inbound messages from the game server to the host. */
export type HostInMessage =
  | { type: 'room_created'; pin: string }
  | { type: 'player_joined'; name: string; count: number }
  | { type: 'player_left'; name: string; count: number }
  | { type: 'player_disconnected'; name: string }
  | { type: 'game_started'; total_rounds: number }
  | { type: 'countdown_done' }
  | { type: 'round_started'; options: string[]; duration_ms: number; round: number; total: number }
  | { type: 'answer_count'; answered: number; total: number }
  | { type: 'answer_revealed'; correct_index: number; deltas: ScoreDelta[]; rankings: NetworkPlayer[] }
  | { type: 'scoreboard'; rankings: NetworkPlayer[] }
  | { type: 'game_ended'; rankings: NetworkPlayer[] }
  | { type: 'ready_for_round'; round: number }
  | { type: 'error'; code: string };
