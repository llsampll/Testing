// Rigid-body vehicle simulation.
//
// The car is simulated in the ground plane (x, z) with three degrees of
// freedom (forward speed u, lateral speed v, yaw rate r) plus an angular
// velocity for each wheel. Each step we compute dynamic wheel loads from
// weight transfer and aero, run every tire through the combined-slip tire
// model, and integrate. Driver assists (ABS, traction control, stability
// control, speed-sensitive steering) sit between the inputs and the physics,
// in the spirit of Forza's assist toggles.
//
// Local frame: x forward, y left. Positive yaw rate turns the car left.
// World frame: heading psi, forward = (sin psi, cos psi), left = (cos psi, -sin psi).

import { TireModel } from './tire.js';

const G = 9.81;
const AIR_DENSITY = 1.225;
const WHEEL_INERTIA = 1.1;
const ENGINE_INERTIA = 0.22;
const DRIVETRAIN_EFFICIENCY = 0.88;
const ROLLING_RESISTANCE = 0.013;
const MIN_SLIP_SPEED = 2.0; // regularizes slip at very low speed

export const ASSIST_PRESETS = {
  easy:   { abs: true,  tcs: true,  stm: true,  steer: true,  brakeAssist: true,  autoShift: true },
  normal: { abs: true,  tcs: true,  stm: false, steer: true,  brakeAssist: false, autoShift: true },
  pro:    { abs: false, tcs: false, stm: false, steer: false, brakeAssist: false, autoShift: true },
  ai:     { abs: true,  tcs: true,  stm: true,  steer: false, brakeAssist: false, autoShift: true },
};

function lerpCurve(curve, x) {
  if (x <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    if (x <= curve[i][0]) {
      const [x0, y0] = curve[i - 1];
      const [x1, y1] = curve[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return curve[curve.length - 1][1];
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export class Vehicle {
  constructor(spec, assists = ASSIST_PRESETS.normal) {
    this.spec = spec;
    this.assists = { ...assists };
    this.tire = new TireModel({ fz0: (spec.mass * G) / 4, ...spec.tire });

    const L = spec.wheelbase;
    this.a = L * (1 - spec.frontWeight); // CG -> front axle
    this.b = L * spec.frontWeight;       // CG -> rear axle
    this.iz = spec.mass * this.a * this.b * (spec.inertiaScale ?? 1);
    this.maxTorque = Math.max(...spec.torqueCurve.map((p) => p[1]));

    const hw = spec.trackWidth / 2;
    this.wheels = [
      { x: this.a, y: hw, front: true },
      { x: this.a, y: -hw, front: true },
      { x: -this.b, y: hw, front: false },
      { x: -this.b, y: -hw, front: false },
    ].map((w) => ({
      ...w,
      driven: spec.drive === 'AWD' || (spec.drive === 'FWD' ? w.front : !w.front),
      omega: 0,
      spin: 0,          // visual rotation angle
      load: 0,
      slipRatio: 0,
      slipAngle: 0,
      slip: 0,          // normalized combined slip (1 = at the limit)
      fx: 0,
      fy: 0,
      grip: 1,          // surface grip multiplier, set by the track
      drag: 0,          // extra surface rolling drag, set by the track
      absFactor: 1,
    }));
    this._tireOut = { fx: 0, fy: 0, sx: 0, sy: 0, s: 0, mu: 0 };

    this.input = { throttle: 0, brake: 0, steer: 0 };
    this.reset(0, 0, 0);
  }

  reset(x, z, heading) {
    this.x = x;
    this.y = 0;
    this.slope = 0;       // pitch angle of the road under the car (rad, nose up positive)
    this.z = z;
    this.heading = heading;
    this.u = 0;
    this.v = 0;
    this.r = 0;
    this.ax = 0;
    this.ay = 0;
    // Terrain, set each step by the race: slope of the road along / across the
    // car (dh/dx), and vertical curvature (positive in a dip, negative on a crest).
    this.gradeLong = 0;
    this.gradeLat = 0;
    this.crest = 0;
    this.steerAngle = 0;
    this.gear = 1;
    this.rpm = this.spec.idleRpm;
    this.shiftTimer = 0;
    this.reverseTimer = 0;
    this.tcsFactor = 1;
    this.stmActive = false;
    this.tcsActive = false;
    this.absActive = false;
    this.limiter = false;
    for (const w of this.wheels) {
      w.omega = 0;
      w.slip = 0;
      w.absFactor = 1;
    }
  }

  get speed() {
    return Math.hypot(this.u, this.v);
  }

  get forward() {
    return [Math.sin(this.heading), Math.cos(this.heading)];
  }

  get left() {
    return [Math.cos(this.heading), -Math.sin(this.heading)];
  }

  /** World position of a body-local point. */
  localToWorld(lx, ly) {
    const s = Math.sin(this.heading);
    const c = Math.cos(this.heading);
    return [this.x + lx * s + ly * c, this.z + lx * c - ly * s];
  }

  /** World-frame velocity of the CG. */
  worldVelocity() {
    const s = Math.sin(this.heading);
    const c = Math.cos(this.heading);
    return [this.u * s + this.v * c, this.u * c - this.v * s];
  }

  setWorldVelocity(vx, vz) {
    const s = Math.sin(this.heading);
    const c = Math.cos(this.heading);
    this.u = vx * s + vz * c;
    this.v = vx * c - vz * s;
  }

  /** Apply a world-space impulse (N·s) at a world-space point. */
  applyImpulse(px, pz, jx, jz) {
    const s = Math.sin(this.heading);
    const c = Math.cos(this.heading);
    const dx = px - this.x;
    const dz = pz - this.z;
    const lx = dx * s + dz * c;
    const ly = dx * c - dz * s;
    const jl = jx * s + jz * c;
    const jt = jx * c - jz * s;
    this.u += jl / this.spec.mass;
    this.v += jt / this.spec.mass;
    this.r += (lx * jt - ly * jl) / this.iz;
  }

  /** Change in point velocity along unit direction n per unit impulse along n. */
  impulseResponse(px, pz, nx, nz) {
    const s = Math.sin(this.heading);
    const c = Math.cos(this.heading);
    const dx = px - this.x;
    const dz = pz - this.z;
    const lx = dx * s + dz * c;
    const ly = dx * c - dz * s;
    const nl = nx * s + nz * c;
    const nt = nx * c - nz * s;
    const arm = lx * nt - ly * nl;
    return 1 / this.spec.mass + (arm * arm) / this.iz;
  }

  /** Velocity of a world-space point attached to the body. */
  pointVelocity(px, pz) {
    const s = Math.sin(this.heading);
    const c = Math.cos(this.heading);
    const dx = px - this.x;
    const dz = pz - this.z;
    const lx = dx * s + dz * c;
    const ly = dx * c - dz * s;
    const vu = this.u - this.r * ly;
    const vv = this.v + this.r * lx;
    return [vu * s + vv * c, vu * c - vv * s];
  }

  gearRatio(gear = this.gear) {
    const s = this.spec;
    if (gear < 0) return -s.reverseRatio * s.finalDrive;
    if (gear === 0) return 0;
    return s.gears[gear - 1] * s.finalDrive;
  }

  engineTorqueAt(rpm) {
    if (rpm >= this.spec.redline) return 0;
    return lerpCurve(this.spec.torqueCurve, rpm);
  }

  /** Steering lock available at the current speed. */
  maxSteerAt(speed) {
    const s = this.spec;
    if (!this.assists.steer) return s.maxSteer / (1 + speed / 45);
    // Speed-sensitive steering: limit lock to what the front tires can use,
    // plus the slip angle needed to get there. Keeps tilt/touch steering
    // from instantly scrubbing the fronts.
    const downforce = 0.5 * AIR_DENSITY * s.liftArea * speed * speed;
    const latAccel = s.tire.mu * (G + downforce / s.mass) * 1.05;
    const v2 = Math.max(speed * speed, 1);
    const geometric = Math.atan((s.wheelbase * latAccel) / v2);
    return Math.min(s.maxSteer, geometric + s.tire.peakSlipAngle * 0.6);
  }

  shiftUp() {
    if (this.gear < this.spec.gears.length && this.shiftTimer <= 0) {
      this.gear = this.gear < 1 ? 1 : this.gear + 1;
      this.shiftTimer = this.spec.shiftTime;
    }
  }

  shiftDown() {
    if (this.gear > 1 && this.shiftTimer <= 0) {
      this.gear -= 1;
      this.shiftTimer = this.spec.shiftTime;
    }
  }

  _autoGearbox(dt, throttle, brake) {
    const s = this.spec;
    // Reverse: hold the brake while (nearly) stopped, like most mobile racers.
    if (this.gear > 0 && this.u < 0.6 && brake > 0.5 && throttle < 0.1) {
      this.reverseTimer += dt;
      if (this.reverseTimer > 0.45) {
        this.gear = -1;
        this.reverseTimer = 0;
      }
    } else if (this.gear < 0 && throttle > 0.3 && this.u > -0.8) {
      this.gear = 1;
      this.reverseTimer = 0;
    } else {
      this.reverseTimer = 0;
    }

    if (this.gear < 1 || this.shiftTimer > 0 || !this.assists.autoShift) return;
    const wheelRpm = this._drivenWheelRpm();
    const rpm = Math.abs(wheelRpm * this.gearRatio());
    if (rpm > s.redline * 0.965 && this.gear < s.gears.length) {
      this.shiftUp();
    } else if (this.gear > 1) {
      const lowerRpm = Math.abs(wheelRpm * this.gearRatio(this.gear - 1));
      const threshold = brake > 0.2 ? 0.78 : 0.6;
      if (lowerRpm < s.redline * threshold && rpm < s.redline * 0.55) this.shiftDown();
    }
  }

  _drivenWheelRpm() {
    let sum = 0;
    let n = 0;
    for (const w of this.wheels) {
      if (w.driven) {
        sum += w.omega;
        n++;
      }
    }
    return ((sum / n) * 60) / (2 * Math.PI);
  }

  /**
   * Advance the simulation.
   * @param {number} dt seconds (keep small, ~1/240)
   */
  step(dt) {
    const s = this.spec;
    const m = s.mass;
    const speed = this.speed;
    const inp = this.input;

    // ---- Inputs -> pedal demands (reverse swaps pedals) -------------------
    let throttle = clamp(inp.throttle, 0, 1);
    let brake = clamp(inp.brake, 0, 1);
    this._autoGearbox(dt, throttle, brake);
    if (this.gear < 0) [throttle, brake] = [brake, throttle];
    if (this.shiftTimer > 0) this.shiftTimer -= dt;
    // Hill-hold: park the car gently when stopped with no pedals, so it doesn't roll away.
    if (Math.abs(this.u) < 0.4 && throttle < 0.02 && brake < 0.02) brake = 0.25;

    // ---- Steering ----------------------------------------------------------
    let steerTarget = clamp(inp.steer, -1, 1) * this.maxSteerAt(Math.abs(this.u));
    if (this.assists.steer && this.u > 3) {
      // Assisted steering also catches slides for you: it countersteers
      // against excess body slip and trims lock when the car is yawing
      // faster than the tires can support.
      const beta = Math.atan2(this.v, this.u);
      steerTarget += Math.sign(beta) * Math.max(0, Math.abs(beta) - 0.05) * 0.9;
      const downforce = 0.5 * AIR_DENSITY * s.liftArea * this.u * this.u;
      const rLimit = (s.tire.mu * (G + downforce / s.mass) * 1.1) / this.u;
      if (Math.abs(this.r) > rLimit) steerTarget -= Math.sign(this.r) * (Math.abs(this.r) - rLimit) * 0.5;
      steerTarget = clamp(steerTarget, -s.maxSteer, s.maxSteer);
    }
    const steerRate = 3.2 / (1 + speed / 14);
    const ds = clamp(steerTarget - this.steerAngle, -steerRate * dt, steerRate * dt);
    this.steerAngle += ds;

    // ---- Stability control ------------------------------------------------
    // Forza-style STM: watches body slip angle and trims throttle and brakes
    // the outside front wheel to stop a spin.
    let stmBrake = [0, 0, 0, 0];
    this.stmActive = false;
    if (this.assists.stm && speed > 6 && this.u > 0) {
      const beta = Math.atan2(this.v, Math.abs(this.u));
      const expectedR = (this.u * Math.tan(this.steerAngle)) / s.wheelbase;
      const yawExcess = Math.abs(this.r) - Math.abs(expectedR) - 0.08;
      const oversteer = Math.abs(beta) > 0.09 && Math.sign(beta) === -Math.sign(this.r);
      if (oversteer || yawExcess > 0.15) {
        this.stmActive = true;
        const severity = clamp(Math.max(Math.abs(beta) - 0.09, yawExcess) * 4, 0, 1);
        throttle *= 1 - severity * 0.85;
        // Outside front: turning left (r > 0) -> outside is front-right.
        const outside = this.r > 0 ? 1 : 0;
        stmBrake[outside] = severity * s.brakeTorque * 0.45;
      }
    }

    // ---- Traction control -------------------------------------------------
    this.tcsActive = false;
    if (this.assists.tcs) {
      // Watch both pure wheelspin and combined slip (power oversteer).
      let excess = 0;
      for (const w of this.wheels) {
        if (!w.driven || w.slipRatio < 0.02) continue;
        excess = Math.max(excess, w.slipRatio / (s.tire.peakSlipRatio * 1.15), w.slip / 1.15);
      }
      if (excess > 1 && throttle > 0.05) {
        this.tcsFactor = Math.max(0.05, this.tcsFactor - dt * 8 * excess);
        this.tcsActive = true;
      } else {
        this.tcsFactor = Math.min(1, this.tcsFactor + dt * 3);
      }
      throttle *= this.tcsFactor;
    }

    // ---- Wheel loads (static + weight transfer + aero) --------------------
    const downforce = 0.5 * AIR_DENSITY * s.liftArea * this.u * this.u;
    // Normal load: cos(slope) of the weight, plus the vertical acceleration
    // from driving through a dip (more load) or over a crest (less).
    const slopeSq = this.gradeLong * this.gradeLong + this.gradeLat * this.gradeLat;
    const loadScale = clamp(1 / Math.sqrt(1 + slopeSq) + (this.crest * this.u * this.u) / G, 0.2, 2.4);
    const frontStatic = (m * G * this.b * loadScale) / s.wheelbase;
    const rearStatic = (m * G * this.a * loadScale) / s.wheelbase;
    const longTransfer = (m * this.ax * s.cgHeight) / s.wheelbase;
    const latTransfer = (m * this.ay * s.cgHeight) / s.trackWidth;
    const frontAxle = frontStatic - longTransfer + downforce * s.aeroBalance;
    const rearAxle = rearStatic + longTransfer + downforce * (1 - s.aeroBalance);
    const frontLat = latTransfer * s.rollBalance;
    const rearLat = latTransfer * (1 - s.rollBalance);
    // Positive ay (accelerating left) moves load to the right-hand wheels.
    this.wheels[0].load = Math.max(0, frontAxle / 2 - frontLat / 2);
    this.wheels[1].load = Math.max(0, frontAxle / 2 + frontLat / 2);
    this.wheels[2].load = Math.max(0, rearAxle / 2 - rearLat / 2);
    this.wheels[3].load = Math.max(0, rearAxle / 2 + rearLat / 2);

    // ---- Engine / clutch --------------------------------------------------
    const ratio = this.gearRatio();
    const wheelRpm = this._drivenWheelRpm();
    const coupledRpm = Math.abs(wheelRpm * ratio);
    let engineTorque = 0;
    let clutchEngaged = true;
    const launchRpm = s.idleRpm + throttle * (s.redline * 0.45 - s.idleRpm);
    if (coupledRpm < launchRpm && throttle > 0.02) {
      // Slipping clutch while launching.
      clutchEngaged = false;
      this.rpm += (launchRpm - this.rpm) * Math.min(1, dt * 10);
    } else {
      this.rpm = Math.max(s.idleRpm, coupledRpm);
    }
    this.limiter = this.rpm >= s.redline;
    if (this.shiftTimer <= 0) {
      engineTorque = this.engineTorqueAt(this.rpm) * throttle;
      if (clutchEngaged && wheelRpm * ratio > 0) {
        // Engine braking off throttle (opposes the crank's rotation).
        engineTorque -= (1 - throttle) * this.maxTorque * 0.18 * (this.rpm / s.redline);
      }
    }
    const axleTorque = engineTorque * ratio * DRIVETRAIN_EFFICIENCY;
    let drivenCount = 0;
    for (const w of this.wheels) if (w.driven) drivenCount++;
    const reflectedInertia = clutchEngaged ? ((s.engineInertia ?? ENGINE_INERTIA) * ratio * ratio) / drivenCount : 0;

    // Limited slip: move torque from the faster driven wheel to the slower one.
    const driven = this.wheels.filter((w) => w.driven);
    let lsdTorque = 0;
    if (driven.length === 2) {
      const diff = driven[0].omega - driven[1].omega;
      const cap = s.lsd * Math.abs(axleTorque) + 40;
      lsdTorque = clamp(diff * 150, -cap, cap);
    }

    // ---- Tires --------------------------------------------------------------
    let fxSum = 0;
    let fySum = 0;
    let mz = 0;
    let absAny = false;
    const cosD = Math.cos(this.steerAngle);
    const sinD = Math.sin(this.steerAngle);
    const R = s.wheelRadius;
    const out = this._tireOut;

    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      const cd = w.front ? cosD : 1;
      const sd = w.front ? sinD : 0;
      // Contact patch velocity in the body frame, then the wheel frame.
      const vu = this.u - this.r * w.y;
      const vv = this.v + this.r * w.x;
      const vLong = vu * cd + vv * sd;
      const vLat = -vu * sd + vv * cd;
      const denom = Math.max(Math.abs(vLong), MIN_SLIP_SPEED);

      w.slipRatio = (w.omega * R - vLong) / denom;
      w.slipAngle = Math.atan2(vLat, denom);
      const grip = w.front ? w.grip : w.grip * (s.rearGrip ?? 1);
      this.tire.force(w.slipRatio, w.slipAngle, w.load, grip, out);
      w.fx = out.fx;
      w.fy = out.fy;
      w.slip = out.s;

      // Rotate tire forces back into the body frame.
      const bx = out.fx * cd - out.fy * sd;
      const by = out.fx * sd + out.fy * cd;
      fxSum += bx;
      fySum += by;
      mz += w.x * by - w.y * bx;

      // ---- Wheel spin (linearized implicit integration for stability) ----
      let driveT = 0;
      if (w.driven) {
        driveT = axleTorque / drivenCount;
        if (driven.length === 2) driveT += w === driven[0] ? -lsdTorque / 2 : lsdTorque / 2;
      }
      let brakeT = brake * s.brakeTorque * (w.front ? s.brakeBias : 1 - s.brakeBias) + stmBrake[i];
      if (this.assists.abs && brakeT > 0) {
        const limit = -s.tire.peakSlipRatio * 1.05;
        if (w.slipRatio < limit && Math.abs(vLong) > 2) {
          w.absFactor = Math.max(0, w.absFactor - dt * 30);
          absAny = true;
        } else {
          w.absFactor = Math.min(1, w.absFactor + dt * 10);
        }
        brakeT *= w.absFactor;
      }
      const inertia = WHEEL_INERTIA + (w.driven ? reflectedInertia : 0);
      const kOmega = (this.tire.longStiffness(w.load, grip) * R) / denom;
      const effI = inertia + dt * R * kOmega;
      const rollT = w.drag * w.load * R * Math.sign(w.omega);
      const omegaFree = w.omega + (dt * (driveT - out.fx * R - rollT)) / effI;
      const brakeDelta = (dt * brakeT) / effI;
      if (Math.abs(omegaFree) <= brakeDelta) w.omega = 0;
      else w.omega = omegaFree - Math.sign(omegaFree) * brakeDelta;
      w.spin += w.omega * dt;
    }
    this.absActive = absAny;

    // ---- Aero drag + rolling resistance ------------------------------------
    const drag = 0.5 * AIR_DENSITY * s.dragArea * this.u * Math.abs(this.u);
    const rolling = ROLLING_RESISTANCE * m * G * clamp(this.u, -1, 1);
    fxSum -= drag + rolling;
    fySum -= 0.5 * AIR_DENSITY * s.dragArea * 2 * this.v * Math.abs(this.v);

    // ---- Integrate body (rotating frame) -----------------------------------
    // Weight transfer follows the forces at the contact patches, so measure it
    // before gravity's pull along the slope is added.
    const axInertial = fxSum / m;
    const ayInertial = fySum / m;
    const slopeNorm = 1 / Math.sqrt(1 + slopeSq);
    fxSum -= m * G * this.gradeLong * slopeNorm;
    fySum -= m * G * this.gradeLat * slopeNorm;
    this.u += (fxSum / m + this.r * this.v) * dt;
    this.v += (fySum / m - this.r * this.u) * dt;
    this.r += (mz / this.iz) * dt;

    // Let the car come to rest instead of creeping at near-zero speed.
    if (throttle < 0.02 && Math.abs(this.u) < 0.15 && Math.abs(this.v) < 0.3 && brake > 0.05) {
      this.u *= 0.9;
      this.v *= 0.9;
      this.r *= 0.9;
    }

    // Filtered accelerations drive weight transfer (suspension lag).
    const k = Math.min(1, dt * 18);
    this.ax += (axInertial - this.ax) * k;
    this.ay += (ayInertial - this.ay) * k;

    const sh = Math.sin(this.heading);
    const ch = Math.cos(this.heading);
    this.x += (this.u * sh + this.v * ch) * dt;
    this.z += (this.u * ch - this.v * sh) * dt;
    this.heading += this.r * dt;
  }
}
