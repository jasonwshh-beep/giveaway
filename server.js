import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnv() {
  const envPath = path.resolve(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnv();

const PORT = Number(process.env.PORT || 3000);
const KICK_CHANNEL = (process.env.KICK_CHANNEL || '').replace('https://kick.com/', '').replace('@', '').trim();
const MANUAL_CHATROOM_ID = (process.env.KICK_CHATROOM_ID || '').trim();
const ADMIN_PIN = String(process.env.ADMIN_PIN || '1234');
const DEFAULT_KEYWORD = String(process.env.DEFAULT_KEYWORD || '!join').trim();
const CHANNEL_AVATAR_URL = String(process.env.CHANNEL_AVATAR_URL || '').trim();

const PUSHER_KEY = '32cbd69e4b950bf97679';
const PUSHER_URL = `wss://ws-us2.pusher.com/app/${PUSHER_KEY}?protocol=7&client=js&version=7.6.0&flash=false`;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const publicDir = path.join(__dirname, 'public');

app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});
app.use(express.static(publicDir));

app.get('/', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.get('/overlay', (req, res) => res.sendFile(path.join(publicDir, 'overlay.html')));

const state = {
  channel: KICK_CHANNEL,
  chatroomId: MANUAL_CHATROOM_ID || null,
  connected: false,
  keyword: DEFAULT_KEYWORD,
  hideCount: false,
  entries: new Map(), // usernameLower -> { username, at }
  lastWinner: null,
  lastWinnerAvatar: null,
  channelAvatar: CHANNEL_AVATAR_URL || null,
  rolling: false,
  lastError: null,
  recent: []
};

function participantDetails() {
  return [...state.entries.values()]
    .map(x => ({ username: x.username, avatar: x.avatar || null }))
    .sort((a, b) => a.username.localeCompare(b.username));
}

function publicState() {
  const details = participantDetails();
  const participants = details.map(x => x.username);
  return {
    channel: state.channel,
    chatroomId: state.chatroomId,
    connected: state.connected,
    keyword: state.keyword,
    hideCount: state.hideCount,
    count: participants.length,
    participants,
    participantDetails: details,
    recent: state.recent.slice(0, 30),
    lastWinner: state.lastWinner,
    lastWinnerAvatar: state.lastWinnerAvatar,
    channelAvatar: state.channelAvatar,
    rolling: state.rolling,
    lastError: state.lastError
  };
}

function broadcast() {
  io.emit('state', publicState());
}

function requirePin(req, res, next) {
  const pin = req.headers['x-admin-pin'] || req.body?.pin || req.query?.pin;
  if (String(pin) !== ADMIN_PIN) return res.status(403).json({ ok: false, error: 'Bad admin pin' });
  next();
}

function normalizeMessageText(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim();
}

function extractChatPayload(event) {
  let data = event?.data;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { return null; }
  }
  return data || null;
}

function getUsername(payload) {
  return payload?.sender?.username ||
    payload?.sender?.name ||
    payload?.user?.username ||
    payload?.username ||
    payload?.sender_username ||
    payload?.message?.sender?.username ||
    null;
}

function getAvatar(payload) {
  return payload?.sender?.profile_pic ||
    payload?.sender?.profile_picture ||
    payload?.sender?.avatar ||
    payload?.user?.profile_pic ||
    payload?.user?.profile_picture ||
    payload?.user?.avatar ||
    payload?.message?.sender?.profile_pic ||
    payload?.message?.sender?.profile_picture ||
    payload?.message?.sender?.avatar ||
    null;
}

function getMessage(payload) {
  return payload?.content ||
    payload?.message?.content ||
    payload?.message ||
    payload?.text ||
    payload?.body ||
    '';
}

function messageMatchesKeyword(message) {
  const msg = normalizeMessageText(message).toLowerCase();
  const kw = normalizeMessageText(state.keyword).toLowerCase();
  if (!kw) return false;
  return msg === kw || msg.startsWith(kw + ' ');
}

function addEntry(username, avatar = null) {
  if (!username) return;
  const display = String(username).trim();
  if (!display) return;
  const key = display.toLowerCase();

  if (state.entries.has(key)) {
    const existing = state.entries.get(key);
    if (!existing.avatar && avatar) existing.avatar = avatar;
    return;
  }

  const entry = { username: display, avatar: avatar || null, at: new Date().toISOString() };
  state.entries.set(key, entry);
  state.recent.unshift(entry);
  state.recent = state.recent.slice(0, 50);

  io.emit('entry-added', { username: display, avatar: entry.avatar, state: publicState() });
  broadcast();
}

function handleChatMessage(payload) {
  const username = getUsername(payload);
  const avatar = getAvatar(payload);
  const message = normalizeMessageText(getMessage(payload));
  if (!username || !message) return;

  // Default card avatar: use CHANNEL_AVATAR_URL immediately.
  // If that variable is not set, learn the channel owner's avatar from chat.
  if (!CHANNEL_AVATAR_URL && String(username).toLowerCase() === String(KICK_CHANNEL).toLowerCase() && avatar) {
    state.channelAvatar = avatar;
    broadcast();
  }

  if (messageMatchesKeyword(message)) addEntry(username, avatar);
}

async function resolveChatroomId(slug) {
  if (MANUAL_CHATROOM_ID) return MANUAL_CHATROOM_ID;
  if (!slug) throw new Error('Missing KICK_CHANNEL variable.');

  const urls = [
    `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`,
    `https://kick.com/api/v1/channels/${encodeURIComponent(slug)}`
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          'accept': 'application/json,text/plain,*/*',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
          'referer': `https://kick.com/${slug}`
        }
      });
      if (!res.ok) continue;
      const data = await res.json();
      const id = data?.chatroom?.id || data?.livestream?.chatroom?.id || data?.chatroom_id;
      if (id) return String(id);
    } catch {
      // Try next endpoint.
    }
  }

  throw new Error('Could not resolve Kick chatroom ID. Add KICK_CHATROOM_ID in Railway variables.');
}

let ws = null;
let reconnectTimer = null;
let reconnectAttempt = 0;

async function connectKick() {
  clearTimeout(reconnectTimer);

  try {
    state.chatroomId = await resolveChatroomId(KICK_CHANNEL);
    state.lastError = null;
  } catch (err) {
    state.connected = false;
    state.lastError = err.message;
    broadcast();
    scheduleReconnect();
    return;
  }

  ws = new WebSocket(PUSHER_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36'
    }
  });

  ws.on('open', () => {
    state.connected = true;
    state.lastError = null;
    reconnectAttempt = 0;
    broadcast();
  });

  ws.on('message', (buf) => {
    let event;
    try { event = JSON.parse(buf.toString()); } catch { return; }

    if (event.event === 'pusher:connection_established') {
      const channels = [`chatrooms.${state.chatroomId}.v2`, `chatroom.${state.chatroomId}`];
      for (const channel of channels) {
        ws.send(JSON.stringify({ event: 'pusher:subscribe', data: { channel } }));
      }
      return;
    }

    if (event.event === 'pusher:ping') {
      ws.send(JSON.stringify({ event: 'pusher:pong', data: {} }));
      return;
    }

    if (event.event === 'App\\Events\\ChatMessageEvent' || event.event === 'App\\Events\\MessageSentEvent') {
      const payload = extractChatPayload(event);
      handleChatMessage(payload);
    }
  });

  ws.on('close', () => {
    state.connected = false;
    broadcast();
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    state.connected = false;
    state.lastError = err.message;
    broadcast();
  });
}

function scheduleReconnect() {
  const delay = Math.min(30000, 1000 * Math.pow(2, reconnectAttempt++));
  reconnectTimer = setTimeout(connectKick, delay);
}

io.on('connection', (socket) => {
  socket.emit('state', publicState());
});

app.get('/api/state', (req, res) => {
  res.json(publicState());
});

app.post('/api/settings', requirePin, (req, res) => {
  if (typeof req.body?.keyword === 'string') state.keyword = req.body.keyword.trim();
  if (typeof req.body?.hideCount === 'boolean') state.hideCount = req.body.hideCount;
  state.lastWinner = null;
  broadcast();
  res.json({ ok: true, state: publicState() });
});

app.post('/api/reset', requirePin, (req, res) => {
  state.entries.clear();
  state.recent = [];
  state.lastWinner = null;
  state.lastWinnerAvatar = null;
  state.rolling = false;
  io.emit('reset-wheel', publicState());
  broadcast();
  res.json({ ok: true, state: publicState() });
});

app.post('/api/manual-entry', requirePin, (req, res) => {
  addEntry(req.body?.username, req.body?.avatar || null);
  res.json({ ok: true, state: publicState() });
});

app.post('/api/roll', requirePin, (req, res) => {
  const details = participantDetails();
  const participants = details.map(x => x.username);
  if (!participants.length) return res.status(400).json({ ok: false, error: 'No participants' });

  const winner = participants[Math.floor(Math.random() * participants.length)];
  const winnerDetail = details.find(x => x.username.toLowerCase() === String(winner).toLowerCase());
  const winnerAvatar = winnerDetail?.avatar || null;
  state.lastWinner = winner;
  state.lastWinnerAvatar = winnerAvatar;
  state.rolling = true;

  const spinNames = [...participants];
  while (spinNames.length < 24) spinNames.push(participants[Math.floor(Math.random() * participants.length)]);

  io.emit('roll-start', {
    durationMs: 5000,
    winner,
    winnerAvatar,
    names: spinNames,
    participants,
    participantDetails: details,
    keyword: state.keyword,
    hideCount: state.hideCount,
    count: participants.length
  });

  broadcast();

  setTimeout(() => {
    state.rolling = false;
    state.lastWinner = winner;
    io.emit('roll-finish', {
      winner,
      winnerAvatar,
      keyword: state.keyword,
      hideCount: state.hideCount,
      count: participants.length,
      participants,
      participantDetails: details
    });
    broadcast();
  }, 5000);

  res.json({ ok: true, winner });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Kick Keyword Wheel running on port ${PORT}`);
  console.log(`Dashboard: /`);
  console.log(`Overlay: /overlay`);
  connectKick();
});
