/**
 * CinemaScreen — trailer blind test for films, series and animation.
 *
 * Flow:
 *  setup → loading → playing (trailer + overlay) → reveal → [next | result]
 *
 * Video source : yt-dlp ytsearch1 (same backend as music quiz)
 * Metadata     : Wikipedia REST API (no key, CORS-friendly)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  CATEGORY_LABELS,
  CinemaCategory,
  CinemaItem,
  buildQcmOptions,
  getItemsByCategory,
} from '../data/cinema';

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase = 'setup' | 'loading' | 'playing' | 'reveal' | 'result';

interface WikiSummary {
  extract: string;
  thumbnail?: { source: string };
  content_urls?: { desktop: { page: string } };
}

interface CinemaScreenProps {
  onExit: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ROUND_DURATION = 20; // seconds to guess
const TOTAL_ROUNDS   = 8;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalise(s: string) {
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function isCloseEnough(guess: string, answer: string) {
  const g = normalise(guess);
  const a = normalise(answer);
  if (g === a) return true;
  // Accept if one contains the other (for long titles)
  if (a.includes(g) && g.length >= 4) return true;
  if (g.includes(a) && a.length >= 4) return true;
  return false;
}

async function fetchWiki(title: string): Promise<WikiSummary | null> {
  try {
    // Try French Wikipedia first, fallback to English
    for (const lang of ['fr', 'en']) {
      const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.extract) return data as WikiSummary;
      }
    }
  } catch { /* silent */ }
  return null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CinemaScreen({ onExit }: CinemaScreenProps) {
  const [phase, setPhase]             = useState<Phase>('setup');
  const [category, setCategory]       = useState<CinemaCategory | 'all'>('all');
  const [nRounds, setNRounds]         = useState(TOTAL_ROUNDS);

  // Quiz state
  const [queue, setQueue]             = useState<CinemaItem[]>([]);
  const [currentIdx, setCurrentIdx]   = useState(0);
  const [videoId, setVideoId]         = useState<string | null>(null);
  const [nextVideoId, setNextVideoId] = useState<string | null>(null);
  const [score, setScore]             = useState(0);
  const [correct, setCorrect]         = useState<boolean | null>(null);
  const [qcmOptions, setQcmOptions]   = useState<string[]>([]);
  const [picked, setPicked]           = useState<string | null>(null);
  const [timer, setTimer]             = useState(ROUND_DURATION);
  const [wiki, setWiki]               = useState<WikiSummary | null>(null);
  const [loadError, setLoadError]     = useState<string | null>(null);

  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const phaseRef   = useRef(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  const currentItem = queue[currentIdx] ?? null;
  const pool        = queue; // use the shuffled queue as QCM pool

  // ── Preload next video ID in background ───────────────────────────────────
  const preloadNext = useCallback((idx: number, q: CinemaItem[]) => {
    const next = q[idx + 1];
    if (!next) return;
    invoke<string>('get_youtube_video_id', { query: next.searchQuery })
      .then((id) => setNextVideoId(id))
      .catch(() => {});
  }, []);

  // ── Load video for a given item ───────────────────────────────────────────
  const loadVideo = useCallback(async (item: CinemaItem, preloaded: string | null) => {
    setPhase('loading');
    setVideoId(null);
    setLoadError(null);
    setWiki(null);
    setPicked(null);
    setCorrect(null);

    try {
      const id = preloaded ?? await invoke<string>('get_youtube_video_id', { query: item.searchQuery });
      setVideoId(id);
      setQcmOptions(buildQcmOptions(item, pool));
      setTimer(ROUND_DURATION);
      setPhase('playing');
    } catch (e) {
      setLoadError(String(e));
      setPhase('loading'); // stay on loading so user can retry
    }
  }, [pool]);

  // ── Start game ────────────────────────────────────────────────────────────
  const startGame = useCallback(() => {
    const items = getItemsByCategory(category)
      .sort(() => Math.random() - 0.5)
      .slice(0, nRounds);
    setQueue(items);
    setCurrentIdx(0);
    setScore(0);
    setNextVideoId(null);
    setPhase('loading');
  }, [category, nRounds]);

  // Trigger load when queue+idx are ready
  useEffect(() => {
    if (phase !== 'loading' || !currentItem) return;
    const preloaded = currentIdx === 0 ? null : nextVideoId;
    loadVideo(currentItem, preloaded);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentItem, currentIdx]);

  // Preload next after entering playing phase
  useEffect(() => {
    if (phase !== 'playing' || !queue.length) return;
    preloadNext(currentIdx, queue);
  }, [phase, currentIdx, queue, preloadNext]);

  // ── Timer ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'playing') return;
    timerRef.current = setInterval(() => {
      setTimer((t) => {
        if (t <= 1) {
          clearInterval(timerRef.current!);
          if (phaseRef.current === 'playing') doReveal(false);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current!);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ── Reveal ─────────────────────────────────────────────────────────────────
  const doReveal = useCallback((isCorrect: boolean) => {
    clearInterval(timerRef.current!);
    setCorrect(isCorrect);
    if (isCorrect) setScore((s) => s + Math.max(10, timer * 5));
    setPhase('reveal');
    // Fetch Wikipedia in background
    if (currentItem) {
      fetchWiki(currentItem.wikiTitle ?? currentItem.title)
        .then((w) => setWiki(w))
        .catch(() => {});
    }
  }, [currentItem, timer]);

  const handleQcm = (option: string) => {
    if (picked) return;
    setPicked(option);
    doReveal(isCloseEnough(option, currentItem?.title ?? ''));
  };

  // ── Next round ─────────────────────────────────────────────────────────────
  const nextRound = () => {
    const next = currentIdx + 1;
    if (next >= queue.length) {
      setPhase('result');
      return;
    }
    setCurrentIdx(next);
    setPhase('loading');
  };

  // ─── Renders ──────────────────────────────────────────────────────────────

  // Setup screen
  if (phase === 'setup') {
    return (
      <div className="screen cin-screen">
        <div className="cin-setup">
          <button className="btn-ghost" onClick={onExit}>← Retour</button>

          <div className="cin-setup-hero">
            <span className="cin-setup-emoji">🎬</span>
            <h1 className="cin-setup-title">Cinéma & Séries</h1>
            <p className="cin-setup-sub">Trouve le film ou la série d'après sa bande-annonce</p>
          </div>

          <div className="cin-setup-section">
            <label className="cin-setup-label">Catégorie</label>
            <div className="cin-cat-grid">
              {(['all', 'film', 'serie', 'animation'] as const).map((cat) => (
                <button
                  key={cat}
                  className={`cin-cat-btn${category === cat ? ' cin-cat-btn--active' : ''}`}
                  onClick={() => setCategory(cat)}
                >
                  {cat === 'all' ? '🎲 Tout mélanger' : CATEGORY_LABELS[cat]}
                </button>
              ))}
            </div>
          </div>

          <div className="cin-setup-section">
            <label className="cin-setup-label">Nombre de questions</label>
            <div className="cin-rounds-row">
              {[5, 8, 10, 15].map((n) => (
                <button
                  key={n}
                  className={`cin-round-btn${nRounds === n ? ' cin-round-btn--active' : ''}`}
                  onClick={() => setNRounds(n)}
                >{n}</button>
              ))}
            </div>
          </div>

          <button className="cin-start-btn" onClick={startGame}>
            ▶ Lancer le quiz
          </button>
        </div>
      </div>
    );
  }

  // Loading screen
  if (phase === 'loading') {
    return (
      <div className="screen cin-screen">
        <div className="cin-loading">
          {loadError ? (
            <>
              <p className="cin-load-error">⚠️ Impossible de charger la bande-annonce</p>
              <p className="cin-load-error-sub">{loadError}</p>
              <button className="btn-primary" onClick={() => currentItem && loadVideo(currentItem, null)}>
                Réessayer
              </button>
              <button className="btn-ghost" onClick={nextRound}>Passer →</button>
            </>
          ) : (
            <>
              <div className="cin-load-spinner">🎬</div>
              <p className="cin-load-label">Chargement de la bande-annonce…</p>
              <p className="cin-load-sub">Question {currentIdx + 1} / {queue.length}</p>
            </>
          )}
        </div>
      </div>
    );
  }

  // Result screen
  if (phase === 'result') {
    const max = queue.length * ROUND_DURATION * 5;
    const pct = Math.round((score / max) * 100);
    const medal = pct >= 80 ? '🏆' : pct >= 50 ? '🥈' : '🎬';
    return (
      <div className="screen cin-screen">
        <div className="cin-result">
          <span className="cin-result-medal">{medal}</span>
          <h1 className="cin-result-title">Score final</h1>
          <p className="cin-result-score">{score} pts</p>
          <p className="cin-result-sub">{pct}% de réussite sur {queue.length} films</p>
          <div className="cin-result-btns">
            <button className="cin-start-btn" onClick={startGame}>↺ Rejouer</button>
            <button className="btn-ghost" onClick={onExit}>← Accueil</button>
          </div>
        </div>
      </div>
    );
  }

  if (!currentItem || !videoId) return null;

  const isRevealed = phase === 'reveal';
  const timerPct   = timer / ROUND_DURATION;

  // Playing + Reveal
  return (
    <div className="screen cin-screen">
      {/* Header */}
      <div className="cin-header">
        <button className="btn-ghost" onClick={onExit}>✕</button>
        <div className="cin-header-center">
          <span className="cin-header-brand">Quizeo</span>
          <span className="cin-header-mode">🎬 Cinéma & Séries</span>
        </div>
        <div className="cin-header-right">
          <span className="cin-progress">{currentIdx + 1} / {queue.length}</span>
          <span className="cin-score">⭐ {score}</span>
        </div>
      </div>

      <div className="cin-body">
        {/* Video area */}
        <div className="cin-video-wrap">
          <iframe
            key={videoId}
            src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1${isRevealed ? '&controls=1' : '&controls=0'}`}
            title={isRevealed ? currentItem.title : 'Bande-annonce mystère'}
            allow="autoplay; encrypted-media"
            allowFullScreen
            className="cin-iframe"
          />
          {/* Overlay hides title bar during guessing */}
          {!isRevealed && (
            <div className="cin-overlay">
              <div className="cin-overlay-top" />
              <div className="cin-overlay-bottom" />
            </div>
          )}
          {/* Timer bar */}
          {!isRevealed && (
            <div className="cin-timer-bar">
              <div
                className="cin-timer-fill"
                style={{
                  width: `${timerPct * 100}%`,
                  background: timerPct > 0.5
                    ? 'var(--color-success)'
                    : timerPct > 0.25
                    ? 'var(--color-warning)'
                    : 'var(--color-error)',
                }}
              />
            </div>
          )}
        </div>

        {/* Question / Reveal */}
        {!isRevealed ? (
          <div className="cin-question">
            <p className="cin-question-label">🎬 Quel est ce film ou cette série ?</p>
            <div className="cin-qcm">
              {qcmOptions.map((opt) => (
                <button
                  key={opt}
                  className={`cin-qcm-btn${picked === opt ? (isCloseEnough(opt, currentItem.title) ? ' cin-qcm-correct' : ' cin-qcm-wrong') : ''}`}
                  onClick={() => handleQcm(opt)}
                  disabled={!!picked}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="cin-reveal">
            {/* Verdict */}
            <p className={correct ? 'cin-verdict-correct' : 'cin-verdict-wrong'}>
              {correct
                ? ['🎉 Bravo !', '🏆 Excellent !', '✨ Bien joué !'][currentIdx % 3]
                : ['💔 Raté…', '😅 Pas cette fois', '🙈 Aïe !'][currentIdx % 3]}
            </p>
            {correct && <p className="cin-points-won">+{Math.max(10, timer * 5)} pts</p>}

            {/* Film info card */}
            <div className="cin-info-card">
              {wiki?.thumbnail?.source && (
                <img src={wiki.thumbnail.source} alt={currentItem.title} className="cin-poster" />
              )}
              <div className="cin-info-body">
                <h2 className="cin-info-title">{currentItem.title}</h2>
                <p className="cin-info-meta">
                  {CATEGORY_LABELS[currentItem.category]} · {currentItem.year}
                </p>
                {wiki?.extract && (
                  <p className="cin-info-extract">
                    {wiki.extract.slice(0, 200)}{wiki.extract.length > 200 ? '…' : ''}
                  </p>
                )}
                {wiki?.content_urls?.desktop.page && (
                  <a
                    href={wiki.content_urls.desktop.page}
                    className="cin-wiki-link"
                    onClick={(e) => {
                      e.preventDefault();
                      invoke('plugin:shell|open', { path: wiki!.content_urls!.desktop.page }).catch(() => {});
                    }}
                  >
                    📖 Wikipedia
                  </a>
                )}
              </div>
            </div>

            <button className="cin-next-btn" onClick={nextRound}>
              {currentIdx + 1 >= queue.length ? '🏁 Voir le score' : 'Question suivante →'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
