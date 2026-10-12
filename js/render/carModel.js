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

/** Lit material for a part (unlit glTF materials would ignore the scene's lighting). */
function litMaterial(m) {
  if (m.isMeshStandardMaterial) return m;
  return new THREE.MeshStandardMaterial({ name: m.name, map: m.map ?? null, color: m.color?.clone() ?? new THREE.Color(0xffffff), roughness: 0.55, metalness: 0.1, side: m.side });
}

/** Merge baked geometries that share a material: [{ geometry, material, trim }]. */
function mergeByMaterial(items) {
  const groups = new Map();
  for (const it of items) {
    const key = `${it.material.uuid}|${it.trim ? 1 : 0}`;
    if (!groups.has(key)) groups.set(key, { material: it.material, trim: !!it.trim, geoms: [] });
    groups.get(key).geoms.push(it.geometry);
  }
  return [...groups.values()].map((g) => ({ geometry: mergeGeometries(g.geoms), material: g.material, trim: g.trim }));
}

/** Copy the listed triangles of a non-indexed geometry. */
function pickTriangles(geo, tris) {
  const g = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(geo.attributes)) {
    const size = attr.itemSize;
    const out = new Float32Array(tris.length * 3 * size);
    tris.forEach((t, i) => out.set(attr.array.subarray(t * 3 * size, (t + 1) * 3 * size), i * 3 * size));
    g.setAttribute(name, new THREE.BufferAttribute(out, size));
  }
  return g;
}

function buildTemplate(scene, cfg, fit) {
  scene.updateMatrixWorld(true);
  const yaw = new THREE.Matrix4().makeRotationY(cfg.yaw ?? 0);
  const wheelItems = [];
  const bodyItems = [];
  const lit = new Map();
  scene.traverse((o) => {
    if (!o.isMesh) return;
    if (!lit.has(o.material)) lit.set(o.material, litMaterial(o.material));
    const item = { geometry: bake(o, yaw), material: lit.get(o.material), trim: hasName(o, cfg.trim ?? []) };
    (hasName(o, cfg.wheels) ? wheelItems : bodyItems).push(item);
  });

  // Split the wheel meshes into four corners by triangle position (models
  // often store a pair, or all four, of the wheels in one mesh).
  const allWheels = new THREE.Box3();
  for (const it of wheelItems) allWheels.union(new THREE.Box3().setFromBufferAttribute(it.geometry.attributes.position));
  const mid = allWheels.getCenter(new THREE.Vector3());
  const corners = [[], [], [], []]; // FL (+x), FR, RL (+x), RR
  for (const it of wheelItems) {
    const pos = it.geometry.attributes.position;
    const tris = [[], [], [], []];
    for (let t = 0; t < pos.count / 3; t++) {
      const x = (pos.getX(t * 3) + pos.getX(t * 3 + 1) + pos.getX(t * 3 + 2)) / 3;
      const z = (pos.getZ(t * 3) + pos.getZ(t * 3 + 1) + pos.getZ(t * 3 + 2)) / 3;
      tris[(z > mid.z ? 0 : 2) + (x > mid.x ? 0 : 1)].push(t);
    }
    tris.forEach((list, c) => list.length && corners[c].push({ geometry: pickTriangles(it.geometry, list), material: it.material }));
  }
  const centers = corners.map((items) => {
    const b = new THREE.Box3();
    for (const it of items) b.union(new THREE.Box3().setFromBufferAttribute(it.geometry.attributes.position));
    return b.getCenter(new THREE.Vector3());
  });

  // Fit to the physics: scale to the wheelbase, front axle on the physics axle, tyres on the ground.
  const modelWheelbase = (centers[0].z + centers[1].z) / 2 - (centers[2].z + centers[3].z) / 2;
  const s = fit.wheelbase / modelWheelbase;
  const frontZ = ((centers[0].z + centers[1].z) / 2) * s;
  const midX = (centers.reduce((a, c) => a + c.x, 0) / 4) * s;
  const ground = allWheels.min.y * s;
  const toCar = new THREE.Matrix4().makeTranslation(-midX, -ground, fit.frontAxleZ - frontZ).multiply(new THREE.Matrix4().makeScale(s, s, s));

  const wheels = corners.map((items, i) => {
    const c = centers[i].clone().applyMatrix4(toCar);
    const local = new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z).multiply(toCar); // spin about its own centre
    for (const it of items) it.geometry.applyMatrix4(local);
    return { parts: mergeByMaterial(items), center: c, front: i < 2 };
  });
  for (const it of bodyItems) it.geometry.applyMatrix4(toCar);
  const body = mergeByMaterial(bodyItems);
  const box = new THREE.Box3();
  for (const p of body) box.union(new THREE.Box3().setFromBufferAttribute(p.geometry.attributes.position));
  return { body, wheels, paint: cfg.paint ?? null, brakeLight: cfg.brakeLight ?? null, size: box.getSize(new THREE.Vector3()), box };
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
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.6 });
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x232426, roughness: 0.85 });
  const isPaint = (m, trim) => !trim && (tpl.paint ? tpl.paint.includes(m.name) : true);
  const cloned = new Map();
  let tailMat = null;
  const bodyMaterial = (m, trim) => {
    if (tpl.brakeLight && m.name === tpl.brakeLight) {
      if (!tailMat) {
        tailMat = m.clone();
        tailMat.emissive = new THREE.Color(0xff1a10);
        tailMat.emissiveIntensity = 0.4;
      }
      return tailMat;
    }
    if (trim && !m.map) return trimMat;
    if (!isPaint(m, trim)) return m;
    if (!cloned.has(m)) {
      const c = m.clone();
      if (m.map) {
        // Textured livery: rivals get a tint of their team colour so they're easy to tell apart.
        if (!isPlayer) c.color.copy(m.color).multiply(new THREE.Color(0xffffff).lerp(new THREE.Color(color), 0.75));
      } else {
        // No texture: plain paint in the car's colour.
        c.color.setHex(color);
      }
      cloned.set(m, c);
    }
    return cloned.get(m);
  };
  for (const p of tpl.body) {
    const mesh = new THREE.Mesh(p.geometry, bodyMaterial(p.material, p.trim));
    mesh.castShadow = shadows;
    body.add(mesh);
  }
  const wheels = tpl.wheels.map((w) => {
    const pivot = new THREE.Group();
    pivot.position.copy(w.center);
    const wheel = new THREE.Group();
    for (const p of w.parts) {
      const mesh = new THREE.Mesh(p.geometry, p.material.map ? p.material : tyreMat);
      mesh.castShadow = shadows;
      wheel.add(mesh);
    }
    pivot.add(wheel);
    group.add(pivot);
    return { pivot, wheel, front: w.front };
  });
  return { group, body, wheels, tailMat };
}
