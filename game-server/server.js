/**
 * VoyageDL Game Server
 *
 * WebSocket server managing multiplayer quiz rooms.
 * Also serves the static mobile player page.
 *
 * Room lifecycle: lobby → countdown → playing → reveal → scoreboard → [loop] → final
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = process.env.PORT || 3010;
const MAX_PLAYERS = 50;
const ROOM_TTL_MS = 2 * 60 * 60 * 1000; // 2h
const COUNTDOWN_SECONDS = 3;

// ─── Room state ──────────────────────────────────────────────────────────────

/**
 * @typedef {'lobby'|'countdown'|'playing'|'reveal'|'scoreboard'|'final'} RoomPhase
 *
 * @typedef {Object} Player
 * @property {string} name
 * @property {number} score
 * @property {number} streak
 * @property {WebSocket} ws
 * @property {number} ping  estimated RTT ms
 * @property {number|null} answer  choice index submitted this round, null if not yet
 * @property {number|null} answerTs  client timestamp of submission
 *
 * @typedef {Object} Room
 * @property {string} pin
 * @property {RoomPhase} phase
 * @property {WebSocket} hostWs
 * @property {Map<string, Player>} players
 * @property {number} roundIndex
 * @property {number} totalRounds
 * @property {number|null} roundStartTs  server timestamp when playing phase began
 * @property {number} roundDurationMs
 * @property {number|null} correctIndex
 * @property {NodeJS.Timeout|null} timer
 * @property {NodeJS.Timeout} ttlTimer
 */

/** @type {Map<string, Room>} */
const rooms = new Map();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generatePin() {
  let pin;
  do { pin = String(Math.floor(100000 + Math.random() * 900000)); }
  while (rooms.has(pin));
  return pin;
}

function send(ws, type, payload = {}) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, ...payload }));
  }
}

function broadcast(room, type, payload = {}, exclude = null) {
  for (const player of room.players.values()) {
    if (player.ws !== exclude) send(player.ws, type, payload);
  }
}

function rankings(room) {
  return [...room.players.values()]
    .sort((a, b) => b.score - a.score)
    .map((p, i) => ({ rank: i + 1, name: p.name, score: p.score, streak: p.streak }));
}

function clearRoomTimer(room) {
  if (room.timer) { clearTimeout(room.timer); room.timer = null; }
}

function destroyRoom(pin) {
  const room = rooms.get(pin);
  if (!room) return;
  clearRoomTimer(room);
  clearTimeout(room.ttlTimer);
  rooms.delete(pin);
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

const BASE_SCORE = 1000;
const SPEED_BONUS = 500;
const MAX_STREAK_MULTIPLIER = 2.0;

function computeScore(room, player) {
  const { roundStartTs, roundDurationMs } = room;
  const elapsed = Math.max(0, (player.answerTs - player.ping / 2) - roundStartTs);
  const timeRatio = Math.max(0, 1 - elapsed / roundDurationMs);
  const speedBonus = Math.round(SPEED_BONUS * timeRatio);
  const streakMult = Math.min(MAX_STREAK_MULTIPLIER, 1 + (player.streak * 0.1));
  return Math.round((BASE_SCORE + speedBonus) * streakMult);
}

// ─── Phase transitions ────────────────────────────────────────────────────────

function startCountdown(room) {
  room.phase = 'countdown';
  send(room.hostWs, 'phase_change', { phase: 'countdown', seconds: COUNTDOWN_SECONDS });
  broadcast(room, 'phase_change', { phase: 'countdown', seconds: COUNTDOWN_SECONDS });

  let n = COUNTDOWN_SECONDS;
  const tick = () => {
    send(room.hostWs, 'countdown_tick', { n });
    broadcast(room, 'countdown_tick', { n });
    n--;
    if (n >= 0) {
      room.timer = setTimeout(tick, 1000);
    } else {
      // Host will send start_round with question data
      room.phase = 'lobby'; // wait for host start_round
      send(room.hostWs, 'countdown_done');
    }
  };
  room.timer = setTimeout(tick, 1000);
}

function startPlaying(room, options, correctIndex, durationMs) {
  room.phase = 'playing';
  room.correctIndex = correctIndex;
  room.roundDurationMs = durationMs;
  room.roundStartTs = Date.now();

  // Reset player answers
  for (const player of room.players.values()) {
    player.answer = null;
    player.answerTs = null;
  }

  broadcast(room, 'round_started', {
    options,
    duration_ms: durationMs,
    round: room.roundIndex + 1,
    total: room.totalRounds,
  });
  send(room.hostWs, 'round_started', {
    options,
    duration_ms: durationMs,
    round: room.roundIndex + 1,
    total: room.totalRounds,
  });

  // Auto-reveal when time is up
  room.timer = setTimeout(() => revealAnswer(room), durationMs);
}

function revealAnswer(room) {
  if (room.phase !== 'playing') return;
  clearRoomTimer(room);
  room.phase = 'reveal';

  const deltas = [];
  for (const player of room.players.values()) {
    let delta = 0;
    if (player.answer === room.correctIndex) {
      delta = computeScore(room, player);
      player.score += delta;
      player.streak += 1;
    } else {
      player.streak = 0;
    }
    deltas.push({ name: player.name, delta, correct: player.answer === room.correctIndex });
  }

  const rank = rankings(room);

  broadcast(room, 'answer_revealed', {
    correct_index: room.correctIndex,
    deltas,
    rankings: rank,
  });
  send(room.hostWs, 'answer_revealed', {
    correct_index: room.correctIndex,
    deltas,
    rankings: rank,
  });
}

function showScoreboard(room) {
  room.phase = 'scoreboard';
  const rank = rankings(room);
  broadcast(room, 'scoreboard', { rankings: rank });
  send(room.hostWs, 'scoreboard', { rankings: rank });
}

function endGame(room) {
  room.phase = 'final';
  const rank = rankings(room);
  broadcast(room, 'game_ended', { rankings: rank });
  send(room.hostWs, 'game_ended', { rankings: rank });
  // Destroy after 10 min to let players see final screen
  setTimeout(() => destroyRoom(room.pin), 10 * 60 * 1000);
}

// ─── Message handlers ─────────────────────────────────────────────────────────

function handleHostMessage(room, msg) {
  switch (msg.type) {

    case 'start_game': {
      if (room.phase !== 'lobby') return;
      if (room.players.size === 0) {
        send(room.hostWs, 'error', { code: 'NO_PLAYERS' });
        return;
      }
      room.totalRounds = msg.total_rounds || 10;
      room.roundIndex = 0;
      broadcast(room, 'game_started', { total_rounds: room.totalRounds });
      send(room.hostWs, 'game_started', { total_rounds: room.totalRounds });
      break;
    }

    case 'start_round': {
      // Host sends options + correct_index + duration_ms after countdown_done
      if (!['lobby', 'scoreboard'].includes(room.phase)) return;
      const { options, correct_index, duration_ms } = msg;
      if (!options || options.length < 2 || correct_index == null || !duration_ms) {
        send(room.hostWs, 'error', { code: 'INVALID_ROUND_DATA' });
        return;
      }
      startCountdown(room);
      // Store pending round data, will apply after countdown
      room._pendingRound = { options, correct_index, duration_ms };
      break;
    }

    case 'countdown_ack': {
      // Host acknowledges countdown done, we start playing
      if (!room._pendingRound) return;
      const { options, correct_index, duration_ms } = room._pendingRound;
      room._pendingRound = null;
      startPlaying(room, options, correct_index, duration_ms);
      break;
    }

    case 'reveal_answer': {
      revealAnswer(room);
      break;
    }

    case 'show_scoreboard': {
      if (room.phase !== 'reveal') return;
      showScoreboard(room);
      break;
    }

    case 'next_round': {
      if (room.phase !== 'scoreboard') return;
      room.roundIndex += 1;
      if (room.roundIndex >= room.totalRounds) {
        endGame(room);
      } else {
        room.phase = 'lobby'; // wait for host start_round
        send(room.hostWs, 'ready_for_round', { round: room.roundIndex + 1 });
      }
      break;
    }

    case 'end_game': {
      endGame(room);
      break;
    }

    case 'kick_player': {
      const player = room.players.get(msg.name);
      if (player) {
        send(player.ws, 'kicked');
        player.ws.close();
        room.players.delete(msg.name);
        broadcast(room, 'player_left', { name: msg.name, count: room.players.size });
        send(room.hostWs, 'player_left', { name: msg.name, count: room.players.size });
      }
      break;
    }
  }
}

function handlePlayerMessage(room, player, msg) {
  switch (msg.type) {

    case 'pong': {
      // Round-trip ping measurement
      if (msg.ts) player.ping = Math.max(0, Date.now() - msg.ts);
      break;
    }

    case 'submit_answer': {
      if (room.phase !== 'playing') return;
      if (player.answer !== null) return; // already answered
      player.answer = msg.choice_index;
      player.answerTs = msg.client_ts || Date.now();

      // Tell host how many answered
      const answered = [...room.players.values()].filter(p => p.answer !== null).length;
      send(room.hostWs, 'answer_count', { answered, total: room.players.size });

      // Auto-reveal when everyone answered
      if (answered === room.players.size) {
        clearRoomTimer(room);
        revealAnswer(room);
      }
      break;
    }
  }
}

// ─── Connection handling ──────────────────────────────────────────────────────

function handleConnection(ws, req) {
  const url = new URL(req.url, `http://localhost`);
  const role = url.searchParams.get('role'); // 'host' or 'player'

  if (role === 'host') {
    handleHostConnection(ws);
  } else if (role === 'player') {
    const pin = url.searchParams.get('pin');
    const name = (url.searchParams.get('name') || '').trim().slice(0, 24);
    handlePlayerConnection(ws, pin, name);
  } else {
    ws.close(1008, 'Missing role');
  }
}

function handleHostConnection(ws) {
  const pin = generatePin();

  const ttlTimer = setTimeout(() => destroyRoom(pin), ROOM_TTL_MS);

  /** @type {Room} */
  const room = {
    pin,
    phase: 'lobby',
    hostWs: ws,
    players: new Map(),
    roundIndex: 0,
    totalRounds: 10,
    roundStartTs: null,
    roundDurationMs: 0,
    correctIndex: null,
    timer: null,
    ttlTimer,
    _pendingRound: null,
  };

  rooms.set(pin, room);
  send(ws, 'room_created', { pin });

  // Ping players periodically
  const pingInterval = setInterval(() => {
    broadcast(room, 'ping', { ts: Date.now() });
  }, 5000);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      handleHostMessage(room, msg);
    } catch { /* ignore malformed */ }
  });

  ws.on('close', () => {
    clearInterval(pingInterval);
    broadcast(room, 'host_disconnected');
    // Give 60s for host to reconnect (not implemented yet — destroy for now)
    room.timer = setTimeout(() => destroyRoom(pin), 60_000);
  });
}

// Rate limiting: track join attempts per IP
const joinAttempts = new Map();
setInterval(() => joinAttempts.clear(), 60_000);

function handlePlayerConnection(ws, pin, name) {
  // Rate limiting
  const ip = ws._socket?.remoteAddress || 'unknown';
  const attempts = (joinAttempts.get(ip) || 0) + 1;
  joinAttempts.set(ip, attempts);
  if (attempts > 5) {
    send(ws, 'error', { code: 'RATE_LIMITED' });
    ws.close();
    return;
  }

  const room = rooms.get(pin);

  if (!room) {
    send(ws, 'error', { code: 'ROOM_NOT_FOUND' });
    ws.close();
    return;
  }
  if (room.players.size >= MAX_PLAYERS) {
    send(ws, 'error', { code: 'ROOM_FULL' });
    ws.close();
    return;
  }
  if (!name) {
    send(ws, 'error', { code: 'INVALID_NAME' });
    ws.close();
    return;
  }

  // Reconnect: restore existing player
  const existing = room.players.get(name);
  if (existing) {
    existing.ws = ws;
    send(ws, 'rejoined', {
      score: existing.score,
      streak: existing.streak,
      phase: room.phase,
      rankings: rankings(room),
    });
    attachPlayerHandlers(ws, room, existing);
    return;
  }

  if (room.phase !== 'lobby') {
    send(ws, 'error', { code: 'GAME_ALREADY_STARTED' });
    ws.close();
    return;
  }

  if (room.players.has(name)) {
    send(ws, 'error', { code: 'NAME_TAKEN' });
    ws.close();
    return;
  }

  /** @type {Player} */
  const player = { name, score: 0, streak: 0, ws, ping: 0, answer: null, answerTs: null };
  room.players.set(name, player);

  send(ws, 'joined', { name, player_count: room.players.size });
  broadcast(room, 'player_joined', { name, count: room.players.size }, ws);
  send(room.hostWs, 'player_joined', { name, count: room.players.size });

  attachPlayerHandlers(ws, room, player);
}

function attachPlayerHandlers(ws, room, player) {
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      handlePlayerMessage(room, player, msg);
    } catch { /* ignore malformed */ }
  });

  ws.on('close', () => {
    // Keep player in room for reconnect — just mark ws as closed
    send(room.hostWs, 'player_disconnected', { name: player.name });
  });
}

// ─── HTTP server (static files + health) ─────────────────────────────────────

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ rooms: rooms.size, uptime: process.uptime() }));
    return;
  }

  // Serve static files from public/
  let filePath = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : req.url);
  // Security: prevent path traversal
  if (!filePath.startsWith(path.join(__dirname, 'public'))) {
    res.writeHead(403);
    res.end();
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // Fallback to index.html (SPA routing)
      fs.readFile(path.join(__dirname, 'public', 'index.html'), (err2, data2) => {
        if (err2) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(data2);
      });
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

// ─── WebSocket server ─────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server });
wss.on('connection', handleConnection);

server.listen(PORT, () => {
  console.log(`[game-server] listening on port ${PORT}`);
});
