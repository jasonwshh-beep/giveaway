require("dotenv").config();

const path = require("path");
const http = require("http");
const express = require("express");
const axios = require("axios");
const { Server } = require("socket.io");

const PusherImport = require("pusher-js");
const Pusher = PusherImport.default || PusherImport;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());

app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const KICK_CHANNEL = String(process.env.KICK_CHANNEL || "").replace("@", "").replace("https://kick.com/","").trim();
const ADMIN_PIN = String(process.env.ADMIN_PIN || "1234");
const DEFAULT_KEYWORD = String(process.env.DEFAULT_KEYWORD || "!join").trim();

let keyword = DEFAULT_KEYWORD;
let hideCount = false;
let entries = new Map();
let connected = false;
let lastError = "";
let chatroomId = null;
let pusherClient = null;
let lastWinner = null;
let rolling = false;

function publicState() {
  return {
    channel: KICK_CHANNEL,
    keyword,
    hideCount,
    count: entries.size,
    participants: Array.from(entries.values()).sort((a,b)=>a.localeCompare(b)),
    connected,
    lastError,
    lastWinner,
    rolling
  };
}

function emitState() {
  io.emit("state", publicState());
}

function requirePin(req, res, next) {
  const pin = req.headers["x-admin-pin"] || req.body.pin || req.query.pin;
  if (String(pin) !== ADMIN_PIN) return res.status(403).json({ ok:false, error:"Bad admin pin" });
  next();
}

function clean(s){ return String(s || "").trim(); }

function messageMatchesKeyword(msg) {
  const m = clean(msg).toLowerCase();
  const k = clean(keyword).toLowerCase();
  if (!k) return false;
  return m === k || m.startsWith(k + " ");
}

function addEntry(username) {
  const display = clean(username);
  if (!display) return;
  const key = display.toLowerCase();
  if (!entries.has(key)) {
    entries.set(key, display);
    io.emit("entry-added", { username: display, state: publicState() });
    emitState();
  }
}

async function getKickChatroomId() {
  if (!KICK_CHANNEL) throw new Error("Missing KICK_CHANNEL Railway variable.");

  const url = `https://kick.com/api/v2/channels/${encodeURIComponent(KICK_CHANNEL)}`;
  const res = await axios.get(url, {
    timeout: 15000,
    validateStatus: () => true,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
      "Accept": "application/json,text/plain,*/*",
      "Referer": `https://kick.com/${KICK_CHANNEL}`
    }
  });

  if (res.status === 403) {
    throw new Error("Kick returned 403 Forbidden. Kick is blocking this Railway server from reading channel info.");
  }
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Kick channel request failed with status ${res.status}`);
  }

  const data = res.data || {};
  const id = data.chatroom?.id || data.chatroom_id || data.livestream?.chatroom?.id || data.livestream?.chatroom_id;
  if (!id) throw new Error("Kick response did not include chatroom id.");
  return id;
}

async function connectKickChat() {
  try {
    connected = false;
    lastError = "Connecting to Kick chat...";
    emitState();

    chatroomId = await getKickChatroomId();

    if (pusherClient) {
      try { pusherClient.disconnect(); } catch {}
      pusherClient = null;
    }

    pusherClient = new Pusher("32cbd69e4b950bf97679", {
      cluster: "us2",
      forceTLS: true,
      enabledTransports: ["ws", "wss"]
    });

    const channelName = `chatrooms.${chatroomId}.v2`;
    const channel = pusherClient.subscribe(channelName);

    pusherClient.connection.bind("connected", () => {
      connected = true;
      lastError = "";
      emitState();
      console.log(`Connected to Kick chat @${KICK_CHANNEL}`);
    });

    pusherClient.connection.bind("error", (err) => {
      connected = false;
      lastError = err?.error?.data?.message || err?.message || JSON.stringify(err);
      emitState();
    });

    pusherClient.connection.bind("disconnected", () => {
      connected = false;
      lastError = "Disconnected from Kick chat.";
      emitState();
    });

    channel.bind("App\\Events\\ChatMessageEvent", (data) => {
      try {
        const payload = typeof data === "string" ? JSON.parse(data) : data;
        const content = payload?.content || payload?.message?.content || "";
        const username =
          payload?.sender?.username ||
          payload?.user?.username ||
          payload?.message?.sender?.username ||
          payload?.username || "";
        if (messageMatchesKeyword(content)) addEntry(username);
      } catch (e) {
        console.error("Chat message parse error:", e.message);
      }
    });

    channel.bind("pusher:subscription_succeeded", () => {
      connected = true;
      lastError = "";
      emitState();
    });

    channel.bind("pusher:subscription_error", (status) => {
      connected = false;
      lastError = `Kick chat subscription error: ${JSON.stringify(status)}`;
      emitState();
    });

  } catch (e) {
    connected = false;
    lastError = e.message || String(e);
    emitState();
    console.error("Kick connect failed:", lastError);
    setTimeout(connectKickChat, 30000);
  }
}

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/overlay", (req, res) => res.sendFile(path.join(__dirname, "public", "overlay.html")));
app.get("/api/state", (req, res) => res.json(publicState()));

app.post("/api/settings", requirePin, (req, res) => {
  if (typeof req.body.keyword === "string") keyword = req.body.keyword.trim();
  if (typeof req.body.hideCount === "boolean") hideCount = req.body.hideCount;
  lastWinner = null;
  emitState();
  res.json({ ok:true, state:publicState() });
});

app.post("/api/reset", requirePin, (req, res) => {
  entries.clear();
  lastWinner = null;
  rolling = false;
  io.emit("reset-wheel", publicState());
  emitState();
  res.json({ ok:true, state:publicState() });
});

app.post("/api/manual-entry", requirePin, (req, res) => {
  addEntry(req.body.username);
  res.json({ ok:true, state:publicState() });
});

app.post("/api/roll", requirePin, (req, res) => {
  const participants = Array.from(entries.values());
  if (!participants.length) return res.status(400).json({ ok:false, error:"No participants" });

  const winner = participants[Math.floor(Math.random() * participants.length)];
  lastWinner = winner;
  rolling = true;

  const spinNames = [...participants];
  while (spinNames.length < 24) spinNames.push(participants[Math.floor(Math.random() * participants.length)]);

  io.emit("roll-start", {
    durationMs: 5000,
    winner,
    names: spinNames,
    participants,
    keyword,
    hideCount,
    count: entries.size
  });

  emitState();

  setTimeout(() => {
    rolling = false;
    lastWinner = winner;
    io.emit("roll-finish", { winner, keyword, hideCount, count: entries.size, participants });
    emitState();
  }, 5000);

  res.json({ ok:true, winner });
});

io.on("connection", socket => socket.emit("state", publicState()));

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Keyword Wheel Giveaway running on port ${PORT}`);
  connectKickChat();
});
