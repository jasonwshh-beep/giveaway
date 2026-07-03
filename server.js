require("dotenv").config();

const path = require("path");
const http = require("http");
const express = require("express");
const axios = require("axios");
const { Server } = require("socket.io");

// Fixes "Pusher is not a constructor" across different pusher-js module formats.
const PusherImport = require("pusher-js");
const Pusher = PusherImport.default || PusherImport;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.json());

app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const KICK_CHANNEL = String(process.env.KICK_CHANNEL || "").replace("@", "").trim();
const ADMIN_PIN = String(process.env.ADMIN_PIN || "1234");
const DEFAULT_KEYWORD = String(process.env.DEFAULT_KEYWORD || "!join").trim();

let keyword = DEFAULT_KEYWORD;
let hideCount = false;
let entries = new Map(); // usernameLower -> display username
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
  if (String(pin) !== ADMIN_PIN) {
    return res.status(403).json({ ok: false, error: "Bad admin pin" });
  }
  next();
}

function normalizeMessage(msg) {
  return String(msg || "").trim();
}

function messageMatchesKeyword(msg) {
  const m = normalizeMessage(msg).toLowerCase();
  const k = normalizeMessage(keyword).toLowerCase();
  if (!k) return false;
  return m === k || m.startsWith(k + " ");
}

function addEntry(username) {
  const display = String(username || "").trim();
  if (!display) return;
  const key = display.toLowerCase();
  if (!entries.has(key)) {
    entries.set(key, display);
    emitState();
  }
}

async function getKickChatroomId() {
  if (!KICK_CHANNEL) throw new Error("Missing KICK_CHANNEL Railway variable.");

  const urls = [
    `https://kick.com/api/v2/channels/${encodeURIComponent(KICK_CHANNEL)}`,
    `https://kick.com/api/v1/channels/${encodeURIComponent(KICK_CHANNEL)}`
  ];

  let last;
  for (const url of urls) {
    try {
      const res = await axios.get(url, {
        timeout: 15000,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36",
          "Accept": "application/json,text/plain,*/*",
          "Referer": `https://kick.com/${KICK_CHANNEL}`
        }
      });
      const data = res.data || {};
      const id =
        data.chatroom?.id ||
        data.chatroom_id ||
        data.livestream?.chatroom?.id ||
        data.livestream?.chatroom_id;
      if (id) return id;
      last = new Error("Kick response did not include chatroom id.");
    } catch (e) {
      last = e;
    }
  }
  throw last || new Error("Could not load Kick channel info.");
}

async function connectKickChat() {
  try {
    connected = false;
    lastError = "";
    emitState();

    chatroomId = await getKickChatroomId();

    if (pusherClient) {
      try { pusherClient.disconnect(); } catch {}
      pusherClient = null;
    }

    // Public Kick chat Pusher connection. If Kick changes this, the dashboard will show the error.
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
      console.log(`Connected to Kick chat @${KICK_CHANNEL} chatroom ${chatroomId}`);
    });

    pusherClient.connection.bind("error", (err) => {
      connected = false;
      lastError = err?.error?.data?.message || err?.message || JSON.stringify(err);
      emitState();
      console.error("Pusher connection error:", lastError);
    });

    pusherClient.connection.bind("disconnected", () => {
      connected = false;
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
          payload?.username ||
          "";

        if (messageMatchesKeyword(content)) {
          addEntry(username);
        }
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
      lastError = `Subscription error: ${JSON.stringify(status)}`;
      emitState();
    });

  } catch (e) {
    connected = false;
    lastError = e?.response?.status
      ? `Request failed with status code ${e.response.status}`
      : (e.message || String(e));
    emitState();
    console.error("Kick connect failed:", lastError);
    setTimeout(connectKickChat, 15000);
  }
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/overlay", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "overlay.html"));
});

app.get("/api/state", (req, res) => {
  res.json(publicState());
});

app.post("/api/settings", requirePin, (req, res) => {
  if (typeof req.body.keyword === "string") keyword = req.body.keyword.trim();
  if (typeof req.body.hideCount === "boolean") hideCount = req.body.hideCount;
  lastWinner = null;
  emitState();
  res.json({ ok: true, state: publicState() });
});

app.post("/api/reset", requirePin, (req, res) => {
  entries.clear();
  lastWinner = null;
  rolling = false;
  emitState();
  res.json({ ok: true, state: publicState() });
});

app.post("/api/manual-entry", requirePin, (req, res) => {
  addEntry(req.body.username);
  res.json({ ok: true, state: publicState() });
});

app.post("/api/roll", requirePin, (req, res) => {
  const participants = Array.from(entries.values());
  if (participants.length === 0) {
    return res.status(400).json({ ok: false, error: "No participants" });
  }

  const winner = participants[Math.floor(Math.random() * participants.length)];
  lastWinner = winner;
  rolling = true;

  const spinNames = [...participants];
  while (spinNames.length < 24) {
    spinNames.push(participants[Math.floor(Math.random() * participants.length)]);
  }

  io.emit("roll-start", {
    durationMs: 5000,
    winner,
    names: spinNames,
    keyword,
    hideCount,
    count: entries.size
  });

  emitState();

  setTimeout(() => {
    rolling = false;
    lastWinner = winner;
    io.emit("roll-finish", { winner, keyword, hideCount, count: entries.size });
    emitState();
  }, 5000);

  res.json({ ok: true, winner });
});

io.on("connection", (socket) => {
  socket.emit("state", publicState());
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Keyword Wheel Giveaway running on port ${PORT}`);
  console.log(`Dashboard: /`);
  console.log(`Overlay: /overlay`);
  connectKickChat();
});
