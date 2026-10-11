// Race simulation: owns the vehicles, AI, collisions, lap timing and
// standings. Contains no rendering code so it can run headless in tests.

import { Vehicle, ASSIST_PRESETS } from './physics/vehicle.js';
import { AIDriver } from './ai.js';

export const PHYSICS_DT = 1 / 240;
const CAR_HALF_LENGTH = 2.2;
const CAR_HALF_WIDTH = 0.95;
const CAR_RADIUS = 0.98;
const AI_NAMES = ['M. Rossi', 'K. Tanaka', 'L. Moreau', 'J. Okafor', 'S. Lindqvist', 'A. Costa', 'R. Novak', 'E. Walsh', 'D. Kaur', 'T. Becker', 'P. Silva'];
const AI_COLORS = [0xe8e8e8, 0x1b1b1b, 0xff7a00, 0x27ae60, 0x8e44ad, 0xc0392b, 0x16a085, 0xf1c40f, 0x2c3e50, 0xe84393, 0x0984e3];

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export class Race {
  /**
   * @param {object} opts
   * @param {import('./track/track.js').Track} opts.track
   * @param {object} opts.carSpec       player car spec
   * @param {number} opts.opponents     number of AI cars
   * @param {number} opts.laps
   * @param {string} opts.assists       assist preset name for the player
   * @param {string} opts.difficulty    'easy' | 'medium' | 'hard'
   * @param {boolean} [opts.playerIsAI] let AI drive the player car (tests/demo)
   */
  constructor(opts) {
    this.track = opts.track;
    this.laps = opts.laps;
    this.time = 0;          // race clock (starts at green light)
    this.countdown = opts.countdown ?? 3.5;
    this.finished = false;
    this.events = [];       // collisions etc. for audio/fx, drained by the game

    const skillBase = { easy: 0.84, medium: 0.91, hard: 0.97 }[opts.difficulty] ?? 0.91;
    const total = opts.opponents + 1;
    // Player starts at the back of the grid like a career race.
    const playerSlot = opts.opponents;
    this.cars = [];
    for (let i = 0; i < total; i++) {
      const isPlayer = i === playerSlot;
      const assists = isPlayer && !opts.playerIsAI ? ASSIST_PRESETS[opts.assists] ?? ASSIST_PRESETS.normal : ASSIST_PRESETS.ai;
      const v = new Vehicle(opts.carSpec, assists);
      const slot = this._gridSlot(i);
      v.reset(slot.x, slot.z, slot.heading);
      const state = {
        id: i,
        vehicle: v,
        isPlayer,
        name: isPlayer ? 'You' : AI_NAMES[i % AI_NAMES.length],
        color: isPlayer ? opts.carSpec.color : AI_COLORS[i % AI_COLORS.length],
        trackIndex: 0,
        s: 0,
        lateral: 0,
        lap: 0,
        distance: 0,
        lapStart: 0,
        lastLap: null,
        bestLap: null,
        lapTimes: [],
        finished: false,
        finishTime: null,
        position: i + 1,
        racing: false,
        offTrack: false,
        wallHit: 0,
        ai: null,
      };
      if (!isPlayer || opts.playerIsAI) {
        // Spread skill so the field strings out; front-runners are quicker.
        const skill = clamp(skillBase + 0.035 - (i / Math.max(1, total - 1)) * 0.07 + (Math.random() - 0.5) * 0.01, 0.75, 0.995);
        state.ai = new AIDriver(v, this.track, isPlayer ? 0.95 : skill);
      }
      const q = this.track.query(v.x, v.z, -1);
      state.trackIndex = q.index;
      state.s = q.s;
      state.lateral = q.lateral;
      // Cars behind the line are still on "lap 0" of the approach.
      state.lap = q.s > this.track.length / 2 ? -1 : 0;
      state.distance = state.lap * this.track.length + q.s;
      this.cars.push(state);
    }
    this.player = this.cars[playerSlot];
    this._updateStandings();
  }

  _gridSlot(i) {
    // Two-by-two staggered grid behind the start line.
    const track = this.track;
    const row = Math.floor(i / 2);
    const side = i % 2 === 0 ? 1 : -1;
    const s = track.length - 8 - row * 9 - (i % 2) * 4.5;
    const f = track.frameAt(s);
    const lat = side * track.halfWidth * 0.42;
    return { x: f.x + f.nx * lat, z: f.z + f.nz * lat, heading: Math.atan2(f.tx, f.tz) };
  }

  get started() {
    return this.countdown <= 0;
  }

  /** Advance the race by one fixed physics step. */
  step(dt = PHYSICS_DT) {
    if (this.countdown > 0) {
      this.countdown -= dt;
      // Hold everyone on the brakes until the lights go out (revving allowed).
      for (const c of this.cars) {
        if (c.ai) {
          c.vehicle.input.throttle = 0;
          c.vehicle.input.steer = 0;
        }
        c.vehicle.input.brake = 1;
        c.vehicle.u = 0;
        c.vehicle.v = 0;
        c.vehicle.r = 0;
        c.vehicle.gear = 1;
        for (const w of c.vehicle.wheels) w.omega = 0;
        c.vehicle.rpm = c.vehicle.spec.idleRpm + c.vehicle.input.throttle * c.vehicle.spec.redline * 0.6;
      }
      if (this.countdown <= 0) {
        for (const c of this.cars) {
          c.racing = true;
          c.lapStart = 0;
        }
      }
      return;
    }
    this.time += dt;

    const leader = this.cars.reduce((a, b) => (a.distance > b.distance ? a : b));
    for (const c of this.cars) {
      if (!c.ai) continue;
      if (c.finished) {
        // Cool-down lap: cruise.
        c.ai.update(dt, c, this.cars.filter((o) => o !== c), 0.6);
        continue;
      }
      // Gentle rubber band relative to the player keeps races close.
      let pace = 1;
      if (!c.isPlayer) {
        const gap = c.distance - this.player.distance;
        pace = clamp(1 - gap * 0.00012, 0.96, 1.03);
        if (c === leader && gap > 0) pace = Math.min(pace, 1);
      }
      c.ai.update(dt, c, this.cars.filter((o) => o !== c), pace);
    }

    for (const c of this.cars) {
      const v = c.vehicle;
      // Per-wheel surface from the track.
      for (const w of v.wheels) {
        const [wx, wz] = v.localToWorld(w.x, w.y);
        const q = this.track.query(wx, wz, c.trackIndex, this._q || (this._q = {}));
        const surf = this.track.surfaceAt(q.lateral);
        w.grip = surf.grip;
        w.drag = surf.drag;
      }
      v.step(dt);
    }

    this._collideWalls();
    this._collideCars();

    for (const c of this.cars) this._updateProgress(c);
    this._updateStandings();
  }

  _updateProgress(c) {
    const track = this.track;
    const v = c.vehicle;
    const q = track.query(v.x, v.z, c.trackIndex, {});
    const prevS = c.s;
    c.trackIndex = q.index;
    c.s = q.s;
    c.lateral = q.lateral;
    c.offTrack = Math.abs(q.lateral) > track.halfWidth + track.kerbWidth;
    const ds = c.s - prevS;
    if (ds < -track.length / 2) {
      // Crossed the line going forward.
      c.lap += 1;
      if (c.lap >= 1 && c.racing) {
        const lapTime = this.time - c.lapStart;
        c.lastLap = lapTime;
        c.lapTimes.push(lapTime);
        if (c.bestLap === null || lapTime < c.bestLap) c.bestLap = lapTime;
        this.events.push({ type: 'lap', car: c, time: lapTime });
      }
      c.lapStart = this.time;
      if (c.lap >= this.laps && !c.finished && c.racing) {
        c.finished = true;
        c.finishTime = this.time;
        this.events.push({ type: 'finish', car: c });
        if (c.isPlayer) this.finished = true;
      }
    } else if (ds > track.length / 2) {
      c.lap -= 1; // reversed back over the line
    }
    c.distance = c.lap * track.length + c.s;
  }

  _updateStandings() {
    const order = [...this.cars].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.distance - a.distance;
    });
    order.forEach((c, i) => (c.position = i + 1));
    this.standings = order;
  }

  _collideWalls() {
    const track = this.track;
    const corners = [
      [CAR_HALF_LENGTH, CAR_HALF_WIDTH],
      [CAR_HALF_LENGTH, -CAR_HALF_WIDTH],
      [-CAR_HALF_LENGTH, CAR_HALF_WIDTH],
      [-CAR_HALF_LENGTH, -CAR_HALF_WIDTH],
    ];
    const q = {};
    for (const c of this.cars) {
      const v = c.vehicle;
      for (const [lx, ly] of corners) {
        const [px, pz] = v.localToWorld(lx, ly);
        track.query(px, pz, c.trackIndex, q);
        const over = Math.abs(q.lateral) - track.wallDist;
        if (over <= 0) continue;
        // Inward wall normal.
        const sign = q.lateral > 0 ? -1 : 1;
        const nx = track.nx[q.index] * sign;
        const nz = track.nz[q.index] * sign;
        v.x += nx * over;
        v.z += nz * over;
        const [pvx, pvz] = v.pointVelocity(px, pz);
        const vn = pvx * nx + pvz * nz;
        if (vn >= 0) continue;
        const k = v.impulseResponse(px, pz, nx, nz);
        const jn = (-(1 + 0.25) * vn) / k;
        v.applyImpulse(px, pz, nx * jn, nz * jn);
        // Scraping friction along the wall.
        const tx = -nz;
        const tz = nx;
        const vt = pvx * tx + pvz * tz;
        const kt = v.impulseResponse(px, pz, tx, tz);
        const jt = clamp(-vt / kt, -0.35 * jn, 0.35 * jn);
        v.applyImpulse(px, pz, tx * jt, tz * jt);
        if (-vn > 2) this.events.push({ type: 'impact', car: c, strength: -vn });
        c.wallHit = 0.4;
      }
    }
  }

  _collideCars() {
    const cars = this.cars;
    const offsets = [CAR_HALF_LENGTH - CAR_RADIUS, 0, -(CAR_HALF_LENGTH - CAR_RADIUS)];
    for (let i = 0; i < cars.length; i++) {
      const A = cars[i].vehicle;
      for (let j = i + 1; j < cars.length; j++) {
        const B = cars[j].vehicle;
        const dx0 = B.x - A.x;
        const dz0 = B.z - A.z;
        if (dx0 * dx0 + dz0 * dz0 > 36) continue;
        let deepest = null;
        for (const oa of offsets) {
          const [ax, az] = A.localToWorld(oa, 0);
          for (const ob of offsets) {
            const [bx, bz] = B.localToWorld(ob, 0);
            const dx = bx - ax;
            const dz = bz - az;
            const d = Math.hypot(dx, dz);
            const pen = 2 * CAR_RADIUS - d;
            if (pen > 0 && (!deepest || pen > deepest.pen)) {
              const nx = d > 1e-6 ? dx / d : 1;
              const nz = d > 1e-6 ? dz / d : 0;
              deepest = { pen, nx, nz, px: ax + nx * CAR_RADIUS, pz: az + nz * CAR_RADIUS };
            }
          }
        }
        if (!deepest) continue;
        const { pen, nx, nz, px, pz } = deepest;
        // Separate.
        A.x -= nx * pen * 0.5;
        A.z -= nz * pen * 0.5;
        B.x += nx * pen * 0.5;
        B.z += nz * pen * 0.5;
        // Impulse along the normal (n points from A to B).
        const [avx, avz] = A.pointVelocity(px, pz);
        const [bvx, bvz] = B.pointVelocity(px, pz);
        const vn = (bvx - avx) * nx + (bvz - avz) * nz;
        if (vn >= 0) continue;
        const k = A.impulseResponse(px, pz, nx, nz) + B.impulseResponse(px, pz, nx, nz);
        const jn = (-(1 + 0.3) * vn) / k;
        A.applyImpulse(px, pz, -nx * jn, -nz * jn);
        B.applyImpulse(px, pz, nx * jn, nz * jn);
        if (-vn > 1.5) this.events.push({ type: 'impact', car: cars[i].isPlayer ? cars[i] : cars[j], strength: -vn, other: true });
      }
    }
  }

  /** Put a car back on the racing line at its current position. */
  resetCar(c) {
    const track = this.track;
    const i = c.trackIndex;
    const v = c.vehicle;
    v.reset(track.px[i] + track.nx[i] * track.lineOffset[i], track.pz[i] + track.nz[i] * track.lineOffset[i], Math.atan2(track.tx[i], track.tz[i]));
  }
}
