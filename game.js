'use strict';

/* ============================== constants ============================== */

const START_LIVES = 3;
const LIVES_CAP = 3;
const MAX_FAIRIES = 3; // heart fairy visits per game

const POINTS_TAP_BAD = 3;    // tapped a bad guy (× combo multiplier)
const POINTS_TAP_GOLDEN = 10; // tapped a golden ghost (× combo multiplier)
const POINTS_MISS_BAD = -1;  // a bad guy escaped untapped
const POINTS_SAVE_GOOD = 1;  // a good guy left safely
const ESCAPE_LIMIT = 3;      // consecutive bad-guy escapes before the ghosts overwhelm you

const BAD_CHARS = ['ghost', 'vampire', 'werewolf', 'pumpkin', 'zombie', 'witch'];
const GOOD_CHARS = ['dog', 'cat', 'rabbit', 'panda'];

/* endless escalation: everything is a function of how many creatures have spawned.
   The curve never plateaus at a comfortable level — it keeps shrinking toward a
   ~300ms reaction window that nobody can sustain, so a run of ~5 minutes is elite. */
const STAY_START = 2600, STAY_FLOOR = 300; // how long a creature waits for you (ms)
const GAP_START = 1150, GAP_FLOOR = 220;   // pause between creatures (ms)
const PACE_DECAY = 0.9865;                 // per-spawn speed-up factor

const stayFor = (n) => Math.max(STAY_FLOOR, STAY_START * Math.pow(PACE_DECAY, n));
const gapFor = (n) => Math.max(GAP_FLOOR, GAP_START * Math.pow(PACE_DECAY, n));
const speedFrac = (n) => (STAY_START - stayFor(n)) / (STAY_START - STAY_FLOOR);
const goodChanceFor = (n) => Math.min(0.38, 0.28 + n * 0.001);
const tierFor = (n) => Math.min(4, Math.floor(n / 30));

const LS_SETTINGS = 'ttg-settings';
const LS_SCORES = 'ttg-scores-v3';
const LS_STATS = 'ttg-stats-v1';
const LS_BADGES = 'ttg-badges-v1';
const MAX_SCORES = 8;

const SVG_NS = 'http://www.w3.org/2000/svg';

/* window layout on the manor facade (must match the house in index.html) */
const WIN_W = 84, WIN_H = 92;
const WIN_COLS = [248, 378, 508];
const WIN_ROWS = [300, 430, 560, 690];

/* ============================== helpers ============================== */

const $ = (sel) => document.querySelector(sel);
const rand = (min, max) => min + Math.random() * (max - min);
const randInt = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[randInt(arr.length)];

function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function fmtTime(ms) {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/* ============================== settings ============================== */

const settings = Object.assign(
  { sound: true, haptics: true, playerName: '' },
  loadJSON(LS_SETTINGS, {})
);

function saveSettings() {
  localStorage.setItem(LS_SETTINGS, JSON.stringify(settings));
}

const CAN_VIBRATE = 'vibrate' in navigator;

function buzz(pattern) {
  if (settings.haptics && CAN_VIBRATE) navigator.vibrate(pattern);
}

function refreshSettingsUI() {
  const soundVal = $('#val-sound');
  soundVal.textContent = settings.sound ? 'ON' : 'OFF';
  soundVal.classList.toggle('good', settings.sound);
  const hapticsVal = $('#val-haptics');
  hapticsVal.textContent = settings.haptics ? 'ON' : 'OFF';
  hapticsVal.classList.toggle('good', settings.haptics);
  $('#btn-haptics').style.display = CAN_VIBRATE ? 'flex' : 'none';
  $('#inp-name').value = settings.playerName;
}

function refreshMenuInfo() {
  $('#menu-player').textContent = settings.playerName || 'unnamed';
  const best = getScores()[0];
  const el = $('#menu-best');
  if (best) {
    el.style.display = 'block';
    el.innerHTML = '';
    el.append('🏆 Best: ');
    const b = document.createElement('b');
    b.textContent = `${best.score} — ${best.name || 'unnamed'}`;
    el.append(b, ` (${fmtTime(best.ms || 0)})`);
  } else {
    el.style.display = 'none';
  }
}

/* ============================== sound (WebAudio, no assets) ============================== */

const sound = {
  ctx: null,
  _nb: null,
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },
  noiseBuf() {
    if (!this._nb) {
      const len = this.ctx.sampleRate;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this._nb = buf;
    }
    return this._nb;
  },
  tone(f0, f1, dur, type = 'sine', vol = 0.2, delay = 0) {
    if (!settings.sound) return;
    this.ensure();
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(f0, 1), t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  },
  seq(steps) {
    for (const [f0, f1, dur, type, vol, delay] of steps) this.tone(f0, f1, dur, type, vol, delay);
  },
  noise(dur, freq, vol, delay = 0, type = 'lowpass') {
    if (!settings.sound) return;
    this.ensure();
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf();
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(gain).connect(this.ctx.destination);
    src.start(t);
    src.stop(t + dur + 0.05);
  },
  glide(freqPoints, dur, type, peakVol) {
    // multi-point frequency glide (howls, meows)
    if (!settings.sound) return;
    this.ensure();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqPoints[0], t);
    for (let i = 1; i < freqPoints.length; i++) {
      osc.frequency.linearRampToValueAtTime(freqPoints[i], t + (dur * i) / (freqPoints.length - 1));
    }
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(peakVol, t + dur * 0.2);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  },
  click()   { this.tone(600, 600, 0.06, 'sine', 0.12); },
  pop()     { this.tone(280, 720, 0.12, 'sine', 0.16); },
  zap()     { this.tone(950, 70, 0.22, 'sawtooth', 0.22); this.tone(1500, 110, 0.18, 'square', 0.08); },
  hurt()    { this.tone(240, 80, 0.4, 'square', 0.22); this.tone(180, 60, 0.45, 'sawtooth', 0.1); },
  miss()    { this.tone(220, 130, 0.18, 'sine', 0.12); },
  save()    { this.tone(760, 980, 0.14, 'sine', 0.1); },
  chime()   { this.seq([[880, 880, 0.1, 'sine', 0.12, 0], [1174, 1174, 0.12, 'sine', 0.12, 0.1], [1568, 1568, 0.18, 'sine', 0.12, 0.2]]); },
  tick(hi)  { this.tone(hi ? 880 : 520, hi ? 880 : 520, 0.09, 'square', 0.12); },
  thunder() { this.noise(1.4, 320, 0.28); this.tone(55, 34, 1.2, 'sine', 0.2, 0.05); },
  explosion() { this.noise(0.5, 900, 0.32); this.tone(160, 40, 0.5, 'sawtooth', 0.24); },
  over()    { [392, 330, 262, 196].forEach((f, i) => this.tone(f, f * 0.97, 0.26, 'triangle', 0.2, i * 0.24)); },
  fanfare() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, f, 0.18, 'triangle', 0.2, i * 0.14)); },
};

document.addEventListener('pointerdown', () => sound.ensure(), { once: true });

/* character voices */
const VOICES = {
  ghost:    () => { sound.tone(340, 190, 0.45, 'sine', 0.11); sound.tone(255, 150, 0.4, 'sine', 0.07, 0.08); },
  vampire:  () => sound.noise(0.22, 3200, 0.1, 0, 'highpass'),
  werewolf: () => sound.glide([240, 520, 380], 0.7, 'sine', 0.13),
  pumpkin:  () => sound.seq([[500, 380, 0.09, 'square', 0.09, 0], [420, 320, 0.09, 'square', 0.09, 0.11], [340, 240, 0.12, 'square', 0.09, 0.22]]),
  zombie:   () => sound.tone(135, 82, 0.55, 'sawtooth', 0.12),
  witch:    () => sound.seq([[720, 680, 0.08, 'triangle', 0.11, 0], [560, 520, 0.08, 'triangle', 0.11, 0.1], [660, 600, 0.1, 'triangle', 0.11, 0.2]]),
  dog:      () => sound.seq([[300, 260, 0.08, 'square', 0.11, 0], [320, 270, 0.09, 'square', 0.11, 0.14]]),
  cat:      () => sound.glide([550, 900, 480], 0.45, 'sine', 0.11),
  rabbit:   () => sound.tone(820, 1020, 0.12, 'sine', 0.1),
  panda:    () => sound.seq([[560, 620, 0.1, 'sine', 0.11, 0], [720, 680, 0.14, 'sine', 0.11, 0.13]]),
  golden:   () => sound.seq([[1180, 1180, 0.08, 'triangle', 0.12, 0], [1480, 1480, 0.08, 'triangle', 0.12, 0.09], [1760, 1760, 0.12, 'triangle', 0.12, 0.18]]),
  fairy:    () => sound.seq([[880, 880, 0.1, 'sine', 0.1, 0], [1100, 1100, 0.1, 'sine', 0.1, 0.1], [1320, 1320, 0.14, 'sine', 0.1, 0.2]]),
  bomb:     () => sound.noise(0.15, 2000, 0.12, 0, 'highpass'),
};

/* ambient night: wind + crickets + the occasional owl */
const ambient = {
  nodes: null,
  crickets: null,
  owl: null,
  start() {
    if (this.nodes || !settings.sound) return;
    sound.ensure();
    if (!sound.ctx) return;
    const ctx = sound.ctx;
    const src = ctx.createBufferSource();
    src.buffer = sound.noiseBuf();
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 260;
    const gain = ctx.createGain();
    gain.gain.value = 0.035;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.02;
    lfo.connect(lfoGain).connect(gain.gain);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start();
    lfo.start();
    this.nodes = { src, lfo };
    this.crickets = setInterval(() => {
      if (Math.random() < 0.75) {
        for (let i = 0; i < 3; i++) sound.tone(4300, 4200, 0.035, 'square', 0.028, i * 0.075);
      }
    }, 2400);
    this.owl = setInterval(() => {
      if (Math.random() < 0.3) {
        sound.tone(392, 328, 0.25, 'sine', 0.08);
        sound.tone(362, 300, 0.32, 'sine', 0.08, 0.38);
      }
    }, 9000);
  },
  stop() {
    if (this.nodes) {
      try { this.nodes.src.stop(); this.nodes.lfo.stop(); } catch { /* already stopped */ }
      this.nodes = null;
    }
    clearInterval(this.crickets);
    clearInterval(this.owl);
    this.crickets = this.owl = null;
  },
};

/* bomb fuse sizzle while one is on screen */
let sizzleTimer = null;
function startSizzle() {
  stopSizzle();
  sizzleTimer = setInterval(() => sound.noise(0.05, 2600, 0.05, 0, 'highpass'), 110);
}
function stopSizzle() {
  clearInterval(sizzleTimer);
  sizzleTimer = null;
}

/* heartbeat on your last life */
let heartTimer = null;
function startHeartbeat() {
  if (heartTimer) return;
  heartTimer = setInterval(() => {
    sound.tone(58, 50, 0.09, 'sine', 0.24);
    sound.tone(52, 45, 0.1, 'sine', 0.2, 0.16);
  }, 950);
}
function stopHeartbeat() {
  clearInterval(heartTimer);
  heartTimer = null;
}

function setTension(on) {
  $('#screen-game').classList.toggle('tension', on);
  if (on) startHeartbeat(); else stopHeartbeat();
}

/* ============================== highscores ============================== */

function getScores() { return loadJSON(LS_SCORES, []); }

function addScore(score, ms) {
  const scores = getScores();
  const entry = { score, ms, name: settings.playerName, date: Date.now() };
  scores.push(entry);
  scores.sort((a, b) => b.score - a.score || a.date - b.date);
  const trimmed = scores.slice(0, MAX_SCORES);
  localStorage.setItem(LS_SCORES, JSON.stringify(trimmed));
  return { rank: trimmed.indexOf(entry), entry };
}

function renderScores() {
  const scores = getScores();
  const list = $('#hs-list');
  list.innerHTML = '';
  $('#hs-empty').style.display = scores.length ? 'none' : 'block';
  $('#btn-clear-scores').style.display = scores.length ? 'flex' : 'none';
  for (const s of scores) {
    const li = document.createElement('li');
    const scoreEl = document.createElement('span');
    scoreEl.className = 'hs-score';
    scoreEl.textContent = s.score;
    const nameEl = document.createElement('span');
    nameEl.className = 'hs-name';
    nameEl.textContent = s.name || 'unnamed';
    const meta = document.createElement('span');
    meta.className = 'hs-meta';
    meta.textContent = `${fmtTime(s.ms || 0)} · ${new Date(s.date).toLocaleDateString()}`;
    li.append(scoreEl, nameEl, meta);
    list.appendChild(li);
  }
}

/* remembers the entry from the last game so a late-entered name can be attached to it */
let lastEntryDate = null;

function commitPlayerName(name) {
  settings.playerName = name;
  saveSettings();
  refreshSettingsUI();
  if (lastEntryDate) {
    const scores = getScores();
    const entry = scores.find((e) => e.date === lastEntryDate);
    if (entry && !entry.name) {
      entry.name = name;
      localStorage.setItem(LS_SCORES, JSON.stringify(scores));
    }
  }
}

/* ============================== stats & badges ============================== */

const stats = Object.assign({
  gamesPlayed: 0,
  totalPoints: 0,
  badTapped: 0,
  badAppeared: 0,
  bestCombo: 0,
  longestMs: 0,
}, loadJSON(LS_STATS, {}));

function saveStats() { localStorage.setItem(LS_STATS, JSON.stringify(stats)); }

const badges = new Set(loadJSON(LS_BADGES, []));

const BADGES = {
  'first-tap':    { ico: '🌟', name: 'First Tap',      desc: 'Tap your first bad guy' },
  'century':      { ico: '💯', name: 'Century Club',   desc: 'Tap 100 bad guys in total' },
  'sharpshooter': { ico: '🎯', name: 'Sharpshooter',   desc: '90% accuracy in a run (30+ baddies)' },
  'untouchable':  { ico: '🛡️', name: 'Untouchable',    desc: 'Reach 50 points without losing a life' },
  'comeback':     { ico: '❤️‍🩹', name: 'Comeback Kid',  desc: 'Refill all hearts after your last life' },
  'golden-touch': { ico: '✨', name: 'Golden Touch',   desc: 'Tap a golden ghost' },
  'long-night':   { ico: '🌙', name: 'Long Night',     desc: 'Survive 3 minutes in one run' },
  'bomb-squad':   { ico: '💣', name: 'Bomb Squad',     desc: 'Outlast 3 bombs in one run' },
  'combo-master': { ico: '🔥', name: 'Combo Master',   desc: 'Reach the ×3 multiplier' },
};

function awardBadge(id) {
  if (badges.has(id)) return;
  badges.add(id);
  localStorage.setItem(LS_BADGES, JSON.stringify([...badges]));
  toast(`🏅 ${BADGES[id].name} unlocked!`);
  sound.chime();
  buzz(30);
}

function renderStats() {
  $('#st-best').textContent = getScores()[0]?.score ?? 0;
  $('#st-time').textContent = fmtTime(stats.longestMs);
  $('#st-combo').textContent = stats.bestCombo;
  $('#st-taps').textContent = stats.badTapped;
  $('#st-acc').textContent = stats.badAppeared
    ? `${Math.round((100 * stats.badTapped) / stats.badAppeared)}%` : '—';
  $('#st-games').textContent = stats.gamesPlayed;

  const grid = $('#badge-grid');
  grid.innerHTML = '';
  for (const [id, b] of Object.entries(BADGES)) {
    const card = document.createElement('div');
    card.className = badges.has(id) ? 'badge' : 'badge locked';
    const ico = document.createElement('span');
    ico.className = 'b-ico';
    ico.textContent = b.ico;
    const name = document.createElement('span');
    name.className = 'b-name';
    name.textContent = b.name;
    const desc = document.createElement('span');
    desc.className = 'b-desc';
    desc.textContent = b.desc;
    card.append(ico, name, desc);
    grid.appendChild(card);
  }
}

/* ============================== toasts ============================== */

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 3300);
}

/* ============================== screens ============================== */

function show(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  $(`#screen-${name}`).classList.add('active');
  if (name === 'scores') renderScores();
  if (name === 'stats') renderStats();
  if (name === 'menu') refreshMenuInfo();
}

/* ============================== scene setup ============================== */

const windows = []; // { g, charEl, cx, cy }

function buildSkyStars() {
  const group = $('#skyStars');
  for (let i = 0; i < 40; i++) {
    const x = rand(10, 790);
    const y = rand(10, 560);
    if (Math.hypot(x - 130, y - 115) < 80) continue; // keep clear of the moon
    const star = svgEl('circle', { cx: x, cy: y, r: rand(1, 2.6), fill: '#fff', class: 'sky-star' });
    star.style.animationDelay = `${rand(0, 3)}s`;
    group.appendChild(star);
  }
}

function buildMenuStars() {
  const holder = $('#stars');
  for (let i = 0; i < 70; i++) {
    const s = document.createElement('span');
    s.className = 'star';
    const size = rand(1, 3);
    s.style.width = s.style.height = `${size}px`;
    s.style.left = `${rand(0, 100)}%`;
    s.style.top = `${rand(0, 100)}%`;
    s.style.animationDelay = `${rand(0, 3)}s`;
    holder.appendChild(s);
  }
}

/* --- flying bats with flapping wings --- */
function buildBats() {
  const group = $('#flyingBats');
  const spots = [
    { x: 150, y: 400, fly: 'fly1', s: 1.0 },
    { x: 630, y: 330, fly: 'fly2', s: 1.2 },
    { x: 290, y: 190, fly: 'fly3', s: 0.8 },
    { x: 540, y: 480, fly: 'fly2', s: 0.7 },
    { x: 100, y: 250, fly: 'fly1', s: 0.9 },
  ];
  for (const spot of spots) {
    const pos = svgEl('g', { transform: `translate(${spot.x} ${spot.y}) scale(${spot.s})` });
    const bat = svgEl('g', { class: `fbat ${spot.fly}` });
    bat.style.setProperty('--dur', `${rand(9, 16).toFixed(1)}s`);
    bat.style.animationDelay = `${-rand(0, 10).toFixed(1)}s`;

    const wl = svgEl('path', { class: 'wing wl', d: 'M-2 0 Q -13 -12 -30 -6 Q -22 2 -13 5 Q -6 6 -2 3 Z' });
    const wr = svgEl('path', { class: 'wing wr', d: 'M2 0 Q 13 -12 30 -6 Q 22 2 13 5 Q 6 6 2 3 Z' });
    const body = svgEl('ellipse', { cx: 0, cy: 0, rx: 4.5, ry: 7 });
    const ears = svgEl('path', { d: 'M-3.5 -5 L -2 -10 L 0 -5.5 L 2 -10 L 3.5 -5 Z' });
    wl.style.animationDelay = `${-rand(0, 0.24).toFixed(2)}s`;
    wr.style.animationDelay = wl.style.animationDelay;

    bat.append(wl, wr, body, ears);
    pos.appendChild(bat);
    group.appendChild(pos);
  }
}

/* --- bushes and shrubs with eyes that glow on and off --- */
const SHRUB_DARKS = ['#040806', '#060b08', '#071009', '#050a07'];
const BUSH_GREENS = ['#0d2416', '#123020', '#0a1c10', '#0f2a1a'];
const EYE_COLORS = ['#ffd75e', '#b7f36b', '#ff9a4d', '#e8e8e8', '#8fd4ff'];

function makeShrub(group, spot, palette, tall, withEyes) {
  const g = svgEl('g', { transform: `translate(${spot.x} ${spot.y}) scale(${spot.s})` });
  const clumps = tall ? 5 : 4;
  for (let i = 0; i < clumps; i++) {
    g.appendChild(svgEl('ellipse', {
      cx: rand(-30, 30),
      cy: tall ? rand(-46, -4) : rand(-8, 2),
      rx: rand(22, 42),
      ry: tall ? rand(28, 52) : rand(16, 26),
      fill: pick(palette),
    }));
  }
  if (withEyes) {
    const eyes = svgEl('g', { class: 'bush-eyes' });
    const color = pick(EYE_COLORS);
    const ex = rand(-16, 6), ey = tall ? rand(-42, -12) : rand(-14, -4), gap = rand(11, 15);
    for (const dx of [0, gap]) {
      eyes.appendChild(svgEl('ellipse', { cx: ex + dx, cy: ey, rx: 4, ry: 5, fill: color }));
      eyes.appendChild(svgEl('circle', { cx: ex + dx, cy: ey + 1, r: 1.8, fill: '#111' }));
    }
    g.appendChild(eyes);
    cycleEyes(eyes);
  }
  group.appendChild(g);
}

function buildShrubsBack() {
  const group = $('#shrubsBack');
  const spots = [
    { x: 35,  y: 876, s: 1.2 },  { x: 105, y: 878, s: 1.35 },
    { x: 175, y: 876, s: 1.1 },  { x: 655, y: 876, s: 1.15 },
    { x: 725, y: 878, s: 1.3 },  { x: 785, y: 876, s: 1.05 },
  ];
  for (const spot of spots) {
    makeShrub(group, spot, SHRUB_DARKS, true, Math.random() < 0.8);
  }
}

function buildBushes() {
  const group = $('#bushes');
  const spots = [
    { x: 62,  y: 880, s: 0.85 }, { x: 150, y: 884, s: 0.7 },
    { x: 228, y: 884, s: 0.6 },  { x: 330, y: 888, s: 0.5 },
    { x: 520, y: 886, s: 0.55 }, { x: 615, y: 884, s: 0.7 },
    { x: 702, y: 880, s: 0.8 },  { x: 772, y: 884, s: 0.65 },
  ];
  for (const spot of spots) {
    makeShrub(group, spot, BUSH_GREENS, false, Math.random() < 0.25);
  }
}

function cycleEyes(eyes) {
  setTimeout(() => {
    eyes.classList.add('on');
    setTimeout(() => {
      eyes.classList.remove('on');
      cycleEyes(eyes);
    }, rand(1200, 4200));
  }, rand(2500, 9500));
}

/* --- ivy vines creeping up the manor walls --- */
const LEAF_GREENS = ['#123a1e', '#0d2c17', '#16401f', '#0f331a'];

function growVine(x0, y0, y1, drift) {
  const group = $('#vines');
  const steps = Math.max(4, Math.round((y0 - y1) / 32));
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const y = y0 - ((y0 - y1) * i) / steps;
    const x = x0 + Math.sin(i * 1.35) * drift + rand(-4, 4);
    pts.push([x, y]);
  }
  const d = 'M' + pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L ');
  group.appendChild(svgEl('path', {
    d, fill: 'none', stroke: '#14301c', 'stroke-width': 4.5,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: 0.95,
  }));
  for (let i = 1; i < pts.length; i++) {
    const leaves = 2 + randInt(2);
    for (let l = 0; l < leaves; l++) {
      const leaf = svgEl('ellipse', {
        cx: pts[i][0] + rand(-11, 11), cy: pts[i][1] + rand(-9, 9),
        rx: rand(5, 9), ry: rand(3, 5),
        fill: pick(LEAF_GREENS),
        transform: `rotate(${rand(0, 180).toFixed(0)} ${pts[i][0].toFixed(0)} ${pts[i][1].toFixed(0)})`,
      });
      group.appendChild(leaf);
    }
  }
}

function scatterLeaves(xMin, xMax, y, count) {
  const group = $('#vines');
  for (let i = 0; i < count; i++) {
    const cx = rand(xMin, xMax), cy = y + rand(-10, 6);
    group.appendChild(svgEl('ellipse', {
      cx, cy,
      rx: rand(5, 10), ry: rand(3, 6),
      fill: pick(LEAF_GREENS),
      transform: `rotate(${rand(0, 180).toFixed(0)} ${cx.toFixed(0)} ${cy.toFixed(0)})`,
    }));
  }
}

function buildVines() {
  growVine(212, 872, 460, 12);
  growVine(226, 872, 640, 8);
  growVine(628, 872, 590, 10);
  scatterLeaves(204, 330, 866, 16);
  scatterLeaves(500, 636, 866, 12);
}

/* --- cracks in the old abandoned walls --- */
function buildCracks() {
  const group = $('#cracks');
  const addPath = (d, width = 2.2) => group.appendChild(svgEl('path', {
    d, fill: 'none', stroke: '#10131b', 'stroke-width': width,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: 0.85,
  }));

  const crack = (x, y, len) => {
    let d = `M${x} ${y}`;
    let cx = x, cy = y;
    const segs = Math.max(3, Math.round(len / 14));
    const branchAt = 1 + randInt(segs - 1);
    for (let i = 0; i < segs; i++) {
      cx += rand(-7, 7);
      cy += rand(10, 18);
      d += ` L${cx.toFixed(1)} ${cy.toFixed(1)}`;
      if (i === branchAt) {
        const bx = cx + rand(9, 18) * (Math.random() < 0.5 ? -1 : 1);
        const by = cy + rand(6, 14);
        d += ` M${cx.toFixed(1)} ${cy.toFixed(1)} L${bx.toFixed(1)} ${by.toFixed(1)} M${cx.toFixed(1)} ${cy.toFixed(1)}`;
      }
    }
    addPath(d);
  };

  const diag = (x, y, dx, dy) => {
    let d = `M${x} ${y}`;
    let cx = x, cy = y;
    for (let i = 0; i < 3; i++) {
      cx += dx / 3 + rand(-3, 3);
      cy += dy / 3 + rand(-3, 3);
      d += ` L${cx.toFixed(1)} ${cy.toFixed(1)}`;
    }
    addPath(d, 1.8);
  };

  const patch = (x, y) => {
    const pts = [];
    const n = 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = rand(10, 22);
      pts.push(`${(x + Math.cos(a) * r * 1.3).toFixed(1)},${(y + Math.sin(a) * r).toFixed(1)}`);
    }
    group.appendChild(svgEl('polygon', { points: pts.join(' '), fill: '#171a23' }));
  };

  crack(354, 282, 130);
  crack(486, 288, 110);
  crack(350, 560, 100);
  crack(484, 590, 150);
  crack(610, 430, 90);
  diag(340, 398, 24, 14);
  diag(500, 528, -26, 12);
  diag(370, 658, -22, -14);
  diag(600, 292, 20, 16);
  patch(356, 340);
  patch(484, 742);
  patch(608, 486);
}

/* --- grass tufts along the front --- */
function buildGrass() {
  const group = $('#grass');
  for (let i = 0; i < 16; i++) {
    const x = rand(10, 790);
    const y = rand(876, 970);
    const h = rand(8, 16);
    group.appendChild(svgEl('path', {
      d: `M${x} ${y} q 2 -${h} 4 0 q 2 -${h * 0.8} 4 0 q 2 -${h} 4 0`,
      fill: 'none', stroke: '#10251a', 'stroke-width': 2.5, 'stroke-linecap': 'round',
    }));
  }
}

/* --- the 12 tappable windows --- */
const CURTAIN_WINDOWS = [1, 6, 9]; // decorative torn curtains

function buildWindows() {
  const group = $('#windows');
  let idx = 0;
  for (const y of WIN_ROWS) {
    for (const x of WIN_COLS) {
      const i = idx++;
      const cx = x + WIN_W / 2;

      const g = svgEl('g', { class: 'win' });
      const frame = svgEl('rect', { x: x - 6, y: y - 6, width: WIN_W + 12, height: WIN_H + 12, rx: 4, fill: '#3a2b1e' });
      const sill = svgEl('rect', { x: x - 10, y: y + WIN_H + 2, width: WIN_W + 20, height: 7, rx: 3, fill: '#241a10' });
      const glass = svgEl('rect', { class: 'glass', x, y, width: WIN_W, height: WIN_H, fill: 'url(#glassDark)' });

      const clip = svgEl('clipPath', { id: `winclip${i}` });
      clip.appendChild(svgEl('rect', { x: x - 2, y: y - 2, width: WIN_W + 4, height: WIN_H + 4 }));

      const charWrap = svgEl('g', { 'clip-path': `url(#winclip${i})` });
      const charEl = svgEl('use', {
        class: 'char',
        width: 70, height: 70,
        x: cx - 35, y: y + WIN_H - 74,
      });
      charWrap.appendChild(charEl);

      // mullions drawn over the character so it looks inside the window
      const barV = svgEl('line', { x1: cx, y1: y, x2: cx, y2: y + WIN_H, stroke: '#3a2b1e', 'stroke-width': 4, 'pointer-events': 'none' });
      const barH = svgEl('line', { x1: x, y1: y + WIN_H / 2, x2: x + WIN_W, y2: y + WIN_H / 2, stroke: '#3a2b1e', 'stroke-width': 4, 'pointer-events': 'none' });

      const flash = svgEl('rect', { class: 'flash', x, y, width: WIN_W, height: WIN_H, fill: '#fffbe0', opacity: 0, 'pointer-events': 'none' });
      const bolt = svgEl('text', { class: 'bolt', x: cx, y: y + WIN_H / 2 + 20, 'font-size': 58, 'text-anchor': 'middle' });
      bolt.textContent = '⚡';

      // generous invisible hit area (easy tapping on phones)
      const hit = svgEl('rect', { x: x - 14, y: y - 14, width: WIN_W + 28, height: WIN_H + 28, fill: 'transparent' });

      g.append(frame, sill, glass, clip, charWrap, barV, barH, flash, bolt, hit);

      if (CURTAIN_WINDOWS.includes(i)) {
        g.appendChild(svgEl('path', {
          d: `M${x} ${y} L ${x + WIN_W} ${y} L ${x + WIN_W} ${y + 7}
              Q ${x + WIN_W * 0.72} ${y + 22} ${x + WIN_W / 2} ${y + 9}
              Q ${x + WIN_W * 0.28} ${y + 22} ${x} ${y + 7} Z`,
          fill: '#4a2032', opacity: 0.9, 'pointer-events': 'none',
        }));
      }

      group.appendChild(g);
      g.addEventListener('pointerdown', (e) => { e.preventDefault(); onWindowTap(i); });

      windows.push({ g, charEl, cx, cy: y + WIN_H / 2 });
    }
  }
}

/* ============================== game state ============================== */

let game = null;

function newRun() {
  return {
    phase: 'countdown', // countdown | playing
    paused: false,
    over: false,
    score: 0,
    lives: START_LIVES,
    streak: 0,
    mult: 1,
    spawnCount: 0,
    lastWindow: -1,
    lastFairy: -99,
    lastBomb: -99,
    fairiesSpawned: 0,
    escapeStreak: 0,
    escapeWarned: false,
    tier: 0,
    elapsed: 0,
    lastTick: performance.now(),
    active: null, // { index, type, charId }
    spawnTimer: null,
    stayTimer: null,
    tickInterval: null,
    cdTimers: [],
    lightningTimer: null,
    // run stats
    runBadAppeared: 0,
    runBadTapped: 0,
    runLivesLost: 0,
    runBombsSurvived: 0,
    runBestCombo: 0,
    wasOnLastLife: false,
    newBestShown: false,
    prevBest: getScores()[0]?.score ?? 0,
  };
}

function startGame() {
  teardownRun();
  game = newRun();
  game.tickInterval = setInterval(tick, 200);
  for (const w of windows) w.g.classList.remove('open', 'zap', 'oops', 'poof', 'boom', 'sp-golden', 'sp-bomb', 'sp-fairy');
  setTension(false);
  applyTier(0);
  updateSpeedBar(0);
  updateHUD();
  show('game');
  runCountdown();
}

function runCountdown() {
  const overlay = $('#countdown');
  const num = $('#cd-num');
  overlay.classList.add('show');
  const steps = ['3', '2', '1', 'TAP!'];
  game.cdTimers = steps.map((label, i) => setTimeout(() => {
    num.textContent = label;
    num.classList.remove('pop');
    void num.offsetWidth; // restart the pop animation
    num.classList.add('pop');
    sound.tick(label === 'TAP!');
  }, i * 700));
  game.cdTimers.push(setTimeout(() => {
    overlay.classList.remove('show');
    game.phase = 'playing';
    game.lastTick = performance.now();
    ambient.start();
    scheduleLightning();
    scheduleSpawn(500);
  }, steps.length * 700));
}

function teardownRun() {
  if (game) {
    clearTimeout(game.spawnTimer);
    clearTimeout(game.stayTimer);
    clearInterval(game.tickInterval);
    clearTimeout(game.lightningTimer);
    game.cdTimers.forEach(clearTimeout);
  }
  ambient.stop();
  stopSizzle();
  stopHeartbeat();
  $('#screen-game').classList.remove('tension');
  $('#pause-overlay').classList.remove('show');
  $('#countdown').classList.remove('show');
}

function applyScore(delta) {
  game.score = Math.max(0, game.score + delta);
  if (!game.newBestShown && game.prevBest > 0 && game.score > game.prevBest) {
    game.newBestShown = true;
    popupText(400, 330, 'NEW BEST!', '#ffd75e', true);
    sound.fanfare();
  }
}

function resetStreak() {
  game.streak = 0;
  game.mult = 1;
}

function bumpStreak() {
  game.streak += 1;
  game.runBestCombo = Math.max(game.runBestCombo, game.streak);
  const newMult = game.streak >= 10 ? 3 : game.streak >= 5 ? 2 : 1;
  if (newMult > game.mult) {
    game.mult = newMult;
    popupText(400, 360, `COMBO ×${newMult}!`, '#ff9a4d', true);
    sound.chime();
    if (newMult === 3) awardBadge('combo-master');
  }
}

/* ---------- spawning ---------- */

function scheduleSpawn(delay) {
  if (!game || game.over || game.paused || game.phase !== 'playing') return;
  clearTimeout(game.spawnTimer);
  const gap = gapFor(game.spawnCount);
  game.spawnTimer = setTimeout(spawn, delay ?? rand(gap * 0.75, gap * 1.3));
}

function chooseSpawn() {
  const n = game.spawnCount;
  if (game.lives < LIVES_CAP && game.fairiesSpawned < MAX_FAIRIES
      && n - game.lastFairy > 20 && n > 12 && Math.random() < 0.045) {
    game.lastFairy = n;
    game.fairiesSpawned += 1;
    return { type: 'fairy', charId: 'fairy' };
  }
  if (n >= 12 && Math.random() < 0.05) {
    return { type: 'golden', charId: 'golden' };
  }
  if (n >= 20 && n - game.lastBomb > 10 && Math.random() < 0.07) {
    game.lastBomb = n;
    return { type: 'bomb', charId: 'bomb' };
  }
  if (Math.random() < goodChanceFor(n)) {
    return { type: 'good', charId: pick(GOOD_CHARS) };
  }
  return { type: 'bad', charId: pick(BAD_CHARS) };
}

function updateSpeedBar(n) {
  $('#speedcover').style.left = `${(speedFrac(n) * 100).toFixed(1)}%`;
}

function spawn() {
  if (!game || game.over || game.paused || game.phase !== 'playing') return;
  const n = game.spawnCount++;
  updateSpeedBar(game.spawnCount);

  // deep-night escalation tier
  const tier = tierFor(game.spawnCount);
  if (tier > game.tier) {
    game.tier = tier;
    applyTier(tier);
    toast('🌘 The night deepens…');
  }

  let index;
  do { index = randInt(windows.length); } while (index === game.lastWindow);
  game.lastWindow = index;

  const { type, charId } = chooseSpawn();
  if (type === 'bad' || type === 'golden') game.runBadAppeared += 1;

  const w = windows[index];
  w.charEl.setAttribute('href', `#ch-${charId}`);
  w.g.classList.remove('zap', 'oops', 'poof', 'boom', 'sp-golden', 'sp-bomb', 'sp-fairy');
  if (type === 'golden') w.g.classList.add('sp-golden');
  if (type === 'bomb') { w.g.classList.add('sp-bomb'); startSizzle(); }
  if (type === 'fairy') w.g.classList.add('sp-fairy');
  w.g.classList.add('open');
  game.active = { index, type, charId };

  (VOICES[charId] ?? sound.pop.bind(sound))();

  let stay = stayFor(n);
  if (type === 'golden') stay *= 0.55;
  if (type === 'bomb') stay *= 1.15;

  game.stayTimer = setTimeout(() => resolveEscape(index), stay);
}

function resolveEscape(index) {
  if (!game || game.over || game.paused) return;
  const a = game.active;
  if (!a || a.index !== index) return;
  game.active = null;
  const w = windows[index];
  w.g.classList.remove('open');

  switch (a.type) {
    case 'bad':
      applyScore(POINTS_MISS_BAD);
      resetStreak();
      popupText(w.cx, w.cy, `${POINTS_MISS_BAD}`, '#ff9a4d');
      sound.miss();
      game.escapeStreak += 1;
      if (game.escapeStreak >= ESCAPE_LIMIT) {
        // the escaped ghosts gang up on you
        game.escapeStreak = 0;
        loseLifeCore();
        sound.hurt();
        popupText(400, 330, '👻 OVERRUN! 💔', '#ff6b57', true);
        updateHUD();
        if (game.lives <= 0) {
          game.over = true;
          setTimeout(endGame, 700);
          return;
        }
        scheduleSpawn(1000); // same grace period as any other life loss
        return;
      }
      if (game.escapeStreak === 1 && !game.escapeWarned) {
        game.escapeWarned = true;
        toast("👻 Don't let them escape!");
      }
      break;
    case 'good':
      applyScore(POINTS_SAVE_GOOD);
      popupText(w.cx, w.cy, `+${POINTS_SAVE_GOOD}`, '#9fdc70');
      sound.save();
      break;
    case 'golden':
      // a missed opportunity, nothing more
      break;
    case 'fairy':
      break;
    case 'bomb':
      stopSizzle();
      game.runBombsSurvived += 1;
      popupText(w.cx, w.cy, '✓', '#9fdc70');
      if (game.runBombsSurvived >= 3) awardBadge('bomb-squad');
      break;
  }
  updateHUD();
  scheduleSpawn();
}

/* ---------- tapping ---------- */

function loseLifeCore() {
  game.lives -= 1;
  game.runLivesLost += 1;
  resetStreak();
  flashVignette();
  shakeScene();
  buzz([60, 40, 60]);
  if (game.lives === 1) {
    game.wasOnLastLife = true;
    setTension(true);
  }
}

function loseLife(w, cssClass) {
  loseLifeCore();
  w.g.classList.add(cssClass);
}

function onWindowTap(index) {
  if (!game || game.over || game.paused || game.phase !== 'playing') return;
  const a = game.active;
  if (!a || a.index !== index) return;

  game.active = null;
  clearTimeout(game.stayTimer);
  const w = windows[index];

  switch (a.type) {
    case 'bad': {
      game.runBadTapped += 1;
      game.escapeStreak = 0;
      bumpStreak();
      applyScore(POINTS_TAP_BAD * game.mult);
      sound.zap();
      buzz(25);
      w.g.classList.add('zap');
      burstParticles(w.cx, w.cy, ['#ffe9a8', '#b7f36b', '#8fd4ff']);
      popupText(w.cx, w.cy, `+${POINTS_TAP_BAD * game.mult}`, '#ffd75e');
      awardBadge('first-tap');
      if (stats.badTapped + game.runBadTapped >= 100) awardBadge('century');
      if (game.score >= 50 && game.runLivesLost === 0) awardBadge('untouchable');
      setTimeout(() => w.g.classList.remove('open', 'zap'), 380);
      break;
    }
    case 'golden': {
      game.runBadTapped += 1;
      game.escapeStreak = 0;
      bumpStreak();
      applyScore(POINTS_TAP_GOLDEN * game.mult);
      sound.zap();
      sound.chime();
      buzz([25, 30, 25]);
      w.g.classList.add('zap');
      burstParticles(w.cx, w.cy, ['#fff8d0', '#ffd75e', '#f4b942'], 14);
      popupText(w.cx, w.cy, `+${POINTS_TAP_GOLDEN * game.mult}`, '#ffd75e', true);
      awardBadge('golden-touch');
      if (game.score >= 50 && game.runLivesLost === 0) awardBadge('untouchable');
      setTimeout(() => w.g.classList.remove('open', 'zap', 'sp-golden'), 380);
      break;
    }
    case 'good': {
      loseLife(w, 'oops');
      sound.hurt();
      popupText(w.cx, w.cy, '💔', '#ff6b57');
      setTimeout(() => w.g.classList.remove('open', 'oops'), 450);
      break;
    }
    case 'fairy': {
      game.lives = Math.min(LIVES_CAP, game.lives + 1);
      if (game.lives > 1) setTension(false);
      if (game.wasOnLastLife && game.lives === LIVES_CAP) awardBadge('comeback');
      sound.chime();
      buzz(20);
      w.g.classList.add('poof');
      burstParticles(w.cx, w.cy, ['#ff8a9a', '#ffd9e2', '#fff'], 12);
      popupText(w.cx, w.cy, '+1 ❤️', '#ff8a9a');
      setTimeout(() => w.g.classList.remove('open', 'poof', 'sp-fairy'), 400);
      break;
    }
    case 'bomb': {
      stopSizzle();
      loseLife(w, 'boom');
      sound.explosion();
      burstParticles(w.cx, w.cy, ['#ffb52e', '#ff6a3a', '#3c4048'], 16);
      popupText(w.cx, w.cy, '💥', '#ff6a3a', true);
      setTimeout(() => w.g.classList.remove('open', 'boom', 'sp-bomb'), 450);
      break;
    }
  }
  updateHUD();

  if (game.lives <= 0) {
    game.over = true;
    setTimeout(endGame, 700);
  } else {
    // brief grace period after losing a life so a panicked tap can't double-punish
    const lostLife = a.type === 'good' || a.type === 'bomb';
    scheduleSpawn(lostLife ? 1000 : undefined);
  }
}

/* ---------- clock & escalation ---------- */

function tick() {
  if (!game || game.over || game.paused || game.phase !== 'playing') return;
  const now = performance.now();
  game.elapsed += now - game.lastTick;
  game.lastTick = now;
  if (game.elapsed >= 180000) awardBadge('long-night');
}

function applyTier(tier) {
  $('#nightTint').setAttribute('opacity', (tier * 0.06).toFixed(2));
  $('#moonTint').setAttribute('opacity', (tier * 0.12).toFixed(2));
}

function updateHUD() {
  $('#hud-score').textContent = `Score: ${game.score}`;
  const hearts = [];
  for (let i = 0; i < LIVES_CAP; i++) {
    hearts.push(`<span class="${i < game.lives ? '' : 'lost'}">❤️</span>`);
  }
  // escaped-ghost warning: at ESCAPE_LIMIT in a row you lose a life
  if (game.escapeStreak > 0) {
    hearts.push(`<span class="esc">${'👻'.repeat(game.escapeStreak)}</span>`);
  }
  $('#hud-lives').innerHTML = hearts.join('');
  const combo = $('#hud-combo');
  if (game.streak >= 2) {
    combo.innerHTML = `🔥${game.streak}${game.mult > 1 ? ` <span class="mult">×${game.mult}</span>` : ''}`;
  } else {
    combo.innerHTML = '';
  }
}

/* keep the HUD aligned with the rendered scene rather than the full
   (letterboxed) viewport, so on wide screens it hugs the house */
function layoutHUD() {
  const hud = $('#hud');
  const vw = window.innerWidth, vh = window.innerHeight;
  const scale = Math.min(vw / 800, vh / 1000); // scene viewBox is 800x1000, fit "meet"
  const sideGap = Math.max(0, (vw - 800 * scale) / 2);
  const topGap = Math.max(0, (vh - 1000 * scale) / 2);
  hud.style.left = `${sideGap}px`;
  hud.style.right = `${sideGap}px`;
  hud.style.top = `${topGap}px`;
}
window.addEventListener('resize', layoutHUD);
window.addEventListener('orientationchange', layoutHUD);

/* ---------- lightning ---------- */

function scheduleLightning() {
  if (!game || game.over || game.paused || game.phase !== 'playing') return;
  clearTimeout(game.lightningTimer);
  game.lightningTimer = setTimeout(strikeLightning, rand(15000, 38000));
}

function strikeLightning() {
  if (!game || game.over || game.paused || game.phase !== 'playing') return;
  const x0 = rand(120, 680);
  let d = `M${x0} 0`;
  let cx = x0, cy = 0;
  for (let i = 0; i < 6; i++) {
    cx += rand(-28, 28);
    cy += rand(30, 55);
    d += ` L${cx.toFixed(0)} ${cy.toFixed(0)}`;
    if (i === 3) {
      d += ` M${cx.toFixed(0)} ${cy.toFixed(0)} l ${rand(-40, -18).toFixed(0)} ${rand(24, 44).toFixed(0)} M${cx.toFixed(0)} ${cy.toFixed(0)}`;
    }
  }
  const bolt = svgEl('path', {
    d, fill: 'none', stroke: '#eaf2ff', 'stroke-width': 3.5,
    'stroke-linecap': 'round', class: 'boltfade',
  });
  $('#skyFx').appendChild(bolt);
  setTimeout(() => bolt.remove(), 600);

  const flash = $('#flashRect');
  flash.classList.remove('flashing');
  void flash.getBBox; // force reflow-ish; class re-add below restarts animation
  requestAnimationFrame(() => flash.classList.add('flashing'));
  setTimeout(() => flash.classList.remove('flashing'), 600);

  setTimeout(() => sound.thunder(), rand(300, 900));
  scheduleLightning();
}

/* ---------- pause ---------- */

function pauseGame() {
  if (!game || game.over || game.paused) return;
  game.paused = true;
  clearTimeout(game.spawnTimer);
  clearTimeout(game.stayTimer);
  clearTimeout(game.lightningTimer);
  game.cdTimers.forEach(clearTimeout);
  $('#countdown').classList.remove('show');
  ambient.stop();
  stopSizzle();
  stopHeartbeat();
  if (game.active != null) {
    // the current creature retreats, no penalty or reward
    const w = windows[game.active.index];
    w.g.classList.remove('open', 'sp-golden', 'sp-bomb', 'sp-fairy');
    game.active = null;
  }
  $('#pause-overlay').classList.add('show');
}

function resumeGame() {
  if (!game || game.over || !game.paused) return;
  game.paused = false;
  game.lastTick = performance.now();
  $('#pause-overlay').classList.remove('show');
  if (game.lives === 1) startHeartbeat();
  if (game.phase === 'countdown') {
    runCountdown();
  } else {
    ambient.start();
    scheduleLightning();
    scheduleSpawn(600);
  }
}

/* pause whenever the player leaves the window / tab */
window.addEventListener('blur', pauseGame);
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });

/* ---------- end of game ---------- */

function endGame() {
  const run = game;
  teardownRun();

  // merge run stats into lifetime stats
  stats.gamesPlayed += 1;
  stats.totalPoints += run.score;
  stats.badTapped += run.runBadTapped;
  stats.badAppeared += run.runBadAppeared;
  stats.bestCombo = Math.max(stats.bestCombo, run.runBestCombo);
  stats.longestMs = Math.max(stats.longestMs, run.elapsed);
  saveStats();

  if (run.runBadAppeared >= 30 && run.runBadTapped / run.runBadAppeared >= 0.9) {
    awardBadge('sharpshooter');
  }

  const result = addScore(run.score, run.elapsed);
  const isNewBest = run.score > 0 && run.score > run.prevBest;
  lastEntryDate = result.entry.date;

  $('#go-score').textContent = run.score;
  const acc = run.runBadAppeared
    ? `${Math.round((100 * run.runBadTapped) / run.runBadAppeared)}%` : '—';
  $('#go-run').textContent = `⏱️ ${fmtTime(run.elapsed)}   🔥 combo ${run.runBestCombo}   🎯 ${acc}`;
  $('#go-best').textContent = `Best: ${Math.max(run.prevBest, run.score)}`;
  $('#go-new').classList.toggle('show', isNewBest);

  const askName = result.rank >= 0 && run.score > 0 && !settings.playerName;
  $('#go-namerow').classList.toggle('show', askName);
  if (askName) $('#go-name').value = '';

  if (isNewBest) sound.fanfare(); else sound.over();
  buzz([80, 60, 80]);

  game = null;
  show('gameover');
}

function quitGame() {
  teardownRun();
  for (const w of windows) w.g.classList.remove('open', 'zap', 'oops', 'poof', 'boom', 'sp-golden', 'sp-bomb', 'sp-fairy');
  game = null;
  show('menu');
}

/* ============================== effects ============================== */

function popupText(x, y, text, color, big = false) {
  const t = svgEl('text', {
    class: big ? 'popup big' : 'popup',
    x, y, 'text-anchor': 'middle',
    fill: color, stroke: '#1a1405', 'stroke-width': 1.5, 'paint-order': 'stroke',
  });
  t.textContent = text;
  $('#fx').appendChild(t);
  setTimeout(() => t.remove(), big ? 1150 : 850);
}

function burstParticles(cx, cy, colors, count = 9) {
  const fx = $('#fx');
  for (let i = 0; i < count; i++) {
    const angle = rand(0, Math.PI * 2);
    const dist = rand(26, 62);
    const p = svgEl('circle', {
      cx, cy, r: rand(2.5, 5.5),
      fill: pick(colors),
      class: 'particle',
    });
    p.style.setProperty('--dx', `${(Math.cos(angle) * dist).toFixed(0)}px`);
    p.style.setProperty('--dy', `${(Math.sin(angle) * dist).toFixed(0)}px`);
    fx.appendChild(p);
    setTimeout(() => p.remove(), 700);
  }
}

function flashVignette() {
  const v = $('#vignette');
  v.classList.add('hit');
  setTimeout(() => v.classList.remove('hit'), 120);
}

function shakeScene() {
  const scene = $('#scene');
  scene.classList.remove('scnshake');
  void scene.getBoundingClientRect();
  scene.classList.add('scnshake');
  setTimeout(() => scene.classList.remove('scnshake'), 350);
}

/* --- roof cat strolls by every now and then --- */
function scheduleRoofCat() {
  setTimeout(() => {
    const cat = $('#roofCat');
    cat.classList.add('walk');
    setTimeout(() => cat.classList.remove('walk'), 9200);
    scheduleRoofCat();
  }, rand(40000, 85000));
}

/* ============================== wiring ============================== */

document.querySelectorAll('[data-nav]').forEach((btn) => {
  btn.addEventListener('click', () => {
    sound.click();
    const target = btn.dataset.nav;
    if (target === 'game') startGame();
    else show(target);
  });
});

$('#btn-again').addEventListener('click', () => { sound.click(); startGame(); });
$('#btn-pause').addEventListener('click', () => { sound.click(); pauseGame(); });
$('#btn-resume').addEventListener('click', () => { sound.click(); resumeGame(); });
$('#btn-quit-menu').addEventListener('click', () => { sound.click(); quitGame(); });

$('#btn-sound').addEventListener('click', () => {
  settings.sound = !settings.sound;
  saveSettings();
  refreshSettingsUI();
  sound.click();
});

$('#btn-haptics').addEventListener('click', () => {
  settings.haptics = !settings.haptics;
  saveSettings();
  refreshSettingsUI();
  sound.click();
  buzz(20);
});

$('#inp-name').addEventListener('change', (e) => {
  settings.playerName = e.target.value.trim();
  saveSettings();
});

$('#btn-savename').addEventListener('click', () => {
  const name = $('#go-name').value.trim();
  if (!name) { $('#go-name').focus(); return; }
  commitPlayerName(name);
  $('#go-namerow').classList.remove('show');
  sound.click();
});
$('#go-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#btn-savename').click();
});

$('#btn-clear-scores').addEventListener('click', () => {
  localStorage.removeItem(LS_SCORES);
  renderScores();
  sound.click();
});

/* ============================== boot ============================== */

buildMenuStars();
buildSkyStars();
buildBats();
buildShrubsBack();
buildBushes();
buildCracks();
buildVines();
buildGrass();
buildWindows();
refreshSettingsUI();
layoutHUD();
scheduleRoofCat();
show('menu');
