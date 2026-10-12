// Detailed surroundings for tracks with a `scenery` config: a painted ground
// map (grass, sandy patches, forest floor, service roads, dirt trails), forest
// around the circuit, a paddock with transporters and hospitality units and
// footbridges over the track. Optional features, each switched on by the
// config: olive trees, a pond and octagonal lawns (Laguna Seca), and an old
// banked oval, mown fields, orchards, a golf course and a town (Monza).
//
// Everything is deterministic for a given track, so the scenery is the same
// on every visit.
import * as THREE from '../vendor/three.module.min.js';

// ---- Noise / random helpers -------------------------------------------------

function hash(ix, iz, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed + 1, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise(x, z, seed) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = fx * fx * (3 - 2 * fx);
  const w = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz, seed);
  const b = hash(ix + 1, iz, seed);
  const c = hash(ix, iz + 1, seed);
  const d = hash(ix + 1, iz + 1, seed);
  return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
}

/** Three octaves of value noise, roughly 0..1 with mean 0.5. */
function fbm(x, z, seed) {
  return noise(x, z, seed) * 0.55 + noise(x * 2.03 + 17, z * 2.03, seed + 7) * 0.3 + noise(x * 4.1, z * 4.1 + 31, seed + 13) * 0.15;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;

/** Spans [x0, x1] of a polygon ([[x, z], ...]) along the row at z (even-odd rule). */
function polyRow(poly, z) {
  const xs = [];
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % poly.length];
    if (az <= z !== bz <= z) xs.push(ax + ((z - az) / (bz - az)) * (bx - ax));
  }
  xs.sort((a, b) => a - b);
  const runs = [];
  for (let i = 0; i + 1 < xs.length; i += 2) runs.push([xs[i], xs[i + 1]]);
  return runs;
}

function inPoly(poly, x, z) {
  return polyRow(poly, z).some(([a, b]) => x >= a && x <= b);
}

/** Closed Catmull-Rom loop through `pts`, sampled about every `step` metres. */
function loopCurve(pts, step) {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const m = Math.max(1, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
    for (let k = 0; k < m; k++) {
      const t = k / m;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  return out;
}

// ---- Distance / inside field ---------------------------------------------------

/**
 * Coarse grid over the terrain holding the distance to the centreline and
 * whether a cell is inside the circuit loop.
 */
class Field {
  constructor(track, T, res) {
    this.res = res;
    this.x0 = T.x0;
    this.z0 = T.z0;
    this.cell = T.size / res;
    const N = res * res;
    const sx = new Float32Array(N).fill(1e9);
    const sz = new Float32Array(N).fill(1e9);
    const cx = (i) => this.x0 + (i + 0.5) * this.cell;
    const cz = (j) => this.z0 + (j + 0.5) * this.cell;
    const d2 = (k, x, z) => (cx(k % res) - x) ** 2 + (cz((k / res) | 0) - z) ** 2;
    // Seed cells along the centreline, then sweep nearest-seed positions over the grid.
    const n = track.count;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const steps = Math.ceil(track.spacing / (this.cell * 0.5));
      for (let t = 0; t < steps; t++) {
        const x = mix(track.px[i], track.px[j], t / steps);
        const z = mix(track.pz[i], track.pz[j], t / steps);
        const gi = Math.floor((x - this.x0) / this.cell);
        const gj = Math.floor((z - this.z0) / this.cell);
        if (gi < 0 || gj < 0 || gi >= res || gj >= res) continue;
        const k = gj * res + gi;
        if (sx[k] > 1e8 || d2(k, x, z) < d2(k, sx[k], sz[k])) {
          sx[k] = x;
          sz[k] = z;
        }
      }
    }
    const relax = (k, o) => {
      if (sx[o] > 1e8) return;
      if (sx[k] > 1e8 || d2(k, sx[o], sz[o]) < d2(k, sx[k], sz[k])) {
        sx[k] = sx[o];
        sz[k] = sz[o];
      }
    };
    for (let pass = 0; pass < 2; pass++) {
      for (let j = 0; j < res; j++)
        for (let i = 0; i < res; i++) {
          const k = j * res + i;
          if (i > 0) relax(k, k - 1);
          if (j > 0) {
            relax(k, k - res);
            if (i > 0) relax(k, k - res - 1);
            if (i < res - 1) relax(k, k - res + 1);
          }
        }
      for (let j = res - 1; j >= 0; j--)
        for (let i = res - 1; i >= 0; i--) {
          const k = j * res + i;
          if (i < res - 1) relax(k, k + 1);
          if (j < res - 1) {
            relax(k, k + res);
            if (i < res - 1) relax(k, k + res + 1);
            if (i > 0) relax(k, k + res - 1);
          }
        }
    }
    this.blocked = new Uint8Array(N);
    this.dist = new Float32Array(N);
    for (let k = 0; k < N; k++) this.dist[k] = Math.sqrt(d2(k, sx[k], sz[k]));

    // Inside the loop: even-odd fill along each row.
    this.inside = new Float32Array(N);
    for (let j = 0; j < res; j++) {
      const z = cz(j);
      const xs = [];
      for (let i = 0; i < n; i++) {
        const k = (i + 1) % n;
        const za = track.pz[i];
        const zb = track.pz[k];
        if (za <= z !== zb <= z) xs.push(track.px[i] + ((z - za) / (zb - za)) * (track.px[k] - track.px[i]));
      }
      xs.sort((a, b) => a - b);
      for (let p = 0; p + 1 < xs.length; p += 2) {
        const i0 = Math.max(0, Math.ceil((xs[p] - this.x0) / this.cell - 0.5));
        const i1 = Math.min(res - 1, Math.floor((xs[p + 1] - this.x0) / this.cell - 0.5));
        for (let i = i0; i <= i1; i++) this.inside[j * res + i] = 1;
      }
    }
  }

  /** Mark the cells within `r` of a point as taken (no trees there). */
  block(x, z, r) {
    const res = this.res;
    const i0 = Math.max(0, Math.floor((x - r - this.x0) / this.cell));
    const i1 = Math.min(res - 1, Math.floor((x + r - this.x0) / this.cell));
    const j0 = Math.max(0, Math.floor((z - r - this.z0) / this.cell));
    const j1 = Math.min(res - 1, Math.floor((z + r - this.z0) / this.cell));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const cx = this.x0 + (i + 0.5) * this.cell;
        const cz = this.z0 + (j + 0.5) * this.cell;
        if ((cx - x) ** 2 + (cz - z) ** 2 <= (r + this.cell * 0.71) ** 2) this.blocked[j * res + i] = 1;
      }
  }

  /** Mark the cells inside a polygon as taken. */
  blockPoly(poly) {
    const res = this.res;
    for (let j = 0; j < res; j++) {
      const z = this.z0 + (j + 0.5) * this.cell;
      const runs = polyRow(poly, z);
      for (const [a, b] of runs) {
        const i0 = Math.max(0, Math.ceil((a - this.x0) / this.cell - 0.5));
        const i1 = Math.min(res - 1, Math.floor((b - this.x0) / this.cell - 0.5));
        for (let i = i0; i <= i1; i++) this.blocked[j * res + i] = 1;
      }
    }
  }

  blockedAt(x, z) {
    const i = Math.floor((x - this.x0) / this.cell);
    const j = Math.floor((z - this.z0) / this.cell);
    if (i < 0 || j < 0 || i >= this.res || j >= this.res) return false;
    return this.blocked[j * this.res + i] === 1;
  }

  /** Bilinear sample of one of the grids. */
  sample(grid, x, z) {
    const r = this.res;
    const fx = Math.min(Math.max((x - this.x0) / this.cell - 0.5, 0), r - 1.001);
    const fz = Math.min(Math.max((z - this.z0) / this.cell - 0.5, 0), r - 1.001);
    const i = fx | 0;
    const j = fz | 0;
    const u = fx - i;
    const w = fz - j;
    const k = j * r + i;
    return mix(mix(grid[k], grid[k + 1], u), mix(grid[k + r], grid[k + r + 1], u), w);
  }

  distAt(x, z) {
    return this.sample(this.dist, x, z);
  }

  insideAt(x, z) {
    return this.sample(this.inside, x, z) > 0.5;
  }
}

// ---- Colours (sRGB 0..255) -------------------------------------------------------

const COL = {
  green: [104, 108, 50],
  dry: [160, 136, 74],
  verge: [94, 110, 46],
  sand: [228, 188, 124],
  forest: [42, 60, 28],
  forest2: [58, 74, 36],
  road: '#9d978b',
  trail: 'rgba(226,190,130,0.9)',
  paddock: '#a39e98',
  lawn: '#3f8a26',
  lawnEdge: '#55992f',
  lakeBed: '#5f5c3e',
  bank: '#c2a272',
  lawnField: '#728f42',
  orchard: '#74803f',
  plantation: '#6d683a',
  town: '#a9a293',
  rough: '#617f36',
  fairway: '#78994a',
  fairwayStripe: '#7fa14f',
  green2: '#8ab352',
  bunker: '#e6d6a6',
  concrete: '#b5b2a8',
};

/** Box placement in the paddock / bridge mesh: x, z, yaw, width, height, depth, colour. */
class Boxes {
  constructor(track) {
    this.track = track;
    this.list = [];
  }

  /** Box resting on the terrain (sunk on the uphill side so it never floats). */
  add(x, z, yaw, w, h, d, color, y = null) {
    if (y === null) {
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      y = Infinity;
      for (const [a, b] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2], [0, 0]]) {
        y = Math.min(y, this.track.terrainHeight(x + a * c + b * s, z - a * s + b * c));
      }
      y -= 0.15;
    }
    this.list.push({ x, y, z, yaw, w, h, d, color });
  }

  mesh(shadows) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.65, metalness: 0.05 }), this.list.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const color = new THREE.Color();
    this.list.forEach((b, i) => {
      q.setFromAxisAngle(up, b.yaw);
      m.compose(new THREE.Vector3(b.x, b.y, b.z), q, new THREE.Vector3(b.w, b.h, b.d));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, color.setHex(b.color));
    });
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    return mesh;
  }
}

export class Landscape {
  /**
   * @param {import('../track/track.js').Track} track
   * @param {object} T  the track's terrain grid (track.ensureTerrain)
   * @param {{quality:string, shadows:boolean}} opts
   */
  constructor(track, T, opts) {
    this.track = track;
    this.T = T;
    this.cfg = track.def.scenery;
    this.opts = opts;
    this.lowQ = opts.quality === 'low';
    this.seed = this.cfg.seed ?? 1;
    this.col = { ...COL, ...(this.cfg.palette ?? {}) };
    this.wd = track.wallDist;
    this.field = new Field(track, T, this.lowQ ? 320 : 448);
    this.keepOut = []; // areas trees stay out of: { x, z, r } circles
    this.extraTrees = []; // planted rows: { x, z, s, kind }
    this._planSites();
    this._planFeatures();
  }

  // ---- Site planning -----------------------------------------------------------

  /** Local frame at arc length s: world position of (along, lateral). */
  _at(f, u, v) {
    return [f.x + f.tx * u + f.nx * v, f.z + f.tz * u + f.nz * v];
  }

  _planSites() {
    const track = this.track;
    const F = this.field;
    const wd = this.wd;
    // Terrain more than this far from the centreline can be reshaped without
    // touching any triangle the road, kerbs or barriers sit on.
    this.safeDist = wd + 1 + 1.6 * this.T.cell;

    // Paddock: inside the loop, behind the pit garages on the start straight.
    const pc = this.cfg.paddock ?? {};
    const f = track.frameAt((track.length + (pc.s ?? -75)) % track.length);
    const side = pc.side ?? 1; // +1 = left of travel
    const L = pc.length ?? 150;
    const v0 = wd + 24;
    let D = pc.depth ?? 100;
    const ok = (D) => {
      for (let u = -L / 2; u <= L / 2; u += 10)
        for (let v = v0; v <= v0 + D; v += 10) {
          const [x, z] = this._at(f, u, side * v);
          if (F.distAt(x, z) < wd + 16) return false;
        }
      return true;
    };
    while (D > 30 && !ok(D)) D -= 10;
    this.paddock = D > 30 ? { f, side, L, v0, D, rows: pc.truckRows ?? 1 } : null;
    if (this.paddock) {
      const [x, z] = this._at(f, 0, side * (v0 + D / 2));
      this.paddock.cx = x;
      this.paddock.cz = z;
      this.keepOut.push({ x, z, r: Math.hypot(L / 2, D / 2) + 8 });
      // Three octagonal lawns in a row beyond the paddock.
      this.lawns = [];
      for (const u of this.cfg.lawns === false ? [] : [-34, 0, 34]) {
        const [lx, lz] = this._at(f, u, side * (v0 + D + 26));
        if (F.distAt(lx, lz) > wd + 30 && F.insideAt(lx, lz) === (side > 0)) {
          this.lawns.push({ x: lx, z: lz, r: 14, yaw: Math.atan2(f.tx, f.tz) });
          this.keepOut.push({ x: lx, z: lz, r: 18 });
        }
      }
    }
    // Pit complex between the track and the paddock.
    const [px, pz] = this._at(f, 0, side * (wd + 12));
    this.keepOut.push({ x: px, z: pz, r: 80 });

    // Pond: the most open spot of the infield that the paddock doesn't use.
    let best = null;
    if (this.cfg.lake === false) best = { room: 0 };
    const res = F.res;
    for (let j = 2; j < res - 2 && this.cfg.lake !== false; j += 2)
      for (let i = 2; i < res - 2; i += 2) {
        const k = j * res + i;
        if (!F.inside[k]) continue;
        const x = F.x0 + (i + 0.5) * F.cell;
        const z = F.z0 + (j + 0.5) * F.cell;
        let room = F.dist[k] - this.safeDist - 28;
        for (const o of this.keepOut) room = Math.min(room, Math.hypot(x - o.x, z - o.z) - o.r - 30);
        if (!best || room > best.room) best = { x, z, room };
      }
    if (best && best.room > 18) {
      const R = Math.min(62, best.room) / 1.25; // the shoreline wanders up to 25% beyond R
      const ph = [rng(this.seed * 7)(), rng(this.seed * 7 + 1)(), rng(this.seed * 7 + 2)()].map((v) => v * Math.PI * 2);
      // Irregular shoreline: radius as a function of direction.
      const radius = (a) => R * (1 + 0.14 * Math.sin(2 * a + ph[0]) + 0.08 * Math.sin(3 * a + ph[1]) + 0.04 * Math.sin(5 * a + ph[2]));
      this.lake = { x: best.x, z: best.z, R, radius };
      this.keepOut.push({ x: best.x, z: best.z, r: R * 1.26 + 10 });
    }

    // Footbridges over the straighter parts of the lap.
    this.bridges = [];
    const markers = track.brakingMarkers();
    const step = 10;
    let last = -Infinity;
    for (let s = 150; s < track.length - 160; s += step) {
      if (s - last < track.length / 5) continue;
      let straight = true;
      for (let k = -30; k <= 30 && straight; k += 2) {
        const i = track.wrapIndex(Math.round((s + k) / track.spacing));
        if (Math.abs(track.curvature[i]) > 1 / 350) straight = false;
      }
      if (!straight || markers.some((m) => Math.abs(m.s - s) < 18)) continue;
      this.bridges.push(s);
      last = s;
      if (this.bridges.length >= (this.cfg.bridges ?? 4)) break;
    }
  }

  /** Optional features from the config: banked oval, fields, golf course, town and roads. */
  _planFeatures() {
    const F = this.field;
    const cfg = this.cfg;
    const wd = this.wd;
    const rand = rng(this.seed * 53 + 1);
    const thin = this.lowQ ? 1.5 : 1; // sparser planted rows on low quality

    if (cfg.oval) {
      const pts = loopCurve(cfg.oval.points, 4);
      this.oval = { pts, half: (cfg.oval.width ?? 12) / 2, bank: cfg.oval.bank ?? 6 };
      for (const [x, z] of pts) F.block(x, z, this.oval.half + 5);
    }

    for (const fl of cfg.fields ?? []) {
      F.blockPoly(fl.poly);
      if (fl.kind !== 'orchard' && fl.kind !== 'plantation') continue;
      const gap = (fl.kind === 'orchard' ? 10 : 11) * thin;
      const xs = fl.poly.map((p) => p[0]);
      const zs = fl.poly.map((p) => p[1]);
      for (let z = Math.min(...zs) + gap / 2; z < Math.max(...zs); z += gap)
        for (let x = Math.min(...xs) + gap / 2; x < Math.max(...xs); x += gap) {
          const tx = x + (rand() - 0.5) * gap * 0.3;
          const tz = z + (rand() - 0.5) * gap * 0.3;
          if (!inPoly(fl.poly, tx, tz) || rand() < 0.12) continue;
          this.extraTrees.push(fl.kind === 'orchard' ? { x: tx, z: tz, s: 0.55 + rand() * 0.2, kind: 2 } : { x: tx, z: tz, s: 0.7 + rand() * 0.3, kind: 1 });
        }
    }

    // Golf course: winding fairways with greens and bunkers, tree belts between.
    if (cfg.golf) {
      const poly = cfg.golf.poly;
      const xs = poly.map((p) => p[0]);
      const zs = poly.map((p) => p[1]);
      const ok = (x, z) => inPoly(poly, x, z) && F.distAt(x, z) > wd + 30;
      this.golf = [];
      let tries = 0;
      while (this.golf.length < (cfg.golf.holes ?? 14) && tries++ < 400) {
        const x0 = mix(Math.min(...xs), Math.max(...xs), rand());
        const z0 = mix(Math.min(...zs), Math.max(...zs), rand());
        if (!ok(x0, z0) || F.blockedAt(x0, z0)) continue;
        const ang = (cfg.golf.heading ?? 0) + (rand() - 0.5) * 1.4;
        const len = 200 + rand() * 220;
        const bend = (rand() - 0.5) * 0.9;
        const w = 42 + rand() * 18;
        const pts = [];
        for (let t = 0; t <= len; t += 6) {
          const a = ang + (bend * t) / len;
          const [px, pz] = pts.length ? pts[pts.length - 1] : [x0 - Math.cos(a) * 6, z0 - Math.sin(a) * 6];
          pts.push([px + Math.cos(a) * 6, pz + Math.sin(a) * 6]);
        }
        if (!pts.every(([x, z]) => ok(x, z) && !F.blockedAt(x, z))) continue;
        for (const [x, z] of pts) F.block(x, z, w / 2 + 4);
        const [gx, gz] = pts[pts.length - 1];
        const bunkers = [];
        for (let b = 0; b < 2 + rand() * 3; b++) {
          const a = rand() * Math.PI * 2;
          const near = b < 2 ? [gx, gz] : pts[(rand() * pts.length) | 0];
          const r = b < 2 ? 18 : w / 2 + 3;
          bunkers.push({ x: near[0] + Math.cos(a) * r, z: near[1] + Math.sin(a) * r, rx: 5 + rand() * 6, rz: 3 + rand() * 4, rot: rand() * Math.PI });
        }
        this.golf.push({ pts, w, green: [gx, gz], bunkers });
      }
    }

    // Town: blocks of houses with gardens.
    this.houses = [];
    for (const tw of cfg.town ?? []) {
      F.blockPoly(tw.poly);
      const xs = tw.poly.map((p) => p[0]);
      const zs = tw.poly.map((p) => p[1]);
      const gap = 24 * thin;
      for (let z = Math.min(...zs) + gap / 2; z < Math.max(...zs); z += gap)
        for (let x = Math.min(...xs) + gap / 2; x < Math.max(...xs); x += gap) {
          if (!inPoly(tw.poly, x, z) || F.distAt(x, z) < wd + 60 || rand() < 0.3) continue;
          const tall = rand() < 0.12;
          this.houses.push({
            x: x + (rand() - 0.5) * 6,
            z: z + (rand() - 0.5) * 6,
            w: 9 + rand() * 8,
            d: 8 + rand() * 6,
            h: tall ? 16 + rand() * 12 : 6 + rand() * 5,
            yaw: (tw.yaw ?? 0) + (rand() < 0.5 ? 0 : Math.PI / 2),
          });
        }
    }

    // Service roads, some lined with trees.
    for (const rd of cfg.roads ?? []) {
      const w = rd.width ?? 6;
      for (let i = 0; i + 1 < rd.points.length; i++) {
        const [ax, az] = rd.points[i];
        const [bx, bz] = rd.points[i + 1];
        const len = Math.hypot(bx - ax, bz - az);
        const nx = -(bz - az) / len;
        const nz = (bx - ax) / len;
        for (let t = 0; t <= len; t += 4) {
          const x = mix(ax, bx, t / len);
          const z = mix(az, bz, t / len);
          if (F.distAt(x, z) > wd + 4) F.block(x, z, w / 2 + 2);
        }
        if (!rd.trees) continue;
        for (let t = 6; t < len; t += 11 * thin)
          for (const side of [-1, 1]) {
            const x = mix(ax, bx, t / len) + nx * side * (w / 2 + 4);
            const z = mix(az, bz, t / len) + nz * side * (w / 2 + 4);
            this.extraTrees.push({ x, z, s: 0.95 + rand() * 0.2, kind: 0 });
          }
      }
    }
  }

  // ---- Terrain shaping ----------------------------------------------------------

  /** Flatten the paddock and dig the pond into the terrain heights (before the mesh is built). */
  shapeTerrain() {
    const T = this.T;
    if (T.landscaped) return;
    T.landscaped = true;
    const F = this.field;
    const track = this.track;
    const P = this.paddock;
    let padH = 0;
    if (P) {
      let n = 0;
      for (let u = -P.L / 2; u <= P.L / 2; u += 15)
        for (let v = P.v0; v <= P.v0 + P.D; v += 15) {
          const [x, z] = this._at(P.f, u, P.side * v);
          padH += track.terrainHeight(x, z);
          n++;
        }
      padH /= n;
      P.h = padH;
    }
    const lake = this.lake;
    if (lake) {
      let h = 0;
      for (let a = 0; a < 16; a++) h += track.terrainHeight(lake.x + Math.cos(a) * lake.radius(a), lake.z + Math.sin(a) * lake.radius(a));
      lake.level = h / 16;
    }
    for (let iz = 0; iz < T.n; iz++)
      for (let ix = 0; ix < T.n; ix++) {
        const x = T.x0 + ix * T.cell;
        const z = T.z0 + iz * T.cell;
        const free = smooth(this.safeDist, this.safeDist + 12, F.distAt(x, z));
        if (free <= 0) continue;
        const k = iz * T.n + ix;
        if (P) {
          const dx = x - P.f.x;
          const dz = z - P.f.z;
          const u = dx * P.f.tx + dz * P.f.tz;
          const v = (dx * P.f.nx + dz * P.f.nz) * P.side;
          const out = Math.max(Math.abs(u) - P.L / 2, P.v0 - v, v - (P.v0 + P.D), 0);
          const w = smooth(25, 0, out) * free;
          if (w > 0) T.H[k] = mix(T.H[k], padH, w);
        }
        if (lake) {
          const r = Math.hypot(x - lake.x, z - lake.z);
          const R = lake.radius(Math.atan2(z - lake.z, x - lake.x));
          if (r < R) T.H[k] = mix(T.H[k], lake.level - 0.6 - 2.4 * (1 - (r / R) ** 2), free);
          else if (r < R + 30) T.H[k] = mix(T.H[k], lake.level + 0.45, smooth(R + 30, R + 8, r) * free);
        }
      }
  }

  // ---- Ground map ---------------------------------------------------------------

  /** Ground material: a painted colour map over the whole terrain plus a tiling detail texture. */
  groundMaterial() {
    const T = this.T;
    const F = this.field;
    const wd = this.wd;
    const res = this.lowQ ? 1024 : this.opts.quality === 'medium' ? 1536 : 2048;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = res;
    const g = canvas.getContext('2d');

    // Per-cell zone weights on the coarse field (noise is costly per pixel).
    const r = F.res;
    const tone = new Float32Array(r * r);
    const sand = new Float32Array(r * r);
    const forest = new Float32Array(r * r);
    for (let j = 0; j < r; j++)
      for (let i = 0; i < r; i++) {
        const k = j * r + i;
        const x = F.x0 + (i + 0.5) * F.cell;
        const z = F.z0 + (j + 0.5) * F.cell;
        const d = F.dist[k];
        const ins = F.inside[k];
        tone[k] = fbm(x / 70, z / 70, this.seed + 11);
        const sr = fbm(x / 110, z / 110, this.seed + 21) * 0.7 + fbm(x / 26, z / 26, this.seed + 22) * 0.3;
        sand[k] = (this.cfg.sand ?? 1) * smooth(0.53, 0.66, sr) * (ins ? 1 : 0.45) * smooth(wd + 3, wd + 12, d);
        forest[k] = F.blocked[k] ? 0 : this._forestAt(x, z, d, ins);
      }
    this.forestGrid = forest;
    this.sandGrid = sand;

    const C = this.col;
    const img = g.createImageData(res, res);
    const px = T.size / res;
    const rand = rng(this.seed * 977);
    for (let row = 0; row < res; row++) {
      const z = T.z0 + (row + 0.5) * px;
      for (let col = 0; col < res; col++) {
        const x = T.x0 + (col + 0.5) * px;
        const t = F.sample(tone, x, z);
        const sd = F.sample(sand, x, z);
        const fo = F.sample(forest, x, z);
        const d = F.sample(F.dist, x, z);
        const verge = 1 - smooth(wd + 2, wd + 10, d);
        const grain = 0.93 + rand() * 0.14;
        const o = (row * res + col) * 4;
        for (let c = 0; c < 3; c++) {
          let v = mix(C.green[c], C.dry[c], t);
          v = mix(v, C.sand[c], sd);
          v = mix(v, mix(C.forest[c], C.forest2[c], t), smooth(0.15, 0.6, fo));
          v = mix(v, C.verge[c], verge);
          img.data[o + c] = Math.min(255, v * grain);
        }
        img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);

    // Vector features, drawn in world metres.
    const k = res / T.size;
    g.setTransform(k, 0, 0, k, -T.x0 * k, -T.z0 * k);
    g.lineCap = g.lineJoin = 'round';
    this._paintFeatures(g);
    this._paintTrails(g);
    if (this.cfg.serviceRoads !== false) this._paintServiceRoads(g);
    this._paintPaddock(g);
    this._paintLake(g);

    const map = new THREE.CanvasTexture(canvas);
    map.flipY = false;
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 8;
    const detail = new THREE.CanvasTexture(
      (() => {
        const c = document.createElement('canvas');
        c.width = c.height = 256;
        const dg = c.getContext('2d');
        const di = dg.createImageData(256, 256);
        const rr = rng(this.seed + 5);
        for (let i = 0; i < 256 * 256; i++) {
          const x = i % 256;
          const y = (i / 256) | 0;
          const v = 128 + (rr() - 0.5) * 34 + (noise(x / 16, y / 16, 3) - 0.5) * 30;
          di.data[i * 4] = di.data[i * 4 + 1] = di.data[i * 4 + 2] = v;
          di.data[i * 4 + 3] = 255;
        }
        dg.putImageData(di, 0, 0);
        return c;
      })(),
    );
    detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
    detail.anisotropy = 4;
    const mat = new THREE.MeshStandardMaterial({ map, roughness: 1, polygonOffset: true, polygonOffsetFactor: 6, polygonOffsetUnits: 6 });
    const detailRepeat = T.size / 10;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.detailMap = { value: detail };
      sh.uniforms.detailRepeat = { value: detailRepeat };
      sh.fragmentShader =
        'uniform sampler2D detailMap;\nuniform float detailRepeat;\n' +
        sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n\tdiffuseColor.rgb *= texture2D( detailMap, vMapUv * detailRepeat ).rgb * 2.0;');
    };
    mat.userData.detail = detail;
    return mat;
  }

  /** Forest cover 0..1: dense outside the circuit, in clumps, with open fields between. */
  _forestAt(x, z, d, ins) {
    const fc = this.cfg.forest ?? {};
    const n = fbm(x / (fc.scale ?? 150), z / (fc.scale ?? 150), this.seed + 31);
    return (ins ? fc.inside ?? 0.25 : 1) * smooth(this.wd + 10, this.wd + 40, d) * smooth(fc.lo ?? 0.4, fc.hi ?? 0.52, n);
  }

  /** Polyline runs where `ok` holds, stroked on the ground map. */
  _strokeRuns(g, pts, ok, style, width) {
    g.strokeStyle = style;
    g.lineWidth = width;
    let open = false;
    g.beginPath();
    for (const [x, z] of pts) {
      if (!ok(x, z)) {
        open = false;
        continue;
      }
      if (open) g.lineTo(x, z);
      else g.moveTo(x, z);
      open = true;
    }
    g.stroke();
  }

  _clearOf(x, z, margin) {
    return !this.field.blockedAt(x, z) && this.keepOut.every((o) => Math.hypot(x - o.x, z - o.z) > o.r + margin);
  }

  /** Winding dirt trails across the infield. */
  _paintTrails(g) {
    const F = this.field;
    const rand = rng(this.seed * 31 + 7);
    const infield = [];
    for (let k = 0; k < F.res * F.res; k += 7) if (F.inside[k] && F.dist[k] > this.wd + 20) infield.push(k);
    if (infield.length < 2) return;
    const cellPos = (k) => [F.x0 + ((k % F.res) + 0.5) * F.cell, F.z0 + (((k / F.res) | 0) + 0.5) * F.cell];
    const ok = (x, z) => F.insideAt(x, z) && F.distAt(x, z) > this.wd + 6 && this._clearOf(x, z, 4);
    for (let t = 0; t < (this.cfg.trails ?? 9); t++) {
      const [ax, az] = cellPos(infield[(rand() * infield.length) | 0]);
      const [bx, bz] = cellPos(infield[(rand() * infield.length) | 0]);
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 120) continue;
      const pts = [];
      const nx = -(bz - az) / len;
      const nz = (bx - ax) / len;
      const wob = 15 + rand() * 25;
      for (let s = 0; s <= len; s += 4) {
        const w = (noise(s / 90, t * 3.7, this.seed + 41) - 0.5) * 2 * wob * Math.sin((Math.PI * s) / len);
        pts.push([mix(ax, bx, s / len) + nx * w, mix(az, bz, s / len) + nz * w]);
      }
      this._strokeRuns(g, pts, ok, this.col.trail, 2.6 + rand());
    }
  }

  /**
   * Grey service roads winding round the outside of the circuit: contours of
   * the distance field (so they never fold back at tight corners), wobbled
   * with noise so they wander through the hills.
   */
  _paintServiceRoads(g) {
    const F = this.field;
    const r = F.res;
    for (const [base, amp, seed, keep] of [[40, 16, 51, 1], [125, 45, 52, 0.55]]) {
      const lvl = new Float32Array(r * r);
      for (let j = 0; j < r; j++)
        for (let i = 0; i < r; i++) {
          const x = F.x0 + (i + 0.5) * F.cell;
          const z = F.z0 + (j + 0.5) * F.cell;
          const k = j * r + i;
          lvl[k] = F.dist[k] - (this.wd + base + (fbm(x / 160, z / 160, this.seed + seed) - 0.5) * 2 * amp);
        }
      const segs = [];
      const pt = (i, j, a, b) => [F.x0 + (i + 0.5 + a) * F.cell, F.z0 + (j + 0.5 + b) * F.cell];
      for (let j = 0; j < r - 1; j++)
        for (let i = 0; i < r - 1; i++) {
          const k = j * r + i;
          const v = [lvl[k], lvl[k + 1], lvl[k + r + 1], lvl[k + r]]; // corners 00, 10, 11, 01
          const c = [[0, 0], [1, 0], [1, 1], [0, 1]];
          const hits = [];
          for (let e = 0; e < 4; e++) {
            const a = v[e];
            const b = v[(e + 1) % 4];
            if (a < 0 !== b < 0) {
              const t = a / (a - b);
              const [ax, az] = c[e];
              const [bx, bz] = c[(e + 1) % 4];
              hits.push(pt(i, j, mix(ax, bx, t), mix(az, bz, t)));
            }
          }
          for (let h = 0; h + 1 < hits.length; h += 2) segs.push([hits[h], hits[h + 1]]);
        }
      const ok = ([x, z]) =>
        !F.insideAt(x, z) && this._clearOf(x, z, 4) && (keep >= 1 || noise(x / 260, z / 260, this.seed + seed + 3) < keep);
      for (const [style, width] of [['#8b867c', 7.5], [this.col.road, 6]]) {
        g.strokeStyle = style;
        g.lineWidth = width;
        g.beginPath();
        for (const [a, b] of segs) {
          if (!ok(a) || !ok(b)) continue;
          g.moveTo(a[0], a[1]);
          g.lineTo(b[0], b[1]);
        }
        g.stroke();
      }
    }
  }

  _paintPaddock(g) {
    const P = this.paddock;
    if (!P) return;
    const quad = (u0, u1, v0, v1) => {
      g.beginPath();
      for (const [u, v] of [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]) {
        const [x, z] = this._at(P.f, u, P.side * v);
        g.lineTo(x, z);
      }
      g.closePath();
    };
    // Pit lane apron and the paddock itself.
    g.fillStyle = '#8e9092';
    quad(-P.L / 2 - 20, P.L / 2 + 10, this.wd + 1, P.v0);
    g.fill();
    g.fillStyle = this.col.paddock;
    quad(-P.L / 2, P.L / 2, P.v0, P.v0 + P.D);
    g.fill();
    // Parking bay lines.
    g.strokeStyle = 'rgba(245,245,240,0.8)';
    g.lineWidth = 0.25;
    for (let u = -P.L / 2 + 6; u < P.L / 2 - 4; u += 4) {
      g.beginPath();
      const [ax, az] = this._at(P.f, u, P.side * (P.v0 + P.D - 22));
      const [bx, bz] = this._at(P.f, u, P.side * (P.v0 + P.D - 30));
      g.moveTo(ax, az);
      g.lineTo(bx, bz);
      g.stroke();
    }
    // Rubber from the skid-pad loops.
    g.strokeStyle = 'rgba(40,40,42,0.35)';
    g.lineWidth = 0.6;
    const [sx, sz] = this._at(P.f, P.L / 2 - 30, P.side * (P.v0 + P.D - 26));
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      g.ellipse(sx + (i % 2 ? 9 : -9), sz, 8 + i * 0.6, 7 + i * 0.4, 0, 0, Math.PI * 2);
      g.stroke();
    }
    // Octagonal lawns.
    for (const lw of this.lawns ?? []) {
      g.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = lw.yaw + Math.PI / 8 + (i * Math.PI) / 4;
        g.lineTo(lw.x + Math.cos(a) * lw.r, lw.z + Math.sin(a) * lw.r);
      }
      g.closePath();
      g.fillStyle = this.col.lawn;
      g.fill();
      g.strokeStyle = this.col.lawnEdge;
      g.lineWidth = 1.2;
      g.stroke();
    }
  }

  /** Fields, golf course, town ground, service roads and the oval, painted on the ground map. */
  _paintFeatures(g) {
    const F = this.field;
    const cfg = this.cfg;
    const wd = this.wd;
    const C = this.col;
    const path = (poly) => {
      g.beginPath();
      poly.forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z)));
      g.closePath();
    };
    for (const fl of cfg.fields ?? []) {
      path(fl.poly);
      g.fillStyle = fl.kind === 'lawn' ? C.lawnField : fl.kind === 'orchard' ? C.orchard : C.plantation;
      g.fill();
      if (fl.kind !== 'lawn') continue;
      // Mowing stripes.
      g.save();
      path(fl.poly);
      g.clip();
      g.fillStyle = 'rgba(255,255,230,0.07)';
      const xs = fl.poly.map((p) => p[0]);
      const zs = fl.poly.map((p) => p[1]);
      for (let x = Math.min(...xs); x < Math.max(...xs); x += 24) g.fillRect(x, Math.min(...zs), 12, Math.max(...zs) - Math.min(...zs));
      g.restore();
    }
    for (const tw of cfg.town ?? []) {
      path(tw.poly);
      g.fillStyle = C.town;
      g.fill();
    }
    for (const h of this.houses ?? []) {
      g.fillStyle = 'rgba(70,90,50,0.35)'; // gardens
      g.fillRect(h.x - h.w, h.z - h.d, h.w * 2, h.d * 2);
    }
    for (const hole of this.golf ?? []) {
      for (const [style, width] of [[C.rough, hole.w + 10], [C.fairway, hole.w], [C.fairwayStripe, hole.w * 0.45]]) {
        g.strokeStyle = style;
        g.lineWidth = width;
        g.beginPath();
        hole.pts.forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z)));
        g.stroke();
      }
      g.fillStyle = C.green2;
      g.beginPath();
      g.arc(hole.green[0], hole.green[1], 15, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = C.bunker;
      for (const b of hole.bunkers) {
        g.beginPath();
        g.ellipse(b.x, b.z, b.rx, b.rz, b.rot, 0, Math.PI * 2);
        g.fill();
      }
    }
    const clearOfTrack = (x, z) => F.distAt(x, z) > wd + 4;
    for (const rd of cfg.roads ?? []) {
      const pts = [];
      for (let i = 0; i + 1 < rd.points.length; i++) {
        const [ax, az] = rd.points[i];
        const [bx, bz] = rd.points[i + 1];
        const len = Math.hypot(bx - ax, bz - az);
        for (let t = 0; t < len; t += 4) pts.push([mix(ax, bx, t / len), mix(az, bz, t / len)]);
      }
      pts.push(rd.points[rd.points.length - 1]);
      this._strokeRuns(g, pts, clearOfTrack, '#8b867c', (rd.width ?? 6) + 1.5);
      this._strokeRuns(g, pts, clearOfTrack, C.road, rd.width ?? 6);
    }
    if (this.oval) {
      const pts = [...this.oval.pts, this.oval.pts[0]];
      this._strokeRuns(g, pts, (x, z) => F.distAt(x, z) > wd + 1, C.concrete, this.oval.half * 2 + 2);
    }
  }

  _paintLake(g) {
    const L = this.lake;
    if (!L) return;
    for (const [style, grow] of [[this.col.bank, 9], [this.col.lakeBed, 2]]) {
      g.fillStyle = style;
      g.beginPath();
      for (let i = 0; i < 64; i++) {
        const a = (i / 64) * Math.PI * 2;
        const r = L.radius(a) + grow;
        g.lineTo(L.x + Math.cos(a) * r, L.z + Math.sin(a) * r);
      }
      g.closePath();
      g.fill();
    }
  }

  // ---- 3D objects ---------------------------------------------------------------

  build(root) {
    const shadows = this.opts.shadows;
    const boxes = new Boxes(this.track);
    this._buildPaddock(boxes);
    this._buildBridges(boxes);
    this._buildTown(boxes);
    this._buildOval(root);
    if (boxes.list.length) root.add(boxes.mesh(shadows));
    this._buildTrees(root);
    if (this.lake) {
      const L = this.lake;
      const shore = new THREE.Shape();
      for (let i = 0; i < 64; i++) {
        const a = (i / 64) * Math.PI * 2;
        const r = L.radius(a) + 4;
        shore[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, -Math.sin(a) * r);
      }
      const water = new THREE.Mesh(
        new THREE.ShapeGeometry(shore),
        new THREE.MeshStandardMaterial({ color: 0x55664f, roughness: 0.12, metalness: 0.2, transparent: true, opacity: 0.92 }),
      );
      water.rotation.x = -Math.PI / 2;
      water.position.set(L.x, L.level, L.z);
      root.add(water);
    }
  }

  /** Houses: walls plus a terracotta roof slab. */
  _buildTown(boxes) {
    const walls = [0xf1ece0, 0xe8dfcc, 0xf6f4ee, 0xe3d3b8, 0xd9cdb6];
    const roofs = [0xa4553a, 0xb5654a, 0x8e4a35, 0x9c9a96];
    const rand = rng(this.seed * 71);
    for (const h of this.houses ?? []) {
      boxes.add(h.x, h.z, h.yaw, h.w, h.h, h.d, walls[(rand() * walls.length) | 0]);
      const top = boxes.list[boxes.list.length - 1];
      boxes.add(h.x, h.z, h.yaw, h.w + 0.8, 0.9, h.d + 0.8, roofs[(rand() * roofs.length) | 0], top.y + h.h);
    }
  }

  /**
   * The old high-speed oval: a concrete ribbon that tilts up into steep
   * banking on the curves and rises over the circuit on a bridge where they
   * cross. Where it runs along the circuit (the shared straight) the circuit
   * itself stands in for it.
   */
  _buildOval(root) {
    const O = this.oval;
    if (!O) return;
    const track = this.track;
    const F = this.field;
    const wd = this.wd;
    const pts = O.pts;
    const n = pts.length;
    let cx = 0;
    let cz = 0;
    for (const [x, z] of pts) {
      cx += x / n;
      cz += z / n;
    }
    // Banking from curvature (flat on the straights).
    const bank = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const [ax, az] = pts[(i - 3 + n) % n];
      const [bx, bz] = pts[i];
      const [qx, qz] = pts[(i + 3) % n];
      const cross = (bx - ax) * (qz - bz) - (bz - az) * (qx - bx);
      const k = (2 * Math.abs(cross)) / (Math.hypot(bx - ax, bz - az) * Math.hypot(qx - bx, qz - bz) * Math.hypot(qx - ax, qz - az) + 1e-9);
      bank[i] = smooth(1 / 1200, 1 / 400, k);
    }
    const b2 = Float32Array.from(bank);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = -8; k <= 8; k++) sum += b2[(i + k + n) % n];
      bank[i] = sum / 17;
    }
    // Where it meets the circuit: long runs alongside are shared, short runs are crossings.
    const over = pts.map(([x, z]) => F.distAt(x, z) < wd + 3);
    const lift = new Float32Array(n);
    const skip = new Uint8Array(n);
    const startAt = over.findIndex((v) => !v);
    for (let k = 0; k < n; ) {
      const i = (startAt + k) % n;
      if (!over[i]) {
        k++;
        continue;
      }
      let len = 0;
      while (k + len < n && over[(startAt + k + len) % n]) len++;
      const mid = (startAt + k + Math.floor(len / 2)) % n;
      if (len * 4 < 70) {
        const [mx, mz] = pts[mid];
        const deck = track.roadY(mx, mz) + 7.5;
        for (let j = -40; j <= 40; j++) {
          const q = (mid + j + n) % n;
          const [x, z] = pts[q];
          const h = (deck - track.terrainHeight(x, z)) * smooth(30, 12, Math.abs(j) - len / 2);
          lift[q] = Math.max(lift[q], h);
        }
      } else {
        for (let j = 0; j < len; j++) skip[(startAt + k + j) % n] = 1;
      }
      k += len;
    }
    for (let i = 0; i < n; i++) if (F.distAt(...pts[i]) < wd + 1.5 && lift[i] < 5) skip[i] = 1;

    const pos = [];
    const uv = [];
    const idx = [];
    const rail = [];
    const railIdx = [];
    const quad = (list, ids, a, b, c, d, u0, u1) => {
      const base = list.length / 3;
      list.push(...a, ...b, ...c, ...d);
      if (ids === idx) uv.push(u0, 0, u1, 0, u0, 1, u1, 1);
      ids.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    };
    let s = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const seg = Math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]);
      if (skip[i] || skip[j]) {
        s += seg;
        continue;
      }
      const edge = (q) => {
        const [x, z] = pts[q];
        const [px, pz] = pts[(q - 1 + n) % n];
        const [nx2, nz2] = pts[(q + 1) % n];
        let ox = -(nz2 - pz);
        let oz = nx2 - px;
        const l = Math.hypot(ox, oz);
        ox /= l;
        oz /= l;
        if (ox * (x - cx) + oz * (z - cz) < 0) {
          ox = -ox;
          oz = -oz;
        }
        const ix = x - ox * O.half;
        const iz = z - oz * O.half;
        const ex = x + ox * O.half;
        const ez = z + oz * O.half;
        const base = lift[q] + 0.06;
        return {
          inner: [ix, track.terrainHeight(ix, iz) + base, iz],
          outer: [ex, track.terrainHeight(ex, ez) + base + O.bank * bank[q], ez],
          innerGround: [ix, track.terrainHeight(ix, iz) - 0.3, iz],
          outerGround: [ex, track.terrainHeight(ex, ez) - 0.3, ez],
          overRoad: F.distAt(x, z) < wd + 2,
        };
      };
      const A = edge(i);
      const B = edge(j);
      const u0 = s / 10;
      const u1 = (s + seg) / 10;
      s += seg;
      // Running surface (faces up), then the walls underneath where it is raised.
      quad(pos, idx, A.inner, B.inner, A.outer, B.outer, u0, u1);
      const raisedOut = A.outer[1] - A.outerGround[1] > 0.6 || B.outer[1] - B.outerGround[1] > 0.6;
      const raisedIn = A.inner[1] - A.innerGround[1] > 0.6 || B.inner[1] - B.innerGround[1] > 0.6;
      const open = A.overRoad || B.overRoad; // leave the span over the circuit open
      if (raisedOut && !open) quad(pos, idx, A.outerGround, B.outerGround, A.outer, B.outer, u0, u1);
      if (raisedIn && !open) quad(pos, idx, A.inner, B.inner, A.innerGround, B.innerGround, u0, u1);
      // Guard rail along the top of the banking.
      const up = (p, h) => [p[0], p[1] + h, p[2]];
      if (bank[i] > 0.2 || lift[i] > 1) {
        quad(rail, railIdx, A.outer, B.outer, up(A.outer, 1.1), up(B.outer, 1.1));
        if (lift[i] > 1) quad(rail, railIdx, A.inner, B.inner, up(A.inner, 1.1), up(B.inner, 1.1));
      }
    }
    const tex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const cg = c.getContext('2d');
      cg.fillStyle = '#b7b4ab';
      cg.fillRect(0, 0, 128, 128);
      const rr = rng(this.seed + 99);
      for (let i = 0; i < 1400; i++) {
        const v = 150 + rr() * 60;
        cg.fillStyle = `rgba(${v},${v},${v - 6},0.5)`;
        cg.fillRect(rr() * 128, rr() * 128, 2, 2);
      }
      // Slab joints and weather streaks.
      cg.fillStyle = 'rgba(60,60,55,0.35)';
      cg.fillRect(0, 0, 2, 128);
      for (let i = 0; i < 6; i++) {
        cg.fillStyle = `rgba(80,78,70,${0.06 + rr() * 0.08})`;
        cg.fillRect(rr() * 128, 0, 3 + rr() * 8, 128);
      }
      const t = new THREE.CanvasTexture(c);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      return t;
    })();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const concrete = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    concrete.receiveShadow = concrete.castShadow = this.opts.shadows;
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(rail, 3));
    rg.setIndex(railIdx);
    rg.computeVertexNormals();
    root.add(concrete, new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ color: 0x8a9096, roughness: 0.5, metalness: 0.5, side: THREE.DoubleSide })));
  }

  _buildPaddock(boxes) {
    const P = this.paddock;
    if (!P) return;
    const rand = rng(this.seed * 13 + 3);
    const yaw = Math.atan2(P.f.tx, P.f.tz);
    const at = (u, v) => this._at(P.f, u, P.side * v);
    const liveries = [0xf4f4f2, 0xf4f4f2, 0xf4f4f2, 0xe9ebee, 0xc9ccd1, 0x1d1f24, 0x1d1f24, 0xc8102e, 0x1f4e9c, 0xf2b705];
    // Transporters backed up to the pits (more rows in a big paddock): trailer + cab.
    const rowGap = 24;
    for (let r = 0; r < P.rows && P.v0 + 3 + r * rowGap + 17 < P.v0 + P.D - 20; r++) {
      const v = P.v0 + 3 + r * rowGap;
      for (let u = -P.L / 2 + 8; u <= P.L / 2 - 8; u += 6.5) {
        if (rand() < 0.15) continue;
        const col = liveries[(rand() * liveries.length) | 0];
        const [tx, tz] = at(u, v + 6.8);
        boxes.add(tx, tz, yaw + Math.PI / 2, 2.55, 4, 13.6, col);
        const [cx, cz] = at(u, v + 13.6 + 1.6);
        boxes.add(cx, cz, yaw + Math.PI / 2, 2.5, 3.6, 2.4, col === 0x1d1f24 ? 0x2a2c30 : 0xf0f0ee);
      }
    }
    const vanStart = P.v0 + Math.min(P.rows, 3) * rowGap;
    if (P.D >= 55) {
      // Hospitality units and team buildings along the back of the paddock.
      let u = -P.L / 2 + 4;
      while (u < P.L / 2 - 20) {
        const len = 22 + rand() * 18;
        const h = 5 + rand() * 4;
        const [bx, bz] = at(u + len / 2, P.v0 + P.D - 11);
        boxes.add(bx, bz, yaw, 12, h, len, 0xf6f7f8);
        // Dark glazing band.
        const [gx, gz] = at(u + len / 2, P.v0 + P.D - 17.05);
        boxes.add(gx, gz, yaw, 0.15, h * 0.35, len - 2, 0x2c3a46, boxes.list[boxes.list.length - 1].y + h * 0.45);
        u += len + 6;
      }
      // Scattered vans and cars.
      for (let i = 0; i < Math.round((26 * P.L) / 150); i++) {
        const [x, z] = at(-P.L / 2 + 8 + rand() * (P.L - 16), vanStart + rand() * Math.max(4, P.v0 + P.D - 26 - vanStart));
        const van = rand() < 0.4;
        boxes.add(x, z, yaw + (rand() < 0.5 ? 0 : Math.PI / 2), 1.9, van ? 2.4 : 1.4, van ? 5.5 : 4.4, liveries[(rand() * liveries.length) | 0]);
      }
    }
  }

  _buildBridges(boxes) {
    const track = this.track;
    const span = this.wd + 3;
    for (const s of this.bridges) {
      const f = track.frameAt(s);
      const yaw = Math.atan2(f.tx, f.tz);
      const deckY = track.heightAtS(s) + 6.2;
      const steel = 0x2d3238;
      // Stair towers either side, then the deck and its side screens.
      for (const side of [-1, 1]) {
        const x = f.x + f.nx * side * (span + 2);
        const z = f.z + f.nz * side * (span + 2);
        const y = track.terrainHeight(x, z) - 0.3;
        boxes.add(x, z, yaw, 4, Math.max(1, deckY + 1.6 - y), 4, 0x3a4048, y);
      }
      const len = 2 * (span + 4);
      boxes.add(f.x, f.z, yaw + Math.PI / 2, 2.8, 0.5, len, steel, deckY);
      for (const e of [-1.35, 1.35]) {
        boxes.add(f.x + f.tx * e, f.z + f.tz * e, yaw + Math.PI / 2, 0.12, 1.5, len, 0x454c55, deckY + 0.5);
      }
      this.keepOut.push({ x: f.x, z: f.z, r: span + 8 });
    }
  }

  _buildTrees(root) {
    const track = this.track;
    const F = this.field;
    const wd = this.wd;
    const q = this.opts.quality;
    const dens = this.cfg.trees ?? 1;
    const forestCount = Math.round((q === 'low' ? 900 : q === 'medium' ? 1700 : 2600) * dens);
    const oliveCount = Math.round((q === 'low' ? 140 : 320) * (this.cfg.olives ?? 1));
    const pineShare = this.cfg.pines ?? 0.3;
    const rand = rng(this.seed * 101 + 9);
    const trees = []; // { x, z, s, kind: 0 broadleaf / 1 pine / 2 olive }
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < track.count; i++) {
      minX = Math.min(minX, track.px[i]);
      maxX = Math.max(maxX, track.px[i]);
      minZ = Math.min(minZ, track.pz[i]);
      maxZ = Math.max(maxZ, track.pz[i]);
    }
    const pad = this.cfg.forestRange ?? 380;
    const grid = this.forestGrid;
    const startClear = (x, z) => {
      const qr = track.query(x, z);
      const s = qr.s > track.length / 2 ? qr.s - track.length : qr.s;
      return !(s > -160 && s < 130 && qr.distance < wd + 30);
    };
    let attempts = 0;
    let forest = 0;
    while (forest < forestCount && attempts++ < forestCount * 40) {
      let x;
      let z;
      if (this.cfg.forestNear && rand() < 0.65) {
        // Most of the trees go where they are seen: close to the circuit.
        const i = (rand() * track.count) | 0;
        const lat = (rand() < 0.5 ? -1 : 1) * (wd + 8 + pad * rand() ** 1.8);
        x = track.px[i] + track.nx[i] * lat;
        z = track.pz[i] + track.nz[i] * lat;
      } else {
        x = mix(minX - pad, maxX + pad, rand());
        z = mix(minZ - pad, maxZ + pad, rand());
      }
      const d = F.distAt(x, z);
      if (d < wd + 9 || d > pad) continue;
      const cover = grid ? F.sample(grid, x, z) : this._forestAt(x, z, d, F.insideAt(x, z));
      if (rand() > cover * (1 - smooth(pad * 0.6, pad, d) * 0.6)) continue;
      if (!this._clearOf(x, z, 2) || !startClear(x, z)) continue;
      trees.push({ x, z, s: 0.8 + rand() * 0.7, kind: rand() < pineShare ? 1 : 0 });
      forest++;
    }
    attempts = 0;
    let olives = 0;
    while (olives < oliveCount && attempts++ < oliveCount * 60) {
      const x = mix(minX, maxX, rand());
      const z = mix(minZ, maxZ, rand());
      if (!F.insideAt(x, z) || F.distAt(x, z) < wd + 7) continue;
      const sd = this.sandGrid ? F.sample(this.sandGrid, x, z) : 0;
      if (rand() < sd * 0.8 || !this._clearOf(x, z, 3) || !startClear(x, z)) continue;
      trees.push({ x, z, s: 0.6 + rand() * 0.45, kind: 2 });
      olives++;
    }
    // Orchard rows, plantations and tree-lined avenues.
    for (const t of this.extraTrees) if (F.distAt(t.x, t.z) > wd + 6) trees.push(t);

    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.32, 2.6, 5);
    trunkGeo.translate(0, 1.3, 0);
    const crownGeo = new THREE.IcosahedronGeometry(1, 0);
    crownGeo.scale(2.8, 2.3, 2.8);
    crownGeo.translate(0, 4.4, 0);
    const pineGeo = new THREE.ConeGeometry(2.3, 8, 6);
    pineGeo.translate(0, 6, 0);
    const leafMat = () => new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true });
    const nCrown = trees.filter((t) => t.kind !== 1).length;
    const nPine = trees.length - nCrown;
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x5d4630, roughness: 1 }), trees.length);
    const crowns = new THREE.InstancedMesh(crownGeo, leafMat(), Math.max(1, nCrown));
    const pines = new THREE.InstancedMesh(pineGeo, leafMat(), Math.max(1, nPine));
    const m = new THREE.Matrix4();
    const qt = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const sc = new THREE.Vector3();
    const p = new THREE.Vector3();
    const color = new THREE.Color();
    let ic = 0;
    let ip = 0;
    trees.forEach((t, i) => {
      p.set(t.x, this.track.terrainHeight(t.x, t.z) - 0.25, t.z);
      qt.setFromAxisAngle(up, rand() * Math.PI * 2);
      const wide = t.kind === 2 ? 1.25 : 1;
      const big = t.kind === 2 ? 1 : this.cfg.treeScale ?? 1;
      sc.set(t.s * wide * big, t.s * (0.85 + rand() * 0.35) * big, t.s * wide * big);
      m.compose(p, qt, sc);
      trunks.setMatrixAt(i, m);
      if (t.kind === 1) {
        color.setHSL(0.24 + rand() * 0.04, 0.45, 0.16 + rand() * 0.06);
        pines.setMatrixAt(ip, m);
        pines.setColorAt(ip++, color);
      } else {
        if (t.kind === 2) color.setHSL(0.19 + rand() * 0.03, 0.34, 0.25 + rand() * 0.05);
        else color.setHSL(0.19 + rand() * 0.06, 0.45, 0.18 + rand() * 0.07);
        crowns.setMatrixAt(ic, m);
        crowns.setColorAt(ic++, color);
      }
    });
    crowns.count = ic;
    pines.count = ip;
    const shadows = this.opts.shadows;
    crowns.castShadow = pines.castShadow = shadows;
    root.add(trunks, crowns, pines);
  }
}
