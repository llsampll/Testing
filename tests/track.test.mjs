// Track geometry checks, including the Laguna Seca elevation profile.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Track } from '../js/track/track.js';
import { TRACKS } from '../js/track/trackData.js';

for (const def of TRACKS) {
  test(`${def.name}: closed loop with room between distant sections`, () => {
    const t = new Track(def);
    const skip = Math.ceil(80 / t.spacing);
    let minSep = Infinity;
    for (let i = 0; i < t.count; i += 2) {
      for (let j = i + skip; j <= i + t.count - skip && j < t.count; j += 2) {
        minSep = Math.min(minSep, Math.hypot(t.px[i] - t.px[j], t.pz[i] - t.pz[j]));
      }
    }
    assert.ok(minSep > 2 * t.wallDist, `sections ${minSep.toFixed(1)} m apart`);
    let maxGrade = 0;
    for (let i = 0; i < t.count; i++) maxGrade = Math.max(maxGrade, Math.abs(t.grade[i]));
    assert.ok(maxGrade < 0.2, `grade ${maxGrade}`);
  });
}

test('Laguna Seca: real lap length and ~55 m of relief with a Corkscrew-style drop', () => {
  const t = new Track(TRACKS.find((d) => d.id === 'laguna'));
  assert.ok(Math.abs(t.length - 3602) < 15, `length ${t.length}`);
  assert.ok(t.relief > 50 && t.relief < 58, `relief ${t.relief}`);
  let steepest = 0;
  for (let i = 0; i < t.count; i++) steepest = Math.min(steepest, t.grade[i]);
  assert.ok(steepest < -0.12 && steepest > -0.2, `steepest descent ${steepest}`);
  // Seamless around the start/finish line.
  assert.ok(Math.abs(t.h[0] - t.h[t.count - 1]) < 0.3);
});

test('terrain mesh and road share one surface (no grass through the road)', () => {
  const t = new Track(TRACKS.find((d) => d.id === 'laguna'));
  const T = t.ensureTerrain(150);
  // The sampler returns the stored height exactly at every grid vertex...
  for (const [ix, iz] of [[0, 0], [10, 20], [75, 75], [149, 149]]) {
    const v = T.H[iz * T.n + ix];
    assert.ok(Math.abs(t.terrainHeight(T.x0 + ix * T.cell, T.z0 + iz * T.cell) - v) < 1e-3);
  }
  // ...and the terrain stays near the true road height, so the hills read right.
  let worst = 0;
  for (let i = 0; i < t.count; i += 3) worst = Math.max(worst, Math.abs(t.terrainHeight(t.px[i], t.pz[i]) - t.h[i]));
  assert.ok(worst < 2.5, `terrain drifts ${worst.toFixed(2)} m from the road profile`);
  // Road surface is always above the terrain at its own position.
  for (let i = 0; i < t.count; i += 3) {
    for (const lat of [-t.halfWidth, 0, t.halfWidth]) {
      const x = t.px[i] + t.nx[i] * lat;
      const z = t.pz[i] + t.nz[i] * lat;
      assert.ok(t.roadY(x, z) > t.terrainHeight(x, z));
    }
  }
});

test('braking boards sit at 300/200/100 m before braking corners, on the approach straight', () => {
  for (const def of TRACKS) {
    const t = new Track(def);
    const markers = t.brakingMarkers();
    for (const m of markers) {
      assert.ok([300, 200, 100].includes(m.distance));
      // Exact distance to the corner, measured along the track.
      const gap = (((m.corner - m.s) % t.length) + t.length) % t.length;
      assert.ok(Math.abs(gap - m.distance) < 0.01, `${def.id}: ${m.distance} m board is ${gap.toFixed(2)} m out`);
      // Nothing between the board and the corner is itself a corner.
      const steps = Math.round(m.distance / t.spacing);
      for (let step = 0; step < steps; step++) {
        const i = Math.round(((m.s + step * t.spacing) % t.length) / t.spacing) % t.count;
        let k = 0;
        for (let j = -5; j <= 5; j++) k += Math.abs(t.curvature[(i + j + t.count) % t.count]);
        assert.ok(k / 11 < 1 / 140 + 1e-9, `${def.id}: board at ${m.s.toFixed(0)} m is inside a corner`);
      }
    }
    const keys = markers.map((m) => `${m.corner}|${m.distance}`);
    assert.equal(new Set(keys).size, keys.length);
  }
  // Laguna Seca's big stops (Andretti hairpin, turn 5, turn 6, the Corkscrew) all get the full set.
  const laguna = new Track(TRACKS.find((d) => d.id === 'laguna'));
  const full = new Set(laguna.brakingMarkers().filter((m) => m.distance === 300).map((m) => m.corner));
  assert.ok(full.size >= 4, `only ${full.size} full braking zones at Laguna`);
});
