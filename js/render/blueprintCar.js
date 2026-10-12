// Builds a car body from blueprint measurements (see blueprints.js).
//
// The body is lofted along the car's length: at every station the cross
// section uses the traced roof height and plan-view width, rounded at the
// sills and shoulders and pulled in above the belt line (tumblehome) to form
// the glasshouse. Wheel arches are cut at the real axle positions, and
// triangles are split into paint and glass by the window zones.
import * as THREE from '../vendor/three.module.min.js';

const RING = 13; // vertical samples per side of each cross section

const smoothstep = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

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
 * @param {object} bp      blueprint entry
 * @param {object} spec    car spec (wheelbase, frontWeight)
 * @param {object} mats    { paint, glass, dark, chrome, head, tail }
 * @returns {{ group: THREE.Group, width: number, length: number, wheels: Array }}
 */
export function buildBlueprintBody(bp, spec, mats) {
  const group = new THREE.Group();
  const a = spec.wheelbase * (1 - spec.frontWeight); // CG -> front axle
  // Map blueprint distance-from-nose to car-local z (forward +z, CG at 0),
  // stretched slightly so the drawn axles land exactly on the physics axles.
  const k = spec.wheelbase / (bp.rearAxle - bp.frontAxle);
  const toZ = (zb) => a - (zb - bp.frontAxle) * k;
  const belt = bp.beltLine;
  const rFront = 0.34;
  const rRear = 0.36;
  const arches = [
    { zb: bp.frontAxle, r: rFront + 0.05, cy: rFront },
    { zb: bp.rearAxle, r: rRear + 0.05, cy: rRear },
  ];
  const clearance = 0.1;
  const inZone = (zb, [z0, z1]) => zb >= z0 && zb <= z1;

  const halfWidth = (hw, top, lowerTop, yb, y) => {
    let w = hw;
    // Tuck the sill under.
    w *= 0.9 + 0.1 * smoothstep((y - yb) / 0.2);
    // Round the top edge of the lower body: a full crown where the lid is
    // the top of the car (bonnet, engine lid), a gentle shoulder under the glass.
    const crown = Math.min(0.22, (lowerTop - yb) * 0.6);
    if (crown > 0 && y > lowerTop - crown) {
      const t = Math.min(1, (y - (lowerTop - crown)) / crown);
      const round = Math.pow(1 - Math.pow(t, 2.6), 1 / 2.6);
      w *= top <= belt + 0.02 ? 0.55 + 0.45 * round : 0.92 + 0.08 * round;
    }
    // Glasshouse: narrower than the body and leaning inward toward the roof.
    if (y > belt) {
      const cabin = Math.min(hw * 0.84, 0.74) - (y - belt) * 0.42;
      w = Math.min(w, cabin);
    }
    return Math.max(0.02, w);
  };

  const stations = bp.stations;
  const pos = [];
  const rings = [];
  const ringInfo = [];
  for (const [zb0] of stations) {
    const [zb, top, hw] = sample(stations, zb0);
    let yb = clearance;
    for (const ar of arches) {
      const dz = Math.abs(zb - ar.zb);
      if (dz < ar.r) yb = Math.max(yb, ar.cy + Math.sqrt(ar.r * ar.r - dz * dz));
    }
    yb = Math.min(yb, top - 0.02);
    const lowerTop = Math.min(top, belt);
    const ys = [];
    const nb = 9;
    for (let i = 0; i < nb; i++) ys.push(yb + ((lowerTop - yb) * i) / (nb - 1));
    for (let i = 1; i <= RING - nb; i++) ys.push(top > belt ? belt + ((top - belt) * i) / (RING - nb) : top);
    const z = toZ(zb);
    const start = pos.length / 3;
    const xs = ys.map((y) => halfWidth(hw, top, lowerTop, yb, y));
    // Right side bottom -> top, then left side top -> bottom.
    for (let i = 0; i < RING; i++) pos.push(-xs[i], ys[i], z);
    for (let i = RING - 1; i >= 0; i--) pos.push(xs[i], ys[i], z);
    rings.push(start);
    ringInfo.push({ zb, top, z });
  }

  // Faces between consecutive rings, sorted into paint / glass.
  const paintIdx = [];
  const glassIdx = [];
  const n = RING * 2;
  for (let s = 0; s < rings.length - 1; s++) {
    const r0 = rings[s];
    const r1 = rings[s + 1];
    const zbMid = (ringInfo[s].zb + ringInfo[s + 1].zb) / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ia = r0 + i, ib = r0 + j, ic = r1 + i, id = r1 + j;
      const yMid = (pos[ia * 3 + 1] + pos[ib * 3 + 1] + pos[ic * 3 + 1] + pos[id * 3 + 1]) / 4;
      const isRoofEdge = i === RING - 1; // the segment joining the two top points
      let glass = false;
      if (yMid > belt + 0.035) {
        if (isRoofEdge) glass = inZone(zbMid, bp.windshield) || inZone(zbMid, bp.rearWindow);
        else glass = inZone(zbMid, bp.sideWindows) || inZone(zbMid, bp.windshield) || inZone(zbMid, bp.rearWindow);
        // Keep a painted pillar between the windscreen and the side glass.
        if (!isRoofEdge && Math.abs(zbMid - bp.sideWindows[0]) < 0.06) glass = false;
      }
      const out = glass ? glassIdx : paintIdx;
      // Winding chosen so normals face outward.
      out.push(ia, ib, ic, ib, id, ic);
    }
  }
  // End caps.
  const capFan = (r, flip) => {
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) { cx += pos[(r + i) * 3]; cy += pos[(r + i) * 3 + 1]; cz += pos[(r + i) * 3 + 2]; }
    const c = pos.length / 3;
    pos.push(cx / n, cy / n, cz / n);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (flip) paintIdx.push(c, r + j, r + i);
      else paintIdx.push(c, r + i, r + j);
    }
  };
  capFan(rings[0], true);
  capFan(rings[rings.length - 1], false);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex([...paintIdx, ...glassIdx]);
  geo.addGroup(0, paintIdx.length, 0);
  geo.addGroup(paintIdx.length, glassIdx.length, 1);
  geo.computeVertexNormals();
  const shell = new THREE.Mesh(geo, [mats.paint, mats.glass]);
  shell.castShadow = true;
  group.add(shell);

  // ---- Details ----------------------------------------------------------
  const at = (zb) => sample(stations, zb);
  // Where the nose / tail surface is at a given height (distance from the nose).
  const noseAt = (y) => {
    for (let zb = 0; zb < 1; zb += 0.005) if (at(zb)[1] >= y) return zb;
    return 0;
  };
  const tailAt = (y) => {
    for (let zb = bp.length; zb > bp.length - 1; zb -= 0.005) if (at(zb)[1] >= y) return zb;
    return bp.length;
  };
  const box = (w, h, d, mat, x, y, zb, rx = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, toZ(zb));
    m.rotation.x = rx;
    group.add(m);
    return m;
  };

  // Round headlamps set into the front wings.
  {
    const zb = 0.42;
    const [, top, hw] = at(zb);
    for (const side of [-1, 1]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.022, 8, 20), mats.chrome);
      const lens = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), mats.head);
      const lamp = new THREE.Group();
      lens.rotation.x = Math.PI / 2;
      lens.scale.set(1, 0.55, 1);
      lamp.add(ring, lens);
      lamp.position.set(side * (hw - 0.3), top - 0.04, toZ(zb) + 0.02);
      lamp.rotation.x = -0.9; // follows the slope of the wing
      group.add(lamp);
    }
  }
  // Nose: three big intakes and a splitter lip.
  {
    const zIn = noseAt(0.42);
    const [, , hwN] = at(zIn + 0.08);
    box(0.7, 0.16, 0.12, mats.dark, 0, 0.32, zIn + 0.02);
    for (const side of [-1, 1]) box(0.36, 0.21, 0.12, mats.dark, side * (hwN - 0.24), 0.32, zIn + 0.05);
    box(hwN * 2 * 0.95, 0.03, 0.34, mats.dark, 0, 0.1, zIn + 0.08);
  }
  // Bonnet duct.
  {
    const [, top] = at(0.55);
    box(0.5, 0.012, 0.28, mats.dark, 0, top + 0.002, 0.55, -0.18);
  }
  // Louvres on top of the front wings.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const zb = 0.82 + i * 0.055;
      const [, top, hw] = at(zb);
      box(0.3, 0.018, 0.022, mats.dark, side * (hw - 0.27), top + 0.004, zb);
    }
  }
  // Door mirrors.
  for (const side of [-1, 1]) {
    const zb = 1.9; // measured from the plan view
    const [, , hw] = at(zb);
    const x = side * (Math.min(hw * 0.84, 0.74) + 0.13);
    box(0.17, 0.1, 0.13, mats.paint, x, 1.0, zb);
    box(0.12, 0.025, 0.05, mats.dark, side * (Math.abs(x) - 0.1), 0.96, zb + 0.02);
  }
  // Intakes ahead of the rear wheels.
  for (const side of [-1, 1]) {
    const zb = 2.95;
    const [, , hw] = at(zb);
    box(0.04, 0.12, 0.34, mats.dark, side * (hw * 0.98), 0.72, zb);
  }
  // Engine lid grille.
  {
    const [, top] = at(3.95);
    box(0.7, 0.012, 0.4, mats.dark, 0, top + 0.003, 3.95, 0.12);
  }
  // Full-width tail-light bar and corner lamps.
  {
    const y = 0.86;
    const zb = tailAt(y + 0.03);
    const [, , hw] = at(zb - 0.05);
    box(hw * 2 * 0.84, 0.045, 0.06, mats.tail, 0, y, zb - 0.01);
    for (const side of [-1, 1]) box(0.34, 0.1, 0.06, mats.tail, side * (hw * 0.84 - 0.2), y - 0.05, zb - 0.02);
    // Engine-cover grille between the lamps.
    box(0.62, 0.12, 0.05, mats.dark, 0, y + 0.1, tailAt(y + 0.16) - 0.01);
  }
  // Diffuser and centre-exit exhausts.
  {
    const zd = tailAt(0.25);
    const [, , hw] = at(zd - 0.1);
    box(hw * 2 * 0.8, 0.16, 0.14, mats.dark, 0, 0.18, zd - 0.03);
    const zp = tailAt(0.34);
    for (const side of [-1, 1]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.16, 12), mats.chrome);
      pipe.rotation.x = Math.PI / 2;
      pipe.position.set(side * 0.09, 0.34, toZ(zp + 0.03));
      group.add(pipe);
    }
  }
  // Swan-neck rear wing: the uprights hold the wing from above.
  {
    const span = 1.62;
    const wingZb = 4.38;
    const wingY = 1.24;
    const wing = box(span, 0.045, 0.34, mats.dark, 0, wingY, wingZb, -0.08);
    wing.castShadow = true;
    const gurney = box(span, 0.05, 0.015, mats.dark, 0, wingY + 0.035, wingZb + 0.17);
    gurney.castShadow = false;
    for (const side of [-1, 1]) {
      box(0.02, 0.22, 0.44, mats.dark, side * span / 2, wingY - 0.02, wingZb); // end plates
      const deckZb = 4.08;
      const [, deckTop] = at(deckZb);
      const x = side * 0.36;
      // Upright from the deck, curving over the wing's leading edge.
      const h = wingY + 0.07 - deckTop;
      box(0.025, h, 0.12, mats.dark, x, deckTop + h / 2, deckZb + 0.1);
      box(0.025, 0.04, 0.2, mats.dark, x, wingY + 0.06, deckZb + 0.2);
    }
  }

  const [, , hwFront] = at(bp.frontAxle);
  const [, , hwRear] = at(bp.rearAxle);
  return {
    group,
    width: hwRear * 2,
    length: bp.length * k,
    doorZ: toZ(2.25),
    doorHalfWidth: at(2.25)[2],
    wheels: {
      front: { x: hwFront - 0.14, r: rFront, w: 0.25 },
      rear: { x: hwRear - 0.17, r: rRear, w: 0.31 },
    },
  };
}
