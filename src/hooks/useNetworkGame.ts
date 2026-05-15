import { useCallback, useEffect, useRef, useState } from 'react';
import {
  HostInMessage, HostOutMessage, NetworkPhase, NetworkPlayer, ScoreDelta,
} from '../types';

export interface NetworkGameState {
  phase: NetworkPhase;
  pin: string;
  players: NetworkPlayer[];
  round: number;
  totalRounds: number;
  answeredCount: number;
  rankings: NetworkPlayer[];
  deltas: ScoreDelta[];
  correctIndex: number | null;
  currentOptions: string[];
  error: string | null;
}

const INITIAL_STATE: NetworkGameState = {
  phase: 'idle',
  pin: '',
  players: [],
  round: 0,
  totalRounds: 10,
  answeredCount: 0,
  rankings: [],
  deltas: [],
  correctIndex: null,
  currentOptions: [],
  error: null,
};

export function useNetworkGame(serverUrl: string) {
  const [state, setState] = useState<NetworkGameState>(INITIAL_STATE);
  const wsRef = useRef<WebSocket | null>(null);

  const send = useCallback((msg: HostOutMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const patch = useCallback((partial: Partial<NetworkGameState>) => {
    setState(prev => ({ ...prev, ...partial }));
  }, []);

  // Connect as host and create a room
  const connect = useCallback(() => {
    if (!serverUrl) return;
    patch({ phase: 'connecting', error: null });

    const wsUrl = serverUrl.replace(/^http/, 'ws') + '?role=host';
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      // Server sends room_created immediately after connection
    };

    ws.onmessage = (ev) => {
      let msg: HostInMessage;
      try { msg = JSON.parse(ev.data); }
      catch { return; }

      switch (msg.type) {
        case 'room_created':
          patch({ phase: 'lobby', pin: msg.pin });
          break;

        case 'player_joined':
          setState(prev => {
            const exists = prev.players.some(p => p.name === msg.name);
            const players = exists ? prev.players : [
              ...prev.players,
              { name: msg.name, score: 0, streak: 0, rank: prev.players.length + 1 },
            ];
            return { ...prev, players };
          });
          break;

        case 'player_left':
          setState(prev => ({
            ...prev,
            players: prev.players.filter(p => p.name !== msg.name),
          }));
          break;

        case 'game_started':
          patch({ totalRounds: msg.total_rounds, round: 0 });
          break;

        case 'countdown_done':
          // Host should call sendStartRound after receiving this
          ws.dispatchEvent(new CustomEvent('countdown_done'));
          break;

        case 'answer_count':
          patch({ answeredCount: msg.answered });
          break;

        case 'answer_revealed':
          patch({
            phase: 'reveal',
            correctIndex: msg.correct_index,
            deltas: msg.deltas,
            rankings: msg.rankings,
          });
          break;

        case 'scoreboard':
          patch({ phase: 'scoreboard', rankings: msg.rankings });
          break;

        case 'ready_for_round':
          patch({ round: msg.round });
          // Host should now call sendStartRound
          ws.dispatchEvent(new CustomEvent('ready_for_round', { detail: msg.round }));
          break;

        case 'game_ended':
          patch({ phase: 'final', rankings: msg.rankings });
          break;

        case 'error':
          patch({ phase: 'error', error: msg.code });
          break;
      }
    };

    ws.onclose = () => {
      if (state.phase !== 'final') {
        patch({ phase: 'error', error: 'DISCONNECTED' });
      }
    };

    ws.onerror = () => {
      patch({ phase: 'error', error: 'CONNECTION_FAILED' });
    };
  }, [serverUrl, patch, state.phase]);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setState(INITIAL_STATE);
  }, []);

  // ── Host actions ───────────────────────────────────────────────────────────

  const startGame = useCallback((totalRounds: number) => {
    send({ type: 'start_game', total_rounds: totalRounds });
  }, [send]);

  const startRound = useCallback((
    options: string[],
    correctIndex: number,
    durationMs: number,
  ) => {
    setState(prev => ({
      ...prev,
      phase: 'countdown',
      answeredCount: 0,
      deltas: [],
      correctIndex: null,
      currentOptions: options,
    }));
    send({ type: 'start_round', options, correct_index: correctIndex, duration_ms: durationMs });
  }, [send]);

  const ackCountdown = useCallback(() => {
    patch({ phase: 'playing' });
    send({ type: 'countdown_ack' });
  }, [send, patch]);

  const revealAnswer = useCallback(() => {
    send({ type: 'reveal_answer' });
  }, [send]);

  const showScoreboard = useCallback(() => {
    send({ type: 'show_scoreboard' });
  }, [send]);

  const nextRound = useCallback(() => {
    send({ type: 'next_round' });
  }, [send]);

  const endGame = useCallback(() => {
    send({ type: 'end_game' });
  }, [send]);

  const kickPlayer = useCallback((name: string) => {
    send({ type: 'kick_player', name });
  }, [send]);

  // Clean up on unmount
  useEffect(() => {
    return () => { wsRef.current?.close(); };
  }, []);

  return {
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
    kickPlayer,
  };
}
