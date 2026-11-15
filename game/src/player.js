// The player: acceleration-based movement with crouch, jump and gravity,
// AABB collision against the arena, and the recoil the arsenal feeds back.
// Aiming down sights slows the player to a walk and tightens the mouse, so
// holding an angle is a real commitment. The simulation owns this state;
// rendering only reads it.
import { clampNum } from './util.js';

export const WALK_SPEED = 4.6;
export const SPRINT_SPEED = 6.4;
export const CROUCH_SPEED = 2.2;
export const AIM_SPEED = 2.6;
const ACCEL = 46;
const FRICTION = 11;
const GRAVITY = 22;
const JUMP_SPEED = 7.2;
const EYE_STAND = 1.62;
const EYE_CROUCH = 1.05;
const RADIUS = 0.42;

export function createOperative(world) {
  const state = {
    position: { x: 0, y: 0, z: 19 },
    velocity: { x: 0, y: 0, z: 0 },
    yaw: 0, // 0 faces north (-z), up the map from the attacker spawn
    pitch: 0,
    eye: EYE_STAND,
    crouched: false,
    aiming: false,
    onGround: true,
    health: 100,
    armor: 0,
    alive: true,
    // Recoil offsets decay back to zero; they add to the camera, not the aim.
    recoilPitch: 0,
    recoilYaw: 0,
    stepPhase: 0,
  };

  function look(dx, dy, sensitivity = 0.0022) {
    // Aiming down sights halves mouse sensitivity for fine aim.
    const scale = state.aiming ? 0.55 : 1;
    state.yaw -= dx * sensitivity * scale;
    state.pitch = clampNum(state.pitch - dy * sensitivity * scale, -1.53, 1.53);
  }

  function addRecoil(pitchKick, yawKick) {
    state.recoilPitch = clampNum(state.recoilPitch + pitchKick, 0, 0.12);
    state.recoilYaw = clampNum(state.recoilYaw + yawKick, -0.05, 0.05);
  }

  // Ground speed, for spread: moving fast means shooting badly.
  function groundSpeed() {
    return Math.hypot(state.velocity.x, state.velocity.z);
  }

  // onStep fires on a footstep; onLand fires when the player comes down
  // from a jump with real fall speed (a landing thud, not every step).
  function step(dt, keys, onStep, onLand) {
    if (!state.alive) return;
    const wasAirborne = !state.onGround;
    const fallSpeed = -state.velocity.y;
    state.crouched = keys.has('ControlLeft') || keys.has('KeyC');
    const sprinting = (keys.has('ShiftLeft') || keys.has('ShiftRight')) && !state.crouched && !state.aiming;
    const speed = state.crouched ? CROUCH_SPEED : state.aiming ? AIM_SPEED : sprinting ? SPRINT_SPEED : WALK_SPEED;

    let forward = 0;
    let strafe = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) forward += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) forward -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) strafe += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) strafe -= 1;
    const len = Math.hypot(forward, strafe) || 1;
    forward /= len;
    strafe /= len;

    // Wish direction in world space from the camera yaw.
    const sin = Math.sin(state.yaw);
    const cos = Math.cos(state.yaw);
    const wishX = -sin * forward + cos * strafe;
    const wishZ = -cos * forward - sin * strafe;

    state.velocity.x += wishX * ACCEL * dt;
    state.velocity.z += wishZ * ACCEL * dt;
    // Friction only when no input: the player stops, they do not slide.
    if (forward === 0 && strafe === 0) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      state.velocity.x *= damp;
      state.velocity.z *= damp;
    }
    // Cap horizontal speed at the current mode's limit.
    const hSpeed = Math.hypot(state.velocity.x, state.velocity.z);
    if (hSpeed > speed) {
      const scale = speed / hSpeed;
      state.velocity.x *= scale;
      state.velocity.z *= scale;
    }

    if (keys.has('Space') && state.onGround) {
      state.velocity.y = JUMP_SPEED;
      state.onGround = false;
    }
    state.velocity.y -= GRAVITY * dt;
    state.position.x += state.velocity.x * dt;
    state.position.z += state.velocity.z * dt;
    state.position.y += state.velocity.y * dt;
    if (state.position.y <= 0) {
      state.position.y = 0;
      state.velocity.y = 0;
      state.onGround = true;
      if (wasAirborne && fallSpeed > 6 && onLand) onLand();
    }

    world.collideCircle(state.position, RADIUS);

    // Eye height eases between stand and crouch.
    const targetEye = state.crouched ? EYE_CROUCH : EYE_STAND;
    state.eye += (targetEye - state.eye) * Math.min(1, dt * 12);

    // Recoil recovery: the kick fades, the aim returns.
    state.recoilPitch *= Math.max(0, 1 - dt * 9);
    state.recoilYaw *= Math.max(0, 1 - dt * 9);

    // Footsteps: one tick per stride, louder while sprinting.
    const speedNow = groundSpeed();
    if (state.onGround && speedNow > 1.2) {
      state.stepPhase += speedNow * dt * 1.6;
      if (state.stepPhase > Math.PI * 2) {
        state.stepPhase -= Math.PI * 2;
        if (onStep) onStep();
      }
    }
  }

  // Damage: armour absorbs 60% of a hit until it runs out.
  function damage(amount) {
    if (!state.alive) return 0;
    let remaining = amount;
    if (state.armor > 0) {
      const absorbed = Math.min(state.armor, remaining * 0.6);
      state.armor -= absorbed;
      remaining -= absorbed;
    }
    state.health -= remaining;
    if (state.health <= 0) {
      state.health = 0;
      state.alive = false;
    }
    return remaining;
  }

  function reset(spawn) {
    state.position.x = spawn.x;
    state.position.y = 0;
    state.position.z = spawn.z;
    state.velocity.x = 0;
    state.velocity.y = 0;
    state.velocity.z = 0;
    state.yaw = spawn.yaw;
    state.pitch = 0;
    state.eye = EYE_STAND;
    state.health = 100;
    state.armor = 0;
    state.alive = true;
    state.aiming = false;
    state.recoilPitch = 0;
    state.recoilYaw = 0;
  }

  return { state, look, addRecoil, groundSpeed, step, damage, reset };
}
