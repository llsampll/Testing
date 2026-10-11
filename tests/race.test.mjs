// Headless race: every AI car (including one driving the player's car) should
// complete laps without getting stuck, on every track with every car.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Race, PHYSICS_DT } from '../js/race.js';
import { Track } from '../js/track/track.js';
import { TRACKS } from '../js/track/trackData.js';
import { CARS } from '../js/physics/cars.js';

for (const def of TRACKS) {
  const track = new Track(def);
  for (const spec of CARS) {
    test(`${def.name} / ${spec.name}: AI field finishes a 2-lap race`, () => {
      const race = new Race({ track, carSpec: spec, opponents: 5, laps: 2, assists: 'normal', difficulty: 'hard', playerIsAI: true, countdown: 0.1 });
      const maxTime = 400;
      let wallHits = 0;
      while (race.time < maxTime && !race.cars.every((c) => c.finished)) {
        race.step(PHYSICS_DT);
        for (const e of race.events) if (e.type === 'impact' && !e.other) wallHits++;
        race.events.length = 0;
      }
      const best = Math.min(...race.cars.map((c) => c.bestLap ?? Infinity));
      const slowest = Math.max(...race.cars.map((c) => c.finishTime ?? Infinity));
      console.log(`${def.id.padEnd(7)} ${spec.id.padEnd(6)} best lap ${best.toFixed(2)}s  last finisher ${slowest.toFixed(1)}s  wall hits ${wallHits}`);
      for (const c of race.cars) assert.ok(c.finished, `${c.name} did not finish (lap ${c.lap}, idx ${c.trackIndex})`);
    });
  }
}
