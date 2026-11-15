// The squad: five WARDEN defenders and two BREACH allies with a real
// brain. Each defender has a role from the arena — two hold the sites, two
// roam the lanes, one is a sniper holding a long angle — and a state
// machine: ROUTE (walk the waypoint graph), HOLD (watch an angle), ENGAGE
// (shoot what it sees), CHASE (push a sound or a glimpse), DEFUSE (run to
// a planted spike and channel the defuse), BLIND (stumble after a flash).
// Vision is range + angle + line of sight, and smoke kills it: a bot cannot
// see through a smoke cloud in either direction. Hearing is a radius around
// loud events. Shooting is hitscan with reaction time, per-shot accuracy
// that worsens with distance and target speed, and damage falloff — so a
// still, aiming player is punished and a strafing one survives longer.
import * as THREE from 'three';
import { clampNum, flatDist, angleDiff, wrapRad } from './util.js';

const BOT_RADIUS = 0.42;
const BOT_HEIGHT = 1.75;
const BOT_SPEED = 3.4;
const BOT_HEALTH = 100;
const VIEW_RANGE = 34;
const VIEW_HALF_ANGLE = 1.05; // ~60 degrees each side
const HEAR_RADIUS = 16;

// Per-role shooting: the sniper fires rarely, slowly, and very hard.
const GUN_PROFILES = {
  rifle: { damage: 24, interval: 0.55, spreadBase: 0.02, spreadPerMetre: 0.0016 },
  sniper: { damage: 46, interval: 1.7, spreadBase: 0.008, spreadPerMetre: 0.0006 },
};

// Bot skins: a capsule body in team colour, a darker visor head, a gun bar.
// The sniper's gun is longer and carries a scope glint.
function buildBotMesh(scene, color, sniper) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.2 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.6, metalness: 0.4 });
  const visorMat = new THREE.MeshStandardMaterial({
    color: 0x2fd4ff,
    emissive: 0x2fd4ff,
    emissiveIntensity: 1.4,
    roughness: 0.3,
  });
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.38, 0.95, 10), bodyMat);
  torso.position.y = 1.05;
  torso.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), darkMat);
  head.position.y = 1.72;
  head.castShadow = true;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.07, 0.05), visorMat);
  visor.position.set(0, 1.74, 0.22);
  const gun = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.09, sniper ? 1.1 : 0.7),
    darkMat,
  );
  gun.position.set(0.28, 1.25, sniper ? 0.45 : 0.3);
  const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.32, 0.55, 10), darkMat);
  legs.position.y = 0.28;
  group.add(torso, head, visor, gun, legs);
  // Tag meshes so the shooter's raycast can tell head from body.
  torso.userData.part = 'body';
  head.userData.part = 'head';
  visor.userData.part = 'head';
  legs.userData.part = 'legs';
  group.traverse((child) => {
    if (child.isMesh) child.userData.botMesh = true;
  });
  scene.add(group);
  return { group, torso, head, visor, gun, legs };
}

export function createSquad(scene, world, random) {
  const bots = [];
  let idCounter = 0;

  function spawn(ally, index, spawnPoint, role) {
    const color = ally ? 0x2fd4ff : 0xff4d8d;
    const isSniper = role.role === 'sniper';
    const parts = buildBotMesh(scene, color, isSniper);
    const bot = {
      id: idCounter,
      ally,
      name: ally ? `BREACH-${index + 1}` : `WARDEN-${index + 1}`,
      role: role.role,
      gun: isSniper ? 'sniper' : 'rifle',
      parts,
      position: { x: spawnPoint.x, y: 0, z: spawnPoint.z },
      yaw: spawnPoint.yaw,
      pitch: 0,
      health: BOT_HEALTH,
      alive: true,
      state: 'hold',
      route: [],
      routeIndex: 0,
      patrolIndex: 0,
      holdNode: role.holdNode,
      patrol: role.patrol,
      target: null, // {x, y, z, kind: 'player'|'bot', ref}
      lastSeenAt: -99,
      lastSeenPos: { x: 0, y: 0, z: 0 },
      nextShotAt: 0,
      reactionAt: 0,
      heardAt: -99,
      heardPos: { x: 0, y: 0, z: 0 },
      blindUntil: -99,
      defuseProgress: 0,
      flanked: false,
      flanking: false, // true only while walking the flank detour, not the site route
      speed: BOT_SPEED * (0.92 + random() * 0.16) * (isSniper ? 0.85 : 1),
      skill: 0.55 + random() * 0.3,
      bobPhase: random() * Math.PI * 2,
    };
    parts.group.traverse((child) => {
      if (child.isMesh) child.userData.bot = bot;
    });
    parts.group.position.set(spawnPoint.x, 0, spawnPoint.z);
    parts.group.rotation.y = spawnPoint.yaw;
    bots.push(bot);
    idCounter += 1;
    return bot;
  }

  function spawnRound(allyCount, enemyCount) {
    for (const bot of bots) scene.remove(bot.parts.group);
    bots.length = 0;
    idCounter = 0;
    const allySpawns = world.spawns.attacker;
    const enemySpawns = world.spawns.defender;
    for (let i = 0; i < allyCount; i += 1) {
      spawn(true, i, allySpawns[i % allySpawns.length], { role: 'ally', holdNode: 4, patrol: [4, 7, 8, 11] });
    }
    for (let i = 0; i < enemyCount; i += 1) {
      spawn(false, i, enemySpawns[i % enemySpawns.length], world.roles[i % world.roles.length]);
    }
    return bots;
  }

  function setRoute(bot, nodeIndex) {
    const from = world.nearestNode(bot.position.x, bot.position.z);
    bot.route = world.findPath(from, nodeIndex);
    bot.routeIndex = 0;
    bot.state = 'route';
  }

  // Vision: in range, inside the view cone, a clear line of sight, and no
  // smoke cloud between the bot and the target.
  function canSee(bot, tx, tz, smokeZones, ty = 1.4) {
    const dx = tx - bot.position.x;
    const dz = tz - bot.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance > VIEW_RANGE) return false;
    const angleTo = Math.atan2(-dx, -dz);
    if (Math.abs(angleDiff(bot.yaw, angleTo)) > VIEW_HALF_ANGLE && distance > 3) return false;
    if (!world.hasLineOfSight(bot.position.x, bot.position.z, tx, tz)) return false;
    for (const zone of smokeZones) {
      if (segmentCrossesDisc(bot.position.x, bot.position.z, tx, tz, zone.x, zone.z, zone.radius)) return false;
    }
    return true;
  }

  function segmentCrossesDisc(ax, az, bx, bz, cx, cz, r) {
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    if (len2 < 1e-9) return flatDist(ax, az, cx, cz) < r;
    let t = ((cx - ax) * dx + (cz - az) * dz) / len2;
    t = Math.max(0, Math.min(1, t));
    return flatDist(ax + dx * t, az + dz * t, cx, cz) < r;
  }

  function hear(bot, x, z, now) {
    if (flatDist(bot.position.x, bot.position.z, x, z) > HEAR_RADIUS) return;
    bot.heardAt = now;
    bot.heardPos.x = x;
    bot.heardPos.z = z;
  }

  function hearAll(x, z, now) {
    for (const bot of bots) if (bot.alive) hear(bot, x, z, now);
  }

  // A flashbang blinds every bot that can see the pop, longer up close.
  function flashBots(x, y, z, now) {
    for (const bot of bots) {
      if (!bot.alive) continue;
      const d = flatDist(bot.position.x, bot.position.z, x, z);
      if (d > 14) continue;
      if (!world.hasLineOfSight(bot.position.x, bot.position.z, x, z)) continue;
      const dx = x - bot.position.x;
      const dz = z - bot.position.z;
      const angleTo = Math.atan2(-dx, -dz);
      const facing = Math.abs(angleDiff(bot.yaw, angleTo)) < 1.2;
      const duration = (facing ? 2.6 : 1.2) * (1 - d / 18);
      bot.blindUntil = now + Math.max(0.6, duration);
      bot.target = null;
    }
  }

  // Pick the nearest visible enemy: the player first, then ally bots.
  function acquireTarget(bot, player, now, smokeZones) {
    let best = null;
    let bestD = Infinity;
    if (player.alive && canSee(bot, player.position.x, player.position.z, smokeZones, player.position.y + player.eye)) {
      best = { kind: 'player', ref: player, x: player.position.x, y: player.position.y + player.eye, z: player.position.z };
      bestD = flatDist(bot.position.x, bot.position.z, player.position.x, player.position.z);
    }
    for (const other of bots) {
      if (!other.alive || other.ally === bot.ally) continue;
      const d = flatDist(bot.position.x, bot.position.z, other.position.x, other.position.z);
      if (d < bestD && canSee(bot, other.position.x, other.position.z, smokeZones, 1.4)) {
        best = { kind: 'bot', ref: other, x: other.position.x, y: 1.4, z: other.position.z };
        bestD = d;
      }
    }
    if (best) {
      if (!bot.target) bot.reactionAt = now + 0.35 + random() * 0.35;
      bot.target = best;
      bot.lastSeenAt = now;
      bot.lastSeenPos.x = best.x;
      bot.lastSeenPos.z = best.z;
    }
    return bot.target;
  }

  function moveToward(bot, tx, tz, dt, speedScale = 1) {
    const dx = tx - bot.position.x;
    const dz = tz - bot.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.15) return true;
    const stepLen = Math.min(distance, bot.speed * speedScale * dt);
    bot.position.x += (dx / distance) * stepLen;
    bot.position.z += (dz / distance) * stepLen;
    const targetYaw = Math.atan2(-dx, -dz);
    bot.yaw += clampNum(angleDiff(bot.yaw, targetYaw), -dt * 6, dt * 6);
    world.collideCircle(bot.position, BOT_RADIUS);
    return distance < 0.4;
  }

  // One fixed step for one bot. Returns shot events for main.js to resolve.
  function stepBot(bot, dt, now, player, spikePlanted, spikeSite, smokeZones) {
    if (!bot.alive) return [];
    const shots = [];

    // Flashed: stumble blind, no vision, no shooting.
    if (now < bot.blindUntil) {
      bot.yaw += dt * 1.5;
      bot.position.x += Math.sin(bot.yaw) * dt * 0.8;
      bot.position.z += Math.cos(bot.yaw) * dt * 0.8;
      world.collideCircle(bot.position, BOT_RADIUS);
      bot.parts.group.position.set(bot.position.x, 0, bot.position.z);
      bot.parts.group.rotation.y = bot.yaw;
      return shots;
    }

    // Planted spike: defenders abandon their posts and run to defuse. The
    // first one to rotate takes a flanking lane so the retake is not a
    // single-file push down mid.
    if (!bot.ally && spikePlanted && spikeSite) {
      if (bot.state !== 'defuse' && bot.state !== 'engage') {
        const centre = {
          x: (spikeSite.minX + spikeSite.maxX) / 2,
          z: (spikeSite.minZ + spikeSite.maxZ) / 2,
        };
        if (!bot.flanked && bot.role === 'roam') {
          bot.flanked = true;
          bot.flanking = true;
          const detour = world.nodes[bot.holdNode];
          setRoute(bot, world.nearestNode(detour.x, detour.z));
          bot.state = 'defuse';
        } else {
          setRoute(bot, world.nearestNode(centre.x, centre.z));
          bot.state = 'defuse';
        }
      }
      if (bot.state === 'defuse' && bot.route.length === 0) {
        const cx = (spikeSite.minX + spikeSite.maxX) / 2;
        const cz = (spikeSite.minZ + spikeSite.maxZ) / 2;
        if (flatDist(bot.position.x, bot.position.z, cx, cz) < 1.6) {
          bot.defuseProgress += dt;
        }
      }
    }

    const target = acquireTarget(bot, player, now, smokeZones);
    if (target) {
      bot.state = 'engage';
      const dx = target.x - bot.position.x;
      const dz = target.z - bot.position.z;
      const targetYaw = Math.atan2(-dx, -dz);
      bot.yaw += clampNum(angleDiff(bot.yaw, targetYaw), -dt * 8, dt * 8);
      // Fire once the reaction time has passed, on a steady cadence.
      if (now >= bot.reactionAt && now >= bot.nextShotAt) {
        const profile = GUN_PROFILES[bot.gun];
        const distance = Math.hypot(dx, dz);
        const targetSpeed = target.kind === 'player' ? Math.hypot(target.ref.velocity.x, target.ref.velocity.z) : 2.5;
        // Accuracy: closer and slower targets are easier; skill scales it.
        let spread = profile.spreadBase + distance * profile.spreadPerMetre + targetSpeed * 0.004;
        spread /= bot.skill;
        const damage = profile.damage * clampNum(1 - distance / 90, 0.35, 1);
        shots.push({
          from: { x: bot.position.x, y: 1.45, z: bot.position.z },
          target,
          spread,
          damage,
          shooter: bot,
        });
        bot.nextShotAt = now + profile.interval + random() * 0.5;
      }
      // Strafe a little while engaging so bots are not statues.
      bot.bobPhase += dt * 2;
      const strafe = Math.sin(bot.bobPhase) * 0.6;
      const sideX = Math.cos(bot.yaw);
      const sideZ = -Math.sin(bot.yaw);
      bot.position.x += sideX * strafe * dt;
      bot.position.z += sideZ * strafe * dt;
      world.collideCircle(bot.position, BOT_RADIUS);
    } else if (now - bot.lastSeenAt < 2.5) {
      // Lost sight recently: push the last known position.
      bot.state = 'chase';
      moveToward(bot, bot.lastSeenPos.x, bot.lastSeenPos.z, dt, 1.1);
    } else if (now - bot.heardAt < 3 && bot.heardAt > 0) {
      bot.state = 'chase';
      if (moveToward(bot, bot.heardPos.x, bot.heardPos.z, dt, 1.05)) bot.heardAt = -99;
    } else if (bot.state === 'route' && bot.route.length > 0) {
      const node = world.nodes[bot.route[bot.routeIndex]];
      if (moveToward(bot, node.x, node.z, dt)) {
        bot.routeIndex += 1;
        if (bot.routeIndex >= bot.route.length) {
          bot.route = [];
          bot.state = 'hold';
        }
      }
    } else if (bot.state === 'defuse' && bot.route.length > 0) {
      // Walking the defuse route: follow it node by node. When the flank
      // detour ends, drop back to 'hold' so the routing block above sends
      // the bot on to the site itself; when the site route ends, stay in
      // 'defuse' with an empty route so the defuse timer can run.
      const node = world.nodes[bot.route[bot.routeIndex]];
      if (moveToward(bot, node.x, node.z, dt, 1.15)) {
        bot.routeIndex += 1;
        if (bot.routeIndex >= bot.route.length) {
          bot.route = [];
          if (bot.flanking) {
            bot.flanking = false;
            bot.state = 'hold';
          }
        }
      }
    } else if (bot.state === 'hold' || bot.state === 'chase') {
      // Patrol: hold a while, then walk to the next patrol node. The sniper
      // holds far longer than anyone else — it owns its angle.
      bot.patrolIndex = (bot.patrolIndex + 1) % bot.patrol.length;
      const patrolChance = bot.gun === 'sniper' ? 0.006 : 0.02;
      if (random() < patrolChance) setRoute(bot, bot.patrol[bot.patrolIndex]);
      // Slowly scan the surroundings while holding.
      bot.yaw += Math.sin(now * 0.5 + bot.id) * dt * 0.35;
    }

    // Sync the mesh: position, facing, and a walk bob.
    const moving = bot.state === 'route' || bot.state === 'chase' || bot.state === 'defuse';
    const bob = moving ? Math.sin(now * 10 + bot.id) * 0.04 : 0;
    bot.parts.group.position.set(bot.position.x, bob, bot.position.z);
    bot.parts.group.rotation.y = bot.yaw;
    return shots;
  }

  function step(dt, now, player, spikePlanted, spikeSite, smokeZones) {
    const shots = [];
    for (const bot of bots) {
      shots.push(...stepBot(bot, dt, now, player, spikePlanted, spikeSite, smokeZones));
    }
    return shots;
  }

  function damage(bot, amount, part) {
    if (!bot.alive) return false;
    let dealt = amount;
    if (part === 'head') dealt *= 2.2;
    else if (part === 'legs') dealt *= 0.75;
    bot.health -= dealt;
    if (bot.health <= 0) {
      bot.health = 0;
      bot.alive = false;
      bot.parts.group.visible = false;
    }
    return !bot.alive;
  }

  function aliveCount(ally) {
    return bots.filter((b) => b.alive && b.ally === ally).length;
  }

  function hitMeshes() {
    const meshes = [];
    for (const bot of bots) {
      if (!bot.alive) continue;
      meshes.push(bot.parts.torso, bot.parts.head, bot.parts.visor, bot.parts.legs);
    }
    return meshes;
  }

  return {
    bots,
    spawnRound,
    step,
    damage,
    aliveCount,
    hitMeshes,
    hearAll,
    flashBots,
    get all() {
      return bots;
    },
  };
}
