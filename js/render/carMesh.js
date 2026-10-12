// Procedural low-poly car models built from extruded side profiles.
import * as THREE from '../vendor/three.module.min.js';
import { BLUEPRINTS } from './blueprints.js';
import { buildBlueprintBody } from './blueprintCar.js';

// Side profiles: [z (forward), y (up)] in meters, traced front-bottom first.
const PROFILES = {
  hatch: {
    length: 4.1,
    width: 1.78,
    body: [[-2.0, 0.3], [2.0, 0.3], [2.07, 0.55], [1.95, 0.78], [0.85, 0.95], [-1.75, 1.0], [-2.05, 0.92], [-2.08, 0.55]],
    cabin: [[0.85, 0.95], [0.05, 1.42], [-1.55, 1.44], [-1.95, 1.0]],
    cabinInset: 0.12,
    wheelbase: 2.55,
    wing: false,
  },
  coupe: {
    length: 4.6,
    width: 1.9,
    body: [[-2.25, 0.28], [2.25, 0.28], [2.33, 0.52], [2.2, 0.74], [0.75, 0.9], [-1.65, 0.94], [-2.28, 0.86], [-2.32, 0.5]],
    cabin: [[0.75, 0.9], [-0.05, 1.3], [-1.05, 1.3], [-1.85, 0.94]],
    cabinInset: 0.16,
    wheelbase: 2.7,
    wing: false,
  },
  gt3: {
    length: 4.7,
    width: 2.0,
    body: [[-2.3, 0.18], [2.32, 0.18], [2.4, 0.4], [2.25, 0.66], [0.7, 0.84], [-1.75, 0.9], [-2.33, 0.86], [-2.38, 0.42]],
    cabin: [[0.7, 0.84], [-0.1, 1.2], [-1.0, 1.2], [-1.85, 0.9]],
    cabinInset: 0.2,
    wheelbase: 2.65,
    wing: true,
  },
};

function extrudeProfile(points, width, bevel) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 1,
  });
  // Shape x -> forward (+z), extrusion -> across the car (x), centered.
  geo.rotateY(-Math.PI / 2);
  geo.translate((width - bevel * 2) / 2, 0, 0);
  geo.computeVertexNormals();
  return geo;
}

let sharedWheel = null;
function wheelParts(radius, width = null, rimMat = null) {
  if (!sharedWheel) {
    const tire = new THREE.CylinderGeometry(1, 1, 0.26, 18);
    tire.rotateZ(Math.PI / 2);
    const rim = new THREE.CylinderGeometry(0.68, 0.68, 0.28, 14);
    rim.rotateZ(Math.PI / 2);
    const spoke = new THREE.BoxGeometry(0.3, 1.2, 0.16);
    sharedWheel = {
      tire,
      rim,
      spoke,
      tireMat: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 }),
      rimMat: new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.3, metalness: 0.8 }),
    };
  }
  const w = sharedWheel;
  const group = new THREE.Group();
  const t = new THREE.Mesh(w.tire, w.tireMat);
  const r = new THREE.Mesh(w.rim, rimMat ?? w.rimMat);
  const s1 = new THREE.Mesh(w.spoke, rimMat ?? w.rimMat);
  const s2 = new THREE.Mesh(w.spoke, rimMat ?? w.rimMat);
  s2.rotation.x = Math.PI / 2;
  t.castShadow = true;
  group.add(t, r, s1, s2);
  group.scale.setScalar(radius);
  // The tire is 0.26 units wide before scaling; stretch it to a real width.
  if (width) group.scale.x = width / 0.26;
  return group;
}

/** Door number roundel (canvas texture). */
function numberMaterial(number) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(32, 32, 30, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#111';
  g.font = 'bold 34px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(number), 32, 34);
  return new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true });
}

let shadowTexture = null;
function blobShadowTexture() {
  if (shadowTexture) return shadowTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  shadowTexture = new THREE.CanvasTexture(c);
  return shadowTexture;
}

export class CarMesh {
  constructor(spec, color, { shadows = false, number = null } = {}) {
    this.spec = spec;
    this.group = new THREE.Group();
    this.body = new THREE.Group();
    this.group.add(this.body);

    const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.32, metalness: 0.35 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x0d1520, roughness: 0.08, metalness: 0.9 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7 });
    this.headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4d6, emissiveIntensity: 0.8 });
    this.tailMat = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1a1a, emissiveIntensity: 0.4 });

    const bp = BLUEPRINTS[spec.body];
    if (bp) {
      this._buildFromBlueprint(bp, spec, { paint, glass, dark, number, shadows });
      return;
    }
    const prof = PROFILES[spec.body] ?? PROFILES.coupe;

    const body = new THREE.Mesh(extrudeProfile(prof.body, prof.width, 0.07), paint);
    body.castShadow = shadows;
    const cabin = new THREE.Mesh(extrudeProfile(prof.cabin, prof.width - prof.cabinInset * 2, 0.05), glass);
    this.body.add(body, cabin);

    // Roof panel in body color so the cabin reads as a car, not a fishbowl.
    const roofLen = Math.abs(prof.cabin[2][0] - prof.cabin[1][0]) + 0.15;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(prof.width - prof.cabinInset * 2 - 0.12, 0.05, roofLen), paint);
    roof.position.set(0, prof.cabin[1][1] + 0.04, (prof.cabin[1][0] + prof.cabin[2][0]) / 2);
    this.body.add(roof);

    // Lights.
    const front = prof.body[2][0];
    const rear = prof.body[prof.body.length - 1][0];
    for (const side of [-1, 1]) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.06), this.headMat);
      h.position.set(side * (prof.width / 2 - 0.35), prof.body[2][1] + 0.05, front - 0.02);
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.12, 0.06), this.tailMat);
      t.position.set(side * (prof.width / 2 - 0.33), prof.body[prof.body.length - 1][1] + 0.18, rear + 0.01);
      this.body.add(h, t);
    }
    // Grille / diffuser.
    const grille = new THREE.Mesh(new THREE.BoxGeometry(prof.width * 0.5, 0.16, 0.05), dark);
    grille.position.set(0, prof.body[1][1] + 0.12, front);
    this.body.add(grille);

    if (prof.wing) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(prof.width * 0.95, 0.05, 0.38), dark);
      wing.position.set(0, 1.25, rear + 0.3);
      const standGeo = new THREE.BoxGeometry(0.05, 0.38, 0.18);
      const s1 = new THREE.Mesh(standGeo, dark);
      const s2 = new THREE.Mesh(standGeo, dark);
      s1.position.set(0.45, 1.05, rear + 0.32);
      s2.position.set(-0.45, 1.05, rear + 0.32);
      this.body.add(wing, s1, s2);
      const splitter = new THREE.Mesh(new THREE.BoxGeometry(prof.width, 0.03, 0.25), dark);
      splitter.position.set(0, 0.2, front + 0.08);
      this.body.add(splitter);
    }

    if (number !== null) {
      const mat = numberMaterial(number);
      for (const side of [-1, 1]) {
        const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.55), mat);
        plate.position.set(side * (prof.width / 2 + 0.01), 0.62, -0.1);
        plate.rotation.y = side * Math.PI / 2;
        this.body.add(plate);
      }
    }

    // Wheels: pivot (steer) -> wheel (spin).
    const R = spec.wheelRadius;
    const a = spec.wheelbase * (1 - spec.frontWeight);
    const b = spec.wheelbase * spec.frontWeight;
    // Center the visual wheelbase on the physics CG.
    const xOff = prof.width / 2 - 0.16;
    this.wheels = [];
    for (const [z, x, front] of [[a, xOff, true], [a, -xOff, true], [-b, xOff, false], [-b, -xOff, false]]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, R, z);
      const wheel = wheelParts(R);
      pivot.add(wheel);
      this.group.add(pivot);
      this.wheels.push({ pivot, wheel, front });
    }
    // Shift the body so its wheel arches line up with the physics axles.
    this.body.position.z = (a - b) / 2;

    this._addShadow(prof.width, prof.length, this.body.position.z);
  }

  _buildFromBlueprint(bp, spec, { paint, glass, dark, number, shadows }) {
    const chrome = new THREE.MeshStandardMaterial({ color: 0xd0d4da, roughness: 0.2, metalness: 1 });
    const built = buildBlueprintBody(bp, spec, { paint, glass, dark, chrome, head: this.headMat, tail: this.tailMat });
    built.group.traverse((o) => { if (o.isMesh && o.castShadow) o.castShadow = shadows; });
    this.body.add(built.group);
    if (number !== null) {
      const mat = numberMaterial(number);
      for (const side of [-1, 1]) {
        const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), mat);
        plate.position.set(side * (built.doorHalfWidth + 0.012), 0.6, built.doorZ);
        plate.rotation.y = (side * Math.PI) / 2;
        this.body.add(plate);
      }
    }
    // Dark centre-lock wheels, wider at the back.
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.35, metalness: 0.7 });
    const a = spec.wheelbase * (1 - spec.frontWeight);
    const b = spec.wheelbase * spec.frontWeight;
    this.wheels = [];
    const { front, rear } = built.wheels;
    for (const [z, x, w, isFront] of [[a, front.x, front, true], [a, -front.x, front, true], [-b, rear.x, rear, false], [-b, -rear.x, rear, false]]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, w.r, z);
      const wheel = wheelParts(w.r, w.w, rimMat);
      pivot.add(wheel);
      this.group.add(pivot);
      this.wheels.push({ pivot, wheel, front: isFront });
    }
    this._addShadow(built.width, built.length, 0);
  }

  _addShadow(width, length, z) {
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(width * 1.5, length * 1.25),
      new THREE.MeshBasicMaterial({ map: blobShadowTexture(), transparent: true, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.12;
    shadow.position.z = z;
    shadow.renderOrder = 1;
    this.group.add(shadow);
  }

  /** Sync with the physics state. */
  update(v, dt) {
    this.group.position.set(v.x, v.y ?? 0, v.z);
    this.group.rotation.order = 'YXZ';
    this.group.rotation.y = v.heading;
    this.group.rotation.x = -(v.slope ?? 0); // nose up on a climb
    // Visual body roll and pitch from accelerations.
    const roll = Math.max(-0.07, Math.min(0.07, v.ay * 0.0055));
    const pitch = Math.max(-0.05, Math.min(0.05, -v.ax * 0.004));
    this.body.rotation.z += (roll - this.body.rotation.z) * Math.min(1, dt * 10);
    this.body.rotation.x += (pitch - this.body.rotation.x) * Math.min(1, dt * 10);
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      w.pivot.rotation.y = w.front ? v.steerAngle : 0;
      w.wheel.rotation.x = v.wheels[i].spin;
    }
    const braking = v.gear < 0 ? v.input.throttle > 0.1 : v.input.brake > 0.1;
    this.tailMat.emissiveIntensity = braking ? 2.2 : 0.4;
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.isMesh) {
        if (o.geometry !== sharedWheel?.tire && o.geometry !== sharedWheel?.rim && o.geometry !== sharedWheel?.spoke) o.geometry.dispose();
      }
    });
  }
}
