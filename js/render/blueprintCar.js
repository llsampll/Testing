// Builds a car body from blueprint measurements (see blueprints.js).
//
// The body is lofted along the car's length. At every station the traced
// roof/wing height and plan-view width shape a proper cross-section: a tucked
// sill, rounded flanks, raised front wings with the bonnet dipping between
// them, a narrow glasshouse with tumblehome, and a crowned roof. Triangles
// are then split into paint, glass, carbon and black trim by position.
import * as THREE from '../vendor/three.module.min.js';

const HALF = 26; // points on each half of a cross-section (bottom centre -> top centre)

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (t) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
const lerp = (a, b, t) => a + (b - a) * t;

/** Linear interpolation of a station table at distance zb from the nose. */
function sample(stations, zb) {
  if (zb <= stations[0][0]) return stations[0];
  for (let i = 1; i < stations.length; i++) {
    if (zb <= stations[i][0]) {
      const [z0, t0, w0] = stations[i - 1];
      const [z1, t1, w1] = stations[i];
      const f = (zb - z0) / (z1 - z0);
      return [zb, t0 + (t1 - t0) * f, w0 + (w1 - w0) * f];
    }
  }
  return stations[stations.length - 1];
}

/**
 * Tidy the traced stations: drop the wing from the tail profile, end the body
 * at its real nose and tail faces (not the thin lip/diffuser slivers), and
 * smooth out pixel jitter so the surface reflects cleanly.
 */
function cleanStations(raw) {
  let st = raw.map((s) => s.slice());
  for (let i = 1; i < st.length; i++) if (st[i][0] > 4.15) st[i][1] = Math.min(st[i][1], st[i - 1][1]);
  st = st.filter((s) => s[1] >= 0.45);
  for (let pass = 0; pass < 4; pass++) {
    const c = st.map((s) => s.slice());
    for (let i = 1; i < st.length - 1; i++) {
      st[i][1] = (c[i - 1][1] + 2 * c[i][1] + c[i + 1][1]) / 4;
      st[i][2] = (c[i - 1][2] + 2 * c[i][2] + c[i + 1][2]) / 4;
    }
  }
  return st;
}

/** Catmull-Rom through 2D control points, then resample evenly by arc length. */
function smoothCurve(ctrl, count) {
  const dense = [];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)];
    const p1 = ctrl[i];
    const p2 = ctrl[i + 1];
    const p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
    for (let k = 0; k < 12; k++) {
      const t = k / 12;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      dense.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  dense.push(ctrl[ctrl.length - 1]);
  const cum = [0];
  for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
  const total = cum[cum.length - 1] || 1;
  const out = [];
  let j = 0;
  for (let i = 0; i < count; i++) {
    const s = (total * i) / (count - 1);
    while (j < cum.length - 2 && cum[j + 1] < s) j++;
    const w = (s - cum[j]) / (cum[j + 1] - cum[j] || 1);
    out.push([Math.max(0, lerp(dense[j][0], dense[j + 1][0], w)), lerp(dense[j][1], dense[j + 1][1], w)]);
  }
  out[0][0] = 0;
  out[count - 1][0] = 0;
  return out;
}

let carbonTex = null;
function carbonTexture() {
  if (carbonTex) return carbonTex;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  for (let y = 0; y < 32; y += 4) {
    for (let x = 0; x < 32; x += 4) {
      const even = ((x + y) / 4) % 2 === 0;
      const grad = g.createLinearGradient(x, y, x + 4, y + 4);
      grad.addColorStop(0, even ? '#2a2d31' : '#141619');
      grad.addColorStop(1, even ? '#141619' : '#2a2d31');
      g.fillStyle = grad;
      g.fillRect(x, y, 4, 4);
    }
  }
  carbonTex = new THREE.CanvasTexture(c);
  carbonTex.wrapS = carbonTex.wrapT = THREE.RepeatWrapping;
  carbonTex.repeat.set(30, 30);
  carbonTex.colorSpace = THREE.SRGBColorSpace;
  return carbonTex;
}

/** Multi-spoke centre-lock wheel with brake disc and caliper. */
export function buildWheel(radius, width, side, style = {}) {
  const rimMat = style.rimMat;
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.92 });
  const spin = new THREE.Group();
  const face = new THREE.Group();
  if (side < 0) face.rotation.y = Math.PI; // outer face toward the outside of the car
  spin.add(face);

  // Tire: lathe of a rounded-rectangle section around the axle.
  const hw = width / 2;
  const rIn = radius * 0.72;
  const prof = [];
  const steps = 6;
  prof.push(new THREE.Vector2(rIn, -hw + 0.01));
  for (let i = 0; i <= steps; i++) {
    const ang = (-Math.PI / 2) * (1 - i / steps);
    prof.push(new THREE.Vector2(radius - 0.035 + Math.cos(ang) * 0.035, -hw + 0.035 + Math.sin(ang) * 0.035));
  }
  for (let i = 0; i <= steps; i++) {
    const ang = (Math.PI / 2) * (i / steps);
    prof.push(new THREE.Vector2(radius - 0.035 + Math.cos(ang) * 0.035, hw - 0.035 + Math.sin(ang) * 0.035));
  }
  prof.push(new THREE.Vector2(rIn, hw - 0.01));
  const tireGeo = new THREE.LatheGeometry(prof.reverse(), 28);
  const tire = new THREE.Mesh(tireGeo, tireMat);
  tire.rotation.z = Math.PI / 2;
  tire.castShadow = true;
  face.add(tire);

  // Rim barrel and spokes on the outer face (+x).
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(rIn, rIn, width * 0.9, 24, 1, true), style.barrelMat);
  barrel.rotation.z = Math.PI / 2;
  face.add(barrel);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(rIn - 0.008, 0.012, 6, 28), rimMat);
  lip.rotation.y = Math.PI / 2;
  lip.position.x = hw - 0.02;
  face.add(lip);
  const spokeLen = rIn - 0.05;
  const spokeGeo = new THREE.BoxGeometry(0.03, spokeLen, 0.024);
  spokeGeo.translate(0, spokeLen / 2 + 0.05, 0);
  for (let i = 0; i < 10; i++) {
    for (const off of [-0.07, 0.07]) {
      const s = new THREE.Mesh(spokeGeo, rimMat);
      s.rotation.x = (i / 10) * Math.PI * 2 + off;
      s.position.x = hw - 0.045;
      face.add(s);
    }
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.05, 12), rimMat);
  hub.rotation.z = Math.PI / 2;
  hub.position.x = hw - 0.04;
  face.add(hub);
  const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 6), style.nutMat);
  nut.rotation.z = Math.PI / 2;
  nut.position.x = hw - 0.01;
  face.add(nut);

  // Brake disc + caliper do not spin.
  const fixed = new THREE.Group();
  if (side < 0) fixed.rotation.y = Math.PI;
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(rIn * 0.86, rIn * 0.86, 0.03, 24), style.discMat);
  disc.rotation.z = Math.PI / 2;
  disc.position.x = hw - 0.12;
  fixed.add(disc);
  const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.2, 0.11), style.caliperMat);
  caliper.position.set(hw - 0.09, rIn * 0.6, -rIn * 0.28);
  caliper.rotation.x = 0.45;
  fixed.add(caliper);
  return { spin, fixed };
}

/**
 * @param {object} bp      blueprint entry
 * @param {object} spec    car spec (wheelbase, frontWeight)
 * @param {object} mats    { paint, glass, chrome, head, tail }
 */
export function buildBlueprintBody(bp, spec, mats) {
  const group = new THREE.Group();
  const carbon = new THREE.MeshPhysicalMaterial({ map: carbonTexture(), roughness: 0.4, metalness: 0.1, clearcoat: 0.6, clearcoatRoughness: 0.1, envMapIntensity: 0.25 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.6 });
  const mesh = new THREE.MeshStandardMaterial({ color: 0x0b0c0d, roughness: 0.9 });

  const a = spec.wheelbase * (1 - spec.frontWeight); // CG -> front axle
  const k = spec.wheelbase / (bp.rearAxle - bp.frontAxle);
  const toZ = (zb) => a - (zb - bp.frontAxle) * k;
  const belt = bp.beltLine;
  const rFront = 0.345;
  const rRear = 0.36;
  const arches = [
    { zb: bp.frontAxle, r: rFront + 0.035, cy: rFront },
    { zb: bp.rearAxle, r: rRear + 0.035, cy: rRear },
  ];
  const clearance = 0.11;
  const inZone = (zb, [z0, z1]) => zb >= z0 && zb <= z1;
  const stations = cleanStations(bp.stations);
  const bodyEnd = stations[stations.length - 1][0];
  const at = (zb) => sample(stations, zb);

  // Bonnet dips between the raised front wings; the engine lid sits a touch below the rear haunches.
  const dipAt = (zb) => {
    const front = smoothstep((zb - 0.12) / 0.3) * (1 - smoothstep((zb - 1.05) / 0.35)) * 0.12;
    const rear = smoothstep((zb - 3.45) / 0.25) * (1 - smoothstep((zb - 4.3) / 0.2)) * 0.04;
    return front + rear;
  };

  const sectionAt = (zb) => {
    const [, top0, hw0] = at(zb);
    const tail = smoothstep((zb - (bodyEnd - 0.32)) / 0.32);
    const nose = 1 - smoothstep((zb - stations[0][0]) / 0.25);
    const hw = hw0 * (1 - 0.1 * tail - 0.06 * nose);
    const top = top0 - 0.05 * tail;
    let yb = clearance;
    for (const ar of arches) {
      const dz = Math.abs(zb - ar.zb);
      if (dz < ar.r) yb = Math.max(yb, ar.cy + Math.sqrt(ar.r * ar.r - dz * dz));
    }
    yb = Math.min(yb, top - 0.03);
    const cabin = smoothstep((top - belt) / 0.14);
    const lowerTop = lerp(top, Math.min(top, belt), cabin);
    const dip = dipAt(zb) * (1 - cabin);
    const fx = Math.max(0.05, hw - (zb < 2 ? 0.25 : 0.27)); // wing / haunch crest
    const h = Math.max(0.02, lowerTop - yb);
    const ctrl = [
      [0, yb],
      [hw * 0.9, yb],
      [hw * 0.975, yb + h * 0.22],
      [hw, yb + h * 0.62],
      [hw * 0.975, lowerTop - Math.min(0.05, h * 0.2)],
      [fx, lowerTop],
    ];
    const open = [
      [fx * 0.62, lowerTop - dip * 0.75],
      [fx * 0.3, lowerTop - dip],
      [0, lowerTop - dip],
    ];
    const cabinHW = Math.min(0.75, hw - 0.17);
    const roofHW = 0.55;
    const closed = [
      [cabinHW, belt + 0.02],
      [lerp(cabinHW, roofHW, 0.85), top - 0.07],
      [0, top],
    ];
    for (let i = 0; i < 3; i++) ctrl.push([lerp(open[i][0], closed[i][0], cabin), lerp(open[i][1], closed[i][1], cabin)]);
    return { pts: smoothCurve(ctrl, HALF), top, hw, yb, lowerTop, fx, cabinHW, cabin, dip };
  };

  // ---- Shell -------------------------------------------------------------
  const pos = [];
  const rings = [];
  const info = [];
  const ringSize = HALF * 2 - 2;
  for (const [zb] of stations) {
    const sec = sectionAt(zb);
    const z = toZ(zb);
    const start = pos.length / 3;
    // Right half bottom -> top (x negative), then left half top -> bottom.
    for (let i = 0; i < HALF; i++) pos.push(-sec.pts[i][0], sec.pts[i][1], z);
    for (let i = HALF - 2; i >= 1; i--) pos.push(sec.pts[i][0], sec.pts[i][1], z);
    rings.push(start);
    info.push({ zb, ...sec });
  }

  const groups = { paint: [], glass: [], carbon: [], trim: [] };
  for (let s = 0; s < rings.length - 1; s++) {
    const r0 = rings[s];
    const r1 = rings[s + 1];
    const A = info[s];
    const B = info[s + 1];
    const zb = (A.zb + B.zb) / 2;
    const top = (A.top + B.top) / 2;
    const fx = (A.fx + B.fx) / 2;
    const cabinHW = (A.cabinHW + B.cabinHW) / 2;
    const yb = (A.yb + B.yb) / 2;
    const lowerTop = (A.lowerTop + B.lowerTop) / 2;
    for (let i = 0; i < ringSize; i++) {
      const j = (i + 1) % ringSize;
      const ia = r0 + i, ib = r0 + j, ic = r1 + i, id = r1 + j;
      const x = Math.abs((pos[ia * 3] + pos[ib * 3] + pos[ic * 3] + pos[id * 3]) / 4);
      const y = (pos[ia * 3 + 1] + pos[ib * 3 + 1] + pos[ic * 3 + 1] + pos[id * 3 + 1]) / 4;
      let g = 'paint';
      if (y < Math.max(A.yb, B.yb) + 0.02 && x < Math.max(A.hw, B.hw) * 0.97) g = 'trim'; // floor / wheel wells
      else if (y < clearance + 0.13 && zb > bp.frontAxle + 0.45 && zb < bp.rearAxle - 0.45) g = 'trim'; // side skirts
      else if (y > belt + 0.035 && x < cabinHW + 0.03) {
        // Glasshouse: carbon roof, windscreen and rear glass on top between the
        // pillars, and a teardrop side window cut into the bodywork.
        const onTop = x < 0.46;
        if (inZone(zb, bp.roof) && onTop && y > top - 0.09) g = 'carbon';
        else if (inZone(zb, bp.windshield) && onTop && zb > bp.windshield[0] + 0.03) g = 'glass';
        else if (inZone(zb, bp.rearWindow) && onTop && x < 0.42) g = 'glass';
        else if (inZone(zb, bp.sideWindows) && !onTop && y < top - 0.05 && y > belt + 0.05) {
          // Side glass narrows toward the rear, following the roofline.
          const rearTaper = smoothstep((zb - (bp.sideWindows[1] - 0.45)) / 0.45);
          if (y > belt + 0.05 + rearTaper * (top - belt - 0.1) * 0.85) g = 'glass';
        } else if (inZone(zb, bp.roof) && onTop) g = 'carbon';
      } else if (zb > 0.14 && zb < bp.windshield[0] + 0.02 && x < fx * 0.72 && y > lowerTop - 0.16) {
        g = 'carbon'; // carbon bonnet between the wings
      }
      groups[g].push(ia, ib, ic, ib, id, ic);
    }
  }
  const capFan = (r, flip) => {
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < ringSize; i++) { cx += pos[(r + i) * 3]; cy += pos[(r + i) * 3 + 1]; cz += pos[(r + i) * 3 + 2]; }
    const c = pos.length / 3;
    pos.push(cx / ringSize, cy / ringSize, cz / ringSize);
    for (let i = 0; i < ringSize; i++) {
      const j = (i + 1) % ringSize;
      if (flip) groups.paint.push(c, r + j, r + i);
      else groups.paint.push(c, r + i, r + j);
    }
  };
  capFan(rings[0], true);
  capFan(rings[rings.length - 1], false);

  const order = ['paint', 'glass', 'carbon', 'trim'];
  const index = [];
  const geo = new THREE.BufferGeometry();
  for (let m = 0; m < order.length; m++) {
    geo.addGroup(index.length, groups[order[m]].length, m);
    for (const v of groups[order[m]]) index.push(v);
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  // Planar UVs (x, z) so the carbon weave has a sensible scale.
  const uv = [];
  for (let i = 0; i < pos.length / 3; i++) uv.push(pos[i * 3] * 0.5, pos[i * 3 + 2] * 0.5);
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const shell = new THREE.Mesh(geo, [mats.paint, mats.glass, carbon, trim]);
  shell.castShadow = true;
  group.add(shell);

  // ---- Details ----------------------------------------------------------
  const noseAt = (y) => {
    for (let zb = 0; zb < 1; zb += 0.004) if (at(zb)[1] >= y) return zb;
    return 0;
  };
  const tailAt = (y) => {
    for (let zb = bodyEnd; zb > bodyEnd - 1; zb -= 0.004) if (at(zb)[1] >= y) return zb;
    return bodyEnd;
  };
  const add = (geom, mat, x, y, zb, rot = [0, 0, 0]) => {
    const m = new THREE.Mesh(geom, mat);
    m.position.set(x, y, toZ(zb));
    m.rotation.set(rot[0], rot[1], rot[2]);
    group.add(m);
    return m;
  };
  const box = (w, h, d, mat, x, y, zb, rot) => add(new THREE.BoxGeometry(w, h, d), mat, x, y, zb, rot);

  // Big upright oval headlamps at the front of each wing, the bonnet dipping between.
  {
    const zb = 0.3;
    const sec = sectionAt(zb + 0.06);
    const bowlMat = new THREE.MeshStandardMaterial({ color: 0xc9d0d8, metalness: 1, roughness: 0.18 });
    const lensMat = new THREE.MeshPhysicalMaterial({ color: 0xdfe8f2, roughness: 0.05, transparent: true, opacity: 0.35, clearcoat: 1 });
    for (const side of [-1, 1]) {
      const lamp = new THREE.Group();
      const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.011, 8, 28), mats.chrome);
      const bowl = new THREE.Mesh(new THREE.CircleGeometry(0.135, 28), bowlMat);
      bowl.position.z = -0.01;
      const lens = new THREE.Mesh(new THREE.SphereGeometry(0.135, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), lensMat);
      lens.rotation.x = Math.PI / 2;
      lens.scale.set(1, 0.35, 1);
      lamp.add(bezel, bowl, lens);
      // Four-point LED daytime lights.
      for (const [dx, dy] of [[-0.05, 0.05], [0.05, 0.05], [-0.05, -0.05], [0.05, -0.05]]) {
        const led = new THREE.Mesh(new THREE.CircleGeometry(0.022, 10), mats.head);
        led.position.set(dx, dy, 0.005);
        lamp.add(led);
      }
      lamp.scale.set(1.15, 1.4, 1.1);
      lamp.position.set(side * (sec.fx + 0.02), sec.lowerTop - 0.1, toZ(zb) + 0.08);
      lamp.rotation.set(-0.38, side * 0.12, 0);
      group.add(lamp);
    }
  }
  // Nose: two big side intakes, a wide lower centre intake and a splitter.
  {
    const zIn = noseAt(0.4);
    const [, , hwN] = at(zIn + 0.1);
    for (const side of [-1, 1]) {
      const zs = noseAt(0.34) + 0.07;
      const [, , hws] = at(zs);
      box(0.4, 0.22, 0.05, mesh, side * (hws - 0.27), 0.33, zs - 0.02, [0, side * 0.35, 0]);
    }
    box(0.8, 0.12, 0.05, mesh, 0, 0.22, noseAt(0.26) - 0.005);
    box(hwN * 2 * 0.96, 0.025, 0.14, trim, 0, 0.11, noseAt(0.2) + 0.02);
    box(0.62, 0.02, 0.06, trim, 0, at(0.16)[1] - 0.02, 0.16); // front lid lip
  }
  // Two bonnet vents.
  for (const side of [-1, 1]) {
    const zb = 0.62;
    const sec = sectionAt(zb);
    box(0.17, 0.03, 0.3, mesh, side * 0.2, sec.lowerTop - sec.dip * 0.85 + 0.005, zb, [-0.12, 0, 0]);
  }
  // Louvres on top of the front wings.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      const zb = 0.8 + i * 0.05;
      const sec = sectionAt(zb);
      box(0.24, 0.015, 0.02, mesh, side * sec.fx, sec.lowerTop + 0.003, zb);
    }
  }
  // Door mirrors on carbon stalks.
  for (const side of [-1, 1]) {
    const zb = 1.86;
    const sec = sectionAt(zb);
    const m = add(new THREE.SphereGeometry(0.1, 14, 10), mats.paint, side * (sec.cabinHW + 0.16), belt + 0.1, zb);
    m.scale.set(0.9, 0.6, 1.1);
    box(0.13, 0.025, 0.05, carbon, side * (sec.cabinHW + 0.06), belt + 0.06, zb + 0.03);
  }
  // Door handles and the big intake ahead of the rear wheel.
  for (const side of [-1, 1]) {
    const sec = sectionAt(2.55);
    box(0.02, 0.025, 0.16, mats.chrome, side * (sec.hw + 0.005), 0.76, 2.55);
    const s2 = sectionAt(2.98);
    box(0.06, 0.26, 0.18, mesh, side * (s2.hw - 0.01), 0.7, 2.98, [0, 0, side * 0.08]);
  }
  // GT3rs script on the lower doors.
  {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#16181b';
    g.font = 'italic bold 44px sans-serif';
    g.textBaseline = 'middle';
    g.fillText('GT3rs', 8, 34);
    const mat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false });
    const sec = sectionAt(2.0);
    for (const side of [-1, 1]) {
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.105), mat);
      plate.position.set(side * (sec.hw * 0.995 + 0.006), 0.32, toZ(2.0));
      plate.rotation.y = (side * Math.PI) / 2;
      group.add(plate);
    }
  }
  // Rear: full-width light bar, lamp clusters, engine grille, diffuser, centre exhausts.
  {
    const y = 0.86;
    const zb = tailAt(y + 0.03);
    const [, , hw] = at(zb - 0.05);
    box(hw * 2 * 0.82, 0.03, 0.05, mats.tail, 0, y, zb - 0.015);
    for (const side of [-1, 1]) box(0.36, 0.09, 0.06, mats.tail, side * (hw * 0.82 - 0.2), y - 0.045, zb - 0.025);
    box(0.7, 0.13, 0.06, mesh, 0, y + 0.1, tailAt(y + 0.17) - 0.015);
    const zd = tailAt(0.27);
    const [, , hwd] = at(zd - 0.1);
    box(hwd * 2 * 0.78, 0.15, 0.07, mesh, 0, 0.2, zd - 0.02);
    const zp = tailAt(0.36);
    const pipeMat = mats.chrome.clone();
    pipeMat.side = THREE.DoubleSide;
    for (const side of [-1, 1]) add(new THREE.CylinderGeometry(0.052, 0.052, 0.16, 14, 1, true), pipeMat, side * 0.085, 0.35, zp + 0.03, [Math.PI / 2, 0, 0]);
  }
  // Swan-neck wing: tall uprights rise from the engine lid and hook over the wing.
  {
    const span = 1.66;
    const wingZb = 4.33;
    const wingY = 1.34;
    const wing = box(span, 0.04, 0.4, carbon, 0, wingY, wingZb, [-0.1, 0, 0]);
    wing.castShadow = true;
    box(span, 0.045, 0.015, carbon, 0, wingY + 0.035, wingZb + 0.2);
    const deckZb = 4.0;
    const deckTop = sectionAt(deckZb).lowerTop - dipAt(deckZb);
    for (const side of [-1, 1]) {
      box(0.018, 0.2, 0.46, carbon, side * (span / 2 + 0.009), wingY - 0.03, wingZb + 0.01);
      const x = side * 0.34;
      const h = wingY + 0.08 - deckTop;
      box(0.022, h, 0.1, carbon, x, deckTop + h / 2, deckZb + 0.12, [0.18, 0, 0]);
      box(0.022, 0.035, 0.24, carbon, x, wingY + 0.075, deckZb + 0.24);
    }
  }

  const front = sectionAt(bp.frontAxle - 0.6);
  const rear = sectionAt(bp.rearAxle + 0.6);
  return {
    group,
    width: Math.max(front.hw, rear.hw) * 2,
    length: bp.length * k,
    doorZ: toZ(2.25),
    doorHalfWidth: sectionAt(2.25).hw,
    wheels: {
      front: { x: at(bp.frontAxle)[2] - 0.15, r: rFront, w: 0.26 },
      rear: { x: at(bp.rearAxle)[2] - 0.18, r: rRear, w: 0.32 },
    },
  };
}
