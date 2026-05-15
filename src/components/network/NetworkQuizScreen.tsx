/**
 * NetworkQuizScreen — host-side UI for the network multiplayer mode.
 *
 * Manages the WebSocket connection to the game server and orchestrates
 * the full game flow: lobby → rounds → reveal → scoreboard → final.
 */

import { useCallback, useEffect, useRef } from 'react';
import { QuizTrack, QuizSettings } from '../../types';
import { useNetworkGame } from '../../hooks/useNetworkGame';
import { NetworkLobby } from './NetworkLobby';
import { NetworkGameControl } from './NetworkGameControl';
import { NetworkFinal } from './NetworkFinal';

interface NetworkQuizScreenProps {
  tracks: QuizTrack[];
  settings: QuizSettings;
  onExit: () => void;
}

// Difficulty → extract duration in ms
const DURATION_MS: Record<string, number> = {
  easy:   20_000,
  medium: 15_000,
  hard:   10_000,
  expert:  7_000,
};

function buildOptions(tracks: QuizTrack[], correctIdx: number, target: string): string[] {
  const correct = target === 'artist' ? tracks[correctIdx].artist : tracks[correctIdx].title;
  const pool = tracks
    .map(t => target === 'artist' ? t.artist : t.title)
    .filter(v => v !== correct);
  const shuffled = pool.sort(() => Math.random() - 0.5).slice(0, 3);
  return [...shuffled, correct].sort(() => Math.random() - 0.5);
}

export function NetworkQuizScreen({ tracks, settings, onExit }: NetworkQuizScreenProps) {
  const serverUrl = settings.serverUrl || 'ws://localhost:3010';
  const {
    state,
    wsRef,
    connect,
    disconnect,
    startGame,
    startRound,
    ackCountdown,
    revealAnswer,
    showScoreboard,
    nextRound,
    endGame,
  } = useNetworkGame(serverUrl);

  // Track the current round's correct index separately (not sent to clients until reveal)
  const correctIdxRef = useRef<number>(0);
  const roundOrderRef = useRef<number[]>([]);

  // Connect on mount
  useEffect(() => {
    connect();
    return () => disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for countdown_done → ack and start playing
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    const handler = () => ackCountdown();
    ws.addEventListener('countdown_done', handler);
    return () => ws.removeEventListener('countdown_done', handler);
  }, [wsRef, ackCountdown, state.phase]);

  // Listen for ready_for_round → automatically send next round data
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    const handler = (e: Event) => {
      const roundIdx = (e as CustomEvent).detail as number; // 1-based
      launchRound(roundIdx - 1);
    };
    ws.addEventListener('ready_for_round', handler);
    return () => ws.removeEventListener('ready_for_round', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsRef, state.phase]);

  const launchRound = useCallback((roundIdx: number) => {
    const order = roundOrderRef.current;
    if (roundIdx >= order.length) return;
    const trackIdx = order[roundIdx];
    correctIdxRef.current = trackIdx;
    const options = buildOptions(tracks, trackIdx, settings.target);
    const correctIndex = options.findIndex(o =>
      o === (settings.target === 'artist' ? tracks[trackIdx].artist : tracks[trackIdx].title)
    );
    const duration = settings.customDuration > 0
      ? settings.customDuration * 1000
      : DURATION_MS[settings.difficulty] ?? 15_000;
    startRound(options, correctIndex, duration);
  }, [tracks, settings, startRound]);

  const handleStartGame = useCallback((totalRounds: number) => {
    // Build random order
    const indices = tracks.map((_, i) => i).sort(() => Math.random() - 0.5);
    roundOrderRef.current = indices.slice(0, totalRounds);
    startGame(totalRounds);
    // Launch first round after game_started arrives
    setTimeout(() => launchRound(0), 300);
  }, [tracks, startGame, launchRound]);

  const handleNextRound = useCallback(() => {
    nextRound();
    // ready_for_round will trigger launchRound via the event listener
  }, [nextRound]);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (state.phase === 'idle' || state.phase === 'connecting') {
    return (
      <div className="screen quiz-screen net-loading">
        <div className="net-spinner" />
        <p className="net-loading-text">Connexion au serveur…</p>
      </div>
    );
  }

  if (state.phase === 'error') {
    const errorMessages: Record<string, string> = {
      DISCONNECTED:      'Connexion perdue.',
      CONNECTION_FAILED: 'Impossible de joindre le serveur.',
    };
    return (
      <div className="screen quiz-screen net-error">
        <p className="net-error-title">Erreur de connexion</p>
        <p className="net-error-sub">{errorMessages[state.error ?? ''] ?? state.error}</p>
        <p className="net-error-hint">
          Vérifie que le serveur tourne sur <code>{serverUrl}</code>
        </p>
        <button className="net-action-btn" onClick={onExit}>Retour</button>
      </div>
    );
  }

  if (state.phase === 'lobby') {
    return (
      <div className="screen quiz-screen">
        <NetworkLobby
          pin={state.pin}
          players={state.players}
          onStart={handleStartGame}
          onClose={onExit}
        />
      </div>
    );
  }

  if (state.phase === 'final') {
    return (
      <div className="screen quiz-screen">
        <NetworkFinal rankings={state.rankings} onClose={onExit} />
      </div>
    );
  }

  // countdown / playing / reveal / scoreboard
  return (
    <div className="screen quiz-screen">
      <NetworkGameControl
        round={state.round}
        totalRounds={state.totalRounds}
        answeredCount={state.answeredCount}
        totalPlayers={state.players.length}
        phase={state.phase as 'playing' | 'reveal' | 'scoreboard'}
        rankings={state.rankings}
        deltas={state.deltas}
        correctIndex={state.correctIndex}
        options={state.currentOptions}
        onReveal={revealAnswer}
        onShowScoreboard={showScoreboard}
        onNextRound={handleNextRound}
        onEndGame={endGame}
      />
    </div>
  );
}
