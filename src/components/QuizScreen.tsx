/**
 * QuizScreen - Music quiz built on top of Deezer's 30s preview URLs.
 *
 * Three modes (QCM, free input, multiplayer buzzer), three guess targets
 * (title / artist / both), four difficulty levels, plus customizable extract
 * duration and pre-round countdown.
 */

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { QuizTrack, QuizSettings, QuizMode, QuizTarget, QuizDifficulty, PlaylistSearchResult, AudioFileInfo } from '../types';
import { Alert } from './Alert';
import { saveScore } from '../hooks/useScores';
import { NetworkQuizScreen } from './network/NetworkQuizScreen';

// ---------------------------------------------------------------------------
// Web Audio buzz sounds — no external files needed
// ---------------------------------------------------------------------------
// Single shared AudioContext — avoids WebKit's ~6-instance hard limit which
// causes the audio element to stop working after many buzz sounds.
let _sharedAudioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext {
  if (!_sharedAudioCtx || _sharedAudioCtx.state === 'closed') {
    _sharedAudioCtx = new AudioContext();
  }
  if (_sharedAudioCtx.state === 'suspended') {
    _sharedAudioCtx.resume();
  }
  return _sharedAudioCtx;
}

function playBuzzSound(playerIndex: number) {
  try {
    const ctx = getAudioCtx();
    const configs: Array<{ freq: number; times: number[]; dur: number }> = [
      { freq: 880, times: [0],              dur: 0.18 }, // high single
      { freq: 330, times: [0],              dur: 0.25 }, // low single
      { freq: 660, times: [0, 0.12],        dur: 0.10 }, // double
      { freq: 550, times: [0, 0.10, 0.20],  dur: 0.08 }, // triple
    ];
    const { freq, times, dur } = configs[playerIndex % configs.length];
    times.forEach((t) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.28, ctx.currentTime + t);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + dur);
      osc.start(ctx.currentTime + t);
      osc.stop(ctx.currentTime + t + dur + 0.01);
    });
  } catch {
    // AudioContext unavailable — silent failure
  }
}

interface QuizScreenProps {
  onExit: () => void;
  audioFiles?: AudioFileInfo[];
  onJukeboxPlay?: (path: string) => void;
  quickSearchQuery?: string; // Pre-fills search and auto-triggers — for Quick Play
}

const JUKEBOX_AUTOADVANCE = 6; // seconds before auto-next in jukebox mode

/** Fuzzy-match a quiz track against downloaded filenames. */
function findJukeboxFile(track: QuizTrack, files: AudioFileInfo[]): AudioFileInfo | null {
  if (!files.length) return null;
  const query = normalizeAnswer(`${track.title} ${track.artist}`);
  let best: AudioFileInfo | null = null;
  let bestDist = Infinity;
  for (const f of files) {
    const name = normalizeAnswer(f.name);
    const d = levenshtein(query, name);
    if (d < bestDist) { bestDist = d; best = f; }
  }
  // Accept if edit distance ≤ 40% of query length
  return best && bestDist <= Math.ceil(query.length * 0.4) ? best : null;
}

interface QuizHistoryEntry {
  url: string;
  label: string;
  trackCount: number;
  addedAt: number;
  rating?: number;
  bestScore?: number;
  bestScoreOutOf?: number;
  bestScoreAt?: number;
  bestChronoTime?: number;
  bestChronoAt?: number;
  bestCombo?: number;
}

interface RoundTheme {
  icon: string;
  gradient: string;
  glow: string;
  reverse: boolean;
}

const ROUND_THEMES: RoundTheme[] = [
  { icon: '🎵', gradient: 'radial-gradient(circle at 30% 30%, #FFAB76, #FF7B54 70%)', glow: 'rgba(255,123,84,0.45)', reverse: false },
  { icon: '🎸', gradient: 'radial-gradient(circle at 30% 30%, #a78bfa, #7c3aed 70%)', glow: 'rgba(124,58,237,0.45)', reverse: true  },
  { icon: '🥁', gradient: 'radial-gradient(circle at 30% 30%, #fb923c, #c2410c 70%)', glow: 'rgba(194,65,12,0.45)',  reverse: false },
  { icon: '🎹', gradient: 'radial-gradient(circle at 30% 30%, #67e8f9, #0891b2 70%)', glow: 'rgba(8,145,178,0.45)',  reverse: true  },
  { icon: '🎺', gradient: 'radial-gradient(circle at 30% 30%, #fde68a, #d97706 70%)', glow: 'rgba(217,119,6,0.45)',  reverse: false },
  { icon: '🎻', gradient: 'radial-gradient(circle at 30% 30%, #86efac, #15803d 70%)', glow: 'rgba(21,128,61,0.45)',  reverse: true  },
  { icon: '🎤', gradient: 'radial-gradient(circle at 30% 30%, #f9a8d4, #be185d 70%)', glow: 'rgba(190,24,93,0.45)',  reverse: false },
  { icon: '🎧', gradient: 'radial-gradient(circle at 30% 30%, #93c5fd, #1d4ed8 70%)', glow: 'rgba(29,78,216,0.45)',  reverse: true  },
  { icon: '🎷', gradient: 'radial-gradient(circle at 30% 30%, #fca5a5, #b91c1c 70%)', glow: 'rgba(185,28,28,0.45)',  reverse: false },
  { icon: '🪗', gradient: 'radial-gradient(circle at 30% 30%, #d9f99d, #4d7c0f 70%)', glow: 'rgba(77,124,15,0.45)',  reverse: true  },
  { icon: '🎶', gradient: 'radial-gradient(circle at 30% 30%, #e9d5ff, #7e22ce 70%)', glow: 'rgba(126,34,206,0.45)', reverse: false },
  { icon: '🪘', gradient: 'radial-gradient(circle at 30% 30%, #fed7aa, #92400e 70%)', glow: 'rgba(146,64,14,0.45)',  reverse: true  },
];

function formatRevealTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatChronoTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 10);
  return `${m}:${s.toString().padStart(2, '0')}.${ms}`;
}

const HISTORY_KEY = 'quizeo-quiz-history';
const HISTORY_MAX = 20;

function loadHistory(): QuizHistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory(entries: QuizHistoryEntry[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, HISTORY_MAX)));
  } catch {
    /* localStorage may fail; non-critical */
  }
}

function buildHistoryLabel(tracks: QuizTrack[]): string {
  const artists = Array.from(new Set(tracks.map((t) => t.artist))).slice(0, 3);
  return artists.join(', ') + (tracks.length > 3 ? '...' : '');
}

function formatRelativeDate(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `il y a ${days} j`;
  return new Date(ts).toLocaleDateString('fr-FR');
}

type Phase = 'setup' | 'config' | 'rules' | 'countdown' | 'playing' | 'result';

interface RoundResult {
  trackIndex: number;
  correct: boolean;
  points: number;
  player?: string;
}

const POINTS_MAX = 100;
const POINTS_MIN = 10;
const DECADES = ['Années 60', 'Années 70', 'Années 80', 'Années 90', 'Années 2000', 'Années 2010', 'Années 2020'];

function yearToDecade(year: string | null | undefined): string | null {
  if (!year) return null;
  const y = parseInt(year, 10);
  if (isNaN(y)) return null;
  const d = Math.floor(y / 10) * 10;
  if (d < 1960 || d > 2029) return null;
  if (d >= 2000) return `Années ${d}`;
  return `Années ${d - 1900}`;
}

function buildDecadeOptions(tracks: QuizTrack[], correctIdx: number): string[] {
  const correct = yearToDecade(tracks[correctIdx].year);
  if (!correct) return [];
  const others = shuffle(DECADES.filter((d) => d !== correct)).slice(0, 3);
  return shuffle([correct, ...others]);
}

/** Combo multiplier: 1x, 1.5x, 2x, 3x */
function comboMultiplier(combo: number): number {
  if (combo >= 6) return 3;
  if (combo >= 4) return 2;
  if (combo >= 2) return 1.5;
  return 1;
}

/** Compute points for a correct answer, given how much of the timer was left. */
function pointsForAnswer(timerRemainingRatio: number, combo = 0): number {
  const r = Math.max(0, Math.min(1, timerRemainingRatio));
  const base = Math.round(POINTS_MIN + (POINTS_MAX - POINTS_MIN) * r);
  return Math.round(base * comboMultiplier(combo));
}

const KAHOOT_COLORS = [
  { key: 'red',    shape: '▲', bg: '#E21B3C' },
  { key: 'blue',   shape: '◆', bg: '#1368CE' },
  { key: 'yellow', shape: '●', bg: '#D89E00' },
  { key: 'green',  shape: '■', bg: '#26890C' },
] as const;

const DIFFICULTY_PRESETS: Record<QuizDifficulty, { duration: number; label: string }> = {
  easy: { duration: 15, label: 'Facile' },
  medium: { duration: 10, label: 'Moyen' },
  hard: { duration: 5, label: 'Difficile' },
  expert: { duration: 2, label: 'Expert' },
};

const PREVIEW_LEN = 30;
const CELEBRATION_MS = 1400;

// Deezer's preview is 30s. Where in it should the extract start?
function pickStartOffset(difficulty: QuizDifficulty, duration: number): number {
  switch (difficulty) {
    case 'easy':
      return 0;
    case 'medium':
      return Math.min(5, Math.max(0, PREVIEW_LEN - duration));
    case 'hard':
      return Math.random() * Math.max(0, PREVIEW_LEN - duration);
    case 'expert': {
      const half = PREVIEW_LEN / 2;
      return Math.random() * Math.max(0, half - duration);
    }
  }
}

function normalizeAnswer(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

function isAnswerClose(input: string, expected: string): boolean {
  const a = normalizeAnswer(input);
  const b = normalizeAnswer(expected);
  if (!a || !b) return false;
  if (a === b) return true;
  if (b.includes(a) && a.length >= b.length - 2) return true;
  const tolerance = b.length <= 4 ? 0 : b.length <= 8 ? 1 : 2;
  return levenshtein(a, b) <= tolerance;
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function answerFor(t: QuizTrack, target: QuizTarget): string {
  if (target === 'title') return t.title;
  if (target === 'artist') return t.artist;
  if (target === 'decade') return yearToDecade(t.year) ?? 'Inconnue';
  return `${t.title} — ${t.artist}`;
}

function buildQcmOptions(tracks: QuizTrack[], correctIdx: number, target: QuizTarget): string[] {
  if (target === 'decade') {
    const opts = buildDecadeOptions(tracks, correctIdx);
    return opts.length >= 2 ? opts : [];
  }
  const correct = tracks[correctIdx];
  const correctAns = answerFor(correct, target);
  const pool = tracks
    .map((t, i) => ({ t, i }))
    .filter(({ i, t }) => i !== correctIdx && answerFor(t, target) !== correctAns);
  const distractors = shuffle(pool).slice(0, 3).map(({ t }) => answerFor(t, target));
  return Array.from(new Set(shuffle([correctAns, ...distractors])));
}

export function QuizScreen({ onExit, audioFiles = [], onJukeboxPlay, quickSearchQuery }: QuizScreenProps) {
  const [phase, setPhase] = useState<Phase>('setup');
  const [error, setError] = useState<string | null>(null);

  // Setup
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [tracks, setTracks] = useState<QuizTrack[]>([]);
  const [history, setHistory] = useState<QuizHistoryEntry[]>(() => loadHistory());

  // Track selection
  const [trackPick, setTrackPick] = useState<'random' | 'manual'>('random');
  const [trackCount, setTrackCount] = useState(10);
  const [selectedTrackIndices, setSelectedTrackIndices] = useState<Set<number>>(new Set());

  // When a playlist loads, default to all tracks selected
  useEffect(() => {
    setSelectedTrackIndices(new Set(tracks.map((_, i) => i)));
  }, [tracks]);

  const toggleTrackIndex = (i: number) =>
    setSelectedTrackIndices((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

  // Key capture for multiplayer key bindings (-1 = idle, ≥0 = capturing for that player index)
  const [capturingKeyFor, setCapturingKeyFor] = useState<number | null>(null);

  // Capture next keypress and assign it to the player at capturingKeyFor index
  useEffect(() => {
    if (capturingKeyFor === null) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // Ignore pure modifier keys
      if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab'].includes(e.key)) return;
      const key = e.key === ' ' ? 'Space' : e.key;
      setSettings((s) => {
        const kb = [...s.keyBindings];
        // Extend array if needed
        while (kb.length <= capturingKeyFor) kb.push('');
        kb[capturingKeyFor] = key;
        return { ...s, keyBindings: kb };
      });
      setCapturingKeyFor(null);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [capturingKeyFor]);

  // Playlist search
  const [setupTab, setSetupTab] = useState<'search' | 'url'>('search');
  const [searchQuery, setSearchQuery] = useState(quickSearchQuery ?? '');
  const [searchResults, setSearchResults] = useState<PlaylistSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // Config
  const [settings, setSettings] = useState<QuizSettings>({
    mode: 'qcm',
    target: 'title',
    difficulty: 'medium',
    players: ['Joueur 1', 'Joueur 2'],
    customDuration: 0,
    countdown: 3,
    jukebox: false,
    keyBindings: ['q', 'p'],
    serverUrl: 'wss://quiz.stan-bouchet.fr',
  });

  // Delegate entirely to NetworkQuizScreen when network mode is active
  if (settings.mode === 'network' && phase === 'playing') {
    return (
      <NetworkQuizScreen
        tracks={tracks}
        settings={settings}
        onExit={() => setPhase('config')}
      />
    );
  }

  // Playing
  const [order, setOrder] = useState<number[]>([]);
  const [currentRound, setCurrentRound] = useState(0);
  const [results, setResults] = useState<RoundResult[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [freeInput, setFreeInput] = useState('');
  const [activePlayer, setActivePlayer] = useState<string | null>(null);
  const [qcmOptions, setQcmOptions] = useState<string[]>([]);
  const [pickedOption, setPickedOption] = useState<string | null>(null);
  // Chrono mode: total elapsed seconds (penalties included)
  const [chronoTotal, setChronoTotal] = useState(0);
  const chronoStartRef = useRef<number | null>(null); // Date.now() at round start
  const [isFullscreen, setIsFullscreen] = useState(false);

  const toggleFullscreen = useCallback(async () => {
    const win = getCurrentWindow();
    const next = !isFullscreen;
    await win.setFullscreen(next);
    setIsFullscreen(next);
  }, [isFullscreen]);

  // Visual countdown timer
  const [countdownLeft, setCountdownLeft] = useState(0);

  // Live extract timer (for the SVG ring)
  const [timerProgress, setTimerProgress] = useState(1); // 1 = full, 0 = empty
  const [celebration, setCelebration] = useState<'win' | 'lose' | null>(null);
  const [revealPlaying, setRevealPlaying] = useState(false);

  // Combo / streak
  const [currentCombo, setCurrentCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);

  // Elimination mode
  const [eliminatedPlayers, setEliminatedPlayers] = useState<string[]>([]);

  // Wikipedia + MusicBrainz enrichment
  const [wikiSnippet, setWikiSnippet] = useState<string | null>(null);
  const [wikiSubject, setWikiSubject] = useState<string | null>(null);
  interface MBData { label?: string; country?: string; date?: string; tags?: string[]; }
  const [mbData, setMbData] = useState<MBData | null>(null);
  const [ytStreamLoading, setYtStreamLoading] = useState(false);
  const [ytVideoId, setYtVideoId] = useState<string | null>(null);
  const [ytVideoLoading, setYtVideoLoading] = useState(false);
  // Full-song player state (active once a YouTube stream or local file is playing)
  const [revealFullSong, setRevealFullSong] = useState(false);
  const [revealCurrentTime, setRevealCurrentTime] = useState(0);
  const [revealDuration, setRevealDuration] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopAtRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const roundEndedRef = useRef(false);
  const recordResultRef = useRef<(correct: boolean, player?: string) => void>(() => {});
  const prevScoresRef = useRef<Map<string, number>>(new Map());
  // Jukebox auto-advance
  const [jukeboxCountdown, setJukeboxCountdown] = useState(0);
  const jukeboxTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const nextRoundRef = useRef<() => void>(() => {});

  const currentTrack = order.length > 0 ? tracks[order[currentRound]] : null;
  const effectiveDuration =
    settings.customDuration > 0
      ? settings.customDuration
      : DIFFICULTY_PRESETS[settings.difficulty].duration;

  const handleFetch = async (urlToFetch?: string) => {
    const finalUrl = (urlToFetch ?? url).trim();
    if (!finalUrl) return;
    setError(null);
    setLoading(true);
    try {
      const fetched: QuizTrack[] = await invoke('fetch_deezer_playlist_for_quiz', { url: finalUrl });
      if (fetched.length < 4) {
        throw new Error('Il faut au moins 4 morceaux pour faire un quizz.');
      }
      setTracks(fetched);
      // Save to history (dedup on URL, bump to top)
      const entry: QuizHistoryEntry = {
        url: finalUrl,
        label: buildHistoryLabel(fetched),
        trackCount: fetched.length,
        addedAt: Date.now(),
      };
      setHistory((prev) => {
        const next = [entry, ...prev.filter((e) => e.url !== finalUrl)];
        saveHistory(next);
        return next;
      });
      setPhase('config');
    } catch (e) {
      setError(typeof e === 'string' ? e : (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const removeHistoryEntry = (urlToRemove: string) => {
    setHistory((prev) => {
      const next = prev.filter((e) => e.url !== urlToRemove);
      saveHistory(next);
      return next;
    });
  };

  // Persist best score / chrono / combo when reaching the result phase.
  useEffect(() => {
    if (phase !== 'result' || !url) return;
    setHistory((prev) => {
      const existing = prev.find((e) => e.url === url);
      if (!existing) return prev;

      let updated = { ...existing };
      let changed = false;

      // Always update bestCombo if improved
      if (maxCombo > 0 && maxCombo > (existing.bestCombo ?? 0)) {
        updated = { ...updated, bestCombo: maxCombo };
        changed = true;
      }

      if (settings.mode === 'chrono') {
        if (chronoTotal > 0 && (existing.bestChronoTime === undefined || chronoTotal < existing.bestChronoTime)) {
          updated = { ...updated, bestChronoTime: chronoTotal, bestChronoAt: Date.now() };
          changed = true;
        }
      } else {
        if (score > 0 && score > (existing.bestScore ?? 0)) {
          updated = { ...updated, bestScore: score, bestScoreOutOf: maxScore, bestScoreAt: Date.now() };
          changed = true;
        }
      }

      if (!changed) return prev;
      const next = prev.map((e) => (e.url === url ? updated : e));
      saveHistory(next);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const rateCurrentPlaylist = (stars: number) => {
    if (!url) return;
    setHistory((prev) => {
      // Below 3 stars: drop the entry entirely.
      const filtered = stars < 3 ? prev.filter((e) => e.url !== url) : prev;
      const next = filtered.map((e) =>
        e.url === url ? { ...e, rating: stars } : e
      );
      saveHistory(next);
      return next;
    });
  };

  // The rating the user gave for the current playlist this session (0 = not rated)
  const currentRating = useMemo(() => {
    return history.find((e) => e.url === url)?.rating ?? 0;
  }, [history, url]);

  const startQuiz = () => {
    let pool: number[];
    if (trackPick === 'manual') {
      pool = Array.from(selectedTrackIndices);
    } else {
      const all = shuffle(tracks.map((_, i) => i));
      pool = trackCount === 0 ? all : all.slice(0, Math.min(trackCount, tracks.length));
    }
    const ord = shuffle(pool);
    prevScoresRef.current = new Map(settings.players.map((p) => [p, 0]));
    setOrder(ord);
    setCurrentRound(0);
    setResults([]);
    setRevealed(false);
    setFreeInput('');
    setActivePlayer(null);
    setPickedOption(null);
    setCelebration(null);
    setChronoTotal(0);
    setCurrentCombo(0);
    setMaxCombo(0);
    setEliminatedPlayers([]);
    setWikiSnippet(null);
    setWikiSubject(null);
    setMbData(null);
    setYtStreamLoading(false);
    setYtVideoId(null);
    setYtVideoLoading(false);
    setRevealFullSong(false);
    setRevealCurrentTime(0);
    setRevealDuration(0);
    chronoStartRef.current = settings.mode === 'chrono' ? Date.now() : null;
    roundEndedRef.current = false;
    setQcmOptions(buildQcmOptions(tracks, ord[0], settings.target));
    // Network mode skips local countdown — the server handles it
    if (settings.mode !== 'network' && settings.countdown > 0) {
      setCountdownLeft(settings.countdown);
      setPhase('countdown');
    } else {
      setPhase('playing');
    }
  };

  // Pre-round countdown phase: ticks down 1s at a time then transitions to playing.
  useEffect(() => {
    if (phase !== 'countdown') return;
    if (countdownLeft <= 0) {
      setPhase('playing');
      return;
    }
    const t = window.setTimeout(() => setCountdownLeft((n) => n - 1), 1000);
    return () => window.clearTimeout(t);
  }, [phase, countdownLeft]);

  // Audio playback for the current round.
  useEffect(() => {
    if (phase !== 'playing' || !currentTrack) return;
    const audio = audioRef.current;
    if (!audio) return;

    const offset = pickStartOffset(settings.difficulty, effectiveDuration);
    const stopAt = offset + effectiveDuration;
    stopAtRef.current = stopAt;
    setTimerProgress(1);

    const startPlayback = () => {
      audio.currentTime = offset;
      audio.play().catch(() => {});
    };

    audio.src = currentTrack.preview_url;
    audio.addEventListener('loadedmetadata', startPlayback, { once: true });
    audio.load();

    // Use timeupdate-based stopping (much more reliable than setTimeout for audio).
    const onTimeUpdate = () => {
      if (stopAtRef.current !== null && audio.currentTime >= stopAtRef.current) {
        audio.pause();
        // Time's up: auto-reveal as a wrong answer if the player didn't act.
        if (!roundEndedRef.current) {
          recordResultRef.current(false);
        }
      }
      // Update visual progress
      const elapsed = audio.currentTime - offset;
      const remaining = Math.max(0, effectiveDuration - elapsed);
      setTimerProgress(remaining / effectiveDuration);
    };
    audio.addEventListener('timeupdate', onTimeUpdate);

    // Smoother visual progress with rAF (timeupdate fires ~4x/sec).
    const tick = () => {
      if (audio && !audio.paused && stopAtRef.current !== null) {
        const elapsed = audio.currentTime - offset;
        const remaining = Math.max(0, effectiveDuration - elapsed);
        setTimerProgress(remaining / effectiveDuration);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      audio.removeEventListener('loadedmetadata', startPlayback);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.pause();
      stopAtRef.current = null;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, currentRound]);

  const replay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    const offset = pickStartOffset(settings.difficulty, effectiveDuration);
    stopAtRef.current = offset + effectiveDuration;
    audio.currentTime = offset;
    audio.play().catch(() => {});
    setTimerProgress(1);
  };

  const recordResult = (correct: boolean, player?: string) => {
    if (roundEndedRef.current) return;
    roundEndedRef.current = true;

    let points = 0;
    if (settings.mode === 'chrono') {
      const elapsed = chronoStartRef.current ? (Date.now() - chronoStartRef.current) / 1000 : 0;
      const penalty = correct ? 0 : 10;
      setChronoTotal((t) => t + elapsed + penalty);
      points = correct ? 1 : 0;
    } else {
      points = correct ? pointsForAnswer(timerProgress, currentCombo) : 0;
    }

    // Combo tracking
    if (correct) {
      setCurrentCombo((c) => {
        const next = c + 1;
        setMaxCombo((m) => Math.max(m, next));
        return next;
      });
    } else {
      setCurrentCombo(0);
      if (settings.mode === 'elimination' && player) {
        setEliminatedPlayers((prev) => [...prev, player]);
      }
    }

    setResults((prev) => [...prev, { trackIndex: order[currentRound], correct, points, player }]);
    setRevealed(true);
    setCelebration(correct ? 'win' : 'lose');

    // Audio reveal — lift the extract stop so the song can play freely.
    // If the audio is still running (user answered before time ran out) we just
    // let it continue; no pause/play dance avoids the WKWebView autoplay block.
    // If the timer already expired (audio is paused) we restart from the top.
    stopAtRef.current = null;
    const revealAudio = audioRef.current;
    if (revealAudio) {
      if (revealAudio.paused) {
        revealAudio.currentTime = 0;
        revealAudio.play()
          .then(() => setRevealPlaying(true))
          .catch(() => setRevealPlaying(false));
      } else {
        setRevealPlaying(true);
      }
    } else {
      setRevealPlaying(false);
    }

    window.setTimeout(() => setCelebration(null), CELEBRATION_MS);

    // Jukebox: play full track in MiniPlayer + auto-advance
    if (settings.jukebox && currentTrack) {
      if (correct && onJukeboxPlay) {
        const match = findJukeboxFile(currentTrack, audioFiles);
        if (match) {
          onJukeboxPlay(match.path);
          // Mute quiz preview so MiniPlayer takes over cleanly
          setTimeout(() => { audioRef.current?.pause(); setRevealPlaying(false); }, 1500);
        }
      }
      let count = JUKEBOX_AUTOADVANCE;
      setJukeboxCountdown(count);
      jukeboxTimerRef.current = setInterval(() => {
        count--;
        if (count <= 0) {
          clearInterval(jukeboxTimerRef.current!);
          jukeboxTimerRef.current = null;
          setJukeboxCountdown(0);
          nextRoundRef.current();
        } else {
          setJukeboxCountdown(count);
        }
      }, 1000);
    }
  };

  useEffect(() => { recordResultRef.current = recordResult; });
  useEffect(() => { nextRoundRef.current = nextRound; });

  // Clear jukebox interval on unmount
  useEffect(() => {
    return () => {
      if (jukeboxTimerRef.current) clearInterval(jukeboxTimerRef.current);
    };
  }, []);


  // Keyboard shortcuts during playing phase.
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'F11') { e.preventDefault(); toggleFullscreen(); return; }
    if (phase !== 'playing') return;
    if (e.key === 'Enter' && revealed) { e.preventDefault(); nextRound(); return; }
    if (e.key === 'Escape' && !revealed) { e.preventDefault(); recordResultRef.current(false); return; }

    // Player buzz keys (multi / elimination) — skip if focus is on a text input
    const tag = (e.target as HTMLElement).tagName;
    const isTyping = tag === 'INPUT' || tag === 'TEXTAREA';
    if (!revealed && !activePlayer && !isTyping &&
        (settings.mode === 'multi' || settings.mode === 'elimination')) {
      const playerIdx = settings.keyBindings.findIndex(
        (k) => k && k.toLowerCase() === e.key.toLowerCase()
      );
      if (playerIdx !== -1 && settings.players[playerIdx]) {
        const player = settings.players[playerIdx];
        const activePlayers = settings.players.filter((p) => !eliminatedPlayers.includes(p));
        if (activePlayers.includes(player)) {
          e.preventDefault();
          handleBuzz(player);
          return;
        }
      }
    }

    if (e.key === ' ') {
      e.preventDefault();
      if (settings.mode === 'multi' && !activePlayer && !revealed) {
        handleBuzz(settings.players[0]);
      } else if (!revealed) {
        replay();
      }
      return;
    }
    if (!revealed && (settings.mode === 'qcm' || settings.mode === 'chrono')) {
      const idx = ['1','2','3','4'].indexOf(e.key);
      if (idx !== -1 && qcmOptions[idx]) handleQcmPick(qcmOptions[idx]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, revealed, settings.mode, settings.players, settings.keyBindings, activePlayer, eliminatedPlayers, qcmOptions, toggleFullscreen]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const nextRound = () => {
    audioRef.current?.pause();
    setRevealPlaying(false);
    setWikiSnippet(null);
    setWikiSubject(null);
    setMbData(null);
    setYtStreamLoading(false);
    setYtVideoId(null);
    setYtVideoLoading(false);
    setRevealFullSong(false);
    setRevealCurrentTime(0);
    setRevealDuration(0);
    if (jukeboxTimerRef.current) {
      clearInterval(jukeboxTimerRef.current);
      jukeboxTimerRef.current = null;
      setJukeboxCountdown(0);
    }
    // Snapshot scores before moving on so the next podium can show deltas.
    const snap = new Map<string, number>();
    settings.players.forEach((p) => snap.set(p, 0));
    results.forEach((r) => {
      if (r.correct && r.player) snap.set(r.player, (snap.get(r.player) ?? 0) + r.points);
    });
    prevScoresRef.current = snap;
    // End quiz if last round or elimination has a winner
    const activePlayers = settings.players.filter((p) => !eliminatedPlayers.includes(p));
    if (currentRound + 1 >= order.length || (settings.mode === 'elimination' && activePlayers.length <= 1)) {
      setPhase('result');
      return;
    }
    const nextIdx = currentRound + 1;
    setCurrentRound(nextIdx);
    setRevealed(false);
    setFreeInput('');
    setActivePlayer(null);
    setPickedOption(null);
    setCelebration(null);
    roundEndedRef.current = false;
    if (settings.mode === 'chrono') chronoStartRef.current = Date.now();
    setQcmOptions(buildQcmOptions(tracks, order[nextIdx], settings.target));
    if (settings.countdown > 0) {
      setCountdownLeft(settings.countdown);
      setPhase('countdown');
    }
  };

  const handleQcmPick = (opt: string) => {
    if (revealed || !currentTrack) return;
    setPickedOption(opt);
    const correct = opt === answerFor(currentTrack, settings.target);
    recordResult(correct);
  };

  const handleFreeSubmit = () => {
    if (revealed || !currentTrack) return;
    const target = settings.target;
    let correct = false;
    if (target === 'title') correct = isAnswerClose(freeInput, currentTrack.title);
    else if (target === 'artist') correct = isAnswerClose(freeInput, currentTrack.artist);
    else if (target === 'decade') {
      const decade = yearToDecade(currentTrack.year);
      correct = decade ? isAnswerClose(freeInput, decade) : false;
    } else
      correct =
        isAnswerClose(freeInput, currentTrack.title) ||
        isAnswerClose(freeInput, `${currentTrack.title} ${currentTrack.artist}`) ||
        isAnswerClose(freeInput, `${currentTrack.artist} ${currentTrack.title}`);
    recordResult(correct);
  };

  const handleBuzz = (player: string) => {
    if (revealed || activePlayer) return;
    const playerIdx = settings.players.indexOf(player);
    playBuzzSound(playerIdx >= 0 ? playerIdx : 0);
    setActivePlayer(player);
    audioRef.current?.pause();
  };

  const handleMultiValidate = (correct: boolean) => {
    recordResult(correct, activePlayer ?? undefined);
  };

  const score = useMemo(() => results.reduce((s, r) => s + r.points, 0), [results]);
  const correctCount = useMemo(() => results.filter((r) => r.correct).length, [results]);
  // Maximum points achievable across the whole quiz (for percentage / records).
  const maxScore = order.length * POINTS_MAX;

  const playerScores = useMemo(() => {
    if (settings.mode !== 'multi') return [];
    const map = new Map<string, number>();
    settings.players.forEach((p) => map.set(p, 0));
    results.forEach((r) => {
      if (r.correct && r.player) {
        map.set(r.player, (map.get(r.player) ?? 0) + r.points);
      }
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [results, settings]);

  const previousBest = useMemo(() => {
    return history.find((e) => e.url === url)?.bestScore ?? 0;
  }, [history, url]);
  const isNewRecord = phase === 'result' && score > 0 && score > previousBest;

  // Sync to unified scores store when result is shown
  useEffect(() => {
    if (phase !== 'result' || score === 0) return;
    saveScore('music', score, maxCombo);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps
  const previousBestChrono = useMemo(() => history.find((e) => e.url === url)?.bestChronoTime, [history, url]);
  const isNewChronoRecord = phase === 'result' && settings.mode === 'chrono' && chronoTotal > 0
    && (previousBestChrono === undefined || chronoTotal < previousBestChrono);

  // Debounced Deezer playlist search
  useEffect(() => {
    if (setupTab !== 'search') return;
    const q = searchQuery.trim();
    if (!q) { setSearchResults([]); return; }
    setSearchLoading(true);
    const timer = setTimeout(() => {
      invoke<PlaylistSearchResult[]>('search_deezer_playlists', { query: q })
        .then(setSearchResults)
        .catch(() => setSearchResults([]))
        .finally(() => setSearchLoading(false));
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery, setupTab]);

  // Cultural enrichment after reveal — fetched via Rust backend (bypasses WKWebView network sandbox)
  useEffect(() => {
    if (!revealed || !currentTrack) return;
    let cancelled = false;
    invoke<{
      wiki_snippet: string | null;
      wiki_subject: string | null;
      mb_label: string | null;
      mb_country: string | null;
      mb_year: string | null;
      mb_tags: string[];
    }>('fetch_track_enrichment', {
      artist: currentTrack.artist,
      album: currentTrack.album ?? null,
      title: currentTrack.title,
    }).then((data) => {
      if (cancelled) return;
      if (data.wiki_snippet) setWikiSnippet(data.wiki_snippet);
      if (data.wiki_subject) setWikiSubject(data.wiki_subject);
      if (data.mb_label || data.mb_country || data.mb_year || data.mb_tags?.length) {
        setMbData({
          label: data.mb_label ?? undefined,
          country: data.mb_country ?? undefined,
          date: data.mb_year ?? undefined,
          tags: data.mb_tags ?? [],
        });
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [revealed, currentTrack]);

  // Track time/duration for the full-song inline player + auto-advance on end
  useEffect(() => {
    if (!revealFullSong) return;
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => {
      setRevealCurrentTime(audio.currentTime);
      setRevealDuration(audio.duration || 0);
    };
    const onEnded = () => nextRoundRef.current();
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('durationchange', onTime);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('durationchange', onTime);
      audio.removeEventListener('ended', onEnded);
    };
  }, [revealFullSong]);

  // ---------- Renders ----------

  if (phase === 'setup') {
    return (
      <div className="screen quiz-screen">
        <div className="quiz-header">
          <button className="btn-ghost" onClick={onExit}>← Retour</button>
          <h1 className="quiz-title">Mode Quizz</h1>
          <div style={{ width: 80 }} />
        </div>
        <div className="quiz-body quiz-setup-body">
          <div className="quiz-hero">
            <div className="quiz-hero-icon">🎵</div>
            <h2>Prêt(e) pour le blind test ?</h2>
          </div>

          {/* Curated quick-start playlists */}
          <div className="quiz-suggested">
            <p className="quiz-suggested-label">Playlists populaires</p>
            <div className="quiz-suggested-grid">
              {[
                { emoji: '🔥', label: 'Top France',        query: 'top france hits' },
                { emoji: '🎸', label: 'Années 80',         query: 'hits années 80' },
                { emoji: '💃', label: 'Années 90',         query: 'hits années 90' },
                { emoji: '🎤', label: 'Années 2000',       query: 'hits 2000 2010' },
                { emoji: '🎭', label: 'Chanson française',  query: 'chanson française classique' },
                { emoji: '🏰', label: 'Disney',            query: 'disney chansons' },
                { emoji: '🎬', label: 'Musiques de films', query: 'bandes originales films' },
                { emoji: '🌍', label: 'Pop International', query: 'pop international hits' },
                { emoji: '🎧', label: 'Hip-Hop / R&B',    query: 'hip hop rnb french' },
              ].map(({ emoji, label, query }) => (
                <button
                  key={query}
                  className={`quiz-suggested-tile${searchQuery === query ? ' quiz-suggested-tile--active' : ''}`}
                  onClick={() => {
                    setSetupTab('search');
                    setSearchQuery(query);
                  }}
                >
                  <span className="quiz-suggested-emoji">{emoji}</span>
                  <span className="quiz-suggested-text">{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Source tabs */}
          <div className="quiz-setup-tabs">
            <button
              className={`quiz-setup-tab ${setupTab === 'search' ? 'is-active' : ''}`}
              onClick={() => setSetupTab('search')}
            >
              🔍 Rechercher
            </button>
            <button
              className={`quiz-setup-tab ${setupTab === 'url' ? 'is-active' : ''}`}
              onClick={() => setSetupTab('url')}
            >
              🔗 Coller une URL
            </button>
          </div>

          {setupTab === 'url' && (
            <div className="quiz-url-wrap">
              <input
                className="input quiz-url-input"
                type="text"
                placeholder="https://www.deezer.com/playlist/..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && url && handleFetch()}
                autoFocus
              />
              <button
                className="btn-primary btn-large"
                onClick={() => handleFetch()}
                disabled={!url || loading}
              >
                {loading ? '⏳ Chargement...' : '▶ Charger la playlist'}
              </button>
            </div>
          )}

          {setupTab === 'search' && (
            <div className="quiz-search-wrap">
              <div className="quiz-search-input-row">
                <input
                  className="input quiz-url-input"
                  type="text"
                  placeholder="Années 80, Disney, rap français..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  autoFocus
                />
                {searchLoading && <span className="quiz-search-spinner">⏳</span>}
              </div>
              {searchResults.length > 0 && (
                <div className="quiz-search-results">
                  {searchResults.map((p) => (
                    <button
                      key={p.id}
                      className="quiz-search-result"
                      onClick={() => {
                        const playlistUrl = `https://www.deezer.com/playlist/${p.id}`;
                        setUrl(playlistUrl);
                        setSetupTab('url');
                        handleFetch(playlistUrl);
                      }}
                      disabled={loading}
                    >
                      {p.picture_medium ? (
                        <img className="quiz-search-cover" src={p.picture_medium} alt="" />
                      ) : (
                        <div className="quiz-search-cover quiz-search-cover-placeholder">🎵</div>
                      )}
                      <div className="quiz-search-info">
                        <span className="quiz-search-title">{p.title}</span>
                        <span className="quiz-search-meta">
                          {p.nb_tracks} titres{p.creator ? ` · ${p.creator}` : ''}
                        </span>
                      </div>
                      <svg className="quiz-search-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>
                  ))}
                </div>
              )}
              {!searchLoading && searchQuery.trim() && searchResults.length === 0 && (
                <p className="quiz-search-empty">Aucune playlist trouvée pour « {searchQuery} »</p>
              )}
            </div>
          )}

          {loading && (
            <p className="quiz-hint" style={{ textAlign: 'center' }}>⏳ Chargement de la playlist…</p>
          )}
          {error && <Alert title="Erreur" message={error} type="error" onClose={() => setError(null)} />}

          {history.length > 0 && (
            <div className="quiz-history">
              <h3 className="quiz-history-title">Playlists récentes</h3>
              <ul className="quiz-history-list">
                {history.map((h) => (
                  <li key={h.url} className="quiz-history-item">
                    <button
                      className="quiz-history-main"
                      onClick={() => {
                        setUrl(h.url);
                        handleFetch(h.url);
                      }}
                      disabled={loading}
                      title={h.url}
                    >
                      <span className="quiz-history-label">{h.label || 'Playlist'}</span>
                      <span className="quiz-history-meta">
                        {h.trackCount} morceaux · {formatRelativeDate(h.addedAt)}
                        {h.rating ? (
                          <span className="quiz-history-stars">
                            {' · '}
                            {'★'.repeat(h.rating)}
                            <span className="quiz-history-stars-empty">
                              {'★'.repeat(5 - h.rating)}
                            </span>
                          </span>
                        ) : null}
                        {h.bestScore ? (
                          <span className="quiz-history-best">
                            {' · 🏆 '}
                            {h.bestScore} pts
                          </span>
                        ) : null}
                        {h.bestCombo && h.bestCombo >= 2 ? (
                          <span className="quiz-history-best">
                            {' · 🔥 '}
                            {h.bestCombo}×
                          </span>
                        ) : null}
                      </span>
                    </button>
                    <button
                      className="quiz-history-remove"
                      onClick={() => removeHistoryEntry(h.url)}
                      title="Retirer de l'historique"
                      aria-label="Retirer"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (phase === 'config') {
    const needsPlayers = settings.mode === 'multi' || settings.mode === 'elimination';
    const canStart = !needsPlayers || settings.players.filter((p) => p.trim()).length >= 2;

    return (
      <div className="screen quiz-screen">
        <div className="quiz-header">
          <button className="btn-ghost" onClick={() => setPhase('setup')}>← Retour</button>
          <h1 className="quiz-title">Réglages</h1>
          <div style={{ width: 80 }} />
        </div>
        <div className="quiz-body">
          <p className="quiz-hint">{tracks.length} morceaux chargés.</p>

          {/* Network mode — featured card at the top */}
          <button
            className={`net-mode-card ${settings.mode === 'network' ? 'is-active' : ''}`}
            onClick={() => setSettings((s) => ({ ...s, mode: 'network' }))}
          >
            <div className="net-mode-card-icon">🌐</div>
            <div className="net-mode-card-body">
              <strong>Mode en ligne</strong>
              <span>Chaque joueur rejoint sur son téléphone — comme Kahoot, mais mieux.</span>
            </div>
            <div className="net-mode-card-check">{settings.mode === 'network' ? '✓' : ''}</div>
          </button>

          {settings.mode === 'network' && (
            <div className="quiz-section">
              <h3>Serveur de jeu</h3>
              <input
                className="quiz-server-url-input"
                type="text"
                value={settings.serverUrl}
                onChange={(e) => setSettings((s) => ({ ...s, serverUrl: e.target.value }))}
                placeholder="wss://quiz.stan-bouchet.fr"
                spellCheck={false}
              />
              <p className="quiz-hint" style={{ marginTop: 8 }}>
                Les joueurs ouvrent <strong>quiz.stan-bouchet.fr</strong> sur leur téléphone.
              </p>
            </div>
          )}

          <div className="quiz-section">
            <h3>Mode solo / local</h3>
            <div className="quiz-options">
              {([
                ['qcm',         'QCM',           '4 propositions'],
                ['free',        'Saisie libre',  "Tape ce que t'entends"],
                ['multi',       'Multi-joueurs', 'Tour par tour avec buzz'],
                ['chrono',      '⏱ Chrono',      'Le plus vite possible'],
                ['elimination', '⚡ Élimination', 'Le dernier debout gagne'],
              ] as [QuizMode, string, string][]).map(([m, label, hint]) => (
                <button
                  key={m}
                  className={`quiz-option ${settings.mode === m ? 'is-active' : ''}`}
                  onClick={() => setSettings((s) => ({ ...s, mode: m }))}
                >
                  <strong>{label}</strong>
                  <span>{hint}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="quiz-section">
            <h3>À deviner</h3>
            <div className="quiz-options">
              {([
                ['title',  'Titre'],
                ['artist', 'Artiste'],
                ['both',   'Les deux'],
                ['decade', 'Décennie'],
              ] as [QuizTarget, string][]).map(([t, label]) => (
                <button
                  key={t}
                  className={`quiz-option ${settings.target === t ? 'is-active' : ''}`}
                  onClick={() => setSettings((s) => ({ ...s, target: t }))}
                >
                  <strong>{label}</strong>
                </button>
              ))}
            </div>
          </div>

          <div className="quiz-section">
            <h3>Difficulté</h3>
            <div className="quiz-options">
              {(Object.keys(DIFFICULTY_PRESETS) as QuizDifficulty[]).map((d) => (
                <button
                  key={d}
                  className={`quiz-option ${settings.difficulty === d ? 'is-active' : ''}`}
                  onClick={() => setSettings((s) => ({ ...s, difficulty: d }))}
                >
                  <strong>{DIFFICULTY_PRESETS[d].label}</strong>
                  <span>{DIFFICULTY_PRESETS[d].duration}s par défaut</span>
                </button>
              ))}
            </div>
          </div>

          <div className="quiz-section">
            <h3>Durée d'extrait</h3>
            <div className="quiz-slider-row">
              <input
                type="range"
                min={1}
                max={30}
                step={1}
                value={settings.customDuration || effectiveDuration}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, customDuration: Number(e.target.value) }))
                }
              />
              <span className="quiz-slider-value">
                {settings.customDuration > 0
                  ? `${settings.customDuration}s`
                  : `${effectiveDuration}s (auto)`}
              </span>
            </div>
            {settings.customDuration > 0 && (
              <button
                className="btn-ghost btn-small"
                onClick={() => setSettings((s) => ({ ...s, customDuration: 0 }))}
              >
                Revenir à la durée auto
              </button>
            )}
          </div>

          <div className="quiz-section">
            <h3>Compte à rebours avant chaque manche</h3>
            <div className="quiz-options">
              {[0, 3, 5, 10, 15, 20, 30].map((c) => (
                <button
                  key={c}
                  className={`quiz-option ${settings.countdown === c ? 'is-active' : ''}`}
                  onClick={() => setSettings((s) => ({ ...s, countdown: c }))}
                >
                  <strong>{c === 0 ? 'Aucun' : `${c}s`}</strong>
                </button>
              ))}
            </div>
          </div>

          {(settings.mode === 'multi' || settings.mode === 'elimination') && (
            <div className="quiz-section">
              <h3>Joueurs</h3>
              <div className="quiz-players-list">
                {settings.players.map((p, i) => {
                  const boundKey = settings.keyBindings[i] ?? '';
                  const isCapturing = capturingKeyFor === i;
                  return (
                    <div key={i} className="quiz-player-row">
                      <input
                        className="input quiz-player-name"
                        type="text"
                        value={p}
                        placeholder={`Joueur ${i + 1}`}
                        onChange={(e) => {
                          const np = [...settings.players];
                          np[i] = e.target.value;
                          setSettings((s) => ({ ...s, players: np }));
                        }}
                      />
                      <button
                        className={`quiz-keybind-btn ${isCapturing ? 'is-capturing' : ''} ${boundKey ? 'has-key' : ''}`}
                        onClick={() => setCapturingKeyFor(isCapturing ? null : i)}
                        title={isCapturing ? 'Appuyez sur une touche…' : 'Cliquez pour assigner une touche'}
                      >
                        {isCapturing
                          ? '⌨ …'
                          : boundKey
                          ? <><span className="quiz-keybind-label">Touche</span><kbd>{boundKey}</kbd></>
                          : '+ Touche'}
                      </button>
                      {boundKey && !isCapturing && (
                        <button
                          className="quiz-keybind-clear"
                          onClick={() => setSettings((s) => {
                            const kb = [...s.keyBindings];
                            kb[i] = '';
                            return { ...s, keyBindings: kb };
                          })}
                          title="Supprimer la touche"
                        >✕</button>
                      )}
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button
                  className="btn-secondary"
                  onClick={() =>
                    setSettings((s) => ({
                      ...s,
                      players: [...s.players, `Joueur ${s.players.length + 1}`],
                      keyBindings: [...s.keyBindings, ''],
                    }))
                  }
                >
                  + Ajouter un joueur
                </button>
                {settings.players.length > 2 && (
                  <button
                    className="btn-secondary"
                    onClick={() =>
                      setSettings((s) => ({
                        ...s,
                        players: s.players.slice(0, -1),
                        keyBindings: s.keyBindings.slice(0, -1),
                      }))
                    }
                  >
                    − Retirer
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="quiz-section">
            <h3>Pistes à jouer</h3>
            <div className="quiz-options" style={{ marginBottom: 12 }}>
              <button
                className={`quiz-option ${trackPick === 'random' ? 'is-active' : ''}`}
                onClick={() => setTrackPick('random')}
              >
                <strong>🎲 Aléatoire</strong>
                <span>N pistes au hasard</span>
              </button>
              <button
                className={`quiz-option ${trackPick === 'manual' ? 'is-active' : ''}`}
                onClick={() => setTrackPick('manual')}
              >
                <strong>☑ Choisir</strong>
                <span>Sélection manuelle</span>
              </button>
            </div>

            {trackPick === 'random' && (
              <div className="quiz-options">
                {[5, 10, 15, 20, 30, 0].filter((n) => n === 0 || n <= tracks.length).map((n) => (
                  <button
                    key={n}
                    className={`quiz-option ${trackCount === n ? 'is-active' : ''}`}
                    onClick={() => setTrackCount(n)}
                  >
                    <strong>{n === 0 ? 'Toutes' : String(n)}</strong>
                    {n === 0 && <span>{tracks.length} morceaux</span>}
                  </button>
                ))}
              </div>
            )}

            {trackPick === 'manual' && (
              <div className="quiz-track-picker">
                <div className="quiz-track-picker-bar">
                  <span className="quiz-track-picker-count">
                    {selectedTrackIndices.size} / {tracks.length} sélectionnées
                  </span>
                  <button
                    className="btn-ghost btn-small"
                    onClick={() => setSelectedTrackIndices(new Set(tracks.map((_, i) => i)))}
                  >
                    Tout
                  </button>
                  <button
                    className="btn-ghost btn-small"
                    onClick={() => setSelectedTrackIndices(new Set())}
                  >
                    Aucune
                  </button>
                </div>
                <div className="quiz-track-picker-list">
                  {tracks.map((t, i) => (
                    <label key={i} className={`quiz-track-pick-item ${selectedTrackIndices.has(i) ? 'is-checked' : ''}`}>
                      <input
                        type="checkbox"
                        checked={selectedTrackIndices.has(i)}
                        onChange={() => toggleTrackIndex(i)}
                      />
                      <div className="quiz-track-pick-info">
                        <span className="quiz-track-pick-title">{t.title}</span>
                        <span className="quiz-track-pick-artist">{t.artist}</span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="quiz-section">
            <h3>Mode Jukebox 🎶</h3>
            <div className="quiz-options">
              <button
                className={`quiz-option ${!settings.jukebox ? 'is-active' : ''}`}
                onClick={() => setSettings((s) => ({ ...s, jukebox: false }))}
              >
                <strong>Off</strong>
                <span>Avancer manuellement</span>
              </button>
              <button
                className={`quiz-option ${settings.jukebox ? 'is-active' : ''}`}
                onClick={() => setSettings((s) => ({ ...s, jukebox: true }))}
              >
                <strong>🎶 Jukebox</strong>
                <span>Auto-avance + musique en fond</span>
              </button>
            </div>
          </div>

          <button
            className="btn-primary btn-large"
            onClick={() => setPhase('rules')}
            disabled={!canStart || (trackPick === 'manual' && selectedTrackIndices.size === 0)}
            style={{ marginTop: 24, width: '100%' }}
          >
            ▶ Voir les règles
            {trackPick === 'random' && trackCount > 0 && tracks.length > 0
              ? ` · ${Math.min(trackCount, tracks.length)} pistes`
              : trackPick === 'manual' && selectedTrackIndices.size > 0
              ? ` · ${selectedTrackIndices.size} pistes`
              : ''}
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'rules') {
    const trackCountLabel = trackPick === 'manual'
      ? selectedTrackIndices.size
      : Math.min(trackCount === 0 ? tracks.length : trackCount, tracks.length);

    const modeRules: Record<string, { icon: string; title: string; lines: string[] }> = {
      qcm: {
        icon: '🎯',
        title: 'QCM — 4 propositions',
        lines: [
          'Écoute l\'extrait et choisis la bonne réponse parmi 4 options.',
          `Plus tu réponds vite, plus tu gagnes de points (entre ${POINTS_MIN} et ${POINTS_MAX} pts).`,
          'Tu peux rejouer l\'extrait autant de fois que tu veux avant de répondre.',
          'Raccourcis : touches 1 2 3 4 pour choisir, Espace pour rejouer.',
        ],
      },
      free: {
        icon: '✍️',
        title: 'Saisie libre',
        lines: [
          'Écoute l\'extrait et tape ta réponse dans le champ texte.',
          'Les majuscules, accents et espaces supplémentaires sont ignorés.',
          `Bonne réponse : ${POINTS_MAX} pts. Mauvaise réponse : ${POINTS_MIN} pts de consolation.`,
          'Raccourci : Espace pour rejouer, Entrée pour valider.',
        ],
      },
      multi: {
        icon: '🔔',
        title: 'Multi-joueurs — Buzzer',
        lines: [
          'Tous les joueurs écoutent ensemble. Buzzez dès que vous reconnaissez le morceau.',
          'Le premier à buzzer répond. Bonne réponse → points ; mauvaise → 0 pts.',
          `Points par manche : entre ${POINTS_MIN} et ${POINTS_MAX} selon la vitesse du buzz.`,
          'Raccourci : Espace pour buzzer (joueur 1).',
        ],
      },
      chrono: {
        icon: '⏱',
        title: 'Chrono — Le plus vite possible',
        lines: [
          'Réponds le plus vite possible : ton score final est ton temps total cumulé.',
          'Moins tu mets de temps, mieux c\'est.',
          'Mauvaise réponse ou abandon : +10 secondes de pénalité.',
          'Raccourcis : touches 1 2 3 4 pour choisir, Espace pour rejouer.',
        ],
      },
      elimination: {
        icon: '⚡',
        title: 'Élimination — Le dernier debout gagne',
        lines: [
          'Tous les joueurs écoutent ensemble. Le premier à buzzer répond.',
          'Bonne réponse → tu restes. Mauvaise réponse → tu es éliminé(e) !',
          'Le dernier joueur encore en jeu remporte la partie.',
          'Espace pour buzzer (joueur 1).',
        ],
      },
    };

    const targetLabel: Record<string, string> = {
      title:  'le titre',
      artist: 'l\'artiste',
      both:   'le titre ET l\'artiste',
      decade: 'la décennie',
    };

    const rule = modeRules[settings.mode];

    return (
      <div className="screen quiz-screen">
        <div className="quiz-header">
          <button className="btn-ghost" onClick={() => setPhase('config')}>← Retour</button>
          <h1 className="quiz-title">Règles</h1>
          <div style={{ width: 80 }} />
        </div>
        <div className="quiz-body quiz-rules-body">

          <div className="quiz-rules-summary">
            <span className="quiz-rules-badge">{trackCountLabel} pistes</span>
            <span className="quiz-rules-badge">{effectiveDuration}s par extrait</span>
            <span className="quiz-rules-badge">Deviner {targetLabel[settings.target]}</span>
            {settings.countdown > 0 && (
              <span className="quiz-rules-badge">Compte à rebours {settings.countdown}s</span>
            )}
            {settings.jukebox && (
              <span className="quiz-rules-badge quiz-rules-badge-jukebox">🎶 Jukebox activé</span>
            )}
          </div>

          <div className="quiz-rules-card">
            <div className="quiz-rules-card-title">
              <span className="quiz-rules-card-icon">{rule.icon}</span>
              {rule.title}
            </div>
            <ul className="quiz-rules-list">
              {rule.lines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </div>

          {(settings.mode === 'multi' || settings.mode === 'elimination') && (
            <div className="quiz-rules-card">
              <div className="quiz-rules-card-title">
                <span className="quiz-rules-card-icon">👥</span>
                Joueurs ({settings.players.filter(p => p.trim()).length})
              </div>
              <div className="quiz-rules-players">
                {settings.players.filter(p => p.trim()).map((p, i) => (
                  <span key={i} className={`quiz-rules-player quiz-kahoot-${KAHOOT_COLORS[i % 4].key}`}>
                    {KAHOOT_COLORS[i % 4].shape} {p}
                  </span>
                ))}
              </div>
            </div>
          )}

          {settings.jukebox && (
            <div className="quiz-rules-card">
              <div className="quiz-rules-card-title">
                <span className="quiz-rules-card-icon">🎶</span>
                Mode Jukebox
              </div>
              <ul className="quiz-rules-list">
                <li>Après chaque révélation, le quiz avance automatiquement en {JUKEBOX_AUTOADVANCE}s.</li>
                <li>Sur bonne réponse : la chanson se lance dans le lecteur en bas de l'écran.</li>
                <li>Clique sur "Suivant" pour passer immédiatement sans attendre.</li>
              </ul>
            </div>
          )}

          <div className="quiz-rules-card quiz-rules-card-global">
            <div className="quiz-rules-card-title">
              <span className="quiz-rules-card-icon">⌨️</span>
              Raccourcis globaux
            </div>
            <ul className="quiz-rules-list">
              <li><kbd>F11</kbd> — Plein écran</li>
              <li><kbd>Échap</kbd> — Abandonner la manche (0 pt)</li>
              <li><kbd>Entrée</kbd> — Passer à la suite après révélation</li>
            </ul>
          </div>

          <button className="btn-primary btn-large quiz-rules-start" onClick={startQuiz}>
            C'est parti ! 🚀
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'countdown') {
    return (
      <div className="screen quiz-screen">
        <div className="quiz-header">
          <button className="btn-ghost" onClick={() => setPhase('result')}>Arrêter</button>
          <h1 className="quiz-title">Score : {score} pts</h1>
          <span className="quiz-progress">
            {currentRound + 1} / {order.length}
          </span>
        </div>
        <div className="quiz-body quiz-playing">
          <div className="quiz-countdown-big">{countdownLeft}</div>
          <p className="quiz-hint">Préparez-vous...</p>
        </div>
      </div>
    );
  }

  if (phase === 'playing' && currentTrack) {
    const progressLabel = `${currentRound + 1} / ${order.length}`;
    const ringSize = 200;
    const stroke = 10;
    const radius = (ringSize - stroke) / 2;
    const circumference = 2 * Math.PI * radius;
    const dashOffset = circumference * (1 - timerProgress);

    return (
      <div className={`screen quiz-screen ${celebration === 'lose' ? 'shake' : ''} ${timerProgress <= 0.25 && !revealed ? 'quiz-screen--urgent' : ''}`}>
        <div className="quiz-header">
          <button className="btn-ghost" onClick={() => setPhase('result')}>Arrêter</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h1 className="quiz-title">Score : {score} pts</h1>
            {currentCombo >= 2 && (
              <span className={`quiz-combo-badge quiz-combo-${currentCombo >= 6 ? 'fire' : currentCombo >= 4 ? 'hot' : 'warm'}`}>
                🔥×{currentCombo}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="quiz-progress">{progressLabel}</span>
            <button className="quiz-fullscreen-btn" onClick={toggleFullscreen} title={isFullscreen ? 'Quitter le plein écran' : 'Plein écran'}>
              {isFullscreen ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="8 3 3 3 3 8"/><polyline points="21 8 21 3 16 3"/>
                  <polyline points="3 16 3 21 8 21"/><polyline points="16 21 21 21 21 16"/>
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
                  <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
                </svg>
              )}
            </button>
          </div>
        </div>

        <div className="quiz-body quiz-playing">
          <audio ref={audioRef} />

          {celebration === 'win' && <Confetti />}

          {!revealed && (() => {
            const theme = ROUND_THEMES[currentRound % ROUND_THEMES.length];
            const blurPx = Math.round(28 * timerProgress);
            return (
              <div className="quiz-mystery">
                {currentTrack.cover_url && (
                  <img
                    src={currentTrack.cover_url}
                    alt=""
                    className="quiz-mystery-cover"
                    style={{ filter: `blur(${blurPx}px) brightness(0.55)`, transform: `scale(${1 + timerProgress * 0.08})` }}
                  />
                )}
                <div className="quiz-vinyl">
                  <svg
                    className="quiz-vinyl-ring"
                    width={ringSize}
                    height={ringSize}
                    viewBox={`0 0 ${ringSize} ${ringSize}`}
                  >
                    <circle
                      className="quiz-vinyl-bg"
                      cx={ringSize / 2}
                      cy={ringSize / 2}
                      r={radius}
                      strokeWidth={stroke}
                      fill="none"
                    />
                    <circle
                      className="quiz-vinyl-fg"
                      cx={ringSize / 2}
                      cy={ringSize / 2}
                      r={radius}
                      strokeWidth={stroke}
                      fill="none"
                      strokeDasharray={circumference}
                      strokeDashoffset={dashOffset}
                      transform={`rotate(-90 ${ringSize / 2} ${ringSize / 2})`}
                      style={{ stroke: theme.glow.replace('0.45', '1'), filter: `drop-shadow(0 0 10px ${theme.glow})` }}
                    />
                  </svg>
                  <div
                    className="quiz-vinyl-disc"
                    style={{
                      background: theme.gradient,
                      boxShadow: `0 12px 40px ${theme.glow}, inset 0 -8px 16px rgba(0,0,0,0.25)`,
                    }}
                  >
                    <span
                      className="quiz-vinyl-icon"
                      style={{ animationDirection: theme.reverse ? 'reverse' : 'normal' }}
                    >
                      {theme.icon}
                    </span>
                  </div>
                  <div className="quiz-vinyl-time">
                    {Math.ceil(timerProgress * effectiveDuration)}
                  </div>
                </div>
                <p className="quiz-mystery-label">À toi de jouer !</p>
                <button className="btn-secondary" onClick={replay}>↻ Rejouer l'extrait</button>
              </div>
            );
          })()}

          {revealed && (() => {
            const lastResult = results[results.length - 1];
            const correct = lastResult?.correct ?? false;
            const deezerSearchUrl = `https://www.deezer.com/search/${encodeURIComponent(`${currentTrack.title} ${currentTrack.artist}`)}`;
            const toggleReveal = () => {
              const audio = audioRef.current;
              if (!audio) return;
              if (revealPlaying) {
                audio.pause();
                setRevealPlaying(false);
              } else {
                audio.play().then(() => setRevealPlaying(true)).catch(() => {});
              }
            };
            return (
              <>
              <div className="quiz-reveal">
                {/* Verdict */}
                <div className={`quiz-verdict-wrap${correct ? ' quiz-verdict-win' : ' quiz-verdict-lose'}`}>
                  <p className={correct ? 'quiz-correct' : 'quiz-wrong'}>
                    {correct
                      ? ['🎉 Bravo !', '🏆 Trop fort !', '✨ Bien joué !', '🌟 Magnifique !'][currentRound % 4]
                      : ['💔 Raté', '😅 Pas cette fois', '🙈 Aïe', '😬 Presque'][currentRound % 4]}
                  </p>
                  {correct && (
                    <p className="quiz-points-won quiz-points-pop">+{lastResult?.points} pts ⚡</p>
                  )}
                </div>

                {/* Track info card */}
                <div className="quiz-reveal-card">
                  {currentTrack.cover_url && (
                    <img src={currentTrack.cover_url} alt="" className="quiz-reveal-cover" />
                  )}
                  <div className="quiz-reveal-info">
                    <span className="quiz-reveal-title">{currentTrack.title}</span>
                    <span className="quiz-reveal-artist">{currentTrack.artist}</span>
                    {currentTrack.album && (
                      <span className="quiz-reveal-album">💿 {currentTrack.album}</span>
                    )}
                    <div className="quiz-reveal-links">
                      <button
                        className="quiz-reveal-deezer-btn"
                        onClick={() => invoke('plugin:shell|open', { path: deezerSearchUrl }).catch(() => {})}
                        title="Rechercher sur Deezer"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10zm-1-6h2V8h-2v8zm0-10h2V4h-2v2z"/></svg>
                        Voir sur Deezer
                      </button>
                      {correct && !ytVideoId && (
                        <button
                          className={`quiz-reveal-yt-btn${ytVideoLoading ? ' is-loading' : ''}`}
                          disabled={ytVideoLoading}
                          onClick={() => {
                            if (ytVideoLoading) return;
                            setYtVideoLoading(true);
                            const query = `${currentTrack.title} ${currentTrack.artist} clip officiel`;
                            invoke<string>('get_youtube_video_id', { query })
                              .then((id) => setYtVideoId(id))
                              .catch(() => {
                                const q = encodeURIComponent(query);
                                invoke('plugin:shell|open', { path: `https://www.youtube.com/results?search_query=${q}` }).catch(() => {});
                              })
                              .finally(() => setYtVideoLoading(false));
                          }}
                          title="Voir le clip"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1C24 15.9 24 12 24 12s0-3.9-.5-5.8zM9.7 15.5V8.5l6.3 3.5-6.3 3.5z"/></svg>
                          {ytVideoLoading ? 'Chargement…' : '🎬 Voir le clip'}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Inline player — shows full controls once a full song is loaded */}
                  {revealFullSong ? (
                    <div className="quiz-reveal-fullplayer">
                      <button className="quiz-reveal-play-btn" onClick={toggleReveal}>
                        {revealPlaying ? (
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                            <rect x="6" y="4" width="4" height="16" rx="1"/>
                            <rect x="14" y="4" width="4" height="16" rx="1"/>
                          </svg>
                        ) : (
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                            <polygon points="5 3 19 12 5 21 5 3"/>
                          </svg>
                        )}
                      </button>
                      <div className="quiz-reveal-fullplayer-track">
                        <div
                          className="quiz-reveal-fullplayer-bar"
                          onClick={(e) => {
                            const audio = audioRef.current;
                            if (!audio || !audio.duration) return;
                            const rect = e.currentTarget.getBoundingClientRect();
                            audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration;
                          }}
                        >
                          <div
                            className="quiz-reveal-fullplayer-fill"
                            style={{ width: revealDuration ? `${(revealCurrentTime / revealDuration) * 100}%` : '0%' }}
                          />
                        </div>
                        <div className="quiz-reveal-fullplayer-times">
                          <span>{formatRevealTime(revealCurrentTime)}</span>
                          <span>{formatRevealTime(revealDuration)}</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="quiz-reveal-player">
                      <button
                        className={`quiz-reveal-play-btn ${revealPlaying ? 'is-playing' : ''}`}
                        onClick={toggleReveal}
                      >
                        {revealPlaying ? (
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                            <rect x="6" y="4" width="4" height="16" rx="1"/>
                            <rect x="14" y="4" width="4" height="16" rx="1"/>
                          </svg>
                        ) : (
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                            <polygon points="5 3 19 12 5 21 5 3"/>
                          </svg>
                        )}
                      </button>
                      <span className="quiz-reveal-player-label">
                        {revealPlaying ? 'Extrait en cours…' : "Écouter l'extrait"}
                      </span>
                    </div>
                  )}
                </div>

                {/* Full song — local file → MiniPlayer, otherwise → stream via yt-dlp */}
                {!revealFullSong && (() => {
                  const localFile = onJukeboxPlay ? findJukeboxFile(currentTrack, audioFiles) : null;
                  if (localFile && onJukeboxPlay) {
                    return (
                      <button className="quiz-full-song-btn" onClick={() => { onJukeboxPlay(localFile.path); setRevealFullSong(true); }}>
                        🎵 Écouter en entier
                      </button>
                    );
                  }
                  const streamTrack = () => {
                    if (ytStreamLoading) return;
                    setYtStreamLoading(true);
                    const query = `${currentTrack.title} ${currentTrack.artist}`;
                    invoke<string>('get_youtube_stream_url', { query })
                      .then((url) => {
                        const audio = audioRef.current;
                        if (!audio) return;
                        audio.pause();
                        audio.src = url;
                        audio.currentTime = 0;
                        audio.play()
                          .then(() => { setRevealPlaying(true); setRevealFullSong(true); })
                          .catch(() => {});
                      })
                      .catch(() => {})
                      .finally(() => setYtStreamLoading(false));
                  };
                  return (
                    <div className="quiz-full-song-wrap">
                      <button
                        className={`quiz-full-song-btn quiz-full-song-btn--yt ${ytStreamLoading ? 'is-loading' : ''}`}
                        onClick={streamTrack}
                        disabled={ytStreamLoading}
                      >
                        {ytStreamLoading ? '▶ Chargement…' : '▶ Écouter en entier'}
                      </button>
                      {ytStreamLoading && (
                        <span className="quiz-full-song-hint">Pas de panique, ça arrive !</span>
                      )}
                    </div>
                  );
                })()}

                {wikiSnippet && (
                  <div className="quiz-wiki-snippet">
                    <span className="quiz-wiki-label">
                      {wikiSubject === currentTrack.title
                        ? `🎵 ${currentTrack.title}`
                        : wikiSubject === currentTrack.album
                        ? `💿 ${currentTrack.album}`
                        : `🎤 ${currentTrack.artist}`}
                    </span>
                    <p className="quiz-wiki-text">{wikiSnippet}</p>
                  </div>
                )}

                {mbData && (mbData.label || mbData.country || mbData.date || mbData.tags?.length) && (
                  <div className="quiz-mb-badges">
                    {mbData.tags?.map((t) => <span key={t} className="quiz-mb-badge quiz-mb-tag">🎸 {t}</span>)}
                    {mbData.label && <span className="quiz-mb-badge">🏷 {mbData.label}</span>}
                    {mbData.date && <span className="quiz-mb-badge">📅 {mbData.date}</span>}
                    {mbData.country && <span className="quiz-mb-badge">🌐 {mbData.country}</span>}
                  </div>
                )}

                {ytVideoId && (
                  <div className="quiz-yt-embed">
                    <iframe
                      src={`https://www.youtube-nocookie.com/embed/${ytVideoId}?autoplay=1&rel=0`}
                      title="Clip YouTube"
                      allow="autoplay; encrypted-media"
                      allowFullScreen
                    />
                    <button
                      className="quiz-yt-embed-close"
                      onClick={() => setYtVideoId(null)}
                      title="Fermer"
                    >✕</button>
                  </div>
                )}

                {(settings.mode === 'multi' || settings.mode === 'elimination') && (
                  <InterRoundPodium
                    players={settings.players}
                    results={results}
                    prevScores={prevScoresRef.current}
                    eliminatedPlayers={eliminatedPlayers}
                  />
                )}

              </div>
              {/* Sticky "Suivant" — always visible at bottom without scrolling */}
              <div className="quiz-next-sticky">
                <button className="btn-primary btn-large" onClick={nextRound}>
                  {currentRound + 1 >= order.length
                    ? '🏁 Voir le score'
                    : jukeboxCountdown > 0
                    ? `Suivant dans ${jukeboxCountdown}s ⏩`
                    : 'Suivant →'}
                </button>
              </div>
              </>
            );
          })()}

          {!revealed && settings.mode === 'qcm' && (
            <div className="quiz-qcm">
              {qcmOptions.map((opt) => (
                <button
                  key={opt}
                  className={`quiz-qcm-option ${pickedOption === opt ? 'is-picked' : ''}`}
                  onClick={() => handleQcmPick(opt)}
                >
                  {opt}
                </button>
              ))}
            </div>
          )}

          {!revealed && settings.mode === 'free' && (
            <div className="quiz-free">
              <input
                className="input"
                autoFocus
                type="text"
                placeholder={
                  settings.target === 'title'
                    ? 'Titre du morceau...'
                    : settings.target === 'artist'
                    ? 'Artiste...'
                    : 'Titre ou artiste...'
                }
                value={freeInput}
                onChange={(e) => setFreeInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && freeInput && handleFreeSubmit()}
              />
              <button
                className="btn-primary"
                onClick={handleFreeSubmit}
                disabled={!freeInput}
                style={{ marginTop: 12 }}
              >
                Valider
              </button>
              <button
                className="btn-ghost"
                onClick={() => recordResult(false)}
                style={{ marginTop: 8 }}
              >
                Je donne ma langue au chat
              </button>
            </div>
          )}

          {!revealed && settings.mode === 'chrono' && (
            <div className="quiz-qcm">
              {qcmOptions.map((opt, i) => (
                <button
                  key={opt}
                  className={`quiz-qcm-option ${pickedOption === opt ? 'is-picked' : ''}`}
                  onClick={() => handleQcmPick(opt)}
                >
                  <span className="quiz-chrono-key">{i + 1}</span> {opt}
                </button>
              ))}
            </div>
          )}

          {!revealed && (settings.mode === 'multi' || settings.mode === 'elimination') && (
            <div className="quiz-multi">
              {!activePlayer && (
                <div className="quiz-buzzers">
                  {settings.players
                    .filter((p) => settings.mode !== 'elimination' || !eliminatedPlayers.includes(p))
                    .map((p, i) => {
                      const key = settings.keyBindings[i];
                      return (
                        <button key={p} className="quiz-buzzer" onClick={() => handleBuzz(p)}>
                          🔔 {p}
                          {key && <kbd className="quiz-buzzer-key">{key}</kbd>}
                        </button>
                      );
                    })}
                  {settings.mode === 'elimination' && eliminatedPlayers.length > 0 && (
                    <div className="quiz-eliminated-list">
                      {eliminatedPlayers.map((p) => (
                        <span key={p} className="quiz-eliminated-badge">💀 {p}</span>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {activePlayer && (
                <div className="quiz-multi-validate">
                  <p className="quiz-multi-buzz-line">
                    🔔 <strong>{activePlayer}</strong> — c'est quoi ?
                  </p>
                  <div className="quiz-kahoot-grid">
                    {qcmOptions.map((opt, i) => (
                      <button
                        key={opt}
                        className={`quiz-kahoot-btn quiz-kahoot-${KAHOOT_COLORS[i % 4].key} ${pickedOption === opt ? 'is-picked' : ''}`}
                        onClick={() => {
                          setPickedOption(opt);
                          handleMultiValidate(opt === answerFor(currentTrack, settings.target));
                        }}
                      >
                        <span className="quiz-kahoot-shape">{KAHOOT_COLORS[i % 4].shape}</span>
                        <span className="quiz-kahoot-text">{opt}</span>
                      </button>
                    ))}
                  </div>
                  <button
                    className="btn-ghost"
                    onClick={() => handleMultiValidate(false)}
                    style={{ marginTop: 12 }}
                  >
                    Je donne ma langue au chat
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (phase === 'result') {
    return (
      <div className="screen quiz-screen">
        <div className="quiz-header">
          <button className="btn-ghost" onClick={onExit}>Quitter</button>
          <h1 className="quiz-title">Fin du quizz</h1>
          <div style={{ width: 80 }} />
        </div>
        <div className="quiz-body quiz-result">
          {settings.mode === 'elimination' ? (() => {
            const survivors = settings.players.filter((p) => !eliminatedPlayers.includes(p));
            const winner = survivors[0] ?? eliminatedPlayers[eliminatedPlayers.length - 1] ?? '?';
            return (
              <>
                <div className="quiz-elim-winner">
                  <div className="quiz-elim-crown">👑</div>
                  <div className="quiz-elim-winner-name">{winner}</div>
                  <div className="quiz-elim-subtitle">Gagnant(e) !</div>
                </div>
                <div className="quiz-elim-eliminated">
                  {[...eliminatedPlayers].reverse().map((p, i) => (
                    <span key={p} className="quiz-eliminated-badge" style={{ animationDelay: `${i * 0.1}s` }}>
                      💀 {p}
                    </span>
                  ))}
                </div>
              </>
            );
          })() : settings.mode === 'multi' ? (
            <>
              <h2>🏆 Classement</h2>
              <ol className="quiz-leaderboard quiz-leaderboard-animated">
                {playerScores.map(([p, s], i) => (
                  <li key={p} style={{ animationDelay: `${i * 0.12}s` }}>
                    <span>
                      {i === 0 ? '👑 ' : ''}
                      {p}
                    </span>
                    <strong>{s}</strong>
                  </li>
                ))}
              </ol>
            </>
          ) : settings.mode === 'chrono' ? (
            <>
              <h2>⏱ Temps total</h2>
              <div className="quiz-final-score quiz-final-chrono">{formatChronoTime(chronoTotal)}</div>
              <p className="quiz-final-meta">
                {correctCount} / {order.length} bonnes réponses
              </p>
              {isNewChronoRecord && previousBestChrono !== undefined && (
                <p className="quiz-record-banner">🆕 Nouveau record ! (avant : {formatChronoTime(previousBestChrono)})</p>
              )}
              {isNewChronoRecord && previousBestChrono === undefined && (
                <p className="quiz-record-banner">🆕 Premier chrono enregistré !</p>
              )}
              {!isNewChronoRecord && previousBestChrono !== undefined && (
                <p className="quiz-hint">Meilleur temps : {formatChronoTime(previousBestChrono)}</p>
              )}
              <p className="quiz-hint">
                {correctCount >= order.length * 0.9
                  ? '🏆 Légendaire !'
                  : correctCount >= order.length * 0.7
                  ? '🎉 Très bien !'
                  : correctCount >= order.length * 0.4
                  ? '👍 Pas mal'
                  : "Encore un peu d'entraînement 😉"}
              </p>
            </>
          ) : (
            <>
              <h2>Ton score</h2>
              <div className="quiz-final-score">{score}</div>
              <p className="quiz-final-meta">
                sur {maxScore} pts · {correctCount} / {order.length} bonnes réponses
              </p>
              {isNewRecord && (
                <p className="quiz-record-banner">🆕 Nouveau record ! (avant : {previousBest} pts)</p>
              )}
              {!isNewRecord && previousBest > 0 && (
                <p className="quiz-hint">Meilleur score : {previousBest} pts</p>
              )}
              {maxCombo >= 2 && (
                <p className="quiz-hint quiz-combo-stat">
                  🔥 Meilleur combo : {maxCombo} ({comboMultiplier(maxCombo)}×)
                </p>
              )}
              <p className="quiz-hint">
                {score >= maxScore * 0.9
                  ? '🏆 Légendaire !'
                  : score >= maxScore * 0.7
                  ? '🎉 Très bien !'
                  : score >= maxScore * 0.4
                  ? '👍 Pas mal'
                  : "Encore un peu d'entraînement 😉"}
              </p>
            </>
          )}
          <div className="quiz-rating-block">
            <p className="quiz-hint">Note cette playlist</p>
            <StarRating value={currentRating} onChange={rateCurrentPlaylist} />
            {currentRating > 0 && currentRating < 3 && (
              <p className="quiz-rating-warn">
                Note basse — la playlist a été retirée de l'historique.
              </p>
            )}
            {currentRating >= 3 && (
              <p className="quiz-rating-thanks">Merci, ta note est sauvegardée 👍</p>
            )}
          </div>

          <QrShare
            mode={settings.mode}
            score={score}
            maxScore={maxScore}
            correctCount={correctCount}
            total={order.length}
            chronoTotal={chronoTotal}
            playerScores={playerScores}
            formatChronoTime={formatChronoTime}
          />

          <div style={{ display: 'flex', gap: 12, marginTop: 24, justifyContent: 'center' }}>
            <button className="btn-primary" onClick={startQuiz}>↻ Rejouer</button>
            <button className="btn-secondary" onClick={() => setPhase('config')}>
              Changer les réglages
            </button>
            <button className="btn-ghost" onClick={onExit}>Quitter</button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

function QrShare({
  mode, score, maxScore, correctCount, total, chronoTotal, playerScores, formatChronoTime,
}: {
  mode: string; score: number; maxScore: number; correctCount: number; total: number;
  chronoTotal: number; playerScores: [string, number][]; formatChronoTime: (s: number) => string;
}) {
  const [show, setShow] = useState(false);
  const [imgOk, setImgOk] = useState(true);

  const buildText = () => {
    const header = '🎵 Quizeo — Blind Test';
    if (mode === 'chrono')
      return `${header}\n⏱ ${formatChronoTime(chronoTotal)}\n${correctCount}/${total} bonnes réponses`;
    if (mode === 'multi')
      return `${header}\n🏆 Classement\n${playerScores.map(([p, s], i) => `${i + 1}. ${p} — ${s} pts`).join('\n')}`;
    return `${header}\n🎯 Score : ${score}/${maxScore} pts\n${correctCount}/${total} bonnes réponses`;
  };

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(buildText())}&size=180x180&color=FF7B54&bgcolor=0a0e1a&margin=10`;

  return (
    <div className="quiz-qr-wrap">
      <button className="btn-ghost btn-small quiz-qr-toggle" onClick={() => { setShow((s) => !s); setImgOk(true); }}>
        {show ? '✕ Fermer le QR' : '📱 Partager le score'}
      </button>
      {show && imgOk && (
        <div className="quiz-qr-card">
          <img
            src={qrUrl}
            alt="QR code du score"
            className="quiz-qr-img"
            onError={() => setImgOk(false)}
          />
          <p className="quiz-qr-hint">Scanne avec ton téléphone</p>
        </div>
      )}
      {show && !imgOk && (
        <p className="quiz-qr-offline">QR indisponible hors-ligne</p>
      )}
    </div>
  );
}

function InterRoundPodium({
  players,
  results,
  prevScores,
  eliminatedPlayers = [],
}: {
  players: string[];
  results: RoundResult[];
  prevScores: Map<string, number>;
  eliminatedPlayers?: string[];
}) {
  const currentMap = new Map<string, number>();
  players.forEach((p) => currentMap.set(p, 0));
  results.forEach((r) => {
    if (r.correct && r.player) currentMap.set(r.player, (currentMap.get(r.player) ?? 0) + r.points);
  });

  const sorted = players
    .map((p) => ({ p, score: currentMap.get(p) ?? 0, prev: prevScores.get(p) ?? 0 }))
    .sort((a, b) => b.score - a.score);

  const prevRanks = new Map(
    [...players]
      .map((p) => ({ p, prev: prevScores.get(p) ?? 0 }))
      .sort((a, b) => b.prev - a.prev)
      .map((item, i) => [item.p, i])
  );

  return (
    <div className="quiz-inter-podium">
      <p className="quiz-inter-title">Classement</p>
      {sorted.map((item, i) => {
        const delta = item.score - item.prev;
        const prevRank = prevRanks.get(item.p) ?? i;
        const rankDelta = prevRank - i;
        return (
          <div
            key={item.p}
            className={`quiz-inter-row ${i === 0 ? 'is-leader' : ''} ${eliminatedPlayers.includes(item.p) ? 'is-eliminated' : ''}`}
            style={{ animationDelay: `${i * 0.07}s` }}
          >
            <span className="quiz-inter-rank">{i === 0 ? '👑' : i + 1}</span>
            <span className="quiz-inter-name">{item.p}</span>
            {rankDelta > 0 && <span className="quiz-inter-move is-up">▲{rankDelta}</span>}
            {rankDelta < 0 && <span className="quiz-inter-move is-down">▼{Math.abs(rankDelta)}</span>}
            <span className="quiz-inter-score">{item.score} pts</span>
            {delta > 0 && <span className="quiz-inter-delta">+{delta}</span>}
          </div>
        );
      })}
    </div>
  );
}

function StarRating({
  value,
  onChange,
  size = 32,
}: {
  value: number;
  onChange: (n: number) => void;
  size?: number;
}) {
  const [hover, setHover] = useState(0);
  return (
    <div className="quiz-stars" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= (hover || value);
        return (
          <button
            key={n}
            type="button"
            className={`quiz-star ${filled ? 'is-filled' : ''}`}
            style={{ fontSize: size }}
            onMouseEnter={() => setHover(n)}
            onClick={() => onChange(n)}
            aria-label={`${n} étoile${n > 1 ? 's' : ''}`}
          >
            ★
          </button>
        );
      })}
    </div>
  );
}

/** Pure-CSS confetti burst, mounted briefly on a correct answer. */
function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 40 }).map((_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 0.3,
        duration: 1 + Math.random() * 0.8,
        color: ['#FF7B54', '#00D4FF', '#4ADE80', '#FBBF24', '#FB7185'][i % 5],
        size: 6 + Math.random() * 8,
        rotate: Math.random() * 360,
      })),
    []
  );
  return (
    <div className="quiz-confetti">
      {pieces.map((p) => (
        <span
          key={p.id}
          style={{
            left: `${p.left}%`,
            background: p.color,
            width: p.size,
            height: p.size,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            transform: `rotate(${p.rotate}deg)`,
          }}
        />
      ))}
    </div>
  );
}
