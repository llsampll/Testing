// Builds the 3D environment for a track: road, kerbs, barriers, scenery,
// start gantry and the Forza-style dynamic driving line.
import * as THREE from '../vendor/three.module.min.js';
import { ROAD_LIFT } from '../track/track.js';

/** Height of the terrain under a point, plus a little lift for hilly tracks (0 when flat). */
function lift(track, x, z) {
  return track.terrain ? track.terrainHeight(x, z) + ROAD_LIFT - 0.04 : 0;
}

function canvasTexture(size, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function asphaltTexture() {
  return canvasTexture(256, (g, n) => {
    g.fillStyle = '#4a4c50';
    g.fillRect(0, 0, n, n);
    const img = g.getImageData(0, 0, n, n);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = (Math.random() - 0.5) * 22;
      img.data[i] += v;
      img.data[i + 1] += v;
      img.data[i + 2] += v;
    }
    g.putImageData(img, 0, 0);
    // Darker rubbered-in band where the cars drive.
    g.fillStyle = 'rgba(20,20,22,0.18)';
    g.fillRect(n * 0.3, 0, n * 0.4, n);
  });
}

function grassTexture(color) {
  const base = new THREE.Color(color);
  return canvasTexture(256, (g, n) => {
    g.fillStyle = `#${base.getHexString()}`;
    g.fillRect(0, 0, n, n);
    for (let i = 0; i < 2600; i++) {
      const c = base.clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.08);
      g.fillStyle = `#${c.getHexString()}`;
      g.fillRect(Math.random() * n, Math.random() * n, 2 + Math.random() * 3, 2 + Math.random() * 3);
    }
    // Mowing stripes.
    g.fillStyle = 'rgba(255,255,255,0.035)';
    for (let x = 0; x < n; x += 64) g.fillRect(x, 0, 32, n);
  });
}

/** Ribbon along the track between two lateral offsets. */
function ribbon(track, inner, outer, { y = 0, vScale = 1 / 8, step = 1, filter = null, colors = null } = {}) {
  const pos = [];
  const uv = [];
  const col = [];
  const idx = [];
  const n = track.count;
  let run = -1;
  for (let i = 0; i <= n; i += step) {
    const k = i % n;
    const on = !filter || filter(k);
    if (!on) {
      run = -1;
      continue;
    }
    const px = track.px[k];
    const pz = track.pz[k];
    const nx = track.nx[k];
    const nz = track.nz[k];
    const a = typeof inner === 'function' ? inner(k) : inner;
    const b = typeof outer === 'function' ? outer(k) : outer;
    const base = pos.length / 3;
    // Several strips across the width, so the surface follows the terrain
    // mesh closely instead of cutting a straight chord across it.
    const steps = Math.max(1, Math.ceil(Math.abs(b - a) / 2.5));
    const v = i * track.spacing * vScale;
    const c = colors ? colors(k) : null;
    for (let j = 0; j <= steps; j++) {
      const lat = a + ((b - a) * j) / steps;
      const x = px + nx * lat;
      const z = pz + nz * lat;
      pos.push(x, y + lift(track, x, z), z);
      uv.push(j / steps, v);
      if (c) col.push(c.r, c.g, c.b);
    }
    // Counter-clockwise seen from above so the faces point up.
    if (run >= 0 && base - run === steps + 1) {
      for (let j = 0; j < steps; j++) idx.push(run + j, base + j, run + j + 1, run + j + 1, base + j, base + j + 1);
    }
    run = base;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (colors) geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // Ribbons can be wound either way depending on offsets; force normals up.
  const nrm = geo.attributes.normal;
  for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
  return geo;
}

/** Vertical wall ribbon at a lateral offset. */
function wall(track, offset, height, side) {
  const pos = [];
  const uv = [];
  const idx = [];
  const n = track.count;
  for (let i = 0; i <= n; i++) {
    const k = i % n;
    const x = track.px[k] + track.nx[k] * offset;
    const z = track.pz[k] + track.nz[k] * offset;
    const base = lift(track, x, z);
    pos.push(x, base, z, x, base + height, z);
    const v = i * track.spacing;
    uv.push(v / 4, 0, v / 4, 1);
    if (i > 0) {
      const a = (i - 1) * 2;
      const b = i * 2;
      if (side > 0) idx.push(a, b, a + 1, b, b + 1, a + 1);
      else idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function smoothAbsCurvature(track, radius) {
  const n = track.count;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let k = -radius; k <= radius; k++) m = Math.max(m, Math.abs(track.curvature[(i + k + n) % n]));
    out[i] = m;
  }
  return out;
}

export class TrackScene {
  /**
   * @param {THREE.Scene} scene
   * @param {import('../track/track.js').Track} track
   * @param {{shadows:boolean, quality:string}} opts
   */
  constructor(scene, track, opts) {
    this.scene = scene;
    this.track = track;
    this.root = new THREE.Group();
    scene.add(this.root);
    const theme = track.def.theme;
    const hw = track.halfWidth;
    const lowQ = opts.quality === 'low';

    // ---- Ground -----------------------------------------------------------
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < track.count; i++) {
      minX = Math.min(minX, track.px[i]);
      maxX = Math.max(maxX, track.px[i]);
      minZ = Math.min(minZ, track.pz[i]);
      maxZ = Math.max(maxZ, track.pz[i]);
    }
    this.bounds = { minX, maxX, minZ, maxZ };
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const size = Math.max(maxX - minX, maxZ - minZ) + 1600;
    const grassTex = grassTexture(theme.grass);
    grassTex.repeat.set(size / 24, size / 24);
    // Terrain: flat for flat circuits, otherwise a heightfield that rolls with
    // the road (kept a little below it so the road surface always wins).
    const T = track.ensureTerrain(lowQ ? 150 : 210);
    let groundGeo;
    if (T) {
      // Heightfield built from the exact grid the road is draped on.
      const n = T.n;
      const pos = new Float32Array(n * n * 3);
      const uv = new Float32Array(n * n * 2);
      for (let iz = 0; iz < n; iz++) {
        for (let ix = 0; ix < n; ix++) {
          const v = iz * n + ix;
          pos[v * 3] = T.x0 + ix * T.cell;
          pos[v * 3 + 1] = T.H[v];
          pos[v * 3 + 2] = T.z0 + iz * T.cell;
          uv[v * 2] = (ix * T.cell) / 24;
          uv[v * 2 + 1] = (iz * T.cell) / 24;
        }
      }
      const idx = new Uint32Array(T.seg * T.seg * 6);
      let o = 0;
      for (let iz = 0; iz < T.seg; iz++) {
        for (let ix = 0; ix < T.seg; ix++) {
          const v00 = iz * n + ix;
          const v10 = v00 + 1;
          const v01 = v00 + n;
          const v11 = v01 + 1;
          idx[o++] = v00; idx[o++] = v01; idx[o++] = v10; // up-facing, diagonal v01-v10
          idx[o++] = v10; idx[o++] = v01; idx[o++] = v11;
        }
      }
      groundGeo = new THREE.BufferGeometry();
      groundGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      groundGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      groundGeo.setIndex(new THREE.BufferAttribute(idx, 1));
      groundGeo.computeVertexNormals();
      grassTex.repeat.set(1, 1);
    } else {
      groundGeo = new THREE.PlaneGeometry(size, size);
      groundGeo.rotateX(-Math.PI / 2);
      groundGeo.translate(cx, -0.08, cz);
    }
    const ground = new THREE.Mesh(
      groundGeo,
      new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1, polygonOffset: true, polygonOffsetFactor: 6, polygonOffsetUnits: 6 }),
    );
    ground.receiveShadow = opts.shadows;
    this.root.add(ground);

    // ---- Road -------------------------------------------------------------
    const asphalt = asphaltTexture();
    asphalt.repeat.set(3, 3);
    const roadMat = new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.92, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const decal = { polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 };
    const road = new THREE.Mesh(ribbon(track, -hw, hw, { y: 0.04, vScale: 1 / hw / 2 }), roadMat);
    road.receiveShadow = opts.shadows;
    this.root.add(road);

    // Edge lines.
    const lineMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6, ...decal });
    this.root.add(new THREE.Mesh(ribbon(track, hw - 0.45, hw - 0.2, { y: 0.07 }), lineMat));
    this.root.add(new THREE.Mesh(ribbon(track, -hw + 0.2, -hw + 0.45, { y: 0.07 }), lineMat));

    // Kerbs on corners (red/white stripes).
    const curv = smoothAbsCurvature(track, 10);
    const isCorner = (k) => curv[k] > 1 / 170;
    const red = new THREE.Color(0xd62828);
    const white = new THREE.Color(0xf4f4f4);
    const stripe = (k) => (Math.floor(k / 1.5) % 2 === 0 ? red : white);
    const kerbMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, ...decal });
    const kw = track.kerbWidth;
    this.root.add(new THREE.Mesh(ribbon(track, hw - 0.05, hw + kw, { y: 0.07, filter: isCorner, colors: stripe }), kerbMat));
    this.root.add(new THREE.Mesh(ribbon(track, -hw - kw, -hw + 0.05, { y: 0.07, filter: isCorner, colors: stripe }), kerbMat));

    // Gravel / sand runoff band outside the kerbs on corners.
    const runoffMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(theme.grass).lerp(new THREE.Color(0xd8c9a3), 0.65), roughness: 1, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
    this.root.add(new THREE.Mesh(ribbon(track, hw + kw, track.wallDist - 1.5, { y: 0.02, filter: isCorner }), runoffMat));
    this.root.add(new THREE.Mesh(ribbon(track, -track.wallDist + 1.5, -hw - kw, { y: 0.02, filter: isCorner }), runoffMat));

    // ---- Barriers ---------------------------------------------------------
    const barrierTex = canvasTexture(64, (g, n) => {
      g.fillStyle = '#e8e8e8';
      g.fillRect(0, 0, n, n);
      g.fillStyle = '#1f5fbf';
      g.fillRect(0, n * 0.55, n, n * 0.25);
      g.fillStyle = '#c9c9c9';
      g.fillRect(0, 0, 2, n);
    });
    const barrierMat = new THREE.MeshStandardMaterial({ map: barrierTex, roughness: 0.8, side: THREE.DoubleSide });
    const wallOff = track.wallDist + 0.25;
    this.root.add(new THREE.Mesh(wall(track, wallOff, 1.1, 1), barrierMat));
    this.root.add(new THREE.Mesh(wall(track, -wallOff, 1.1, -1), barrierMat));

    // ---- Start line, grid, gantry ----------------------------------------
    const f0 = track.frameAt(0);
    const heading = Math.atan2(f0.tx, f0.tz);
    const checker = canvasTexture(128, (g, n) => {
      const cells = 8;
      for (let y = 0; y < 2; y++)
        for (let x = 0; x < cells; x++) {
          g.fillStyle = (x + y) % 2 ? '#111' : '#fafafa';
          g.fillRect((x * n) / cells, (y * n) / 2, n / cells, n / 2);
        }
    }, false);
    const startLine = new THREE.Mesh(new THREE.PlaneGeometry(track.width, 1.6), new THREE.MeshStandardMaterial({ map: checker, roughness: 0.7, ...decal }));
    startLine.rotation.order = 'YXZ';
    startLine.rotation.y = heading;
    startLine.rotation.x = -Math.PI / 2;
    startLine.position.set(f0.x, 0.08 + lift(track, f0.x, f0.z), f0.z);
    this.root.add(startLine);

    const gridMat = new THREE.MeshBasicMaterial({ color: 0xffffff, ...decal });
    for (let i = 0; i < 16; i++) {
      const row = Math.floor(i / 2);
      const side = i % 2 === 0 ? 1 : -1;
      const s = track.length - 8 - row * 9 - (i % 2) * 4.5 + 2.6;
      const f = track.frameAt(s);
      const lat = side * hw * 0.42;
      const mark = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.25), gridMat);
      mark.rotation.order = 'YXZ';
      mark.rotation.y = Math.atan2(f.tx, f.tz);
      mark.rotation.x = -Math.PI / 2;
      mark.position.set(f.x + f.nx * lat, 0.08 + lift(track, f.x + f.nx * lat, f.z + f.nz * lat), f.z + f.nz * lat);
      this.root.add(mark);
    }

    // Gantry with five start lights.
    const gantry = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.5, metalness: 0.6 });
    const span = track.width + 4;
    const postGeo = new THREE.BoxGeometry(0.5, 7, 0.5);
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(postGeo, steel);
      post.position.set((sx * span) / 2, 3.5, 0);
      gantry.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span, 1.4, 0.6), steel);
    beam.position.y = 6.6;
    gantry.add(beam);
    this.startLights = [];
    for (let i = 0; i < 5; i++) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff0000, emissiveIntensity: 0 });
      const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.42, 16), mat);
      lamp.position.set((i - 2) * 1.2, 6.6, -0.31);
      lamp.rotation.y = Math.PI;
      gantry.add(lamp);
      this.startLights.push(mat);
    }
    const banner = canvasTexture(512, (g, n) => {
      g.fillStyle = '#c1121f';
      g.fillRect(0, 0, n, n);
      g.fillStyle = '#fff';
      g.font = 'bold 150px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('APEX', n / 2, n / 2);
    }, false);
    const bannerMesh = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.2), new THREE.MeshBasicMaterial({ map: banner }));
    bannerMesh.position.set(0, 6.6, 0.31);
    gantry.add(bannerMesh);
    gantry.position.set(f0.x, lift(track, f0.x, f0.z), f0.z);
    gantry.rotation.y = heading;
    this.root.add(gantry);

    // ---- Scenery ----------------------------------------------------------
    this._buildGrandstands(track, f0, heading, opts);
    this._buildTrees(track, lowQ ? 260 : 650, opts);
    this._buildDistant(cx, cz, size, theme);

    // ---- Driving line (dynamic) -------------------------------------------
    this.lineSegments = 70;
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(this.lineSegments * 2 * 3), 3));
    lineGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(this.lineSegments * 2 * 3), 3));
    const lidx = [];
    for (let i = 0; i < this.lineSegments - 1; i++) {
      const a = i * 2;
      // Leave small gaps so the line reads as chevrons/dashes.
      if (i % 3 === 2) continue;
      lidx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    lineGeo.setIndex(lidx);
    this.drivingLine = new THREE.Mesh(
      lineGeo,
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    );
    this.drivingLine.frustumCulled = false;
    this.drivingLine.renderOrder = 2;
    this.root.add(this.drivingLine);
  }

  _buildGrandstands(track, f0, heading, opts) {
    const standMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.8 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
    const crowdTex = canvasTexture(128, (g, n) => {
      g.fillStyle = '#3d4450';
      g.fillRect(0, 0, n, n);
      const cols = ['#e63946', '#f1faee', '#a8dadc', '#457b9d', '#ffb703', '#2a9d8f', '#e76f51'];
      for (let i = 0; i < 900; i++) {
        g.fillStyle = cols[(Math.random() * cols.length) | 0];
        g.fillRect(Math.random() * n, Math.random() * n, 3, 3);
      }
    });
    crowdTex.repeat.set(6, 1);
    const crowdMat = new THREE.MeshStandardMaterial({ map: crowdTex, roughness: 1 });
    const len = 90;
    for (const [offsetS, side] of [[-40, 1], [60, -1]]) {
      const f = track.frameAt(offsetS);
      const lat = side * (track.wallDist + 6);
      const g = new THREE.Group();
      for (let step = 0; step < 6; step++) {
        const tier = new THREE.Mesh(new THREE.BoxGeometry(len, 0.9 + step * 0.9, 2), standMat);
        tier.position.set(0, (0.9 + step * 0.9) / 2, step * 2);
        g.add(tier);
        const crowd = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.9), crowdMat);
        crowd.position.set(0, 0.9 + step * 0.9 + 0.01, step * 2 - 0.5);
        crowd.rotation.x = -Math.PI / 2 - 0.6;
        g.add(crowd);
      }
      const roof = new THREE.Mesh(new THREE.BoxGeometry(len + 2, 0.3, 14), roofMat);
      roof.position.set(0, 9.5, 5);
      roof.castShadow = opts.shadows;
      g.add(roof);
      g.position.set(f.x + f.nx * lat, track.terrainHeight(f.x + f.nx * lat, f.z + f.nz * lat) - 0.3, f.z + f.nz * lat);
      // Face the track.
      g.rotation.y = Math.atan2(f.tx, f.tz) + (side > 0 ? Math.PI / 2 : -Math.PI / 2);
      this.root.add(g);
    }
    // Pit building on the outside of the start straight.
    const pit = new THREE.Mesh(new THREE.BoxGeometry(10, 6, 120), new THREE.MeshStandardMaterial({ color: 0xdfe3e8, roughness: 0.6 }));
    const fp = track.frameAt(track.length - 70);
    const latP = -(track.wallDist + 10);
    pit.position.set(fp.x + fp.nx * latP, 3 + track.terrainHeight(fp.x + fp.nx * latP, fp.z + fp.nz * latP) - 0.3, fp.z + fp.nz * latP);
    pit.rotation.y = Math.atan2(fp.tx, fp.tz);
    pit.castShadow = opts.shadows;
    this.root.add(pit);
  }

  _buildTrees(track, count, opts) {
    const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 2.4, 6);
    trunkGeo.translate(0, 1.2, 0);
    const leafGeo = new THREE.ConeGeometry(2.2, 6, 7);
    leafGeo.translate(0, 5, 0);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1 }), count);
    const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshStandardMaterial({ color: 0x2f6b34, roughness: 0.9 }), count);
    leaves.castShadow = opts.shadows;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const color = new THREE.Color();
    const query = {};
    let placed = 0;
    let attempts = 0;
    while (placed < count && attempts < count * 20) {
      attempts++;
      const i = (Math.random() * track.count) | 0;
      const side = Math.random() < 0.5 ? -1 : 1;
      const lat = side * (track.wallDist + 6 + Math.random() * 70);
      const x = track.px[i] + track.nx[i] * lat;
      const z = track.pz[i] + track.nz[i] * lat;
      track.query(x, z, -1, query);
      if (query.distance < track.wallDist + 5) continue;
      const sc = 0.7 + Math.random() * 0.8;
      p.set(x, track.terrainHeight(x, z) - 0.3, z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI);
      s.set(sc, sc * (0.8 + Math.random() * 0.5), sc);
      m.compose(p, q, s);
      trunks.setMatrixAt(placed, m);
      leaves.setMatrixAt(placed, m);
      color.setHSL(0.28 + Math.random() * 0.08, 0.45, 0.22 + Math.random() * 0.12);
      leaves.setColorAt(placed, color);
      placed++;
    }
    trunks.count = placed;
    leaves.count = placed;
    this.root.add(trunks, leaves);
  }

  _buildDistant(cx, cz, size, theme) {
    // Ring of low hills/mesas on the horizon.
    const hillMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(theme.ground).offsetHSL(0, -0.1, -0.08), roughness: 1, flatShading: true });
    const r = size * 0.42;
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2 + Math.random() * 0.1;
      const h = 30 + Math.random() * 70;
      const hill = new THREE.Mesh(new THREE.ConeGeometry(60 + Math.random() * 80, h, 6), hillMat);
      const hx = cx + Math.cos(a) * r;
      const hz = cz + Math.sin(a) * r;
      hill.position.set(hx, this.track.terrainHeight(hx, hz) + h / 2 - 2, hz);
      this.root.add(hill);
    }
  }

  /** Light up the start gantry: n lamps lit (0..5), or green when go. */
  setStartLights(n, go) {
    this.startLights.forEach((m, i) => {
      if (go) {
        m.emissive.setHex(0x00ff40);
        m.emissiveIntensity = 0;
      } else {
        m.emissive.setHex(0xff0000);
        m.emissiveIntensity = i < n ? 3 : 0;
      }
    });
  }

  /**
   * Update the driving line ahead of the player. Colors follow Forza's
   * convention: green = accelerate, yellow = lift, red = brake.
   */
  updateDrivingLine(visible, state, speedProfile) {
    this.drivingLine.visible = visible;
    if (!visible) return;
    const track = this.track;
    const pos = this.drivingLine.geometry.attributes.position;
    const col = this.drivingLine.geometry.attributes.color;
    const n = track.count;
    const u = state.vehicle.u;
    const start = state.trackIndex + 2;
    for (let i = 0; i < this.lineSegments; i++) {
      const k = (start + i * 2) % n;
      const x = track.rx[k];
      const z = track.rz[k];
      const nx = track.rnx[k];
      const nz = track.rnz[k];
      const w = 0.45;
      const y = 0.1 + lift(track, x, z);
      pos.setXYZ(i * 2, x + nx * w, y, z + nz * w);
      pos.setXYZ(i * 2 + 1, x - nx * w, y, z - nz * w);
      // Compare speed with what's needed at that point (and the distance left to slow down).
      const target = speedProfile[k];
      const excess = u - target;
      let r, g, b;
      if (excess > 4) [r, g, b] = [0.95, 0.12, 0.1];
      else if (excess > -2) [r, g, b] = [1, 0.8, 0.1];
      else [r, g, b] = [0.15, 0.85, 0.3];
      col.setXYZ(i * 2, r, g, b);
      col.setXYZ(i * 2 + 1, r, g, b);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.root);
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (m.map) m.map.dispose();
          m.dispose();
        }
      }
    });
  }
}
