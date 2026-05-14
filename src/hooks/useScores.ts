/**
 * useScores — persist best scores and streaks to localStorage.
 * Works for both music quiz and cinema quiz.
 */

export type QuizMode = 'music' | 'cinema';

interface ScoreEntry {
  best: number;
  bestStreak: number;
  gamesPlayed: number;
  lastPlayed: number; // timestamp
}

const KEY = 'quizeo_scores_v1';

function load(): Record<QuizMode, ScoreEntry> {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {
    music:  { best: 0, bestStreak: 0, gamesPlayed: 0, lastPlayed: 0 },
    cinema: { best: 0, bestStreak: 0, gamesPlayed: 0, lastPlayed: 0 },
  };
}

function save(data: Record<QuizMode, ScoreEntry>) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* ignore */ }
}

export function getScores(): Record<QuizMode, ScoreEntry> {
  return load();
}

/**
 * Save a completed game result.
 * Returns true if this score beats the previous best (for "Record !" display).
 */
export function saveScore(mode: QuizMode, score: number, streak: number): { newRecord: boolean; prevBest: number } {
  const data = load();
  const entry = data[mode];
  const newRecord = score > entry.best;
  const prevBest = entry.best;
  data[mode] = {
    best:        Math.max(entry.best, score),
    bestStreak:  Math.max(entry.bestStreak, streak),
    gamesPlayed: entry.gamesPlayed + 1,
    lastPlayed:  Date.now(),
  };
  save(data);
  return { newRecord, prevBest };
}

export function useScores() {
  return { getScores, saveScore };
}
