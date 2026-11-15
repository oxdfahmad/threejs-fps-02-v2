// Keyboard and mouse, with pointer lock. This module only reports state:
// which keys are held, which were pressed once since the last read, how far
// the mouse moved, whether the trigger is down and whether the player is
// aiming down sights (right mouse held). It never decides what a key does.
export function createControls(canvas, onLockChange) {
  const held = new Set();
  const edge = new Set();
  const lookDelta = { x: 0, y: 0 };
  let triggerDown = false;
  let aiming = false;
  let locked = false;

  function keyDown(event) {
    if (event.repeat) return;
    held.add(event.code);
    edge.add(event.code);
    if (event.code === 'Space') event.preventDefault();
    if (event.code === 'Tab') event.preventDefault();
  }
  function keyUp(event) {
    held.delete(event.code);
  }
  function mouseMove(event) {
    if (!locked) return;
    lookDelta.x += event.movementX;
    lookDelta.y += event.movementY;
  }
  function mouseDown(event) {
    if (!locked) return;
    if (event.button === 0) triggerDown = true;
    if (event.button === 2) aiming = true;
  }
  function mouseUp(event) {
    if (event.button === 0) triggerDown = false;
    if (event.button === 2) aiming = false;
  }
  function lockChange() {
    locked = document.pointerLockElement === canvas;
    if (!locked) {
      triggerDown = false;
      aiming = false;
    }
    onLockChange(locked);
  }
  function contextMenu(event) {
    event.preventDefault();
  }

  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', keyUp);
  window.addEventListener('mousemove', mouseMove);
  window.addEventListener('mousedown', mouseDown);
  window.addEventListener('mouseup', mouseUp);
  document.addEventListener('pointerlockchange', lockChange);
  canvas.addEventListener('contextmenu', contextMenu);

  return {
    held,
    get firing() {
      return triggerDown;
    },
    get aiming() {
      return aiming;
    },
    get locked() {
      return locked;
    },
    requestLock() {
      // Newer Chrome returns a promise that rejects when the document
      // cannot take the lock (headless, iframe, denied permission). A
      // rejected lock is not a game error — swallow it instead of
      // leaving an uncaught rejection in the console.
      const result = canvas.requestPointerLock();
      if (result && typeof result.catch === 'function') result.catch(() => {});
    },
    releaseLock() {
      if (document.pointerLockElement) document.exitPointerLock();
    },
    // Drop every held key and pending edge (Alt-Tab, window blur): without
    // this a key released while the tab is unfocused stays held forever.
    clearAll() {
      held.clear();
      edge.clear();
      triggerDown = false;
      aiming = false;
    },
    // Mouse travel since the last call, in raw pixels.
    takeLook() {
      const out = { x: lookDelta.x, y: lookDelta.y };
      lookDelta.x = 0;
      lookDelta.y = 0;
      return out;
    },
    // True once per physical press; reading it consumes it.
    takePressed(code) {
      if (!edge.has(code)) return false;
      edge.delete(code);
      return true;
    },
    // First of these codes pressed since the last frame, or null.
    takeAnyPressed(codes) {
      for (const code of codes) {
        if (edge.has(code)) {
          edge.delete(code);
          return code;
        }
      }
      return null;
    },
    clearPressed() {
      edge.clear();
    },
  };
}
