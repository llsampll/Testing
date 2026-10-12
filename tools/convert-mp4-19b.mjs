// Prepares the McLaren MP4-19B model for the game:
//  - converts its old spec/gloss materials (KHR_materials_pbrSpecularGlossiness,
//    no longer supported by three.js) to standard metal/rough materials,
//  - simplifies the very dense wheels, and shrinks the textures.
//
// Model: "mclaren f1 mp4/19B lowpoly" by luis.adrian.villagrana
// (https://sketchfab.com/luis.adrian.designs3D), CC-BY-4.0,
// https://sketchfab.com/3d-models/mclaren-f1-mp419b-lowpoly-322d7355a54b409baaea32e915fb5f74
//
// Usage (needs: npm i @gltf-transform/core@4 @gltf-transform/functions@4 @gltf-transform/extensions@4 meshoptimizer sharp):
//   node tools/convert-mp4-19b.mjs models/src/mp4-19b/mclaren_f1_mp419b_lowpoly.glb models/mp4-19b.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { metalRough, dedup, prune, weld, simplifyPrimitive, textureCompress } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const [src, dst] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
await doc.transform(metalRough(), dedup(), weld());

await MeshoptSimplifier.ready;
let before = 0;
let after = 0;
for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    before += prim.getIndices().getCount() / 3;
    const mat = prim.getMaterial()?.getName() ?? '';
    // The wheels are ~22k triangles on their own; the rest of the car is light.
    if (/Wheel/.test(mat)) simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: 0.3, error: 0.002 });
    after += prim.getIndices().getCount() / 3;
  }
}
await doc.transform(prune(), textureCompress({ encoder: sharp, targetFormat: 'png', resize: [1024, 1024] }));
await io.write(dst, doc);
console.log(`triangles ${before} -> ${after}; materials ${doc.getRoot().listMaterials().length}`);
