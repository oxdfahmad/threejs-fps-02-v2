// Neon Breach II — boot, fixed-step simulation, shooting and round flow.
// This file is the single store: it creates every subsystem and owns the
// wiring between them. The simulation runs at a fixed 60 Hz and is kept
// apart from rendering; the frame loop only accumulates time, steps the sim
// and draws. No object is allocated in the hot loop: the raycaster, the
// direction vector and the tracer pool are created once and reused.
// The arena can be swapped on the start screen (Neon District / Harbor
// Yard): setupArena rebuilds the world and every subsystem that reads it.
// ?shot=start|play|harbor|end&seed=N&map=neon|harbor renders one
// deterministic frame for capture and sets window.__shotReady when painted.
import * as THREE from 'three';
import { NIGHT, DUSK } from './palette.js';
import { clampNum, rngFromSeed, flatDist, wrapRad } from './util.js';
import { buildArena } from './world.js';
import { createControls } from './input.js';
import { createOperative } from './player.js';
import { createArsenal, ARSENAL, BUY_CATALOGUE } from './weapon.js';
import { createSquad } from './bots.js';
import { createThrowables } from './throwables.js';
import { createRounds, PLANT_SECONDS, SPIKE_FUSE_SECONDS } from './rounds.js';
import { createHud } from './hud.js';
import { createSoundBank } from './audio.js';
import { createEffects } from './effects.js';

const FIXED_STEP = 1 / 60;
const BASE_FOV = 74;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const mapParam = params.get('map') || 'neon';
const random = rngFromSeed(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
// PCFShadowMap: PCFSoftShadowMap was removed in three 0.187, and the
// soft variant now only prints a deprecation warning and falls back here.
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(NIGHT.sky);
scene.fog = new THREE.Fog(NIGHT.fog, 26, 70);
const camera = new THREE.PerspectiveCamera(BASE_FOV, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const audio = createSoundBank();
const input = createControls(renderer.domElement, onLockChange);
const weapon = createArsenal(camera, audio);
const effects = createEffects(scene, camera);
const rounds = createRounds(audio);

// The player's hitbox: an invisible box the bots raycast against. It renders
// nothing (colour writes off) but still intersects, so bot fire is honest.
const playerHitbox = new THREE.Mesh(
  new THREE.BoxGeometry(0.84, 1.75, 0.84),
  new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
);
playerHitbox.material.colorWrite = false;
scene.add(playerHitbox);

// Arena-bound subsystems, rebuilt whenever the map changes.
let world = null;
let player = null;
let bots = null;
let throwables = null;
let hud = null;
let arenaGroup = null;

function setupArena(mapId) {
  if (arenaGroup) scene.remove(arenaGroup);
  arenaGroup = new THREE.Group();
  scene.add(arenaGroup);
  world = buildArena(arenaGroup, mapId);
  const sky = mapId === 'harbor' ? DUSK : NIGHT;
  scene.background = new THREE.Color(sky.sky);
  scene.fog = new THREE.Fog(sky.fog, mapId === 'harbor' ? 24 : 26, mapId === 'harbor' ? 64 : 70);
  player = createOperative(world);
  bots = createSquad(scene, world, random);
  throwables = createThrowables(scene);
  // One HUD for the whole session: switching maps re-points it at the new
  // arena instead of building a second HUD (which would double the click
  // listeners on the shared start/buy/end buttons).
  if (!hud) {
    hud = createHud(world);
    wireHud();
  } else {
    hud.setWorld(world);
  }
  syncCamera();
  refreshHud();
}

function wireHud() {
  hud.onPlay(() => {
    if (shot) return;
    audio.unlock();
    if (!game.started) {
      // First click: open the match and its buy menu; the player buys, then
      // clicks Ready. Do not hide the buy overlay we just showed.
      startMatch();
      return;
    }
    if (rounds.state.roundOver) {
      onNextRound();
      return;
    }
    hud.hideOverlays();
    game.buyOpen = false;
    input.requestLock();
  });
  hud.onBuyDone(() => {
    game.buyOpen = false;
    hud.hideOverlays();
    input.requestLock();
  });
  hud.onNext(() => onNextRound());
  hud.onMap((mapId) => {
    if (game.started) return; // the map locks once the match begins
    setupArena(mapId);
  });
}

const raycaster = new THREE.Raycaster();
const aimDir = new THREE.Vector3();
const muzzle = new THREE.Vector3();
const tmpVec = new THREE.Vector3();
const endVec = new THREE.Vector3();
const shotOrigin = new THREE.Vector3();

// Tracer pool: 24 reusable lines, each fading out over 90 ms.
const tracers = [];
for (let i = 0; i < 24; i += 1) {
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const mat = new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0 });
  const line = new THREE.Line(geo, mat);
  line.visible = false;
  line.frustumCulled = false;
  scene.add(line);
  tracers.push({ line, age: 1 });
}
let tracerIndex = 0;

function spawnTracer(from, to, color = 0xffd27a) {
  const t = tracers[tracerIndex];
  tracerIndex = (tracerIndex + 1) % tracers.length;
  const positions = t.line.geometry.attributes.position;
  positions.setXYZ(0, from.x, from.y, from.z);
  positions.setXYZ(1, to.x, to.y, to.z);
  positions.needsUpdate = true;
  t.line.material.color.setHex(color);
  t.line.material.opacity = 0.9;
  t.line.visible = true;
  t.age = 0;
}

// ---- Match state (the single store) -------------------------------------
const game = {
  started: false,
  paused: false,
  elapsed: 0,
  now: 0,
  frozen: false,
  accumulator: 0,
  lastTime: performance.now(),
  buyOpen: false,
  shotsFired: 0,
  shotsHit: 0,
};

function syncCamera() {
  camera.position.set(player.state.position.x, player.state.position.y + player.state.eye, player.state.position.z);
  camera.rotation.set(player.state.pitch + player.state.recoilPitch, player.state.yaw, player.state.recoilYaw, 'YXZ');
  playerHitbox.position.set(player.state.position.x, player.state.position.y + 0.88, player.state.position.z);
}

function refreshHud() {
  const r = rounds.state;
  hud.setHealth(player.state.health, player.state.armor);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  hud.setWeapon(weapon.def().name);
  hud.setMoney(r.money);
  hud.setThrowables(r.frags, r.smokes, r.flashes);
  hud.setTimer(r.timer, r.phase);
  hud.setScore(r.scoreUs, r.scoreThem, r.round);
  hud.setRoster(bots.all);
  hud.setObjective(
    r.spikePlanted
      ? `Spike planted — ${Math.ceil(r.spikeFuse)}s to detonation`
      : playerInSite() ? 'Hold E to plant the spike' : 'Plant the spike at A or B',
  );
}

function playerInSite() {
  const p = player.state.position;
  if (world.inSite(p.x, p.z, world.sites.A)) return world.sites.A;
  if (world.inSite(p.x, p.z, world.sites.B)) return world.sites.B;
  return null;
}

function accuracyLine() {
  const fired = game.shotsFired;
  const pct = fired === 0 ? 0 : Math.round((game.shotsHit / fired) * 100);
  return `${rounds.state.kills} eliminations · ${game.shotsHit}/${fired} shots on target (${pct}%) · $${rounds.state.money.toLocaleString('en-US')} banked`;
}

function startMatch() {
  rounds.resetMatch();
  game.shotsFired = 0;
  game.shotsHit = 0;
  weapon.state.owned = { pistol: true, smg: false, rifle: false, shotgun: false, sniper: false };
  weapon.state.stores.rifle = { mag: 30, reserve: 90 };
  weapon.switchTo('pistol', game.now);
  startRound();
  hud.showOverlay('buy');
  game.buyOpen = true;
  game.started = true;
  renderBuyMenu();
}

function startRound() {
  bots.spawnRound(2, 5);
  const spawn = world.spawns.attacker[1];
  player.reset(spawn);
  throwables.reset();
  rounds.startBuyPhase();
  weapon.refillAll();
  weapon.switchTo('pistol', game.now);
  refreshHud();
  hud.banner(`Round ${rounds.state.round}`, 'Buy phase — spend your cash, then fight', '', 2200);
}

function endRoundFlow() {
  const r = rounds.state;
  input.releaseLock();
  game.buyOpen = false;
  if (r.matchOver) {
    const won = r.scoreUs > r.scoreThem;
    hud.showEnd(
      won ? 'Match won — the district is yours' : 'Match lost',
      won
        ? `BREACH takes the match ${r.scoreUs}–${r.scoreThem}.`
        : `WARDEN takes the match ${r.scoreThem}–${r.scoreUs}. Click below to run it back.`,
      r.scoreUs,
      r.scoreThem,
      accuracyLine(),
    );
  } else {
    hud.showEnd(
      r.roundResult.win ? 'Round won' : 'Round lost',
      `${r.roundResult.reason}. Score ${r.scoreUs}–${r.scoreThem}.`,
      r.scoreUs,
      r.scoreThem,
      accuracyLine(),
    );
  }
}

function onNextRound() {
  if (rounds.state.matchOver) {
    startMatch();
    return;
  }
  rounds.nextRound();
  startRound();
  hud.showOverlay('buy');
  game.buyOpen = true;
  renderBuyMenu();
  input.requestLock();
}

function renderBuyMenu() {
  const catalogue = BUY_CATALOGUE.map((entry) => {
    if (entry.weapon) {
      return {
        ...entry,
        keyLabel: entry.key.replace('Digit', ''),
        price: ARSENAL[entry.weapon].price,
        onBuy: () => tryBuyWeapon(entry.weapon),
      };
    }
    const price = entry.item === 'frag' ? 300 : entry.item === 'smoke' ? 300 : entry.item === 'flash' ? 200 : 650;
    return {
      ...entry,
      keyLabel: entry.key.replace('Digit', ''),
      price,
      onBuy: () => tryBuyItem(entry.item),
    };
  });
  hud.renderBuy(catalogue, rounds.state.money, weapon.state.owned);
}

function tryBuyWeapon(id) {
  if (rounds.state.phase !== 'buy') return;
  if (weapon.state.owned[id]) {
    weapon.switchTo(id, game.now);
    refreshHud();
    return;
  }
  // Pay first, then take ownership and equip: rounds.buy only moves money.
  if (rounds.buy(id)) {
    weapon.buy(id);
    refreshHud();
    renderBuyMenu();
  }
}

function tryBuyItem(item) {
  if (rounds.state.phase !== 'buy') return;
  if (item === 'armor') {
    if (rounds.payArmor()) {
      player.state.armor = 50;
      refreshHud();
      renderBuyMenu();
    }
    return;
  }
  if (rounds.buy(item)) {
    refreshHud();
    renderBuyMenu();
  }
}

function onLockChange(locked) {
  if (shot) return;
  if (!locked && game.started && !rounds.state.roundOver && !game.buyOpen) {
    hud.showOverlay('start');
    game.paused = true;
  } else if (locked) {
    game.paused = false;
    hud.hideOverlays();
    audio.unlock();
  }
}

// ---- Shooting ------------------------------------------------------------
function playerShoot() {
  if (!player.state.alive || rounds.state.phase !== 'live') return;
  const spread = weapon.spread(player.groundSpeed(), player.state.onGround, player.state.crouched);
  if (!weapon.takeRound(game.now)) return;
  game.shotsFired += 1;
  const def = weapon.def();
  camera.getWorldDirection(aimDir);
  muzzle.copy(camera.position).addScaledVector(aimDir, 0.6);
  muzzle.y -= 0.12;
  effects.flashMuzzle();
  for (let pellet = 0; pellet < def.pellets; pellet += 1) {
    tmpVec.copy(aimDir);
    tmpVec.x += (random() * 2 - 1) * spread;
    tmpVec.y += (random() * 2 - 1) * spread;
    tmpVec.z += (random() * 2 - 1) * spread;
    tmpVec.normalize();
    raycaster.set(camera.position, tmpVec);
    raycaster.far = def.range;
    const targets = world.shootables.concat(bots.hitMeshes());
    const hit = raycaster.intersectObjects(targets, false)[0];
    if (hit) endVec.copy(hit.point);
    else endVec.copy(camera.position).addScaledVector(tmpVec, def.range);
    // Smoke eats the shot: the tracer stops at the cloud and nothing dies.
    const blocked = hit && throwables.shotBlocked(camera.position, hit.point);
    if (blocked) {
      const entry = throwables.smokeEntry(camera.position, tmpVec, def.range);
      if (entry) endVec.set(entry.x, entry.y, entry.z);
      else endVec.copy(camera.position).addScaledVector(tmpVec, def.range * 0.4);
      spawnTracer(muzzle, endVec);
      effects.impact(endVec);
      continue;
    }
    spawnTracer(muzzle, endVec);
    if (hit && hit.object.userData.bot) {
      const bot = hit.object.userData.bot;
      const part = hit.object.userData.part || 'body';
      game.shotsHit += 1;
      effects.hitPuff(hit.point);
      const killed = bots.damage(bot, def.damage, part);
      hud.hitMarker(killed);
      audio.hit(killed);
      hud.addKillfeed(`You ${part === 'head' ? '<span class="headshot">HEADSHOT</span> ' : ''}▸ <b>${bot.name}</b>`, part === 'head');
      if (killed) rounds.onKill(part === 'head');
    } else if (hit) {
      effects.impact(hit.point);
    }
  }
  audio.shot(def.kind);
  player.addRecoil(def.recoilPitch, (random() * 2 - 1) * def.recoilYaw);
  bots.hearAll(player.state.position.x, player.state.position.z, game.now);
  refreshHud();
}

function resolveBotShot(shotEvent) {
  const { from, target, spread, damage, shooter } = shotEvent;
  // The shot only lands if the line is still clear when it fires.
  if (!world.hasLineOfSight(from.x, from.z, target.x, target.z)) {
    tmpVec.set(target.x - from.x, 1.4 - from.y, target.z - from.z).normalize();
    shotOrigin.set(from.x, from.y, from.z);
    raycaster.set(shotOrigin, tmpVec);
    raycaster.far = 60;
    const wallHit = raycaster.intersectObjects(world.shootables, false)[0];
    spawnTracer(from, wallHit ? wallHit.point : { x: target.x, y: 1.4, z: target.z }, 0xff4d8d);
    return;
  }
  // Spread decides the hit: a random point inside the cone at the target.
  const distance = flatDist(from.x, from.z, target.x, target.z);
  const missRadius = spread * distance;
  const offsetX = (random() * 2 - 1) * missRadius;
  const offsetZ = (random() * 2 - 1) * missRadius;
  const aimX = target.x + offsetX;
  const aimZ = target.z + offsetZ;
  const hitPlayer = target.kind === 'player' && Math.hypot(offsetX, offsetZ) < 0.55;
  const endPoint = hitPlayer
    ? { x: target.x, y: target.y, z: target.z }
    : { x: aimX, y: 1.2, z: aimZ };
  spawnTracer(from, endPoint, 0xff4d8d);
  if (target.kind === 'player') {
    if (hitPlayer && player.state.alive) {
      player.damage(damage);
      hud.damageFlash();
      // Point the damage arc at the shooter.
      const rel = wrapRad(Math.atan2(-(from.x - player.state.position.x), -(from.z - player.state.position.z)) - player.state.yaw);
      hud.damageFrom((rel * 180) / Math.PI);
      audio.hurt();
      if (!player.state.alive) {
        rounds.state.deaths += 1;
        hud.banner('You are down', 'Your squad is still fighting — watch the round play out', 'lose', 3000);
        input.releaseLock();
      }
      refreshHud();
    }
  } else if (hitPlayer === false && target.kind === 'bot') {
    // Bots shooting bots: same cone test against a 0.55 m body radius.
    if (Math.hypot(offsetX, offsetZ) < 0.55 && target.ref.alive) {
      const killed = bots.damage(target.ref, damage * 0.8, 'body');
      if (killed) {
        hud.addKillfeed(`<b>${shooter.name}</b> ▸ <b>${target.ref.name}</b>`);
      }
    }
  }
  // A nearby enemy shot is audible even when it misses.
  if (flatDist(from.x, from.z, player.state.position.x, player.state.position.z) < 30) {
    audio.distantShot();
  }
}

function applyFrag(event) {
  const p = player.state;
  const dPlayer = flatDist(event.x, event.z, p.position.x, p.position.z);
  if (dPlayer < event.radius && p.alive) {
    const dealt = event.damage * (1 - dPlayer / event.radius);
    player.damage(dealt);
    hud.damageFlash();
    audio.hurt();
    refreshHud();
  }
  for (const bot of bots.all) {
    if (!bot.alive) continue;
    const d = flatDist(event.x, event.z, bot.position.x, bot.position.z);
    if (d < event.radius) {
      const killed = bots.damage(bot, event.damage * (1 - d / event.radius), 'body');
      if (killed) hud.addKillfeed(`GL-4 frag ▸ <b>${bot.name}</b>`);
    }
  }
}

function applyFlash(event) {
  // Bots that can see the pop are blinded; the player is whited out by how
  // close they are and whether they were looking at it.
  bots.flashBots(event.x, event.y, event.z, game.now);
  camera.getWorldDirection(aimDir);
  const dx = event.x - camera.position.x;
  const dy = event.y - camera.position.y;
  const dz = event.z - camera.position.z;
  const d = Math.hypot(dx, dy, dz);
  const facing = (dx * aimDir.x + dy * aimDir.y + dz * aimDir.z) / Math.max(0.001, d);
  const strength = clampNum(1 - d / 16, 0, 1) * (facing > 0 ? 1 : 0.35);
  if (strength > 0.08) hud.flashBang(strength);
}

function throwCurrent(kind) {
  const r = rounds.state;
  const count = kind === 'frag' ? r.frags : kind === 'smoke' ? r.smokes : r.flashes;
  if (count <= 0) return;
  camera.getWorldDirection(aimDir);
  muzzle.copy(camera.position);
  throwables.throwOne(kind, muzzle, aimDir, audio);
  if (kind === 'frag') r.frags -= 1;
  if (kind === 'smoke') r.smokes -= 1;
  if (kind === 'flash') r.flashes -= 1;
  refreshHud();
}

// ---- Fixed-step simulation ----------------------------------------------
function step(dt) {
  game.now += dt;
  game.elapsed += dt;
  const r = rounds.state;

  // Buy keys work while the buy overlay is open.
  if (game.buyOpen && r.phase === 'buy') {
    const code = input.takeAnyPressed(['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8']);
    if (code === 'Digit1') tryBuyWeapon('smg');
    if (code === 'Digit2') tryBuyWeapon('rifle');
    if (code === 'Digit3') tryBuyWeapon('shotgun');
    if (code === 'Digit4') tryBuyWeapon('sniper');
    if (code === 'Digit5') tryBuyItem('frag');
    if (code === 'Digit6') tryBuyItem('smoke');
    if (code === 'Digit7') tryBuyItem('flash');
    if (code === 'Digit8') tryBuyItem('armor');
  }
  if (input.takePressed('KeyB') && r.phase === 'buy' && game.started && !r.roundOver) {
    game.buyOpen = !game.buyOpen;
    if (game.buyOpen) {
      renderBuyMenu();
      hud.showOverlay('buy');
      input.releaseLock();
    } else {
      hud.hideOverlays();
      input.requestLock();
    }
  }

  // Round clock, planting, fuse, defuse.
  const defuser = bots.all.find((b) => !b.ally && b.alive && b.defuseProgress > 0.05) || null;
  const site = playerInSite();
  r.planting = Boolean(
    player.state.alive && r.phase === 'live' && !r.spikePlanted && site && input.held.has('KeyE'),
  );
  const events = rounds.step(dt, { site, defuser });
  for (const event of events) {
    if (event === 'buy-end') {
      game.buyOpen = false;
      hud.hideOverlays();
      hud.banner(`Round ${r.round} — fight`, 'Plant the spike at A or B, or eliminate WARDEN', '', 2400);
      input.requestLock();
    }
    if (event === 'spike-planted') {
      hud.banner('Spike planted', `${SPIKE_FUSE_SECONDS}s until detonation — hold the site`, 'win', 2600);
      hud.setObjective('Spike planted — defend it');
      audio.beep();
    }
    if (event === 'spike-detonated' || event === 'spike-defused' || event === 'time-out') endRoundFlow();
  }

  // Plant progress bar.
  hud.setPlant(r.planting ? r.plantProgress / PLANT_SECONDS : null);

  // Aim down sights: right mouse, only with a gun that can aim.
  const wantAim = input.aiming && player.state.alive && r.phase === 'live' && !weapon.state.reloading;
  if (wantAim !== weapon.state.aiming) {
    weapon.state.aiming = wantAim;
    player.state.aiming = wantAim;
    if (wantAim) audio.scope();
    hud.setScoped(wantAim && weapon.def().kind === 'sniper');
  }

  // Movement + weapon, only while the round is live and the player is up.
  if (r.phase === 'live' && player.state.alive && !game.paused) {
    const look = input.takeLook();
    player.look(look.x, look.y);
    player.step(dt, input.held, () => audio.step(), () => audio.land());
    weapon.step(dt, game.now);
    if (input.firing && weapon.ready(game.now)) playerShoot();
    if (input.takePressed('KeyR')) weapon.reload(game.now);
    if (input.takePressed('KeyG')) throwCurrent('frag');
    if (input.takePressed('KeyQ')) throwCurrent('smoke');
    if (input.takePressed('KeyF')) throwCurrent('flash');
    const slot = input.takeAnyPressed(['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5']);
    if (slot === 'Digit1') weapon.switchTo('pistol', game.now);
    if (slot === 'Digit2' && weapon.state.owned.smg) weapon.switchTo('smg', game.now);
    if (slot === 'Digit3' && weapon.state.owned.rifle) weapon.switchTo('rifle', game.now);
    if (slot === 'Digit4' && weapon.state.owned.shotgun) weapon.switchTo('shotgun', game.now);
    if (slot === 'Digit5' && weapon.state.owned.sniper) weapon.switchTo('sniper', game.now);
  } else {
    input.takeLook();
    weapon.step(dt, game.now);
  }

  // Bots fight only while the round is live.
  if (r.phase === 'live' && game.started) {
    const botShots = bots.step(dt, game.now, player, r.spikePlanted, r.spikeSite, throwables.smokeZones());
    for (const s of botShots) resolveBotShot(s);
  }

  // Throwables always simulate so a thrown one finishes after death.
  for (const event of throwables.step(dt, world, audio)) {
    if (event.type === 'frag') applyFrag(event);
    if (event.type === 'smoke') hud.addKillfeed('Smoke deployed — sight lines cut');
    if (event.type === 'flash') applyFlash(event);
  }

  // Elimination win/loss, checked after every step.
  if (r.phase === 'live' && !r.roundOver) {
    if (bots.aliveCount(false) === 0) {
      rounds.endRound(true, 'All WARDEN defenders eliminated');
      endRoundFlow();
    } else if (!player.state.alive && bots.aliveCount(true) === 0) {
      rounds.endRound(false, 'BREACH squad eliminated');
      endRoundFlow();
    }
  }

  // Crosshair gap follows the live spread.
  const gap = 8 + weapon.spread(player.groundSpeed(), player.state.onGround, player.state.crouched) * 900;
  hud.setSpreadGap(gap);
  refreshHud();
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - game.lastTime) / 1000, 0.1);
  game.lastTime = now;
  if (!game.frozen && !game.paused) {
    game.accumulator += dt;
    let steps = 0;
    while (game.accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      game.accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (game.accumulator > FIXED_STEP * 5) game.accumulator = 0;
    // Aim zoom: ease the field of view toward the gun's ADS value.
    const targetFov = weapon.state.aiming ? weapon.def().zoomFov : BASE_FOV;
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 12);
      camera.updateProjectionMatrix();
    }
    world.animate(dt, game.now);
    effects.step(dt);
    syncCamera();
    hud.frame(dt);
    hud.drawMinimap(player.state, bots.all, rounds.state.spikeSite);
  }
  // Tracers fade.
  for (const t of tracers) {
    if (t.age >= 1) {
      t.line.visible = false;
      continue;
    }
    t.age += dt * 11;
    t.line.material.opacity = Math.max(0, 0.9 * (1 - t.age));
  }
  renderer.render(scene, camera);
}

// ---- Deterministic screenshot modes --------------------------------------
function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function aimAt(x, y, z) {
  const p = player.state;
  const dx = x - p.position.x;
  const dy = y - (p.position.y + p.eye);
  const dz = z - p.position.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  p.yaw = Math.atan2(-dx, -dz);
  p.pitch = Math.asin(clampNum(dy / len, -1, 1));
  syncCamera();
}

function runShot(name) {
  hud.hideOverlays();
  game.started = true;
  if (name === 'start') {
    startMatch();
    // Look down mid from the spawn: the kiosk, the lanes, the neon.
    player.state.position.x = 0;
    player.state.position.y = 0;
    player.state.position.z = 19;
    player.state.yaw = 0;
    player.state.pitch = 0.01;
    settle(30);
    syncCamera();
    // refreshHud at the end of runShot paints the staged buy state.
    hud.showOverlay('buy');
    game.buyOpen = true;
    renderBuyMenu();
  } else if (name === 'play') {
    startMatch();
    rounds.startLivePhase();
    game.buyOpen = false;
    hud.hideOverlays();
    weapon.buy('rifle');
    rounds.state.money = 1100;
    rounds.state.kills = 1;
    rounds.state.smokes = 1;
    // Throw the smoke FIRST and let it bloom before staging: the fuse is
    // 1.2 s and the cloud needs another ~1 s to grow, so 135 settle steps
    // (2.25 s) put it near full size. The player waits at spawn, out of
    // the defenders' view range, so nothing fights during the wait.
    throwables.throwOne('smoke', { x: -8, y: 1.6, z: -2 }, { x: 0.3, y: 0.2, z: -1 }, audio);
    settle(135);
    rounds.state.timer = 82;
    // Stage the fight: player on the west lane, two defenders in clear view
    // (south of the A approach wall, clear of the crates at (-10,-2)).
    const defenders = bots.all.filter((b) => !b.ally);
    player.state.position.x = -14;
    player.state.position.y = 0;
    player.state.position.z = 6;
    player.state.yaw = 0;
    defenders[0].position.x = -15;
    defenders[0].position.z = -4;
    defenders[0].parts.group.position.set(-15, 0, -4);
    defenders[1].position.x = -8;
    defenders[1].position.z = -6;
    defenders[1].parts.group.position.set(-8, 0, -6);
    const ally = bots.all.find((b) => b.ally);
    if (ally) {
      ally.position.x = -10;
      ally.position.z = 10;
      ally.parts.group.position.set(-10, 0, 10);
    }
    aimAt(-15, 1.4, -4);
    playerShoot();
    settle(6);
    aimAt(-8, 1.5, -6);
    playerShoot();
    settle(4);
    // Stage a mid-fight state directly on the player, so refreshHud below
    // keeps it instead of overwriting it.
    player.state.health = 82;
    player.state.armor = 25;
    hud.addKillfeed('You ▸ <b>WARDEN-2</b>');
    syncCamera();
  } else if (name === 'harbor') {
    // Harbor Yard at dusk: rain, the gantry crane overhead, a defender
    // holding the container lane, smoke drifting across mid. Same staging
    // as 'play': smoke first (135 steps to bloom and grow), then positions.
    startMatch();
    rounds.startLivePhase();
    game.buyOpen = false;
    hud.hideOverlays();
    weapon.buy('sniper');
    rounds.state.money = 2400;
    rounds.state.kills = 2;
    rounds.state.smokes = 1;
    throwables.throwOne('smoke', { x: 2, y: 1.6, z: 2 }, { x: 0.2, y: 0.2, z: -1 }, audio);
    settle(135);
    rounds.state.timer = 74;
    const defenders = bots.all.filter((b) => !b.ally);
    player.state.position.x = -12;
    player.state.position.y = 0;
    player.state.position.z = 12;
    player.state.yaw = 0;
    // Both defenders down the east lane, clear of the mid crane box, so
    // the frame shows the yard, the smoke and two enemies at once.
    defenders[0].position.x = 10;
    defenders[0].position.z = -6;
    defenders[0].parts.group.position.set(10, 0, -6);
    defenders[1].position.x = 8;
    defenders[1].position.z = -2;
    defenders[1].parts.group.position.set(8, 0, -2);
    aimAt(9, 1.4, -4);
    syncCamera();
  } else {
    // 'end': a won round, scoreboard up. Stage the pre-win state, then let
    // endRound add the win itself so the numbers stay consistent (1–0).
    // The defenders are downed first, so the roster and minimap agree with
    // the "all defenders eliminated" copy instead of still showing 5 alive.
    startMatch();
    for (const d of bots.all.filter((b) => !b.ally)) {
      d.alive = false;
      d.parts.group.visible = false;
    }
    rounds.state.scoreUs = 0;
    rounds.state.scoreThem = 0;
    rounds.state.kills = 3;
    rounds.state.money = 800;
    game.shotsFired = 11;
    game.shotsHit = 7;
    rounds.endRound(true, 'All WARDEN defenders eliminated');
    player.state.position.x = -20;
    player.state.position.y = 0;
    player.state.position.z = -10;
    player.state.yaw = 0.6;
    settle(10);
    syncCamera();
    endRoundFlow();
  }
  refreshHud();
  // Shot mode never runs the frame loop, so timed HUD bits (the round
  // banner) would freeze mid-fade: hide the banner before painting.
  hud.hideBanner();
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    hud.drawMinimap(player.state, bots.all, rounds.state.spikeSite);
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      game.frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Losing the window (Alt-Tab) drops every held key, so the player never
// comes back to a stuck sprint or a held trigger.
window.addEventListener('blur', () => input.clearAll());

// Clicking the canvas re-locks the pointer after a pause (Esc, Alt-Tab).
renderer.domElement.addEventListener('click', () => {
  if (game.started && !game.buyOpen && !rounds.state.roundOver && !input.locked) {
    input.requestLock();
  }
});

setupArena(mapParam);
if (shot) runShot(shot);
else requestAnimationFrame(frame);
