// Track geometry: a closed centerline resampled at uniform arc length, with
// fast nearest-point queries, surface lookup, and a computed racing line.

const SAMPLE_SPACING = 2; // meters between centerline samples

function catmullRom(p0, p1, p2, p3, t) {
  // Centripetal Catmull-Rom (alpha = 0.5) avoids cusps and overshoot.
  const d = (a, b) => Math.max(1e-4, Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5));
  const t0 = 0;
  const t1 = t0 + d(p0, p1);
  const t2 = t1 + d(p1, p2);
  const t3 = t2 + d(p2, p3);
  const tt = t1 + (t2 - t1) * t;
  const lerp = (a, b, ta, tb) => {
    const w = (tt - ta) / (tb - ta);
    return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w];
  };
  const a1 = lerp(p0, p1, t0, t1);
  const a2 = lerp(p1, p2, t1, t2);
  const a3 = lerp(p2, p3, t2, t3);
  const b1 = [
    a1[0] + (a2[0] - a1[0]) * ((tt - t0) / (t2 - t0)),
    a1[1] + (a2[1] - a1[1]) * ((tt - t0) / (t2 - t0)),
  ];
  const b2 = [
    a2[0] + (a3[0] - a2[0]) * ((tt - t1) / (t3 - t1)),
    a2[1] + (a3[1] - a2[1]) * ((tt - t1) / (t3 - t1)),
  ];
  return [b1[0] + (b2[0] - b1[0]) * ((tt - t1) / (t2 - t1)), b1[1] + (b2[1] - b1[1]) * ((tt - t1) / (t2 - t1))];
}


/**
 * Periodic monotone cubic interpolation (Fritsch-Carlson). Unlike a plain
 * Catmull-Rom it never overshoots between anchors, so a steep drop like the
 * Corkscrew doesn't ring into fake bumps.
 */
function periodicPchip(anchors, period) {
  const xs = [];
  const ys = [];
  for (let k = -1; k <= 1; k++) for (const [x, y] of anchors) { xs.push(x + k * period); ys.push(y); }
  const n = xs.length;
  const h = [];
  const delta = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(xs[i + 1] - xs[i]);
    delta.push((ys[i + 1] - ys[i]) / h[i]);
  }
  const d = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    if (delta[i - 1] * delta[i] <= 0) continue;
    const w1 = 2 * h[i] + h[i - 1];
    const w2 = h[i] + 2 * h[i - 1];
    d[i] = (w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i]);
  }
  return (s) => {
    const x = ((s % period) + period) % period;
    let i = anchors.length; // start of the middle copy
    while (i < n - 2 && xs[i + 1] < x) i++;
    while (i > 0 && xs[i] > x) i--;
    const t = (x - xs[i]) / h[i];
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * d[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * d[i + 1];
  };
}

/** How far the road surface sits above the terrain mesh (meters). */
export const ROAD_LIFT = 0.16;

export const SURFACE = {
  asphalt: { grip: 1.0, drag: 0.0 },
  kerb: { grip: 0.93, drag: 0.004 },
  grass: { grip: 0.58, drag: 0.06 },
};

export class Track {
  constructor(def) {
    this.def = def;
    this.width = def.width;
    this.halfWidth = def.width / 2;
    this.kerbWidth = 1.3;
    this.wallDist = this.halfWidth + def.runoff;
    const scale = def.scale ?? 1;
    this._buildCenterline(def.points.map(([x, z]) => [x * scale, z * scale]));
    this._buildElevation(def.elevation);
    this._buildRacingLine();
  }

  _buildCenterline(points) {
    const n = points.length;
    const dense = [];
    for (let i = 0; i < n; i++) {
      const p0 = points[(i - 1 + n) % n];
      const p1 = points[i];
      const p2 = points[(i + 1) % n];
      const p3 = points[(i + 2) % n];
      for (let k = 0; k < 40; k++) dense.push(catmullRom(p0, p1, p2, p3, k / 40));
    }
    // Cumulative length of the dense polyline.
    const cum = [0];
    for (let i = 1; i <= dense.length; i++) {
      const a = dense[i - 1];
      const b = dense[i % dense.length];
      cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    const total = cum[cum.length - 1];
    const count = Math.round(total / SAMPLE_SPACING);
    this.count = count;
    this.length = total;
    this.spacing = total / count;
    this.px = new Float64Array(count);
    this.pz = new Float64Array(count);
    let j = 0;
    for (let i = 0; i < count; i++) {
      const s = i * this.spacing;
      while (cum[j + 1] < s) j++;
      const w = (s - cum[j]) / (cum[j + 1] - cum[j]);
      const a = dense[j];
      const b = dense[(j + 1) % dense.length];
      this.px[i] = a[0] + (b[0] - a[0]) * w;
      this.pz[i] = a[1] + (b[1] - a[1]) * w;
    }
    this.tx = new Float64Array(count);
    this.tz = new Float64Array(count);
    this.nx = new Float64Array(count); // left normal
    this.nz = new Float64Array(count);
    this.curvature = new Float64Array(count);
    this._computeFrames(this.px, this.pz, this.tx, this.tz, this.nx, this.nz, this.curvature);
  }

  _computeFrames(px, pz, tx, tz, nx, nz, curv) {
    const n = px.length;
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n;
      const b = (i + 1) % n;
      let dx = px[b] - px[a];
      let dz = pz[b] - pz[a];
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      tx[i] = dx;
      tz[i] = dz;
      // Left of forward (sin h, cos h) is (cos h, -sin h) => (tz, -tx).
      nx[i] = dz;
      nz[i] = -dx;
    }
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n;
      const b = (i + 1) % n;
      // Signed curvature from three points; positive = turning left.
      const ax = px[i] - px[a];
      const az = pz[i] - pz[a];
      const bx = px[b] - px[i];
      const bz = pz[b] - pz[i];
      const cross = ax * bz - az * bx;
      const la = Math.hypot(ax, az);
      const lb = Math.hypot(bx, bz);
      const lc = Math.hypot(px[b] - px[a], pz[b] - pz[a]);
      // Our left is +x when heading +z, so a left turn has negative cross.
      curv[i] = (-2 * cross) / (la * lb * lc || 1);
    }
  }

  /**
   * Per-sample height `h`, longitudinal grade `grade` (dh/ds, uphill positive)
   * and vertical curvature `crest` (d2h/ds2: positive in a dip where the car
   * is pressed into the road, negative over a crest where it gets light).
   */
  _buildElevation(anchors) {
    const n = this.count;
    this.h = new Float64Array(n);
    this.grade = new Float64Array(n);
    this.crest = new Float64Array(n);
    this.hasElevation = !!(anchors && anchors.length);
    if (this.hasElevation) {
      const f = periodicPchip(anchors, this.length);
      for (let i = 0; i < n; i++) this.h[i] = f(i * this.spacing);
      for (let pass = 0; pass < 3; pass++) {
        const c = Float64Array.from(this.h);
        for (let i = 0; i < n; i++) this.h[i] = (c[(i - 1 + n) % n] + 2 * c[i] + c[(i + 1) % n]) / 4;
      }
      const ds = this.spacing;
      for (let i = 0; i < n; i++) {
        const a = (i - 1 + n) % n;
        const b = (i + 1) % n;
        this.grade[i] = (this.h[b] - this.h[a]) / (2 * ds);
        this.crest[i] = (this.h[b] - 2 * this.h[i] + this.h[a]) / (ds * ds);
      }
      const c = Float64Array.from(this.crest);
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let k = -5; k <= 5; k++) sum += c[(i + k + n) % n];
        this.crest[i] = sum / 11;
      }
    }
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < n; i++) {
      lo = Math.min(lo, this.h[i]);
      hi = Math.max(hi, this.h[i]);
    }
    this.relief = hi - lo;
    // Coarse copy of the centerline for ground-height queries.
    const step = 4;
    const m = Math.ceil(n / step);
    this._gx = new Float64Array(m);
    this._gz = new Float64Array(m);
    this._gh = new Float64Array(m);
    for (let j = 0; j < m; j++) {
      const i = j * step;
      this._gx[j] = this.px[i];
      this._gz[j] = this.pz[i];
      this._gh[j] = this.h[i];
    }
  }

  /**
   * Build the terrain heightfield (hilly tracks only). Everything that sits on
   * the ground - road, kerbs, barriers, scenery, cars - samples this exact
   * surface through `terrainHeight`, so the grass can never poke through the
   * road however steep the slope.
   */
  ensureTerrain(seg) {
    if (!this.hasElevation) return null;
    if (this.terrain && this.terrain.seg === seg) return this.terrain;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < this.count; i++) {
      minX = Math.min(minX, this.px[i]);
      maxX = Math.max(maxX, this.px[i]);
      minZ = Math.min(minZ, this.pz[i]);
      maxZ = Math.max(maxZ, this.pz[i]);
    }
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const size = Math.max(maxX - minX, maxZ - minZ) + 1600;
    const n = seg + 1;
    const cell = size / seg;
    const x0 = cx - size / 2;
    const z0 = cz - size / 2;
    const H = new Float32Array(n * n);
    for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) H[iz * n + ix] = this.groundHeight(x0 + ix * cell, z0 + iz * cell);
    this.terrain = { seg, n, cell, x0, z0, size, cx, cz, H };
    return this.terrain;
  }

  /** Exact height of the terrain mesh (same triangulation as the rendered mesh). */
  terrainHeight(x, z) {
    const T = this.terrain;
    if (!T) return 0;
    const fx = Math.min(Math.max((x - T.x0) / T.cell, 0), T.seg - 1e-6);
    const fz = Math.min(Math.max((z - T.z0) / T.cell, 0), T.seg - 1e-6);
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const u = fx - ix;
    const w = fz - iz;
    const k = iz * T.n + ix;
    const h00 = T.H[k];
    const h10 = T.H[k + 1];
    const h01 = T.H[k + T.n];
    const h11 = T.H[k + T.n + 1];
    // Cells are split along the v01-v10 diagonal.
    if (u + w <= 1) return h00 + u * (h10 - h00) + w * (h01 - h00);
    return h11 + (1 - u) * (h01 - h11) + (1 - w) * (h10 - h11);
  }

  /** Height of the drivable surface at a world position (what wheels touch). */
  roadY(x, z) {
    return this.terrain ? this.terrainHeight(x, z) + ROAD_LIFT : 0.04;
  }

  /** Road height at arc length s (linear between samples). */
  heightAtS(s) {
    const f = (((s % this.length) + this.length) % this.length) / this.spacing;
    const i = Math.floor(f) % this.count;
    const j = (i + 1) % this.count;
    return this.h[i] + (this.h[j] - this.h[i]) * (f - Math.floor(f));
  }

  /**
   * Terrain height for scenery: an inverse-distance blend of nearby road
   * heights, so the land rolls with the circuit and settles toward the mean
   * elevation far away.
   */
  groundHeight(x, z) {
    if (!this.hasElevation) return 0;
    let sw = 0;
    let sh = 0;
    for (let j = 0; j < this._gx.length; j++) {
      const dx = this._gx[j] - x;
      const dz = this._gz[j] - z;
      const d2 = dx * dx + dz * dz;
      const w = 1 / (d2 * Math.sqrt(d2) + 8000);
      sw += w;
      sh += w * this._gh[j];
    }
    return sh / sw;
  }

  wrapIndex(i) {
    const n = this.count;
    return ((i % n) + n) % n;
  }

  /**
   * Find the closest centerline point.
   * @param {number} hint previous index (-1 for a full search)
   * @returns {{index:number, s:number, lateral:number, distance:number}}
   */
  query(x, z, hint = -1, out = {}) {
    const n = this.count;
    let best = -1;
    let bestD = Infinity;
    if (hint >= 0) {
      for (let k = -25; k <= 25; k++) {
        const i = this.wrapIndex(hint + k);
        const d = (this.px[i] - x) ** 2 + (this.pz[i] - z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    if (best < 0 || bestD > 40 * 40) {
      for (let i = 0; i < n; i++) {
        const d = (this.px[i] - x) ** 2 + (this.pz[i] - z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    // Refine along the local tangent for a continuous arc-length value.
    const dx = x - this.px[best];
    const dz = z - this.pz[best];
    const along = dx * this.tx[best] + dz * this.tz[best];
    out.index = best;
    out.s = (best * this.spacing + along + this.length) % this.length;
    out.lateral = dx * this.nx[best] + dz * this.nz[best];
    out.distance = Math.abs(out.lateral);
    return out;
  }

  surfaceAt(lateral) {
    const a = Math.abs(lateral);
    if (a <= this.halfWidth) return SURFACE.asphalt;
    if (a <= this.halfWidth + this.kerbWidth) return SURFACE.kerb;
    return SURFACE.grass;
  }

  /** Interpolated centerline position/frame at arc length s. */
  frameAt(s) {
    const f = (((s % this.length) + this.length) % this.length) / this.spacing;
    const i = Math.floor(f) % this.count;
    const j = (i + 1) % this.count;
    const w = f - Math.floor(f);
    const lerp = (arr) => arr[i] + (arr[j] - arr[i]) * w;
    return { x: lerp(this.px), z: lerp(this.pz), tx: lerp(this.tx), tz: lerp(this.tz), nx: lerp(this.nx), nz: lerp(this.nz) };
  }

  /**
   * Racing line via an "elastic band" relaxation: each point is pulled toward
   * the midpoint of its neighbours (which straightens the path and so lowers
   * curvature) while being kept inside the track edges.
   */
  _buildRacingLine() {
    const n = this.count;
    const limit = this.halfWidth - 1.6;
    const offset = new Float64Array(n);
    const rx = new Float64Array(n);
    const rz = new Float64Array(n);
    const span = 6;
    for (let iter = 0; iter < 500; iter++) {
      for (let i = 0; i < n; i++) {
        rx[i] = this.px[i] + this.nx[i] * offset[i];
        rz[i] = this.pz[i] + this.nz[i] * offset[i];
      }
      for (let i = 0; i < n; i++) {
        const a = (i - span + n) % n;
        const b = (i + span) % n;
        const mx = (rx[a] + rx[b]) / 2;
        const mz = (rz[a] + rz[b]) / 2;
        const target = (mx - this.px[i]) * this.nx[i] + (mz - this.pz[i]) * this.nz[i];
        offset[i] += (target - offset[i]) * 0.5;
        if (offset[i] > limit) offset[i] = limit;
        if (offset[i] < -limit) offset[i] = -limit;
      }
    }
    // Light smoothing so the line has no kinks from the clamp.
    for (let pass = 0; pass < 4; pass++) {
      const copy = Float64Array.from(offset);
      for (let i = 0; i < n; i++) {
        offset[i] = (copy[(i - 2 + n) % n] + copy[(i - 1 + n) % n] + copy[i] + copy[(i + 1) % n] + copy[(i + 2) % n]) / 5;
      }
    }
    this.lineOffset = offset;
    this.rx = new Float64Array(n);
    this.rz = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      this.rx[i] = this.px[i] + this.nx[i] * offset[i];
      this.rz[i] = this.pz[i] + this.nz[i] * offset[i];
    }
    this.rtx = new Float64Array(n);
    this.rtz = new Float64Array(n);
    this.rnx = new Float64Array(n);
    this.rnz = new Float64Array(n);
    this.lineCurvature = new Float64Array(n);
    this._computeFrames(this.rx, this.rz, this.rtx, this.rtz, this.rnx, this.rnz, this.lineCurvature);
    // Curvature from adjacent samples is noisy; average it over a few meters.
    const c = Float64Array.from(this.lineCurvature);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = -3; k <= 3; k++) sum += c[(i + k + n) % n];
      this.lineCurvature[i] = sum / 7;
    }
  }

  /**
   * Target speed along the racing line for a car, assuming it can corner at
   * `grip` g (scaled by downforce) and brake at `brakeG`.
   */
  speedProfile(spec, grip, brakeG) {
    const n = this.count;
    const v = new Float64Array(n);
    const g = 9.81;
    const k = (0.5 * 1.225 * spec.liftArea) / spec.mass;
    for (let i = 0; i < n; i++) {
      const kappa = Math.abs(this.lineCurvature[i]);
      // Downforce and dips add grip; crests take it away.
      const denom = kappa - grip * (k + this.crest[i]);
      v[i] = denom <= 1e-5 ? 95 : Math.min(95, Math.sqrt((grip * g) / denom));
    }
    // Backward pass: make sure we can brake down to every corner speed
    // (uphill helps the brakes, downhill fights them).
    for (let pass = 0; pass < 2; pass++) {
      for (let i = n - 1; i >= 0; i--) {
        const next = v[(i + 1) % n];
        const ds = this.spacing;
        const decel = Math.max(0.25 * g, brakeG * g + g * this.grade[i] + k * next * next * 0.5);
        v[i] = Math.min(v[i], Math.sqrt(next * next + 2 * decel * ds));
      }
    }
    return v;
  }
}
