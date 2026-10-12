// Game session: owns the renderer, scene, camera, race simulation, HUD and
// the frame loop for one race.
import * as THREE from './vendor/three.module.min.js';
import { Race, PHYSICS_DT } from './race.js';
import { Track } from './track/track.js';
import { CarMesh } from './render/carMesh.js';
import { TrackScene } from './render/trackMesh.js';
import { AIDriver } from './ai.js';
import { ASSIST_PRESETS } from './physics/vehicle.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const CAMERAS = ['chase', 'far', 'hood', 'bumper'];

export function formatTime(t) {
  if (t === null || t === undefined || !isFinite(t)) return '--:--.---';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export class Game {
  /**
   * @param {object} deps
   * @param {HTMLCanvasElement} deps.canvas
   * @param {import('./input.js').Input} deps.input
   * @param {import('./audio.js').GameAudio} deps.audio
   * @param {object} deps.hud  element references
   */
  constructor({ canvas, input, audio, hud }) {
    this.canvas = canvas;
    this.input = input;
    this.audio = audio;
    this.hud = hud;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.3, 4000);
    this.running = false;
    this.paused = false;
    this.cameraMode = 'chase';
    this.showLine = true;
    this.onFinish = null;
    this._raf = 0;
    this._frame = this._frame.bind(this);
    window.addEventListener('resize', () => this._resize());
    this._resize();
  }

  _resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Keep a sensible horizontal field of view in portrait too.
    this.baseFov = w < h ? 80 : 62;
    this.camera.updateProjectionMatrix();
    if (this.hud?.minimap) this._sizeMinimap();
  }

  /**
   * Build a race and start the loop.
   * @param {object} cfg {trackDef, carSpec, mode, laps, opponents, difficulty, assists, quality, camera, line}
   */
  start(cfg) {
    this.stop();
    this.cfg = cfg;
    const quality = cfg.quality;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(quality === 'high' ? Math.min(dpr, 2) : quality === 'medium' ? Math.min(dpr, 1.5) : 1);
    this.renderer.shadowMap.enabled = quality === 'high';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this._resize();

    const track = new Track(cfg.trackDef);
    this.track = track;
    const timeTrial = cfg.mode === 'timetrial';
    this.race = new Race({
      track,
      carSpec: cfg.carSpec,
      opponents: timeTrial ? 0 : cfg.opponents,
      laps: timeTrial ? 9999 : cfg.laps,
      assists: cfg.assists,
      difficulty: cfg.difficulty,
      countdown: 4.2,
    });
    this.timeTrial = timeTrial;
    this.player = this.race.player;
    this.assists = ASSIST_PRESETS[cfg.assists] ?? ASSIST_PRESETS.normal;
    const spec = cfg.carSpec;
    this.playerProfile = track.speedProfile(spec, spec.tire.mu * 0.9, spec.tire.mu * 0.8);
    this.cameraMode = cfg.camera ?? 'chase';
    this.showLine = cfg.line ?? true;
    this.bestKey = `apex-best-${cfg.trackDef.id}-${spec.id}`;
    try {
      this.storedBest = parseFloat(localStorage.getItem(this.bestKey)) || null;
    } catch {
      this.storedBest = null;
    }

    this._buildScene(quality);
    this._initMinimap();

    this.camHeading = this.player.vehicle.heading;
    this.camPos = null;
    this.shake = 0;
    this.messageTimer = 0;
    this.hudTimer = 0;
    this.accumulator = 0;
    this.lastLights = -1;
    this.finishShown = false;
    this.paused = false;
    this.running = true;
    this.input.releaseAll();
    this._last = performance.now();
    this._raf = requestAnimationFrame(this._frame);
  }

  _buildScene(quality) {
    const theme = this.track.def.theme;
    const scene = new THREE.Scene();
    this.scene = scene;
    scene.fog = new THREE.Fog(theme.fog, 220, 1500);

    // Gradient sky dome.
    const skyGeo = new THREE.SphereGeometry(3000, 24, 12);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(theme.sky).offsetHSL(0, 0.1, -0.12) },
        horizon: { value: new THREE.Color(theme.fog) },
      },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying vec3 vP; void main(){ float h = clamp(vP.y * 2.2, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, pow(h, 0.7)), 1.0); }',
    });
    this.sky = new THREE.Mesh(skyGeo, skyMat);
    scene.add(this.sky);

    // Image-based lighting from the sky so paint and glass pick up reflections.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const envSky = new THREE.Mesh(new THREE.SphereGeometry(10, 16, 8), skyMat.clone());
    envScene.add(envSky);
    const groundEnv = new THREE.Mesh(new THREE.CircleGeometry(10, 16), new THREE.MeshBasicMaterial({ color: theme.ground, side: THREE.DoubleSide }));
    groundEnv.rotation.x = -Math.PI / 2;
    groundEnv.position.y = -1;
    envScene.add(groundEnv);
    this.envMap = pmrem.fromScene(envScene, 0.02).texture;
    scene.environment = this.envMap;
    pmrem.dispose();

    scene.add(new THREE.HemisphereLight(theme.sky, theme.ground, 0.55));
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
    sun.position.set(80, 140, 50);
    sun.castShadow = quality === 'high';
    if (sun.castShadow) {
      sun.shadow.mapSize.set(1024, 1024);
      const sc = sun.shadow.camera;
      sc.left = -45;
      sc.right = 45;
      sc.top = 45;
      sc.bottom = -45;
      sc.near = 10;
      sc.far = 400;
      sun.shadow.bias = -0.0005;
    }
    scene.add(sun);
    scene.add(sun.target);
    this.sun = sun;

    this.trackScene = new TrackScene(scene, this.track, { shadows: quality === 'high', quality });
    this.carMeshes = this.race.cars.map((c, i) => {
      const mesh = new CarMesh(c.vehicle.spec, c.color, { shadows: quality === 'high', number: i + 1 });
      scene.add(mesh.group);
      return mesh;
    });
  }

  _initMinimap() {
    const canvas = this.hud.minimap;
    const track = this.track;
    const b = this.trackScene.bounds;
    this.mm = { b, pad: 8 };
    this._sizeMinimap();
    this.mmPath = () => {
      const ctx = canvas.getContext('2d');
      ctx.beginPath();
      for (let i = 0; i <= track.count; i += 4) {
        const k = i % track.count;
        const [x, y] = this._mmPoint(track.px[k], track.pz[k]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      return ctx;
    };
  }

  _sizeMinimap() {
    const canvas = this.hud.minimap;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
  }

  _mmPoint(x, z) {
    const { b, pad } = this.mm;
    const canvas = this.hud.minimap;
    const w = canvas.width - pad * 2;
    const h = canvas.height - pad * 2;
    const sx = b.maxX - b.minX;
    const sz = b.maxZ - b.minZ;
    const scale = Math.min(w / sx, h / sz);
    const ox = pad + (w - sx * scale) / 2;
    const oy = pad + (h - sz * scale) / 2;
    // World +x is to the left when looking down +z; mirror x so the map
    // matches what you see from above with north (+z) up.
    return [ox + (b.maxX - x) * scale, oy + (b.maxZ - z) * scale];
  }

  _drawMinimap() {
    const canvas = this.hud.minimap;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!this.mmPath) return;
    this.mmPath();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = canvas.width * 0.06;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = canvas.width * 0.025;
    ctx.stroke();
    const r = canvas.width * 0.035;
    for (const c of this.race.cars) {
      if (c.isPlayer) continue;
      const [x, y] = this._mmPoint(c.vehicle.x, c.vehicle.z);
      ctx.fillStyle = '#' + new THREE.Color(c.color).getHexString();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    const p = this.player.vehicle;
    const [x, y] = this._mmPoint(p.x, p.z);
    ctx.fillStyle = '#ffd60a';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  cycleCamera() {
    this.cameraMode = CAMERAS[(CAMERAS.indexOf(this.cameraMode) + 1) % CAMERAS.length];
    this.camPos = null;
    return this.cameraMode;
  }

  toggleLine() {
    this.showLine = !this.showLine;
    return this.showLine;
  }

  resetPlayer() {
    if (!this.race?.started || this.player.finished) return;
    this.race.resetCar(this.player);
    this.camPos = null;
  }

  pause(on) {
    if (!this.running) return;
    this.paused = on;
    if (on) this.audio.suspend();
    else {
      this.audio.resume();
      this._last = performance.now();
    }
    this.input.releaseAll();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
    if (this.scene) {
      this.trackScene.dispose();
      for (const m of this.carMeshes) {
        this.scene.remove(m.group);
        m.dispose();
      }
      this.sky.geometry.dispose();
      this.sky.material.dispose();
      this.envMap?.dispose();
      this.scene = null;
    }
    this.audio.stopEngine();
  }

  _applyPlayerInput(dt) {
    const p = this.player;
    const v = p.vehicle;
    if (p.finished) return; // AI drives the cool-down lap
    const inp = this.input;
    inp.update(dt);
    let throttle = inp.throttle;
    let brake = inp.brake;
    // Brake assist (on with the Easy preset and the auto-gas control scheme):
    // brakes for you when you arrive at a corner too fast.
    if ((this.assists.brakeAssist || inp.scheme === 'tilt-auto') && this.race.started && v.gear > 0) {
      const ahead = (p.trackIndex + Math.round((Math.max(v.u, 0) * 0.45) / this.track.spacing) + 2) % this.track.count;
      const target = this.playerProfile[ahead];
      if (v.u > target + 1) {
        const assist = clamp((v.u - target) * 0.18, 0, 1);
        brake = Math.max(brake, assist);
        throttle = Math.min(throttle, 1 - assist);
      }
    }
    v.input.steer = inp.steer;
    v.input.throttle = throttle;
    v.input.brake = brake;
  }

  _frame(now) {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._frame);
    const dt = Math.min(0.1, (now - this._last) / 1000);
    this._last = now;
    if (this.paused) return;

    this._applyPlayerInput(dt);

    // Fixed-step physics.
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= PHYSICS_DT && steps < 60) {
      this.race.step(PHYSICS_DT);
      this.accumulator -= PHYSICS_DT;
      steps++;
    }
    if (steps === 60) this.accumulator = 0;

    this._handleEvents();
    for (let i = 0; i < this.carMeshes.length; i++) this.carMeshes[i].update(this.race.cars[i].vehicle, dt);
    this._updateCamera(dt);
    this._updateStartLights();
    this.trackScene.updateDrivingLine(this.showLine && !this.player.finished, this.player, this.playerProfile);

    // Shadow camera follows the player.
    if (this.sun.castShadow) {
      const pv = this.player.vehicle;
      this.sun.position.set(pv.x + 40, pv.y + 120, pv.z + 30);
      this.sun.target.position.set(pv.x, pv.y, pv.z);
    }
    this.sky.position.copy(this.camera.position);

    const pv = this.player.vehicle;
    const surfaceRumble = this.player.offTrack ? 1 : Math.abs(this.player.lateral) > this.track.halfWidth ? 0.5 : 0;
    this.audio.update(pv, pv.spec.cylinders ?? 6, surfaceRumble);

    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 1 / 15;
      this._updateHud();
      this._drawMinimap();
    }
    if (this.messageTimer > 0) {
      this.messageTimer -= dt;
      if (this.messageTimer <= 0) this.hud.message.classList.remove('show');
    }

    this.renderer.render(this.scene, this.camera);
  }

  _handleEvents() {
    for (const e of this.race.events) {
      if (e.type === 'impact' && e.car === this.player) {
        this.audio.impact(e.strength);
        this.shake = Math.min(1, this.shake + e.strength * 0.05);
      } else if (e.type === 'lap' && e.car === this.player) {
        const best = this.player.bestLap;
        const isBest = best === e.time;
        let text = `LAP ${formatTime(e.time)}`;
        if (this.timeTrial && (this.storedBest === null || e.time < this.storedBest)) {
          this.storedBest = e.time;
          try {
            localStorage.setItem(this.bestKey, String(e.time));
          } catch {
            /* storage unavailable */
          }
          text = `NEW RECORD ${formatTime(e.time)}`;
        } else if (isBest && this.player.lapTimes.length > 1) {
          text = `BEST LAP ${formatTime(e.time)}`;
        }
        if (!this.timeTrial && this.player.lap === this.race.laps - 1) text += '<br><small>FINAL LAP</small>';
        this._message(text, 2.5);
      } else if (e.type === 'finish' && e.car === this.player) {
        this.audio.beep(true);
        this._message(`FINISH — ${ordinal(this.player.position)}`, 3);
        // Let the AI take over the player's car for the cool-down.
        this.player.ai = new AIDriver(this.player.vehicle, this.track, 0.85);
        setTimeout(() => this.onFinish && this.onFinish(this.results()), 2600);
      }
    }
    this.race.events.length = 0;
  }

  _message(html, seconds) {
    this.hud.message.innerHTML = html;
    this.hud.message.classList.add('show');
    this.messageTimer = seconds;
  }

  _updateStartLights() {
    const cd = this.race.countdown;
    let lit;
    let go = false;
    if (cd > 3.5) lit = 0;
    else if (cd > 0) lit = Math.min(5, Math.floor((3.5 - cd) / 0.7) + 1);
    else {
      lit = 0;
      go = true;
    }
    const key = go ? (this.race.time < 1.2 ? 'go' : 'done') : lit;
    if (key === this.lastLights) return;
    this.lastLights = key;
    this.trackScene.setStartLights(lit, go);
    const el = this.hud.countdown;
    if (key === 'done') {
      el.classList.remove('show');
      return;
    }
    el.classList.add('show');
    el.innerHTML = go
      ? '<div class="lights go">' + '<i></i>'.repeat(5) + '</div><b>GO!</b>'
      : '<div class="lights">' + Array.from({ length: 5 }, (_, i) => `<i class="${i < lit ? 'on' : ''}"></i>`).join('') + '</div>';
    if (go) this.audio.beep(true);
    else if (lit > 0) this.audio.beep(false);
  }

  _updateCamera(dt) {
    const v = this.player.vehicle;
    const cam = this.camera;
    const fx = Math.sin(v.heading);
    const fz = Math.cos(v.heading);
    const speed = v.speed;

    if (this.cameraMode === 'chase' || this.cameraMode === 'far') {
      // Follow the direction of travel a little, so slides are visible.
      let target = v.heading;
      if (speed > 4 && v.u > 0) {
        const vel = v.worldVelocity();
        const travel = Math.atan2(vel[0], vel[1]);
        let d = travel - v.heading;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        target = v.heading + d * 0.5;
      }
      let dh = target - this.camHeading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      this.camHeading += dh * Math.min(1, dt * 7);
      const far = this.cameraMode === 'far';
      const dist = (far ? 9.5 : 6.4) + speed * 0.015;
      const height = far ? 3.8 : 2.5;
      const hx = Math.sin(this.camHeading);
      const hz = Math.cos(this.camHeading);
      // Stay above the road behind us too, so a dip or the Corkscrew drop never buries the camera.
      const baseY = this.track.hasElevation ? Math.max(v.y, this.track.heightAtS(this.player.s - dist)) : 0;
      const desired = new THREE.Vector3(v.x - hx * dist, baseY + height, v.z - hz * dist);
      if (!this.camPos) this.camPos = desired.clone();
      this.camPos.lerp(desired, Math.min(1, dt * 12));
      cam.position.copy(this.camPos);
      cam.lookAt(v.x + fx * 4, v.y + (far ? 0.9 : 0.55), v.z + fz * 4);
    } else {
      const forwardOff = this.cameraMode === 'hood' ? 0.6 : 2.0;
      const h = this.cameraMode === 'hood' ? 1.3 : 0.75;
      const lx = Math.cos(v.heading);
      const lz = -Math.sin(v.heading);
      const roll = clamp(v.ay * 0.004, -0.05, 0.05);
      const rise = Math.tan(v.slope || 0);
      cam.position.set(v.x + fx * forwardOff, v.y + h + rise * forwardOff, v.z + fz * forwardOff);
      cam.up.set(lx * roll, 1, lz * roll).normalize();
      cam.lookAt(v.x + fx * 30, v.y + h - 0.4 + rise * 30, v.z + fz * 30);
      cam.up.set(0, 1, 0);
    }

    if (this.shake > 0) {
      cam.position.x += (Math.random() - 0.5) * this.shake * 0.4;
      cam.position.y += (Math.random() - 0.5) * this.shake * 0.3;
      this.shake = Math.max(0, this.shake - dt * 2.5);
    }
    // Subtle kerb/grass vibration.
    if (Math.abs(this.player.lateral) > this.track.halfWidth && speed > 5) {
      cam.position.y += (Math.random() - 0.5) * 0.05;
    }
    const fov = this.baseFov + clamp(speed * 0.13, 0, 12);
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 3);
      cam.updateProjectionMatrix();
    }
  }

  _updateHud() {
    const h = this.hud;
    const p = this.player;
    const v = p.vehicle;
    const race = this.race;
    h.speed.textContent = Math.round(Math.abs(v.u) * 3.6);
    h.gear.textContent = v.gear < 0 ? 'R' : v.gear === 0 ? 'N' : v.gear;
    const rpmFrac = clamp(v.rpm / v.spec.redline, 0, 1);
    h.rpmFill.style.transform = `scaleX(${rpmFrac})`;
    h.rpmFill.classList.toggle('redline', rpmFrac > 0.93);
    h.abs.classList.toggle('on', v.absActive);
    h.tcs.classList.toggle('on', v.tcsActive);
    h.stm.classList.toggle('on', v.stmActive);

    const lapNow = race.started ? race.time - p.lapStart : 0;
    h.time.textContent = formatTime(lapNow);
    const best = this.timeTrial ? this.storedBest : p.bestLap;
    h.best.textContent = `BEST ${formatTime(best)}`;
    h.last.textContent = `LAST ${formatTime(p.lastLap)}`;

    if (this.timeTrial) {
      h.pos.innerHTML = 'TIME<span> TRIAL</span>';
      h.lap.textContent = `LAP ${Math.max(1, p.lap + 1)}`;
      h.gaps.textContent = '';
    } else {
      h.pos.innerHTML = `${p.position}<span>/${race.cars.length}</span>`;
      h.lap.textContent = `LAP ${clamp(p.lap + 1, 1, race.laps)}/${race.laps}`;
      const order = race.standings;
      const i = order.indexOf(p);
      const gapTo = (o) => Math.abs(o.distance - p.distance) / Math.max(v.speed, 15);
      const ahead = i > 0 ? `▲ ${gapTo(order[i - 1]).toFixed(1)}s` : '';
      const behind = i < order.length - 1 ? `▼ ${gapTo(order[i + 1]).toFixed(1)}s` : '';
      h.gaps.textContent = [ahead, behind].filter(Boolean).join('  ');
    }
  }

  results() {
    const race = this.race;
    const rows = race.standings.map((c) => {
      let time;
      if (c.finished) time = formatTime(c.finishTime);
      else {
        const lapsDown = Math.floor((race.player.distance - c.distance) / race.track.length);
        time = lapsDown >= 1 ? `+${lapsDown} LAP${lapsDown > 1 ? 'S' : ''}` : `+${((race.player.distance - c.distance) / Math.max(c.vehicle.speed, 20)).toFixed(1)}s`;
      }
      return { pos: c.position, name: c.name, isPlayer: c.isPlayer, time, best: formatTime(c.bestLap), color: c.color };
    });
    return { position: race.player.position, total: race.cars.length, ordinal: ordinal(race.player.position), rows, bestLap: race.player.bestLap };
  }
}
