// Car specifications. Units are SI (kg, m, N·m, rad/s) unless noted.

export const CARS = [
  {
    id: 'hatch',
    name: 'Volta Hatch RS',
    class: 'C',
    description: 'Front-wheel-drive hot hatch. Forgiving, light and nimble.',
    color: 0xf2c94c,
    mass: 1220,
    inertiaScale: 1.0,
    wheelbase: 2.55,
    frontWeight: 0.61,
    cgHeight: 0.52,
    trackWidth: 1.52,
    wheelRadius: 0.31,
    drive: 'FWD',
    cylinders: 4,
    body: 'hatch',
    tire: { mu: 1.08, peakSlipRatio: 0.11, peakSlipAngle: 0.15, shape: 1.42 },
    // [rpm, torque N·m]
    torqueCurve: [[1000, 180], [2500, 300], [4000, 330], [5500, 320], [6500, 285], [7000, 240]],
    idleRpm: 900,
    redline: 6900,
    gears: [3.3, 2.1, 1.48, 1.15, 0.93, 0.78],
    finalDrive: 4.1,
    reverseRatio: 3.2,
    shiftTime: 0.18,
    brakeTorque: 4400,
    brakeBias: 0.7,
    maxSteer: 0.6,
    dragArea: 0.82,      // Cd * frontal area
    liftArea: 0.0,       // Cl * area (downforce)
    aeroBalance: 0.5,
    rollBalance: 0.6,    // fraction of lateral load transfer taken by the front
    lsd: 0.15,
  },
  {
    id: 'coupe',
    name: 'Strada GT Coupe',
    class: 'B',
    description: 'Rear-drive V8 coupe. Lots of torque — feed the throttle in.',
    color: 0xd7263d,
    mass: 1480,
    inertiaScale: 1.0,
    wheelbase: 2.70,
    frontWeight: 0.53,
    cgHeight: 0.48,
    trackWidth: 1.60,
    wheelRadius: 0.34,
    drive: 'RWD',
    cylinders: 8,
    body: 'coupe',
    tire: { mu: 1.12, peakSlipRatio: 0.1, peakSlipAngle: 0.14, shape: 1.45 },
    torqueCurve: [[1000, 330], [2500, 480], [4000, 540], [5500, 520], [6600, 460], [7200, 400]],
    idleRpm: 850,
    redline: 7100,
    gears: [2.95, 2.05, 1.52, 1.2, 1.0, 0.84],
    finalDrive: 3.6,
    reverseRatio: 3.0,
    shiftTime: 0.15,
    brakeTorque: 5600,
    brakeBias: 0.66,
    maxSteer: 0.58,
    dragArea: 0.86,
    liftArea: 0.25,
    aeroBalance: 0.45,
    rollBalance: 0.6,
    lsd: 0.35,
    rearGrip: 1.07,
  },
  {
    id: 'gt3',
    name: 'Apex GT3 R',
    class: 'A',
    description: 'Purpose-built GT3 racer. Huge brakes and real downforce.',
    color: 0x2d9cdb,
    mass: 1300,
    inertiaScale: 0.95,
    wheelbase: 2.65,
    frontWeight: 0.46,
    cgHeight: 0.42,
    trackWidth: 1.68,
    wheelRadius: 0.35,
    drive: 'RWD',
    cylinders: 6,
    body: 'gt3',
    tire: { mu: 1.42, peakSlipRatio: 0.09, peakSlipAngle: 0.12, shape: 1.48 },
    torqueCurve: [[1500, 380], [3000, 500], [4500, 560], [6000, 560], [7500, 510], [8500, 450]],
    idleRpm: 1200,
    redline: 8300,
    gears: [3.0, 2.2, 1.73, 1.42, 1.2, 1.04],
    finalDrive: 3.4,
    reverseRatio: 3.0,
    shiftTime: 0.08,
    brakeTorque: 7600,
    brakeBias: 0.64,
    maxSteer: 0.52,
    dragArea: 1.02,
    liftArea: 2.1,
    aeroBalance: 0.4,
    rollBalance: 0.58,
    lsd: 0.5,
    rearGrip: 1.05,
  },
  {
    id: 'spec-e36',
    name: 'Spec E36',
    class: 'C',
    description: 'E36 spec racer: 2.8 straight-six, five-speed, sticky R-compound tyres and near-perfect balance. Carry your momentum.',
    color: 0xeef1f4,        // the model's livery is white
    mass: 1300,             // with driver, class minimum
    inertiaScale: 1.0,
    wheelbase: 2.70,
    frontWeight: 0.51,
    cgHeight: 0.47,
    trackWidth: 1.43,
    wheelRadius: 0.317,     // 225/45R17
    drive: 'RWD',
    cylinders: 6,
    body: 'coupe',          // procedural fallback if the 3D model can't load
    // 3D model: "BMW E36 M3 racing car" by Cutieunicorn (CC-BY-4.0). Packed with tools/pack_glb.py.
    model: {
      url: 'models/spec-e36.glb',
      wheels: ['Cylinder.001'],
      trim: ['e36.001', 'e36.008', 'Cylinder.002', 'Plane.002', 'Cube.001', 'Cube.002'],
    },
    tire: { mu: 1.22, peakSlipRatio: 0.1, peakSlipAngle: 0.13, shape: 1.46 },
    // BMW M52 2.8: 193 hp at 5,300 rpm, 280 N·m at 3,950 rpm.
    torqueCurve: [[1000, 200], [2500, 255], [3950, 280], [5000, 268], [5800, 245], [6500, 210]],
    idleRpm: 800,
    redline: 6500,
    gears: [4.21, 2.49, 1.66, 1.24, 1.0],
    finalDrive: 3.46,
    reverseRatio: 3.85,
    shiftTime: 0.2,
    brakeTorque: 4800,
    brakeBias: 0.64,
    maxSteer: 0.6,
    dragArea: 0.7,
    liftArea: 0.12,
    aeroBalance: 0.45,
    rollBalance: 0.57,
    lsd: 0.4,
    rearGrip: 1.03,
  },
  {
    id: 'mp4-19b',
    name: 'McLaren MP4-19B',
    class: 'F1',
    description: '2004 Formula 1 car: Mercedes FO110Q 3.0 V10, 870 hp at 18,500 rpm, 600 kg with driver. Brakes and corners like nothing else here.',
    color: 0xc3c7cc,          // silver
    // Published figures: 600 kg with driver, 3,100 mm wheelbase, 4,630 mm long,
    // FO110Q 3.0 V10 870 hp @ 18,500 rpm, 7-speed sequential, Michelin tyres.
    // McLaren never published aero, gear ratios or the rev limit: those are
    // estimates typical of a 2004 F1 car.
    mass: 600,
    inertiaScale: 0.9,
    wheelbase: 3.1,
    frontWeight: 0.44,
    cgHeight: 0.28,
    trackWidth: 1.45,         // estimate
    wheelRadius: 0.33,        // 13-inch rims, ~660 mm tyres
    drive: 'RWD',
    cylinders: 10,
    body: 'gt3',              // procedural fallback if the 3D model can't load
    // 3D model: "mclaren f1 mp4/19B lowpoly" by luis.adrian.villagrana (CC-BY-4.0),
    // converted with tools/convert-mp4-19b.mjs. The model faces -z, hence the yaw.
    model: {
      url: 'models/mp4-19b.glb',
      yaw: Math.PI,
      wheels: ['Object_12', 'Object_13'],
      paint: ['Body1Mtl'],
      brakeLight: 'Light1Mtl',
    },
    // Grooved 2004 Michelins: huge mechanical grip, and far less grip lost as
    // downforce piles load onto them than a road tyre would suffer.
    tire: { mu: 1.75, peakSlipRatio: 0.08, peakSlipAngle: 0.1, shape: 1.5, fz0: 3000, loadSens: 0.08 },
    torqueCurve: [[4000, 180], [8000, 260], [11000, 310], [14000, 345], [16000, 350], [18500, 335], [19200, 300]],
    idleRpm: 4000,
    redline: 19000,           // estimate
    gears: [5.9, 4.4, 3.5, 2.85, 2.35, 1.95, 1.64], // estimate: ~100 km/h in 1st, ~360 km/h in 7th
    finalDrive: 4.0,
    reverseRatio: 6.0,
    shiftTime: 0.04,
    engineInertia: 0.05,      // tiny, fast-revving race V10
    brakeTorque: 5000,        // carbon brakes
    brakeBias: 0.57,
    maxSteer: 0.4,
    dragArea: 1.05,           // estimate
    liftArea: 3.9,            // estimate: ~1,700 kg of downforce at 300 km/h
    aeroBalance: 0.42,
    rollBalance: 0.52,
    lsd: 0.6,
    rearGrip: 1.1,            // wider rear tyres
  },
];

export function getCar(id) {
  return CARS.find((c) => c.id === id) ?? CARS[0];
}
