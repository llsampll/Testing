// Sanity checks for the vehicle model. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vehicle, ASSIST_PRESETS } from '../js/physics/vehicle.js';
import { CARS } from '../js/physics/cars.js';

const DT = 1 / 240;

function run(car, seconds, fn) {
  for (let t = 0; t < seconds; t += DT) {
    if (fn && fn(t) === false) return t;
    car.step(DT);
  }
  return seconds;
}

function zeroTo100(spec) {
  const car = new Vehicle(spec, ASSIST_PRESETS.normal);
  car.input.throttle = 1;
  return run(car, 30, () => car.u * 3.6 < 100);
}

function topSpeed(spec) {
  const car = new Vehicle(spec, ASSIST_PRESETS.normal);
  car.input.throttle = 1;
  run(car, 90);
  return car.u * 3.6;
}

function brakingDistance(spec, assists) {
  const car = new Vehicle(spec, assists);
  car.u = 100 / 3.6;
  for (const w of car.wheels) w.omega = car.u / spec.wheelRadius;
  car.input.brake = 1;
  const x0 = car.z;
  run(car, 20, () => car.u > 0.1);
  return car.z - x0;
}

function skidpad(spec, radius) {
  // Drive a constant-radius circle with a simple speed/steer controller and
  // find the highest steady speed that holds the line.
  const car = new Vehicle(spec, ASSIST_PRESETS.normal);
  car.reset(-radius, 0, 0);
  let targetV = 8;
  let best = 0;
  for (let t = 0; t < 120; t += DT) {
    const dist = Math.hypot(car.x, car.z);
    const err = dist - radius; // positive = drifted outward
    // Desired heading: the one whose left vector points at the center.
    const tangent = Math.atan2(car.z / dist, -car.x / dist);
    let hErr = tangent - car.heading;
    hErr = Math.atan2(Math.sin(hErr), Math.cos(hErr));
    const kappa = 1 / radius;
    car.input.steer = Math.max(-1, Math.min(1, (Math.atan(spec.wheelbase * kappa) + hErr * 1.2 + err * 0.08) / car.maxSteerAt(car.u)));
    const speedErr = targetV - car.u;
    car.input.throttle = Math.max(0, Math.min(1, speedErr * 0.5 + 0.15));
    car.input.brake = speedErr < -1 ? 0.3 : 0;
    if (Math.abs(err) < 1.5 && Math.abs(speedErr) < 0.5) {
      best = Math.max(best, car.u);
      targetV += 0.02;
    }
    if (Math.abs(err) > 6) break;
    car.step(DT);
  }
  return (best * best) / radius / 9.81;
}

for (const spec of CARS) {
  test(`${spec.name}: plausible performance envelope`, () => {
    const t100 = zeroTo100(spec);
    const vmax = topSpeed(spec);
    const brakeAbs = brakingDistance(spec, ASSIST_PRESETS.normal);
    const brakeLocked = brakingDistance(spec, ASSIST_PRESETS.pro);
    const latG = skidpad(spec, 60);
    console.log(
      `${spec.name.padEnd(18)} 0-100 ${t100.toFixed(2)}s  vmax ${vmax.toFixed(0)} km/h  ` +
        `100-0 ${brakeAbs.toFixed(1)} m (no ABS ${brakeLocked.toFixed(1)} m)  skidpad ${latG.toFixed(2)} g`,
    );
    assert.ok(t100 > 2.5 && t100 < 9, `0-100 ${t100}`);
    assert.ok(vmax > 190 && vmax < 330, `top speed ${vmax}`);
    assert.ok(brakeAbs > 25 && brakeAbs < 45, `braking ${brakeAbs}`);
    assert.ok(brakeLocked >= brakeAbs - 1, 'ABS should not be worse than locking up');
    assert.ok(latG > 0.85 && latG < 1.8, `lateral g ${latG}`);
  });
}

test('car at rest stays at rest', () => {
  const car = new Vehicle(CARS[1]);
  run(car, 5);
  assert.ok(car.speed < 0.05, `speed ${car.speed}`);
  assert.ok(Math.abs(car.heading) < 1e-3);
});

test('holding brake from a stop selects reverse and backs up', () => {
  const car = new Vehicle(CARS[0]);
  car.input.brake = 1;
  run(car, 3);
  assert.equal(car.gear, -1);
  assert.ok(car.u < -1, `u ${car.u}`);
});

test('steering left turns the car left', () => {
  const car = new Vehicle(CARS[2]);
  car.u = 20;
  for (const w of car.wheels) w.omega = car.u / CARS[2].wheelRadius;
  car.input.throttle = 0.3;
  car.input.steer = 0.5;
  run(car, 1);
  assert.ok(car.heading > 0.1, `heading ${car.heading}`);
});
