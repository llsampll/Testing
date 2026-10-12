// Detailed surroundings for tracks with a `scenery` config: a painted ground
// map (dry grass, sandy patches, forest floor, service roads, dirt trails),
// dense forest outside the circuit, olive trees in the infield, a paddock
// with transporters and hospitality units, a pond, octagonal lawns and
// footbridges over the track.
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
    this.wd = track.wallDist;
    this.field = new Field(track, T, this.lowQ ? 320 : 448);
    this.keepOut = []; // areas trees stay out of: { x, z, r } circles
    this._planSites();
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
    const f = track.frameAt(track.length - 75);
    const side = this.cfg.paddockSide ?? 1; // +1 = left of travel
    const L = 150;
    const v0 = wd + 24;
    let D = 100;
    const ok = (D) => {
      for (let u = -L / 2; u <= L / 2; u += 10)
        for (let v = v0; v <= v0 + D; v += 10) {
          const [x, z] = this._at(f, u, side * v);
          if (F.distAt(x, z) < wd + 16) return false;
        }
      return true;
    };
    while (D > 30 && !ok(D)) D -= 10;
    this.paddock = D > 30 ? { f, side, L, v0, D } : null;
    if (this.paddock) {
      const [x, z] = this._at(f, 0, side * (v0 + D / 2));
      this.paddock.cx = x;
      this.paddock.cz = z;
      this.keepOut.push({ x, z, r: Math.hypot(L / 2, D / 2) + 8 });
      // Three octagonal lawns in a row beyond the paddock.
      this.lawns = [];
      for (const u of [-34, 0, 34]) {
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
    const res = F.res;
    for (let j = 2; j < res - 2; j += 2)
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
      if (this.bridges.length >= 4) break;
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
        sand[k] = smooth(0.53, 0.66, sr) * (ins ? 1 : 0.45) * smooth(wd + 3, wd + 12, d);
        forest[k] = this._forestAt(x, z, d, ins);
      }
    this.forestGrid = forest;
    this.sandGrid = sand;

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
          let v = mix(COL.green[c], COL.dry[c], t);
          v = mix(v, COL.sand[c], sd);
          v = mix(v, mix(COL.forest[c], COL.forest2[c], t), smooth(0.15, 0.6, fo));
          v = mix(v, COL.verge[c], verge);
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
    this._paintTrails(g);
    this._paintServiceRoads(g);
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
    const n = fbm(x / 150, z / 150, this.seed + 31);
    return (ins ? 0.25 : 1) * smooth(this.wd + 10, this.wd + 40, d) * smooth(0.4, 0.52, n);
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
    return this.keepOut.every((o) => Math.hypot(x - o.x, z - o.z) > o.r + margin);
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
    for (let t = 0; t < 9; t++) {
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
      this._strokeRuns(g, pts, ok, COL.trail, 2.6 + rand());
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
      for (const [style, width] of [['#8b867c', 7.5], [COL.road, 6]]) {
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
    g.fillStyle = COL.paddock;
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
      g.fillStyle = COL.lawn;
      g.fill();
      g.strokeStyle = COL.lawnEdge;
      g.lineWidth = 1.2;
      g.stroke();
    }
  }

  _paintLake(g) {
    const L = this.lake;
    if (!L) return;
    for (const [style, grow] of [[COL.bank, 9], [COL.lakeBed, 2]]) {
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

  _buildPaddock(boxes) {
    const P = this.paddock;
    if (!P) return;
    const rand = rng(this.seed * 13 + 3);
    const yaw = Math.atan2(P.f.tx, P.f.tz);
    const at = (u, v) => this._at(P.f, u, P.side * v);
    const liveries = [0xf4f4f2, 0xf4f4f2, 0xe9ebee, 0x1d1f24, 0xc8102e, 0x1f4e9c, 0xf2b705, 0x2f7d4a];
    // Transporters backed up to the pits: trailer + cab, nose toward the paddock.
    for (let u = -P.L / 2 + 8; u <= P.L / 2 - 8; u += 6.5) {
      if (rand() < 0.15) continue;
      const col = liveries[(rand() * liveries.length) | 0];
      const [tx, tz] = at(u, P.v0 + 3 + 6.8);
      boxes.add(tx, tz, yaw + Math.PI / 2, 2.55, 4, 13.6, col);
      const [cx, cz] = at(u, P.v0 + 3 + 13.6 + 1.6);
      boxes.add(cx, cz, yaw + Math.PI / 2, 2.5, 3.6, 2.4, col === 0x1d1f24 ? 0x2a2c30 : 0xf0f0ee);
    }
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
      for (let i = 0; i < 26; i++) {
        const [x, z] = at(-P.L / 2 + 8 + rand() * (P.L - 16), P.v0 + 24 + rand() * Math.max(4, P.D - 50));
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
    const forestCount = q === 'low' ? 900 : q === 'medium' ? 1700 : 2600;
    const oliveCount = q === 'low' ? 140 : 320;
    const rand = rng(this.seed * 101 + 9);
    const trees = []; // { x, z, s, kind: 0 broadleaf / 1 pine / 2 olive }
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < track.count; i++) {
      minX = Math.min(minX, track.px[i]);
      maxX = Math.max(maxX, track.px[i]);
      minZ = Math.min(minZ, track.pz[i]);
      maxZ = Math.max(maxZ, track.pz[i]);
    }
    const pad = 380;
    const grid = this.forestGrid;
    const startClear = (x, z) => {
      const qr = track.query(x, z);
      const s = qr.s > track.length / 2 ? qr.s - track.length : qr.s;
      return !(s > -160 && s < 130 && qr.distance < wd + 30);
    };
    let attempts = 0;
    let forest = 0;
    while (forest < forestCount && attempts++ < forestCount * 40) {
      const x = mix(minX - pad, maxX + pad, rand());
      const z = mix(minZ - pad, maxZ + pad, rand());
      const d = F.distAt(x, z);
      if (d < wd + 9 || d > pad) continue;
      const dens = grid ? F.sample(grid, x, z) : this._forestAt(x, z, d, F.insideAt(x, z));
      if (rand() > dens * (1 - smooth(pad * 0.6, pad, d) * 0.6)) continue;
      if (!this._clearOf(x, z, 2) || !startClear(x, z)) continue;
      trees.push({ x, z, s: 0.8 + rand() * 0.7, kind: rand() < 0.3 ? 1 : 0 });
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
      sc.set(t.s * wide, t.s * (0.85 + rand() * 0.35), t.s * wide);
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
