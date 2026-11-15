// Combat feedback effects: impact sparks, muzzle light and hit puffs.
// Everything here is pooled and allocation-free in the hot loop: one
// THREE.Points cloud holds every spark, each with a velocity and a life;
// the muzzle light is a single PointLight parented to the camera that
// flashes on every shot and decays. The game never creates meshes per shot.
import * as THREE from 'three';

const SPARK_MAX = 256;
const SPARK_LIFE = 0.45;

export function createEffects(scene, camera) {
  // Spark cloud: positions + per-particle velocity/life in plain arrays.
  const positions = new Float32Array(SPARK_MAX * 3);
  const velocities = new Float32Array(SPARK_MAX * 3);
  const lives = new Float32Array(SPARK_MAX);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xffc46b,
    size: 0.09,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const cloud = new THREE.Points(geo, mat);
  cloud.frustumCulled = false;
  scene.add(cloud);
  // Park every spark far below the map until it is used.
  for (let i = 0; i < SPARK_MAX; i += 1) positions[i * 3 + 1] = -100;
  let cursor = 0;

  // Muzzle light: a warm point light at the gun that flashes per shot.
  const muzzleLight = new THREE.PointLight(0xffc46b, 0, 9, 1.6);
  muzzleLight.position.set(0.24, -0.1, -0.9);
  camera.add(muzzleLight);
  let muzzleAge = 1;

  function spawnSparks(x, y, z, count, color, speed) {
    mat.color.setHex(color);
    for (let n = 0; n < count; n += 1) {
      const i = cursor;
      cursor = (cursor + 1) % SPARK_MAX;
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      const a = Math.random() * Math.PI * 2;
      const b = Math.random() * Math.PI - Math.PI / 2;
      const v = speed * (0.4 + Math.random() * 0.6);
      velocities[i * 3] = Math.cos(a) * Math.cos(b) * v;
      velocities[i * 3 + 1] = Math.sin(b) * v + 1.2;
      velocities[i * 3 + 2] = Math.sin(a) * Math.cos(b) * v;
      lives[i] = SPARK_LIFE * (0.6 + Math.random() * 0.4);
    }
    geo.attributes.position.needsUpdate = true;
  }

  // Wall impact: a short orange burst where a bullet struck.
  function impact(point) {
    spawnSparks(point.x, point.y, point.z, 10, 0xffc46b, 3.2);
  }

  // Flesh hit: a smaller red puff on the target.
  function hitPuff(point) {
    spawnSparks(point.x, point.y, point.z, 7, 0xff5d5d, 2.2);
  }

  function flashMuzzle() {
    muzzleLight.intensity = 7;
    muzzleAge = 0;
  }

  function step(dt) {
    for (let i = 0; i < SPARK_MAX; i += 1) {
      if (lives[i] <= 0) continue;
      lives[i] -= dt;
      if (lives[i] <= 0) {
        positions[i * 3 + 1] = -100;
        continue;
      }
      positions[i * 3] += velocities[i * 3] * dt;
      positions[i * 3 + 1] += velocities[i * 3 + 1] * dt;
      positions[i * 3 + 2] += velocities[i * 3 + 2] * dt;
      velocities[i * 3 + 1] -= 9 * dt;
      if (positions[i * 3 + 1] < 0.02) {
        positions[i * 3 + 1] = 0.02;
        velocities[i * 3 + 1] = Math.abs(velocities[i * 3 + 1]) * 0.3;
      }
    }
    geo.attributes.position.needsUpdate = true;
    if (muzzleAge < 1) {
      muzzleAge = Math.min(1, muzzleAge + dt * 16);
      muzzleLight.intensity = 7 * (1 - muzzleAge);
    }
  }

  return { impact, hitPuff, flashMuzzle, step };
}
