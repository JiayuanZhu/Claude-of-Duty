/**
 * Touch input for mobile browsers.
 *
 * Injects virtual controls directly into the Input instance without changing
 * how gameplay reads it: movement goes through `input.stick`, look deltas
 * through `input._rawLook`, and button presses through `input._pendingDown` /
 * `input._pendingUp` — the same fields keyboard/mouse/gamepad write to.
 *
 * Layout (landscape):
 *   Left 40%  — virtual joystick (movement)
 *   Right 60% — look drag zone + HUD buttons
 *     Bottom-right corners: FIRE, ADS, JUMP, RELOAD
 */

const BTN_SIZE = 64;   // px
const JOY_RADIUS = 56; // px, outer ring
const JOY_KNOB = 22;   // px, inner knob

const STYLE = `
.ow-tc {
  position: fixed; inset: 0; z-index: 100;
  pointer-events: none; touch-action: none;
  user-select: none; -webkit-user-select: none;
}
.ow-joy-base {
  position: absolute;
  width: ${JOY_RADIUS * 2}px; height: ${JOY_RADIUS * 2}px;
  border-radius: 50%;
  background: rgba(255,255,255,0.12);
  border: 2px solid rgba(255,255,255,0.3);
  pointer-events: none;
  display: none;
}
.ow-joy-knob {
  position: absolute;
  width: ${JOY_KNOB * 2}px; height: ${JOY_KNOB * 2}px;
  border-radius: 50%;
  background: rgba(255,255,255,0.55);
  transform: translate(-50%, -50%);
  pointer-events: none;
}
.ow-btn {
  position: absolute;
  width: ${BTN_SIZE}px; height: ${BTN_SIZE}px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font: bold 13px/1 ui-monospace, monospace;
  color: rgba(255,255,255,0.9);
  pointer-events: auto;
  touch-action: none;
  border: 2px solid rgba(255,255,255,0.35);
}
.ow-btn-fire  { background: rgba(220,60,60,0.35); bottom:80px; right:16px; }
.ow-btn-ads   { background: rgba(60,120,220,0.35); bottom:160px; right:88px; }
.ow-btn-jump  { background: rgba(60,200,60,0.35); bottom:160px; right:16px; }
.ow-btn-reload{ background: rgba(200,160,40,0.35); bottom:240px; right:16px; }
.ow-look-zone {
  position: absolute;
  top:0; right:0; bottom:0;
  width: 60%;
  pointer-events: auto;
  touch-action: none;
}
.ow-joy-zone {
  position: absolute;
  top:0; left:0; bottom:0;
  width: 40%;
  pointer-events: auto;
  touch-action: none;
}
`;

export class TouchInput {
  constructor(input) {
    this.input = input;
    this.touchEnabled = true;

    // Virtual joystick state
    this._joyTouchId = null;
    this._joyOrigin = { x: 0, y: 0 };
    this._joyKnob = { x: 0, y: 0 };

    // Look state
    this._lookTouches = new Map(); // touchId -> {x, y}

    this._buildDOM();
    this._attach();
  }

  _buildDOM() {
    // Inject styles
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);
    this._style = style;

    // Root container
    const root = document.createElement('div');
    root.className = 'ow-tc';
    document.body.appendChild(root);
    this._root = root;

    // Joystick zone
    const joyZone = document.createElement('div');
    joyZone.className = 'ow-joy-zone';
    root.appendChild(joyZone);
    this._joyZone = joyZone;

    // Joystick visual base ring
    const joyBase = document.createElement('div');
    joyBase.className = 'ow-joy-base';
    root.appendChild(joyBase);
    this._joyBase = joyBase;

    // Joystick knob inside base
    const knob = document.createElement('div');
    knob.className = 'ow-joy-knob';
    knob.style.left = `${JOY_RADIUS}px`;
    knob.style.top = `${JOY_RADIUS}px`;
    joyBase.appendChild(knob);
    this._joyKnobEl = knob;

    // Look zone (right 60%)
    const lookZone = document.createElement('div');
    lookZone.className = 'ow-look-zone';
    root.appendChild(lookZone);
    this._lookZone = lookZone;

    // Buttons (inside look zone / root)
    const makeBtn = (cls, label) => {
      const b = document.createElement('div');
      b.className = `ow-btn ${cls}`;
      b.textContent = label;
      root.appendChild(b);
      return b;
    };
    this._fireBtn = makeBtn('ow-btn-fire', 'FIRE');
    this._adsBtn = makeBtn('ow-btn-ads', 'ADS');
    this._jumpBtn = makeBtn('ow-btn-jump', 'JUMP');
    this._reloadBtn = makeBtn('ow-btn-reload', 'R');
  }

  _attach() {
    const joy = this._joyZone;
    const look = this._lookZone;

    joy.addEventListener('touchstart', this._onJoyStart.bind(this), { passive: false });
    joy.addEventListener('touchmove', this._onJoyMove.bind(this), { passive: false });
    joy.addEventListener('touchend', this._onJoyEnd.bind(this), { passive: false });
    joy.addEventListener('touchcancel', this._onJoyEnd.bind(this), { passive: false });

    look.addEventListener('touchstart', this._onLookStart.bind(this), { passive: false });
    look.addEventListener('touchmove', this._onLookMove.bind(this), { passive: false });
    look.addEventListener('touchend', this._onLookEnd.bind(this), { passive: false });
    look.addEventListener('touchcancel', this._onLookEnd.bind(this), { passive: false });

    this._bindBtn(this._fireBtn, 'Mouse0');
    this._bindBtn(this._adsBtn, 'Mouse2');
    this._bindBtn(this._jumpBtn, 'Space');
    this._bindBtn(this._reloadBtn, 'KeyR');
  }

  _bindBtn(el, code) {
    el.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.input._pendingDown.add(code);
    }, { passive: false });
    el.addEventListener('touchend', (e) => {
      e.preventDefault();
      this.input._pendingUp.add(code);
    }, { passive: false });
    el.addEventListener('touchcancel', (e) => {
      e.preventDefault();
      this.input._pendingUp.add(code);
    }, { passive: false });
  }

  _onJoyStart(e) {
    e.preventDefault();
    if (this._joyTouchId !== null) return;
    const t = e.changedTouches[0];
    this._joyTouchId = t.identifier;
    this._joyOrigin.x = t.clientX;
    this._joyOrigin.y = t.clientY;
    this._joyKnob.x = 0;
    this._joyKnob.y = 0;

    // Show joystick at touch position
    this._joyBase.style.display = 'block';
    this._joyBase.style.left = `${t.clientX - JOY_RADIUS}px`;
    this._joyBase.style.top = `${t.clientY - JOY_RADIUS}px`;
    this._joyKnobEl.style.left = `${JOY_RADIUS}px`;
    this._joyKnobEl.style.top = `${JOY_RADIUS}px`;
  }

  _onJoyMove(e) {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier !== this._joyTouchId) continue;
      const dx = t.clientX - this._joyOrigin.x;
      const dy = t.clientY - this._joyOrigin.y;
      const len = Math.hypot(dx, dy);
      const clamped = Math.min(len, JOY_RADIUS);
      const nx = len > 0.01 ? dx / len : 0;
      const ny = len > 0.01 ? dy / len : 0;
      this._joyKnob.x = nx * (clamped / JOY_RADIUS);
      this._joyKnob.y = ny * (clamped / JOY_RADIUS);

      // Update knob visual
      this._joyKnobEl.style.left = `${JOY_RADIUS + nx * clamped}px`;
      this._joyKnobEl.style.top = `${JOY_RADIUS + ny * clamped}px`;
    }
  }

  _onJoyEnd(e) {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === this._joyTouchId) {
        this._joyTouchId = null;
        this._joyKnob.x = 0;
        this._joyKnob.y = 0;
        this._joyBase.style.display = 'none';
        break;
      }
    }
  }

  _onLookStart(e) {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      this._lookTouches.set(t.identifier, { x: t.clientX, y: t.clientY });
    }
  }

  _onLookMove(e) {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      const prev = this._lookTouches.get(t.identifier);
      if (!prev) continue;
      const dx = t.clientX - prev.x;
      const dy = t.clientY - prev.y;
      // Scale to match mouse sensitivity (touch is faster than mouse per pixel)
      this.input._rawLook.x += dx * 2.5;
      this.input._rawLook.y += dy * 2.5;
      prev.x = t.clientX;
      prev.y = t.clientY;
    }
  }

  _onLookEnd(e) {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      this._lookTouches.delete(e.changedTouches[i].identifier);
    }
  }

  /** Called each frame by Input.beginFrame() to flush stick state. */
  flush() {
    const inp = this.input;
    inp.stick.moveX = this._joyKnob.x;
    inp.stick.moveY = -this._joyKnob.y;  // screen Y+ = move backward
  }

  dispose() {
    this._root.remove();
    this._style.remove();
  }
}
