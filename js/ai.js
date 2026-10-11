// AI drivers. They drive the same physics model as the player (with assists
// on), following the track's racing line with pure-pursuit steering and a
// precomputed braking/speed profile.

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export class AIDriver {
  /**
   * @param {import('./physics/vehicle.js').Vehicle} vehicle
   * @param {import('./track/track.js').Track} track
   * @param {number} skill 0..1 fraction of the car's grip the AI dares to use
   */
  constructor(vehicle, track, skill) {
    this.vehicle = vehicle;
    this.track = track;
    this.skill = skill;
    const spec = vehicle.spec;
    this.profile = track.speedProfile(spec, spec.tire.mu * 0.88 * skill, spec.tire.mu * 0.72 * skill);
    this.laneOffset = 0;
    this.laneTarget = 0;
    this.stuckTime = 0;
    this.mistakeTimer = 4 + Math.random() * 10;
    this.mistake = 0;
  }

  /**
   * @param {number} dt
   * @param {object} state  this car's race state ({trackIndex, lateral})
   * @param {Array} others  race states of all other cars
   * @param {number} paceScale  small rubber-band multiplier on target speed
   */
  update(dt, state, others, paceScale = 1) {
    const car = this.vehicle;
    const track = this.track;
    const n = track.count;
    const u = car.u;
    const idx = state.trackIndex;

    // ---- Traffic: pick a lane to pass slower cars ahead -------------------
    this.laneTarget *= Math.max(0, 1 - dt * 0.4);
    let brakeForTraffic = 0;
    for (const o of others) {
      let gap = (o.trackIndex - idx) * track.spacing;
      if (gap < -track.length / 2) gap += track.length;
      if (gap > track.length / 2) gap -= track.length;
      if (gap <= 0 || gap > 28) continue;
      const myLat = track.lineOffset[idx] + this.laneOffset;
      const latDiff = o.lateral - myLat;
      if (Math.abs(latDiff) > 3.2) continue;
      const closing = u - o.vehicle.u;
      if (closing > -1) {
        // Move to whichever side has more room.
        const room = track.halfWidth - 1.4;
        const side = o.lateral > 0 ? -1 : 1;
        const desired = o.lateral + side * 3.6 - track.lineOffset[idx];
        const absLat = track.lineOffset[idx] + desired;
        this.laneTarget = Math.abs(absLat) < room ? desired : o.lateral - side * 3.6 - track.lineOffset[idx];
        if (gap < 10 && Math.abs(latDiff) < 2.2 && closing > 0) brakeForTraffic = clamp(closing * 0.15, 0, 0.6);
      }
    }
    this.laneOffset += clamp(this.laneTarget - this.laneOffset, -dt * 2.5, dt * 2.5);
    // Keep the shifted line on the asphalt.
    const maxOff = track.halfWidth - 1.3;
    const base = track.lineOffset[idx];
    this.laneOffset = clamp(base + this.laneOffset, -maxOff, maxOff) - base;

    // ---- Steering: pure pursuit on the (offset) racing line ---------------
    const lookahead = clamp(7 + Math.abs(u) * 0.42, 8, 42);
    const ti = (idx + Math.round(lookahead / track.spacing)) % n;
    const lane = this.laneOffset + this.mistake;
    const tx = track.rx[ti] + track.rnx[ti] * lane;
    const tz = track.rz[ti] + track.rnz[ti] * lane;
    const dx = tx - car.x;
    const dz = tz - car.z;
    const s = Math.sin(car.heading);
    const c = Math.cos(car.heading);
    const lx = dx * s + dz * c;
    const ly = dx * c - dz * s;
    const curvature = (2 * ly) / Math.max(lx * lx + ly * ly, 1);
    let delta = Math.atan(curvature * car.spec.wheelbase);
    delta -= car.r * 0.03; // yaw damping
    car.input.steer = clamp(delta / car.maxSteerAt(Math.abs(u)), -1, 1);

    // ---- Speed control ----------------------------------------------------
    const ahead = (idx + Math.round((Math.max(u, 0) * 0.35) / track.spacing) + 1) % n;
    let target = this.profile[ahead] * paceScale;
    if (Math.abs(state.lateral) > track.halfWidth) target = Math.min(target, 30);
    const err = target - u;
    let throttle;
    let brake = 0;
    if (err > 0) {
      throttle = clamp(0.35 + err * 0.35, 0, 1);
    } else if (err > -1.2) {
      throttle = 0.25;
    } else {
      throttle = 0;
      brake = clamp(-err * 0.22, 0, 1);
    }
    brake = Math.max(brake, brakeForTraffic);
    if (brakeForTraffic > 0) throttle *= 0.5;

    // Occasional small mistakes keep the field from being robotic.
    this.mistakeTimer -= dt;
    if (this.mistakeTimer <= 0) {
      this.mistake = (Math.random() - 0.5) * 2.5 * (1.05 - this.skill) * 6;
      this.mistakeTimer = 6 + Math.random() * 12;
    }
    this.mistake *= Math.max(0, 1 - dt * 0.6);

    // ---- Recovery when stuck against a wall --------------------------------
    if (Math.abs(u) < 1.5 && state.racing) this.stuckTime += dt;
    else this.stuckTime = Math.max(0, this.stuckTime - dt);
    if (this.stuckTime > 2.5) {
      // Back up, steering the opposite way, then try again.
      throttle = 0;
      brake = 1;
      car.input.steer = -car.input.steer;
      if (this.stuckTime > 5) this.stuckTime = 0;
    }

    car.input.throttle = throttle;
    car.input.brake = brake;
  }
}
