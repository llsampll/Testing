// Loads a glTF car model and prepares it for the game.
//
// The model is fitted to the physics: scaled so its wheelbase matches the
// car spec, its front axle placed on the physics front axle, centred, and its
// tyres put on the ground. The wheels (one mesh in the source model) are split
// into four so each can spin and steer. Everything else is merged, so a car is
// about five draw calls.
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from '../vendor/addons/utils/BufferGeometryUtils.js';

const loader = new GLTFLoader();
const pending = new Map();
const ready = new Map();

/** Where a car spec's physics axles are. */
export function modelFit(spec) {
  return { wheelbase: spec.wheelbase, frontAxleZ: spec.wheelbase * (1 - spec.frontWeight) };
}

const keyFor = (spec) => `${spec.model.url}|${spec.wheelbase}|${spec.frontWeight}`;

/** Load and prepare a spec's model once; later calls reuse it. */
export function preloadCarModel(spec) {
  const key = keyFor(spec);
  if (!pending.has(key)) {
    pending.set(
      key,
      loader.loadAsync(spec.model.url).then((gltf) => {
        const tpl = buildTemplate(gltf.scene, spec.model, modelFit(spec));
        ready.set(key, tpl);
        return tpl;
      }),
    );
  }
  return pending.get(key);
}

/** The prepared model, if it has finished loading. */
export function getCarModel(spec) {
  return spec.model ? ready.get(keyFor(spec)) ?? null : null;
}

/** Original glTF name of a mesh or any of its ancestors that matches. */
function hasName(obj, names) {
  for (let o = obj; o; o = o.parent) {
    const n = o.userData?.name ?? o.name ?? '';
    if (names.some((p) => n === p || n.startsWith(`${p}_`))) return true;
  }
  return false;
}

/** World-space float copy of a mesh's geometry (position, normal, uv). */
function bake(mesh, matrix) {
  const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const g = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const a = src.attributes[name];
    if (!a) continue;
    const out = new Float32Array(a.count * a.itemSize);
    const get = [a.getX, a.getY, a.getZ];
    for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) out[i * a.itemSize + c] = get[c].call(a, i);
    g.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
  }
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(matrix, mesh.matrixWorld));
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

function buildTemplate(scene, cfg, fit) {
  scene.updateMatrixWorld(true);
  const parts = { wheels: [], trim: [], body: [] };
  let map = null;
  scene.traverse((o) => {
    if (!o.isMesh) return;
    map = map ?? o.material?.map ?? null;
    if (hasName(o, cfg.wheels)) parts.wheels.push(o);
    else if (hasName(o, cfg.trim ?? [])) parts.trim.push(o);
    else parts.body.push(o);
  });
  const yaw = new THREE.Matrix4().makeRotationY(cfg.yaw ?? 0);

  // Split the wheel mesh(es) into four corners by triangle position.
  const wheelGeo = mergeGeometries(parts.wheels.map((m) => bake(m, yaw)));
  const pos = wheelGeo.attributes.position;
  const box = new THREE.Box3().setFromBufferAttribute(pos);
  const mid = box.getCenter(new THREE.Vector3());
  const cornerTris = [[], [], [], []]; // FL (+x), FR, RL (+x), RR
  for (let t = 0; t < pos.count / 3; t++) {
    let x = 0, z = 0;
    for (let k = 0; k < 3; k++) {
      x += pos.getX(t * 3 + k);
      z += pos.getZ(t * 3 + k);
    }
    const front = z / 3 > mid.z;
    const left = x / 3 > mid.x;
    cornerTris[(front ? 0 : 2) + (left ? 0 : 1)].push(t);
  }
  const pick = (tris) => {
    const g = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(wheelGeo.attributes)) {
      const out = new Float32Array(tris.length * 3 * attr.itemSize);
      tris.forEach((t, i) => out.set(attr.array.subarray(t * 3 * attr.itemSize, (t + 1) * 3 * attr.itemSize), i * 3 * attr.itemSize));
      g.setAttribute(name, new THREE.BufferAttribute(out, attr.itemSize));
    }
    return g;
  };
  const wheelGeos = cornerTris.map(pick);
  const centers = wheelGeos.map((g) => {
    g.computeBoundingBox();
    return g.boundingBox.getCenter(new THREE.Vector3());
  });

  // Fit to the physics: scale to the wheelbase, front axle on the physics axle, tyres on the ground.
  const modelWheelbase = (centers[0].z + centers[1].z) / 2 - (centers[2].z + centers[3].z) / 2;
  const s = fit.wheelbase / modelWheelbase;
  const frontZ = ((centers[0].z + centers[1].z) / 2) * s;
  const midX = (centers.reduce((a, c) => a + c.x, 0) / 4) * s;
  const ground = box.min.y * s;
  const toCar = new THREE.Matrix4().makeTranslation(-midX, -ground, fit.frontAxleZ - frontZ).multiply(new THREE.Matrix4().makeScale(s, s, s));

  const wheels = wheelGeos.map((g, i) => {
    g.applyMatrix4(toCar);
    const c = centers[i].clone().applyMatrix4(toCar);
    g.translate(-c.x, -c.y, -c.z); // spin about the wheel's own centre
    return { geometry: g, center: c, front: i < 2 };
  });
  const merge = (list) => {
    if (!list.length) return null;
    const g = mergeGeometries(list.map((m) => bake(m, yaw)));
    g.applyMatrix4(toCar);
    return g;
  };
  const body = merge(parts.body);
  const trim = merge(parts.trim);
  body.computeBoundingBox();
  return { body, trim, wheels, map, size: body.boundingBox.getSize(new THREE.Vector3()), box: body.boundingBox.clone() };
}

/**
 * One drawable copy of the model.
 * @param {object} tpl     template from preloadCarModel
 * @param {number} color   this car's colour
 * @param {boolean} isPlayer  the player's car shows the livery untinted
 */
export function instantiate(tpl, { color, isPlayer, shadows }) {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  let paint;
  let trimMat;
  let wheelMat;
  if (tpl.map) {
    // Textured livery: rivals get a tint of their team colour so they're easy to tell apart.
    const tint = isPlayer ? new THREE.Color(0xffffff) : new THREE.Color(0xffffff).lerp(new THREE.Color(color), 0.75);
    paint = new THREE.MeshStandardMaterial({ map: tpl.map, color: tint, roughness: 0.55, metalness: 0.1 });
    trimMat = paint;
    wheelMat = new THREE.MeshStandardMaterial({ map: tpl.map, roughness: 0.8 });
  } else {
    // No texture available: plain paint with dark tyres and trim.
    paint = new THREE.MeshPhysicalMaterial({ color, roughness: 0.35, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08 });
    trimMat = new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.6 });
    wheelMat = new THREE.MeshStandardMaterial({ color: 0x232426, roughness: 0.85 });
  }
  const bodyMesh = new THREE.Mesh(tpl.body, paint);
  bodyMesh.castShadow = shadows;
  body.add(bodyMesh);
  if (tpl.trim) body.add(Object.assign(new THREE.Mesh(tpl.trim, trimMat), { castShadow: shadows }));
  const wheels = tpl.wheels.map((w) => {
    const pivot = new THREE.Group();
    pivot.position.copy(w.center);
    const wheel = new THREE.Mesh(w.geometry, wheelMat);
    wheel.castShadow = shadows;
    pivot.add(wheel);
    group.add(pivot);
    return { pivot, wheel, front: w.front };
  });
  return { group, body, wheels };
}
