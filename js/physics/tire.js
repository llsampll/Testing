// Tire model: a normalized Pacejka "Magic Formula" curve combined with the
// similarity method for combined slip (friction ellipse). This is the same
// family of model used by most simulation-style racers (Forza Motorsport
// included): grip builds linearly with slip, peaks, then falls off into a
// slide, and longitudinal + lateral demand share one friction budget.

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export class TireModel {
  /**
   * @param {object} p
   * @param {number} p.mu        peak friction coefficient at nominal load
   * @param {number} p.loadSens  friction lost per unit of (Fz/Fz0 - 1)
   * @param {number} p.fz0       nominal load (N)
   * @param {number} p.peakSlipRatio  slip ratio at peak longitudinal force
   * @param {number} p.peakSlipAngle  slip angle (rad) at peak lateral force
   * @param {number} p.shape     Pacejka C; controls post-peak falloff
   */
  constructor(p) {
    this.mu = p.mu;
    this.loadSens = p.loadSens ?? 0.16;
    this.fz0 = p.fz0 ?? 4000;
    this.peakSlipRatio = p.peakSlipRatio ?? 0.1;
    this.peakSlipAngle = p.peakSlipAngle ?? 0.14;
    this.C = p.shape ?? 1.45;
    // Pick B so the curve peaks exactly at normalized slip = 1.
    this.B = Math.tan(Math.PI / (2 * this.C));
    // Slope of the normalized curve at the origin (used for stiffness).
    this.slope0 = this.B * this.C;
  }

  /** Normalized magic formula, peak value 1 at s = 1. */
  curve(s) {
    return Math.sin(this.C * Math.atan(this.B * s));
  }

  /** Effective friction coefficient for a given vertical load. */
  frictionAt(fz, surfaceGrip) {
    const over = fz / this.fz0 - 1;
    const mu = this.mu * (1 - this.loadSens * over);
    return Math.max(0.2, mu) * surfaceGrip;
  }

  /**
   * Combined-slip force.
   * @param {number} slipRatio  kappa
   * @param {number} slipAngle  alpha (rad), positive = wheel sliding toward +lateral
   * @param {number} fz         vertical load (N)
   * @param {number} surfaceGrip multiplier for the surface (asphalt 1, grass ~0.6)
   * @param {object} out        receives {fx, fy, sx, sy, s, mu}
   */
  force(slipRatio, slipAngle, fz, surfaceGrip, out) {
    if (fz <= 0) {
      out.fx = 0; out.fy = 0; out.s = 0; out.sx = 0; out.sy = 0; out.mu = 0;
      return out;
    }
    // Cornering stiffness grows slower than load (a loaded tire needs more
    // slip angle to reach its peak). This is a big part of why real cars
    // are stable under trail braking rather than snapping into a spin.
    const loadRatio = clamp(fz / this.fz0, 0.35, 2.5);
    const sx = slipRatio / this.peakSlipRatio;
    const sy = slipAngle / (this.peakSlipAngle * Math.sqrt(loadRatio));
    const s = Math.hypot(sx, sy);
    const mu = this.frictionAt(fz, surfaceGrip);
    out.sx = sx; out.sy = sy; out.s = s; out.mu = mu;
    if (s < 1e-6) {
      out.fx = 0; out.fy = 0;
      return out;
    }
    const f = mu * fz * this.curve(s);
    out.fx = (f * sx) / s;
    out.fy = (-f * sy) / s;
    return out;
  }

  /** Longitudinal force per unit slip ratio in the linear region. */
  longStiffness(fz, surfaceGrip) {
    return (this.frictionAt(fz, surfaceGrip) * fz * this.slope0) / this.peakSlipRatio;
  }
}
