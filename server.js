require('dotenv').config();
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const Pusher = require('pusher-js');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json());
app.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || '1234';
const channelSlug = (process.env.KICK_CHANNEL || '').replace(/^@/,'').trim().toLowerCase();

let state = {
  connected: false,
  channel: channelSlug || 'not-set',
  chatroomId: process.env.KICK_CHATROOM_ID || null,
  lastError: null,
  active: false,
  keyword: process.env.DEFAULT_KEYWORD || '!duel',
  hideCount: false,
  participants: [],
  participantMap: {},
  winner: null,
  rolling: false,
  rollStartedAt: null,
  rollDurationMs: 5000,
  recentMessages: []
};

function publicState(){
  return {
    connected: state.connected,
    channel: state.channel,
    chatroomId: state.chatroomId,
    lastError: state.lastError,
    active: state.active,
    keyword: state.keyword,
    hideCount: state.hideCount,
    participants: state.participants,
    participantCount: state.participants.length,
    winner: state.winner,
    rolling: state.rolling,
    rollStartedAt: state.rollStartedAt,
    rollDurationMs: state.rollDurationMs,
    recentMessages: state.recentMessages.slice(0, 20)
  };
}
function emit(){ io.emit('state', publicState()); }
function requirePin(req,res,next){
  const pin = req.headers['x-admin-pin'] || req.query.pin || req.body.pin;
  if(String(pin) !== String(ADMIN_PIN)) return res.status(403).json({error:'Bad admin pin'});
  next();
}
function normalize(s){ return String(s||'').trim().toLowerCase(); }
function addEntry(username){
  if(!state.active || !username) return;
  const key = normalize(username);
  if(state.participantMap[key]) return;
  state.participantMap[key] = true;
  state.participants.push(username);
  state.recentMessages.unshift(`${username} entered with ${state.keyword}`);
  state.recentMessages = state.recentMessages.slice(0, 20);
  emit();
}
function handleChat(username, message){
  const msg = normalize(message);
  const kw = normalize(state.keyword);
  if(!kw) return;
  const exact = msg === kw;
  const commandWithSpace = kw.startsWith('!') && msg.split(/\s+/)[0] === kw;
  if(exact || commandWithSpace) addEntry(username);
}

async function lookupChatroomId(){
  if(state.chatroomId) return state.chatroomId;
  if(!channelSlug) throw new Error('Missing KICK_CHANNEL variable');
  const urls = [
    `https://kick.com/api/v2/channels/${channelSlug}`,
    `https://kick.com/api/v1/channels/${channelSlug}`
  ];
  let last;
  for(const url of urls){
    try{
      const r = await fetch(url, { headers: {
        'accept':'application/json,text/plain,*/*',
        'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
      }});
      if(!r.ok) throw new Error(`Kick lookup ${r.status}`);
      const data = await r.json();
      const id = data?.chatroom?.id || data?.chatroom_id || data?.id_chatroom;
      if(id){ state.chatroomId = String(id); return state.chatroomId; }
      last = new Error('Could not find chatroom id in Kick response');
    }catch(e){ last = e; }
  }
  throw last || new Error('Kick chatroom lookup failed');
}

async function connectKick(){
  try{
    const chatroomId = await lookupChatroomId();
    const pusher = new Pusher('32cbd69e4b950bf97679', {
      cluster: 'us2',
      forceTLS: true,
      enabledTransports: ['ws','wss']
    });
    const chan = pusher.subscribe(`chatrooms.${chatroomId}.v2`);
    chan.bind('pusher:subscription_succeeded', () => {
      state.connected = true; state.lastError = null; emit();
      console.log(`Connected to Kick chat @${state.channel} chatroom ${chatroomId}`);
    });
    chan.bind('pusher:subscription_error', (err) => {
      state.connected = false; state.lastError = 'Pusher subscription error: '+JSON.stringify(err); emit();
    });
    chan.bind('App\\Events\\ChatMessageEvent', (raw) => {
      try{
        const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const username = data?.sender?.username || data?.user?.username || data?.username || data?.sender?.slug;
        const message = data?.content || data?.message || data?.text || '';
        handleChat(username, message);
      }catch(e){ console.error('chat parse error', e); }
    });
    pusher.connection.bind('connected', ()=>{ state.connected=true; state.lastError=null; emit(); });
    pusher.connection.bind('disconnected', ()=>{ state.connected=false; emit(); });
    pusher.connection.bind('error', (err)=>{ state.connected=false; state.lastError='Pusher error: '+JSON.stringify(err); emit(); });
  }catch(e){
    state.connected = false;
    state.lastError = e.message;
    console.error('Kick connection failed:', e);
    emit();
  }
}

app.get('/', (req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.get('/overlay', (req,res)=>res.sendFile(path.join(__dirname,'public','overlay.html')));
app.get('/api/state', (req,res)=>res.json(publicState()));
app.post('/api/start', requirePin, (req,res)=>{
  state.keyword = String(req.body.keyword || state.keyword || '').trim();
  state.hideCount = !!req.body.hideCount;
  state.active = true;
  state.winner = null;
  state.rolling = false;
  emit(); res.json(publicState());
});
app.post('/api/settings', requirePin, (req,res)=>{
  if(typeof req.body.keyword === 'string') state.keyword = req.body.keyword.trim();
  if(typeof req.body.hideCount !== 'undefined') state.hideCount = !!req.body.hideCount;
  emit(); res.json(publicState());
});
app.post('/api/stop', requirePin, (req,res)=>{ state.active=false; emit(); res.json(publicState()); });
app.post('/api/reset', requirePin, (req,res)=>{
  state.participants=[]; state.participantMap={}; state.winner=null; state.rolling=false; state.rollStartedAt=null; state.recentMessages=[]; emit(); res.json(publicState());
});
app.post('/api/test-entry', requirePin, (req,res)=>{ addEntry(req.body.username || `TestUser${Math.floor(Math.random()*999)}`); res.json(publicState()); });
app.post('/api/roll', requirePin, (req,res)=>{
  if(state.participants.length < 1) return res.status(400).json({error:'No participants'});
  const winner = state.participants[Math.floor(Math.random()*state.participants.length)];
  state.rolling = true;
  state.rollStartedAt = Date.now();
  state.winner = null;
  emit();
  setTimeout(()=>{ state.winner = winner; state.rolling=false; emit(); }, state.rollDurationMs);
  res.json({winner, durationMs: state.rollDurationMs, state: publicState()});
});

io.on('connection', (socket)=> socket.emit('state', publicState()));
server.listen(PORT, '0.0.0.0', ()=>{
  console.log(`Keyword Wheel Giveaway running on port ${PORT}`);
  connectKick();
});
