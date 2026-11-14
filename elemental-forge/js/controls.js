// Multi-touch + keyboard/mouse input. Produces a stick vector, look deltas and button states.
export class Controls {
  constructor(canvas) {
    this.canvas = canvas;
    this.stick = { x: 0, y: 0 };            // x right, y up (forward)
    this.look = { x: 0, y: 0 };             // accumulated pixel deltas since last read
    this.btn = { attack: false, bend: false, guard: false, jump: false, dodge: false };
    this.pressed = { attack: false, bend: false, guard: false, jump: false, dodge: false, lock: false };
    this.sens = 1;
    this.stickPtr = null; this.lookPtr = null;
    this.stickOrigin = { x: 0, y: 0 };
    this.btnPtrs = new Map();
    this.keys = new Set();
    this.touchUsed = false;
    this.enabled = false;

    this.base = document.getElementById('stick-base');
    this.knob = document.getElementById('stick-knob');

    const opts = { passive: false };
    canvas.addEventListener('pointerdown', e => this.onDown(e), opts);
    window.addEventListener('pointermove', e => this.onMove(e), opts);
    window.addEventListener('pointerup', e => this.onUp(e), opts);
    window.addEventListener('pointercancel', e => this.onUp(e), opts);
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('contextmenu', e => { if (this.enabled) e.preventDefault(); });

    for (const el of document.querySelectorAll('.act')) {
      el.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation();
        if (e.pointerType === 'touch') this.touchUsed = true;
        const a = el.dataset.act;
        this.btnPtrs.set(e.pointerId, { a, el });
        this.btn[a] = true; this.pressed[a] = true; el.classList.add('down');
        // allow sliding a thumb off a button into aiming
        try { el.releasePointerCapture(e.pointerId); } catch (_) {}
      }, opts);
    }
    document.getElementById('btn-lock').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); this.pressed.lock = true; }, opts);

    window.addEventListener('keydown', e => {
      if (!this.enabled) return;
      if (e.code === 'Tab') e.preventDefault();
      if (this.keys.has(e.code)) return;
      this.keys.add(e.code);
      const map = { Space: 'jump', ShiftLeft: 'dodge', ShiftRight: 'dodge', KeyQ: 'guard', KeyE: 'bend', KeyF: 'attack', Tab: 'lock', KeyT: 'lock' };
      const a = map[e.code];
      if (a) { this.pressed[a] = true; if (a in this.btn) this.btn[a] = true; }
    });
    window.addEventListener('keyup', e => {
      this.keys.delete(e.code);
      const map = { Space: 'jump', ShiftLeft: 'dodge', ShiftRight: 'dodge', KeyQ: 'guard', KeyE: 'bend', KeyF: 'attack' };
      const a = map[e.code]; if (a) this.btn[a] = false;
    });
    canvas.addEventListener('mousedown', e => {
      if (!this.enabled || this.touchUsed) return;
      if (document.pointerLockElement !== canvas) { canvas.requestPointerLock?.(); }
      if (e.button === 0) { this.btn.attack = true; this.pressed.attack = true; }
      if (e.button === 2) { this.btn.bend = true; this.pressed.bend = true; }
    });
    window.addEventListener('mouseup', e => { if (e.button === 0) this.btn.attack = false; if (e.button === 2) this.btn.bend = false; });
    document.addEventListener('mousemove', e => {
      if (document.pointerLockElement === canvas) { this.look.x += e.movementX * 0.9; this.look.y += e.movementY * 0.9; }
    });
  }

  onDown(e) {
    if (!this.enabled) return;
    if (e.pointerType === 'mouse') return; // mouse handled separately (pointer lock)
    e.preventDefault();
    this.touchUsed = true;
    const w = window.innerWidth;
    if (e.clientX < w * 0.45 && this.stickPtr === null) {
      this.stickPtr = e.pointerId;
      this.stickOrigin.x = e.clientX; this.stickOrigin.y = e.clientY;
      this.base.style.display = 'block';
      this.base.style.left = e.clientX + 'px'; this.base.style.top = e.clientY + 'px';
      this.knob.style.transform = 'translate(0px,0px)';
    } else if (this.lookPtr === null) {
      this.lookPtr = e.pointerId; this.lookLast = { x: e.clientX, y: e.clientY };
    }
  }
  onMove(e) {
    if (e.pointerId === this.stickPtr) {
      e.preventDefault();
      let dx = e.clientX - this.stickOrigin.x, dy = e.clientY - this.stickOrigin.y;
      const R = 58, d = Math.hypot(dx, dy);
      if (d > R) {
        // floating stick: drag the base along when the thumb overshoots
        const ex = d - R;
        this.stickOrigin.x += dx / d * ex; this.stickOrigin.y += dy / d * ex;
        this.base.style.left = this.stickOrigin.x + 'px'; this.base.style.top = this.stickOrigin.y + 'px';
        dx = dx / d * R; dy = dy / d * R;
      }
      this.knob.style.transform = `translate(${dx}px,${dy}px)`;
      let x = dx / R, y = -dy / R;
      const m = Math.hypot(x, y);
      const dead = 0.12;
      if (m < dead) { x = 0; y = 0; } else { const k = Math.min(1, (m - dead) / (1 - dead)) / m; x *= k; y *= k; }
      this.stick.x = x; this.stick.y = y;
    } else if (e.pointerId === this.lookPtr || (this.btnPtrs.has(e.pointerId))) {
      if (e.pointerId !== this.lookPtr) return;
      e.preventDefault();
      this.look.x += (e.clientX - this.lookLast.x) * 1.0;
      this.look.y += (e.clientY - this.lookLast.y) * 1.0;
      this.lookLast.x = e.clientX; this.lookLast.y = e.clientY;
    }
  }
  onUp(e) {
    if (e.pointerId === this.stickPtr) {
      this.stickPtr = null; this.stick.x = this.stick.y = 0; this.base.style.display = 'none';
    }
    if (e.pointerId === this.lookPtr) this.lookPtr = null;
    const b = this.btnPtrs.get(e.pointerId);
    if (b) { this.btnPtrs.delete(e.pointerId); if (![...this.btnPtrs.values()].some(v => v.a === b.a)) { this.btn[b.a] = false; b.el.classList.remove('down'); } }
  }

  // read and clear per-frame data
  frame() {
    let sx = this.stick.x, sy = this.stick.y;
    const k = this.keys;
    const kx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const ky = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    if (kx || ky) { const l = Math.hypot(kx, ky); sx = kx / l; sy = ky / l; }
    // touch look: radians per pixel scaled by screen size so it feels the same on any phone
    const scale = (this.touchUsed ? 3.4 / Math.max(window.innerWidth, 1) : 0.0026) * this.sens;
    const out = {
      mx: sx, my: sy,
      lookX: -this.look.x * scale, lookY: this.look.y * scale * 0.8,
      btn: { ...this.btn }, pressed: { ...this.pressed },
    };
    this.look.x = this.look.y = 0;
    for (const key in this.pressed) this.pressed[key] = false;
    return out;
  }

  reset() {
    this.stickPtr = this.lookPtr = null; this.stick.x = this.stick.y = 0;
    for (const a in this.btn) this.btn[a] = false;
    this.btnPtrs.clear(); this.base.style.display = 'none';
    document.querySelectorAll('.act.down').forEach(el => el.classList.remove('down'));
  }
}
