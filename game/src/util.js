// Pure number helpers shared by every module. Nothing here touches the
// DOM, the renderer or game state: seeded randoms for deterministic
// captures, clamps, angle wrapping and flat-plane distance. Hot loops reuse
// the scratch point instead of allocating vectors per frame.
export function rngFromSeed(seedValue) {
  let a = seedValue >>> 0;
  return function nextRandom() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clampNum(value, low, high) {
  return value < low ? low : value > high ? high : value;
}

export function lerpNum(from, to, t) {
  return from + (to - from) * t;
}

export function wrapRad(angle) {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

export function angleDiff(from, to) {
  return wrapRad(to - from);
}

// Distance on the ground plane; the arenas are flat, so height never counts.
export function flatDist(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

// A reusable {x, y, z} scratch object for raycasts and direction maths.
export function scratchPoint() {
  return { x: 0, y: 0, z: 0 };
}
