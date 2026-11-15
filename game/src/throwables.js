// Throwables: the GL-4 frag, the SK-2 smoke and the FB-9 flashbang.
// All three fly on the same arc, bounce off walls and the floor, then do
// their job. The frag explodes for area damage. The smoke blooms into a
// cloud that blocks sight for both teams — bots cannot see through it and
// neither can the player's raycast. The flash blinds anyone looking at it.
// One module owns every live throwable; main.js reads the events it reports.
import * as THREE from 'three';
import { flatDist } from './util.js';

const GRAVITY = 14;
const FRAG_FUSE = 1.6;
const FRAG_RADIUS = 6.5;
const FRAG_DAMAGE = 110;
const SMOKE_FUSE = 1.2;
const SMOKE_RADIUS = 4.2;
const SMOKE_LIFE = 12;
const FLASH_FUSE = 1.1;
const FLASH_RADIUS = 14;
const BOUNCE = 0.45;

export function createThrowables(scene) {
  const live = [];
  const ballGeo = new THREE.SphereGeometry(0.09, 10, 8);
  const fragMat = new THREE.MeshStandardMaterial({ color: 0x2a2e38, roughness: 0.4, metalness: 0.8 });
  const smokeMat = new THREE.MeshStandardMaterial({ color: 0x9aa4b0, roughness: 0.9, metalness: 0 });
  const flashMat = new THREE.MeshStandardMaterial({ color: 0xd8dce2, roughness: 0.3, metalness: 0.6 });
  const ringGeo = new THREE.RingGeometry(0.3, 0.55, 32);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xffb454,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  // One shared smoke material so every cloud fades together.
  const cloudMat = new THREE.MeshBasicMaterial({
    color: 0x8b95a3, transparent: true, opacity: 0.55, depthWrite: false,
  });
  const cloudGeo = new THREE.SphereGeometry(1, 12, 10);

  function throwOne(kind, from, direction, audio) {
    const mat = kind === 'smoke' ? smokeMat : kind === 'flash' ? flashMat : fragMat;
    const mesh = new THREE.Mesh(ballGeo, mat);
    mesh.position.copy(from);
    scene.add(mesh);
    const ring = new THREE.Mesh(ringGeo, ringMat.clone());
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(from);
    ring.visible = false;
    scene.add(ring);
    // A smoke cloud is five overlapping spheres that scale up on bloom.
    const puffs = [];
    if (kind === 'smoke') {
      for (let i = 0; i < 5; i += 1) {
        const puff = new THREE.Mesh(cloudGeo, cloudMat);
        puff.visible = false;
        puff.position.copy(from);
        scene.add(puff);
        puffs.push(puff);
      }
    }
    live.push({
      kind,
      mesh,
      ring,
      puffs,
      velocity: {
        x: direction.x * 13,
        y: direction.y * 13 + 4.5,
        z: direction.z * 13,
      },
      fuse: kind === 'frag' ? FRAG_FUSE : kind === 'smoke' ? SMOKE_FUSE : FLASH_FUSE,
      beeped: false,
      done: false,
      ringAge: 0,
      cloudAge: 0,
      cloudCentre: { x: from.x, y: from.y, z: from.z },
    });
    audio.beep();
  }

  // Active smoke clouds, for vision checks: {x, z, radius}.
  function smokeZones() {
    const zones = [];
    for (const g of live) {
      if (g.kind === 'smoke' && g.done && g.cloudAge < SMOKE_LIFE) {
        zones.push({ x: g.cloudCentre.x, z: g.cloudCentre.z, radius: SMOKE_RADIUS });
      }
    }
    return zones;
  }

  // Does the segment from->to pass through any live smoke cloud? Used to
  // block the player's raycast the same way it blocks bot vision.
  function shotBlocked(from, to) {
    for (const zone of smokeZones()) {
      if (segmentHitsCircle(from.x, from.z, to.x, to.z, zone.x, zone.z, zone.radius)) return true;
    }
    return false;
  }

  // 2D segment vs circle: true when the segment crosses the disc.
  function segmentHitsCircle(ax, az, bx, bz, cx, cz, r) {
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    if (len2 < 1e-9) return flatDist(ax, az, cx, cz) < r;
    let t = ((cx - ax) * dx + (cz - az) * dz) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = ax + dx * t;
    const pz = az + dz * t;
    return flatDist(px, pz, cx, cz) < r;
  }

  // Returns events for main.js: frag {type:'frag',x,y,z,radius,damage},
  // smoke {type:'smoke',x,y,z}, flash {type:'flash',x,y,z}.
  function step(dt, world, audio) {
    const events = [];
    for (let i = live.length - 1; i >= 0; i -= 1) {
      const g = live[i];
      if (g.done) {
        if (g.kind === 'frag') {
          g.ringAge += dt;
          const t = g.ringAge / 0.6;
          if (t >= 1) {
            scene.remove(g.ring);
            live.splice(i, 1);
          } else {
            const scale = 1 + t * FRAG_RADIUS * 2;
            g.ring.scale.set(scale, scale, 1);
            g.ring.material.opacity = 0.85 * (1 - t);
          }
        } else if (g.kind === 'smoke') {
          g.cloudAge += dt;
          const grow = Math.min(1, g.cloudAge / 1.2);
          const fade = g.cloudAge > SMOKE_LIFE - 3 ? Math.max(0, (SMOKE_LIFE - g.cloudAge) / 3) : 1;
          for (let p = 0; p < g.puffs.length; p += 1) {
            const puff = g.puffs[p];
            const s = SMOKE_RADIUS * (0.55 + (p % 3) * 0.22) * (0.6 + grow * 0.4);
            puff.scale.set(s, s * 0.62, s);
            puff.material.opacity = 0.5 * fade;
          }
          if (g.cloudAge >= SMOKE_LIFE) {
            for (const puff of g.puffs) scene.remove(puff);
            scene.remove(g.ring);
            live.splice(i, 1);
          }
        } else {
          // Flash: nothing lingers; the pop is the event itself.
          scene.remove(g.ring);
          live.splice(i, 1);
        }
        continue;
      }
      g.fuse -= dt;
      if (g.fuse < 0.8 && !g.beeped) {
        g.beeped = true;
        audio.plantTick();
      }
      g.velocity.y -= GRAVITY * dt;
      const pos = g.mesh.position;
      pos.x += g.velocity.x * dt;
      pos.y += g.velocity.y * dt;
      pos.z += g.velocity.z * dt;
      // Floor bounce.
      if (pos.y < 0.09) {
        pos.y = 0.09;
        g.velocity.y = Math.abs(g.velocity.y) * BOUNCE;
        g.velocity.x *= 0.7;
        g.velocity.z *= 0.7;
      }
      // Wall bounce: reuse the map's circle collision, then reflect velocity.
      const before = { x: pos.x, z: pos.z };
      world.collideCircle(pos, 0.09);
      if (pos.x !== before.x) g.velocity.x = -g.velocity.x * BOUNCE;
      if (pos.z !== before.z) g.velocity.z = -g.velocity.z * BOUNCE;
      if (g.fuse <= 0) {
        g.done = true;
        g.cloudCentre.x = pos.x;
        g.cloudCentre.y = pos.y;
        g.cloudCentre.z = pos.z;
        if (g.kind === 'frag') {
          g.ring.visible = true;
          g.ring.position.set(pos.x, 0.05, pos.z);
          scene.remove(g.mesh);
          audio.explosion();
          events.push({ type: 'frag', x: pos.x, y: pos.y, z: pos.z, radius: FRAG_RADIUS, damage: FRAG_DAMAGE });
        } else if (g.kind === 'smoke') {
          // Bloom the puffs around the landing point, slightly spread out.
          const offsets = [[0, 0], [2.2, 0.8], [-2, 1.2], [1, -2.2], [-1.6, -1.4]];
          for (let p = 0; p < g.puffs.length; p += 1) {
            const puff = g.puffs[p];
            puff.position.set(pos.x + offsets[p][0], 1.1, pos.z + offsets[p][1]);
            puff.visible = true;
          }
          scene.remove(g.mesh);
          audio.smokeHiss();
          events.push({ type: 'smoke', x: pos.x, y: pos.y, z: pos.z });
        } else {
          scene.remove(g.mesh);
          audio.flashRing();
          events.push({ type: 'flash', x: pos.x, y: pos.y, z: pos.z });
        }
      }
    }
    return events;
  }

  function reset() {
    for (const g of live) {
      scene.remove(g.mesh);
      scene.remove(g.ring);
      for (const puff of g.puffs) scene.remove(puff);
    }
    live.length = 0;
  }

  // Raycast entry point: the first point where a ray from `from` along
  // `dir` (both THREE vectors) enters a blooming smoke cloud, or null.
  // Used for tracer/shot blocking and for the muzzle-flash light path.
  function smokeEntry(from, dir, maxDist) {
    let best = null;
    let bestT = maxDist;
    for (const cloud of live) {
      if (cloud.kind !== 'smoke' || cloud.fuse > 0) continue;
      for (let i = 0; i < cloud.puffs.length; i += 1) {
        const puff = cloud.puffs[i];
        const radius = SMOKE_RADIUS * 0.8;
        const ox = puff.position.x - from.x;
        const oy = puff.position.y - from.y;
        const oz = puff.position.z - from.z;
        const tca = ox * dir.x + oy * dir.y + oz * dir.z;
        if (tca < 0 || tca > bestT) continue;
        const d2 = ox * ox + oy * oy + oz * oz - tca * tca;
        if (d2 > radius * radius) continue;
        const tHit = tca - Math.sqrt(radius * radius - d2);
        if (tHit < 0 || tHit > bestT) continue;
        bestT = tHit;
        best = { x: from.x + dir.x * tHit, y: from.y + dir.y * tHit, z: from.z + dir.z * tHit };
      }
    }
    return best;
  }

  return { throwOne, step, reset, smokeZones, shotBlocked, smokeEntry, get count() { return live.length; } };
}
