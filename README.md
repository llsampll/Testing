# Apex Circuit

A mobile-first 3D racing game that runs in the browser. It's laid out like
Real Racing 3 (tilt steering, on-screen pedals, a grid of AI opponents) and
its handling follows Forza Motorsport's approach: a Pacejka-style tire model,
weight transfer, and toggleable driver assists.

No build step and no dependencies to install. three.js is vendored in
`js/vendor/`, so the game also works offline.

## Play

```bash
npm start            # serves the folder on http://localhost:8080
```

Then open the URL on your phone. It must be on the same network, or the folder
must be hosted somewhere such as GitHub Pages. Turn the phone to landscape and
press **RACE**.

> Tilt steering uses the device-orientation sensor, and browsers only allow
> that over **HTTPS** (or `localhost`). On iOS you'll be asked for permission
> the first time you start a race.

### Controls

| Scheme | Steering | Gas / Brake |
| --- | --- | --- |
| **Tilt + Pedals** (default on phones) | Tilt the phone like a wheel | Pedals bottom-left (brake) and bottom-right (gas) |
| **Tilt + Auto Gas** (classic RR3) | Tilt | Accelerates automatically and brake-assists into corners. Tap brake to slow down |
| **Touch Buttons** | ◀ ▶ buttons bottom-left | Brake and gas bottom-right |
| Keyboard | ← → / A D | ↑ / W gas, ↓ / S / Space brake |
| Gamepad | Left stick | RT gas, LT brake |

Hold the brake while stopped to reverse. Other keys: `C` cycles the camera
(chase, far, hood, bumper), `L` toggles the driving line, `R` puts the car
back on the track, and `Esc` pauses. `Q` and `E` shift down and up. The game
shifts automatically, but you can still shift by hand.

### Modes

- **Race**: 1–10 laps against 3–11 AI drivers on Easy, Medium or Hard. You
  start at the back of the grid.
- **Time Trial**: you alone on the track. Your best lap for each car and
  track is saved on the device.

## What's in it

- **4 cars**: an FWD hot hatch (Class C), an RWD V8 coupe (Class B), a GT3
  race car with downforce (Class A), and the **Spec E36**. The Spec E36 is
  an E36 spec racer with a 2.8 L straight-six and a 5-speed gearbox, drawn
  with a real 3D model (see below).
- **McLaren MP4-19B** (class F1): the 2004 Formula 1 car, with its real
  published figures:
  - Mercedes-Benz FO110Q 3.0 L V10, 870 hp at 18,500 rpm
  - 7-speed sequential gearbox
  - 600 kg including the driver
  - 3,100 mm wheelbase and 4,630 mm length

  Downforce, drag, gear ratios and the rev limit were never published, so
  those are estimates typical of a 2004 F1 car. In the game it does 0–100 km/h
  in about 2.6 s, reaches about 342 km/h, stops from 100 km/h in about 19 m,
  and pulls over 4 g in fast corners.
- **4 circuits**: *Harbor Point GP* (2.9 km, fast and flowing), *Red
  Canyon Ring* (2.2 km, technical), *Laguna Seca* (3.6 km with 54 m of
  elevation, traced from the real Monterey circuit map) and *Monza* (5.8 km,
  measured off an aerial view of the park).
- **Forza-style driving line**: the line ahead of you is green where you can
  accelerate, yellow where you should lift, and red where you need to brake.
  The colors are worked out live from your speed.
- **Assist presets**:
  - *Easy*: ABS, traction control, stability control, steering assist and
    automatic braking for corners.
  - *Normal*: ABS, traction control and steering assist.
  - *Pro*: no assists.
- **Braking boards**: 300, 200 and 100 m boards stand before every corner
  that needs real braking, on the outside of the approach. They only go on
  the straight leading up to a corner, so short straights get just the boards
  that fit, and fast kinks taken flat-out get none.
- Start lights, lap and sector timing, position and gap readouts, a minimap,
  a results table, and engine, tire-squeal and impact sounds generated
  procedurally.
- Installable as a PWA (web app), with landscape lock and full screen where
  the browser supports them.

### About the Laguna Seca layout

The centerline was traced from the official circuit map: the outline was
extracted from the image, smoothed and scaled to the real 3.60 km lap, so the
front straight, Andretti hairpin, the loop out to turns 5 and 6, Rahal
Straight, the Corkscrew notch, Rainey Curve and the final corner all sit where
they do on the map. It runs counter-clockwise.

The road, kerbs, barriers, scenery and cars are all draped on one shared terrain surface, so the grass mesh can never poke through the road.

The surroundings follow an aerial reference photo (`js/render/landscape.js`,
switched on by the track's `scenery` setting):

- **Ground:** a painted ground map with dry grass, sandy patches and forest floor.
- **Forest and infield:** dense woodland outside the circuit, and scattered
  olive trees and dirt trails in the infield.
- **Paddock:** a flat paddock behind the pit garages, with transporters,
  hospitality units, vans and three octagonal lawns.
- **Around the track:** a pond dug into the infield, footbridges over the
  straights, and grey service roads winding through the hills.

The layout of these features is fixed per track, so it looks the same on every
visit.

Elevation is modelled with about 54 m of relief (the real circuit has about
55 m): the road climbs from the start line to a crest at turn 6, rolls down
Rahal Straight, then drops roughly 18 m through the Corkscrew (steepest grade
about 18%) and on down to the final corner. The height profile is a hand-built
approximation from published figures, not survey data, and it is defined by a
short list of `[distance, height]` anchors in `js/track/trackData.js`, so it's
easy to refine. Any track can use the same `elevation` field.

### About the Monza layout

The real lap is 5.793 km, and the corners were measured off an aerial view of
the park. Each corner is stored as a point and a radius in
`js/track/trackData.js`, and the centerline is built from those straights and
arcs:

| Corner | Radius |
| --- | --- |
| Rettifilo chicane | 19 m |
| Curva Grande | 250 m |
| Roggia chicane | 32 m |
| Lesmo 1 | 100 m |
| Lesmo 2 | 85 m |
| Ascari | 95–140 m |
| Parabolica | 95 m opening to 170 m |

The tightest radii were opened up a little from the photo so the corner
speeds line up with real ones. The lap runs clockwise. The park is nearly
level, so the track is modelled flat.

The scenery follows the aerial view too:

- **The old banked oval:** it shares the main straight, banks steeply round
  both ends and crosses over the circuit on a bridge between Lesmo and Ascari.
- **Paddock:** a large paddock behind the long pit building, with rows of
  transporters.
- **Grandstands:** placed from the official seating map.
- **The park:** dense woodland, mown fields, an orchard and a plantation
  inside the oval, and a tree-lined avenue.
- **Around the park:** a golf course to the south and town edges to the north.

### 3D car models

Cars can use a glTF model instead of the built-in procedural body. To use one,
set `model` in the car's spec in `js/physics/cars.js`. On load,
`js/render/carModel.js` adapts the model to the game:

- scales it so its wheelbase matches the physics
- places its axles on the physics axles and puts the tyres on the ground
- splits the wheels into four so each can spin and steer
- merges the rest of the body, so a car is only a few draw calls

If a model can't load, the procedural body is used instead.

**Spec E36 model:** "BMW E36 M3 racing car" by
[Cutieunicorn](https://sketchfab.com/lukas.dlabek), licensed
[CC BY 4.0](http://creativecommons.org/licenses/by/4.0/), from
[Sketchfab](https://sketchfab.com/3d-models/bmw-e36-m3-racing-car-241b53e288bc44f28176e6523c286381).
The source files are in `models/src/spec-e36/`.
`python3 tools/pack_glb.py models/src/spec-e36/scene.gltf models/spec-e36.glb`
packs the model, its geometry and its palette texture into the single file the
game loads. Your car keeps the white livery; rival cars are tinted with their
team colour so you can tell them apart.

**McLaren MP4-19B model:** "mclaren f1 mp4/19B lowpoly" by
[luis.adrian.villagrana](https://sketchfab.com/luis.adrian.designs3D),
licensed [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/), from
[Sketchfab](https://sketchfab.com/3d-models/mclaren-f1-mp419b-lowpoly-322d7355a54b409baaea32e915fb5f74).
`tools/convert-mp4-19b.mjs` converts its old spec/gloss materials (which
three.js no longer reads), simplifies the dense wheels and writes
`models/mp4-19b.glb`. The model's tyre textures read Bridgestone, although the
real car raced on Michelins.

## Physics

The physics lives in `js/physics/` and is plain JavaScript, independent of the
renderer. It runs at a fixed 240 Hz.

- **Tires** (`tire.js`): a normalized Pacejka Magic Formula curve. Grip
  rises with slip, peaks, then drops off into a slide. Longitudinal and
  lateral slip are combined with the similarity method, so braking or
  accelerating mid-corner uses up cornering grip, as on a friction circle.
  Friction falls off with load (load sensitivity), and cornering stiffness
  grows more slowly than load. Both effects help keep cars stable under
  trail braking.
- **Vehicle** (`vehicle.js`): the body has three degrees of freedom
  (forward speed, lateral speed, yaw). Each wheel has its own spin speed,
  integrated with a linearized implicit step so it stays stable. Wheel loads
  come from static weight distribution, longitudinal and lateral weight
  transfer (lateral split by roll stiffness), and aerodynamic downforce split
  by aero balance. Aerodynamic drag and rolling resistance are included.
- **Drivetrain**: engine torque curves, a clutch that slips on launch, an
  automatic gearbox with shift times, engine braking, a rev limiter, and a
  limited-slip differential.
- **Assists**:
  - ABS: releases a wheel's brake pressure past the peak slip ratio.
  - Traction control: watches both wheelspin and combined slip, so it also
    catches power oversteer.
  - Stability control: watches body slip angle, trims the throttle and
    brakes the outside front wheel.
  - Steering assist: limits steering lock to what the front tires can use at
    the current speed, and countersteers automatically.
- **Hills**: the road's slope pulls the car back uphill and pushes it
  forward downhill, braking distances grow on a descent, and weight transfer
  is calculated from the contact-patch forces so a climb loads the rear. Dips
  press the tires into the road (more grip) and crests unload them (less
  grip). The AI plans its braking and corner speeds with all of this, and
  the scenery, camera and car body pitch follow the terrain.
- **Surfaces and contact**: asphalt, kerbs and grass each have their own grip
  and drag. Barriers and car-to-car contact are resolved with impulses that
  include spin, so a hit can turn the car.

AI drivers (`js/ai.js`) use the same physics as the player. Each follows a
racing line computed by relaxing an "elastic band" between the track edges,
steers by pure pursuit, and drives to a speed profile limited by grip and
braking. They pass slower cars and make the occasional small mistake.

## Tests

```bash
npm test
```

The tests check each car's performance against plausible figures: 0–100 km/h
time, top speed, braking distance with and without ABS, and skidpad grip. They
also run full headless AI races on every car and track combination and check
that every car finishes.

## Project layout

```
index.html, css/style.css     UI: menu, HUD, touch controls, overlays
js/main.js                    menu, settings, screen flow
js/game.js                    renderer, camera, HUD, frame loop
js/race.js                    race simulation (headless): laps, standings, collisions
js/ai.js                      AI drivers
js/input.js                   tilt / touch / keyboard / gamepad
js/audio.js                   procedural Web Audio sound
js/physics/                   tire model, vehicle model, car specs
js/track/                     track spline, elevation, racing line, speed profiles, layouts
js/render/                    procedural car and track meshes
```
