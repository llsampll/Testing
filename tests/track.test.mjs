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
