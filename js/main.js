// Entry point: menu, settings, and screen flow.
import { CARS } from './physics/cars.js';
import { TRACKS } from './track/trackData.js';
import { Track } from './track/track.js';
import { Input } from './input.js';
import { GameAudio } from './audio.js';
import { Game, formatTime } from './game.js';

const $ = (sel) => document.querySelector(sel);

const DEFAULTS = {
  car: 'coupe',
  track: 'harbor',
  mode: 'race',
  laps: '3',
  opponents: '7',
  difficulty: 'medium',
  assists: 'normal',
  controls: 'tilt',
  sensitivity: '1',
  line: 'on',
  camera: 'chase',
  quality: 'medium',
  sound: 'on',
};

const isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (!isTouch) DEFAULTS.controls = 'buttons';
if (!isTouch) DEFAULTS.quality = 'high';

let settings = { ...DEFAULTS };
try {
  settings = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('apex-settings') || '{}') };
} catch {
  /* ignore */
}
const save = () => {
  try {
    localStorage.setItem('apex-settings', JSON.stringify(settings));
  } catch {
    /* ignore */
  }
};

const ASSIST_HINTS = {
  easy: 'ABS, traction & stability control, steering assist and auto-braking for corners.',
  normal: 'ABS, traction control and steering assist. You do the braking.',
  pro: 'No assists. Manage wheelspin, lock-ups and slides yourself.',
};

// ---------------------------------------------------------------- Cards
function peakPower(spec) {
  let best = 0;
  for (let rpm = spec.idleRpm; rpm < spec.redline; rpm += 100) {
    let t = spec.torqueCurve[0][1];
    for (let i = 1; i < spec.torqueCurve.length; i++) {
      const [r0, t0] = spec.torqueCurve[i - 1];
      const [r1, t1] = spec.torqueCurve[i];
      if (rpm >= r0 && rpm <= r1) t = t0 + ((t1 - t0) * (rpm - r0)) / (r1 - r0);
      else if (rpm > r1) t = t1;
    }
    best = Math.max(best, (t * rpm * 2 * Math.PI) / 60 / 745.7);
  }
  return Math.round(best);
}

function stat(label, frac, value) {
  return `<div class="stat"><span>${label}</span><span class="bar"><i style="width:${Math.round(frac * 100)}%"></i></span><b>${value}</b></div>`;
}

function renderCars() {
  const list = $('#car-list');
  list.innerHTML = '';
  for (const spec of CARS) {
    const hp = peakPower(spec);
    const el = document.createElement('button');
    el.className = 'card';
    el.dataset.id = spec.id;
    const color = `#${spec.color.toString(16).padStart(6, '0')}`;
    el.innerHTML = `
      <div class="title">${spec.name}<span class="badge">${spec.class}</span></div>
      <div class="swatch" style="background:${color}"></div>
      <div class="desc">${spec.description}</div>
      ${stat('Power', hp / 600, `${hp} hp`)}
      ${stat('Weight', 1 - (spec.mass - 1000) / 800, `${spec.mass} kg`)}
      ${stat('Grip', (spec.tire.mu - 0.8) / 0.7, spec.tire.mu.toFixed(2))}
      ${stat('Aero', spec.liftArea / 2.2, spec.liftArea > 1 ? 'High' : spec.liftArea > 0 ? 'Low' : 'None')}
      ${stat('Drive', spec.drive === 'FWD' ? 0.5 : 0.8, spec.drive)}`;
    el.addEventListener('click', () => {
      settings.car = spec.id;
      save();
      syncSelection();
      renderTrackRecords();
    });
    list.appendChild(el);
  }
}

function drawTrackPreview(canvas, def) {
  const track = new Track(def);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = (canvas.width = 210 * dpr);
  const h = (canvas.height = 80 * dpr);
  const g = canvas.getContext('2d');
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < track.count; i++) {
    minX = Math.min(minX, track.px[i]);
    maxX = Math.max(maxX, track.px[i]);
    minZ = Math.min(minZ, track.pz[i]);
    maxZ = Math.max(maxZ, track.pz[i]);
  }
  const pad = 8 * dpr;
  // Rotate the layout 90° so it fits the wide card nicely.
  const sx = maxZ - minZ;
  const sy = maxX - minX;
  const scale = Math.min((w - pad * 2) / sx, (h - pad * 2) / sy);
  const ox = (w - sx * scale) / 2;
  const oy = (h - sy * scale) / 2;
  g.lineJoin = 'round';
  g.beginPath();
  for (let i = 0; i <= track.count; i += 3) {
    const k = i % track.count;
    const x = ox + (track.pz[k] - minZ) * scale;
    const y = oy + (track.px[k] - minX) * scale;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 3 * dpr;
  g.stroke();
  g.fillStyle = '#ff3b30';
  g.beginPath();
  g.arc(ox + (track.pz[0] - minZ) * scale, oy + (track.px[0] - minX) * scale, 4 * dpr, 0, Math.PI * 2);
  g.fill();
  return { length: track.length, relief: track.relief };
}

function renderTracks() {
  const list = $('#track-list');
  list.innerHTML = '';
  for (const def of TRACKS) {
    const el = document.createElement('button');
    el.className = 'card';
    el.dataset.id = def.id;
    el.innerHTML = `<div class="title">${def.name}</div><canvas></canvas><div class="desc"></div><div class="record"></div>`;
    const { length: len, relief } = drawTrackPreview(el.querySelector('canvas'), def);
    const climb = relief > 1 ? ` · ${Math.round(relief)} m elevation change` : '';
    el.querySelector('.desc').textContent = `${(len / 1000).toFixed(2)} km${climb} · ${def.description}`;
    el.addEventListener('click', () => {
      settings.track = def.id;
      save();
      syncSelection();
    });
    list.appendChild(el);
  }
  renderTrackRecords();
}

function renderTrackRecords() {
  for (const el of document.querySelectorAll('#track-list .card')) {
    let best = null;
    try {
      best = parseFloat(localStorage.getItem(`apex-best-${el.dataset.id}-${settings.car}`)) || null;
    } catch {
      /* ignore */
    }
    el.querySelector('.record').textContent = best ? `Record (this car): ${formatTime(best)}` : '';
  }
}

function syncSelection() {
  for (const el of document.querySelectorAll('#car-list .card')) el.classList.toggle('selected', el.dataset.id === settings.car);
  for (const el of document.querySelectorAll('#track-list .card')) el.classList.toggle('selected', el.dataset.id === settings.track);
  for (const seg of document.querySelectorAll('.seg')) {
    const key = seg.dataset.setting;
    for (const b of seg.querySelectorAll('button')) b.classList.toggle('active', b.dataset.value === settings[key]);
  }
  for (const el of document.querySelectorAll('.race-only')) el.style.opacity = settings.mode === 'race' ? '1' : '0.35';
  $('#assist-hint').textContent = ASSIST_HINTS[settings.assists];
}

for (const seg of document.querySelectorAll('.seg')) {
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    settings[seg.dataset.setting] = b.dataset.value;
    save();
    syncSelection();
  });
}

// ---------------------------------------------------------------- Game flow
const input = new Input();
const audio = new GameAudio();
const hud = {
  root: $('#hud'),
  pos: $('#hud-pos'),
  lap: $('#hud-lap'),
  gaps: $('#hud-gaps'),
  time: $('#hud-time'),
  best: $('#hud-best'),
  last: $('#hud-last'),
  speed: $('#hud-speed'),
  gear: $('#hud-gear'),
  rpmFill: $('#rpm-fill'),
  abs: $('#flag-abs'),
  tcs: $('#flag-tcs'),
  stm: $('#flag-stm'),
  countdown: $('#countdown'),
  message: $('#message'),
  minimap: $('#minimap'),
};
const game = new Game({ canvas: $('#game'), input, audio, hud });
input.bindTouchControls($('#hud'));

input.onAction = (name) => {
  if (!game.running) return;
  if (name === 'pause') togglePause(!game.paused);
  else if (game.paused) return;
  else if (name === 'camera') {
    settings.camera = game.cycleCamera();
    save();
  } else if (name === 'line') {
    settings.line = game.toggleLine() ? 'on' : 'off';
    save();
  } else if (name === 'reset') game.resetPlayer();
  else if (name === 'shiftUp') game.player.vehicle.shiftUp();
  else if (name === 'shiftDown') game.player.vehicle.shiftDown();
};

function show(id, on) {
  $(id).classList.toggle('hidden', !on);
}

async function startRace() {
  audio.enabled = settings.sound === 'on';
  audio.start();
  audio.setEnabled(audio.enabled);
  if (settings.controls !== 'buttons') await input.requestTiltPermission();
  if (isTouch) {
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      await screen.orientation?.lock?.('landscape');
    } catch {
      /* not supported (e.g. iOS Safari) */
    }
  }
  input.scheme = settings.controls;
  input.tiltSensitivity = parseFloat(settings.sensitivity);
  const touch = $('#touch');
  touch.className = `touch scheme-${settings.controls}${isTouch ? '' : ' no-touch'}`;

  show('#menu', false);
  show('#start-btn', false);
  show('#results', false);
  show('#pause', false);
  show('#hud', true);
  document.body.classList.add('in-race');
  game.onFinish = showResults;
  game.start({
    trackDef: TRACKS.find((t) => t.id === settings.track),
    carSpec: CARS.find((c) => c.id === settings.car),
    mode: settings.mode,
    laps: parseInt(settings.laps, 10),
    opponents: parseInt(settings.opponents, 10),
    difficulty: settings.difficulty,
    assists: settings.assists,
    quality: settings.quality,
    camera: settings.camera,
    line: settings.line === 'on',
  });
  window.__game = game; // handy for debugging from the console
}

function toMenu() {
  game.stop();
  show('#hud', false);
  show('#pause', false);
  show('#results', false);
  show('#menu', true);
  show('#start-btn', true);
  document.body.classList.remove('in-race');
  renderTrackRecords();
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}

function togglePause(on) {
  game.pause(on);
  show('#pause', on);
}

function showResults(res) {
  if (!game.running) return;
  $('#result-title').textContent = `${res.ordinal} place`;
  $('#result-best').textContent = res.bestLap ? `Your best lap: ${formatTime(res.bestLap)}` : '';
  $('#result-rows').innerHTML = res.rows
    .map(
      (r) => `<tr class="${r.isPlayer ? 'me' : ''}"><td>${r.pos}</td><td><span class="dot" style="background:#${r.color.toString(16).padStart(6, '0')}"></span>${r.name}</td><td>${r.time}</td><td>${r.best}</td></tr>`,
    )
    .join('');
  show('#results', true);
}

$('#start-btn').addEventListener('click', startRace);
$('#again-btn').addEventListener('click', startRace);
$('#menu-btn').addEventListener('click', toMenu);
$('#pause').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pause]');
  if (!b) return;
  const a = b.dataset.pause;
  if (a === 'resume') togglePause(false);
  else if (a === 'reset') {
    togglePause(false);
    game.resetPlayer();
  } else if (a === 'restart') startRace();
  else if (a === 'quit') toMenu();
});

// Auto-pause when the app goes to the background.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.running && !game.paused) togglePause(true);
});

renderCars();
renderTracks();
syncSelection();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
