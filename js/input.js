// Player input: tilt steering, on-screen pedals/buttons, keyboard and gamepad.
// Everything is merged into one {steer, throttle, brake} state each frame.

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export class Input {
  constructor() {
    this.scheme = 'tilt'; // 'tilt' | 'buttons' | 'tilt-auto'
    this.tiltSensitivity = 1;
    this.steer = 0;
    this.throttle = 0;
    this.brake = 0;
    this.keys = new Set();
    this.touch = { left: false, right: false, gas: false, brake: false };
    this.tiltAngle = 0;     // degrees, positive = rotate device clockwise (steer right)
    this.tiltAvailable = false;
    this._keySteer = 0;
    this.onAction = null;   // callback(name) for camera/pause/reset/shift buttons

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      const map = { KeyC: 'camera', Escape: 'pause', KeyP: 'pause', KeyR: 'reset', KeyE: 'shiftUp', KeyQ: 'shiftDown', KeyL: 'line' };
      if (map[e.code] && this.onAction) this.onAction(map[e.code]);
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('deviceorientation', (e) => this._onOrientation(e));
  }

  /** iOS 13+ needs an explicit permission request from a user gesture. */
  async requestTiltPermission() {
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === 'function') {
      try {
        const res = await DOE.requestPermission();
        return res === 'granted';
      } catch {
        return false;
      }
    }
    return true;
  }

  _onOrientation(e) {
    if (e.beta === null || e.gamma === null) return;
    this.tiltAvailable = true;
    // Gravity direction in device coordinates from the Euler angles.
    const b = (e.beta * Math.PI) / 180;
    const g = (e.gamma * Math.PI) / 180;
    const dx = Math.cos(b) * Math.sin(g);
    const dy = -Math.sin(b);
    // Project into screen coordinates for the current orientation.
    const angle = ((screen.orientation?.angle ?? window.orientation ?? 0) * Math.PI) / 180;
    const sx = dx * Math.cos(angle) - dy * Math.sin(angle);
    const sy = dx * Math.sin(angle) + dy * Math.cos(angle);
    // Turning the device like a wheel rotates gravity within the screen plane.
    this.tiltAngle = (Math.atan2(sx, -sy) * 180) / Math.PI;
  }

  /** Bind on-screen controls. Elements carry data-control="left|right|gas|brake". */
  bindTouchControls(root) {
    const set = (el, on) => {
      const name = el.dataset.control;
      this.touch[name] = on;
      el.classList.toggle('pressed', on);
    };
    for (const el of root.querySelectorAll('[data-control]')) {
      const down = (e) => {
        e.preventDefault();
        set(el, true);
      };
      const up = (e) => {
        e.preventDefault();
        set(el, false);
      };
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('pointerleave', up);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    for (const el of root.querySelectorAll('[data-action]')) {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (this.onAction) this.onAction(el.dataset.action);
      });
    }
  }

  releaseAll() {
    for (const k of Object.keys(this.touch)) this.touch[k] = false;
    this.keys.clear();
  }

  /** Merge all sources. Call once per rendered frame. */
  update(dt) {
    const k = this.keys;
    const kLeft = k.has('ArrowLeft') || k.has('KeyA');
    const kRight = k.has('ArrowRight') || k.has('KeyD');
    const kGas = k.has('ArrowUp') || k.has('KeyW');
    const kBrake = k.has('ArrowDown') || k.has('KeyS') || k.has('Space');

    let steer = 0;
    let throttle = 0;
    let brake = 0;
    let analog = false;

    // Digital steering (keys / buttons) ramps in and out like a real wheel.
    const left = kLeft || (this.scheme === 'buttons' && this.touch.left);
    const right = kRight || (this.scheme === 'buttons' && this.touch.right);
    const target = (left ? 1 : 0) - (right ? 1 : 0);
    const rate = target === 0 ? 6 : Math.sign(target) !== Math.sign(this._keySteer) ? 8 : 3.2;
    this._keySteer += clamp(target - this._keySteer, -rate * dt, rate * dt);
    steer = this._keySteer;

    if (this.scheme !== 'buttons' && this.tiltAvailable && !left && !right) {
      // 30 degrees of rotation = full lock (scaled by sensitivity), small deadzone.
      const deg = this.tiltAngle;
      const dead = 1.5;
      const mag = Math.max(0, Math.abs(deg) - dead) / (30 / this.tiltSensitivity);
      // Tilting clockwise (right) should steer right (negative = right in physics).
      steer = -Math.sign(deg) * clamp(mag, 0, 1);
      analog = true;
    }

    throttle = kGas || this.touch.gas ? 1 : 0;
    brake = kBrake || this.touch.brake ? 1 : 0;
    if (this.scheme === 'tilt-auto' && !brake) throttle = 1;

    // Gamepad (first connected).
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const ax = p.axes[0] ?? 0;
      if (Math.abs(ax) > 0.08) {
        steer = -ax;
        analog = true;
      }
      const rt = p.buttons[7]?.value ?? 0;
      const lt = p.buttons[6]?.value ?? 0;
      if (rt > 0.05 || p.buttons[0]?.pressed) throttle = Math.max(throttle, p.buttons[0]?.pressed ? 1 : rt);
      if (lt > 0.05 || p.buttons[1]?.pressed) brake = Math.max(brake, p.buttons[1]?.pressed ? 1 : lt);
      break;
    }

    // Soften analog steering near center for precision.
    if (analog) steer = Math.sign(steer) * Math.pow(Math.abs(steer), 1.35);
    this.steer = clamp(steer, -1, 1);
    this.throttle = throttle;
    this.brake = brake;
  }
}
