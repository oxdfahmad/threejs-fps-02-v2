// The arenas: two original maps built from the same builder. Neon District
// is the v1 map — a night plaza with two sites, a neon kiosk and long mid
// sightlines. Harbor Yard is new: a dusk container yard in the rain, with a
// crane over mid and tighter lanes. Every box that blocks movement is an
// AABB collider; only colliders taller than eye height block line of sight.
// Waypoint graphs are hand-checked so no route crosses a wall. Nothing is
// loaded from disk: ground textures are painted on a canvas at runtime and
// the skylines are geometry.
import * as THREE from 'three';
import { NIGHT, DUSK } from './palette.js';
import { flatDist } from './util.js';

const EYE_BLOCK = 1.4;

// Box entry: centre x/z, footprint w/d, height h, colour key, optional
// emissive glow and its band height. `decor` entries are visual only — they
// never collide (a crane jib floats above head height).
const ARENAS = {
  neon: {
    name: 'Neon District',
    bounds: { minX: -32, maxX: 32, minZ: -22, maxZ: 22 },
    palette: NIGHT,
    ground: { size: [66, 46], repeat: [16, 11], wet: false },
    boxes: [
      { x: 0, z: -22.5, w: 66, d: 1, h: 5, c: 'wall' },
      { x: 0, z: 22.5, w: 66, d: 1, h: 5, c: 'wall' },
      { x: -32.5, z: 0, w: 1, d: 46, h: 5, c: 'wall' },
      { x: 32.5, z: 0, w: 1, d: 46, h: 5, c: 'wall' },
      { x: -20, z: -6, w: 8, d: 1, h: 4, c: 'wall' },
      { x: 20, z: 6, w: 8, d: 1, h: 4, c: 'wall' },
      { x: -12, z: 8, w: 1, d: 10, h: 4, c: 'wall' },
      { x: 12, z: -8, w: 1, d: 10, h: 4, c: 'wall' },
      { x: -16, z: -17, w: 1, d: 6, h: 4, c: 'wall' },
      { x: 16, z: 17, w: 1, d: 6, h: 4, c: 'wall' },
      { x: 0, z: 0, w: 8, d: 5, h: 3.5, c: 'steel', glow: 'cyan', glowH: 0.35 },
      { x: -27, z: -16, w: 5, d: 2.2, h: 2.6, c: 'steel', glow: 'magenta', glowH: 0.25 },
      { x: -19, z: -18, w: 2.2, d: 4, h: 2.6, c: 'wallDark' },
      { x: 27, z: 16, w: 5, d: 2.2, h: 2.6, c: 'steel', glow: 'amber', glowH: 0.25 },
      { x: 19, z: 18, w: 2.2, d: 4, h: 2.6, c: 'wallDark' },
      { x: -6, z: 12, w: 2, d: 2, h: 1.2, c: 'wallDark' },
      { x: 6, z: 12, w: 2, d: 2, h: 1.2, c: 'wallDark' },
      { x: -16, z: 4, w: 2.4, d: 2.4, h: 2.2, c: 'wallDark' },
      { x: 16, z: -4, w: 2.4, d: 2.4, h: 2.2, c: 'wallDark' },
      { x: -4, z: -4, w: 2, d: 2, h: 1.2, c: 'wallDark' },
      { x: 4, z: 4, w: 2, d: 2, h: 1.2, c: 'wallDark' },
      { x: -28, z: -10, w: 2, d: 2, h: 1.2, c: 'wallDark' },
      { x: -20, z: -18, w: 2, d: 2, h: 1.2, c: 'wallDark' },
      { x: 28, z: 10, w: 2, d: 2, h: 1.2, c: 'wallDark' },
      { x: 20, z: 18, w: 2, d: 2, h: 1.2, c: 'wallDark' },
      { x: 0, z: -14, w: 3, d: 1.5, h: 1.2, c: 'wallDark' },
      { x: -10, z: -2, w: 2, d: 2, h: 2.2, c: 'wallDark' },
      { x: 10, z: 2, w: 2, d: 2, h: 2.2, c: 'wallDark' },
      // New for v2: a billboard wall on the east lane and two more crates.
      { x: 24, z: -12, w: 1, d: 6, h: 3.2, c: 'steel', glow: 'cyan', glowH: 0.3 },
      { x: -24, z: 12, w: 2, d: 2, h: 1.2, c: 'wallDark' },
      { x: 12, z: 14, w: 2, d: 2, h: 1.2, c: 'wallDark' },
    ],
    decor: [
      // A flickering neon sign over the kiosk, animated in animate().
      { x: 0, y: 4.4, z: 0, w: 5, h: 0.8, d: 0.2, c: 'magenta', flicker: true },
    ],
    sites: {
      A: { minX: -30, maxX: -17, minZ: -20, maxZ: -8, label: 'A' },
      B: { minX: 17, maxX: 30, minZ: 8, maxZ: 20, label: 'B' },
    },
    spawns: {
      attacker: [
        { x: -4, z: 19, yaw: 0 },
        { x: 0, z: 19.5, yaw: 0 },
        { x: 4, z: 19, yaw: 0 },
      ],
      defender: [
        { x: -6, z: -19, yaw: Math.PI },
        { x: 0, z: -19.5, yaw: Math.PI },
        { x: 6, z: -19, yaw: Math.PI },
        { x: -12, z: -17, yaw: Math.PI },
        { x: 12, z: -17, yaw: Math.PI },
      ],
    },
    nodes: [
      { x: 0, z: 18 }, { x: -10, z: 15 }, { x: 10, z: 15 }, { x: -18, z: 10 },
      { x: 0, z: 10 }, { x: 18, z: 10 }, { x: -26, z: 2 }, { x: -8, z: 2 },
      { x: 8, z: 2 }, { x: 24, z: 2 }, { x: -26, z: -8 }, { x: 0, z: -8 },
      { x: 24, z: -8 }, { x: -24, z: -14 }, { x: 0, z: -18 }, { x: 24, z: 14 },
      { x: -8, z: -11 }, { x: 8, z: -14 }, { x: 16, z: 6 }, { x: -6, z: 14 },
      { x: 6, z: 14 },
    ],
    edges: [
      [0, 1], [0, 2], [0, 4], [0, 19], [0, 20],
      [1, 3], [1, 19], [2, 5], [2, 20],
      [3, 6], [4, 7], [4, 8], [5, 9],
      [6, 10], [7, 8], [7, 11], [8, 9], [8, 11],
      [9, 18], [10, 13], [10, 16], [11, 14], [11, 16], [11, 17],
      [12, 14], [12, 17], [13, 16], [14, 17], [15, 18], [15, 5],
      [16, 17], [17, 12], [18, 5],
    ],
    roles: [
      { role: 'holdA', holdNode: 13, patrol: [13, 10, 16] },
      { role: 'holdB', holdNode: 15, patrol: [15, 18, 5] },
      { role: 'roam', holdNode: 11, patrol: [11, 7, 8, 17, 12] },
      { role: 'roam', holdNode: 8, patrol: [8, 4, 7, 11, 17] },
      { role: 'sniper', holdNode: 7, patrol: [7, 11, 4] },
    ],
    lamps: [[-24, -14, 0xff4d8d], [24, 14, 0xffb454], [0, 18, 0x2fd4ff], [0, -18, 0xff4d8d]],
    skyline: 'towers',
    rain: false,
  },
  harbor: {
    name: 'Harbor Yard',
    bounds: { minX: -28, maxX: 28, minZ: -20, maxZ: 20 },
    palette: DUSK,
    ground: { size: [58, 42], repeat: [14, 10], wet: true },
    boxes: [
      { x: 0, z: -20.5, w: 58, d: 1, h: 5, c: 'wall' },
      { x: 0, z: 20.5, w: 58, d: 1, h: 5, c: 'wall' },
      { x: -28.5, z: 0, w: 1, d: 42, h: 5, c: 'wall' },
      { x: 28.5, z: 0, w: 1, d: 42, h: 5, c: 'wall' },
      { x: -18, z: -8, w: 8, d: 1, h: 4, c: 'wall' },
      { x: 18, z: 8, w: 8, d: 1, h: 4, c: 'wall' },
      { x: -10, z: 6, w: 1, d: 8, h: 4, c: 'wall' },
      { x: 10, z: -6, w: 1, d: 8, h: 4, c: 'wall' },
      { x: -14, z: -16, w: 1, d: 5, h: 4, c: 'wall' },
      { x: 14, z: 16, w: 1, d: 5, h: 4, c: 'wall' },
      { x: 0, z: 0, w: 5, d: 3, h: 3.5, c: 'steel', glow: 'magenta', glowH: 0.3 },
      { x: -24, z: -14, w: 5, d: 2.2, h: 2.6, c: 'steel', glow: 'amber', glowH: 0.25 },
      { x: 24, z: 14, w: 5, d: 2.2, h: 2.6, c: 'steel', glow: 'cyan', glowH: 0.25 },
      { x: -24, z: 10, w: 2.2, d: 4, h: 2.6, c: 'wallDark' },
      { x: 24, z: -10, w: 2.2, d: 4, h: 2.6, c: 'wallDark' },
      { x: -6, z: 10, w: 2, d: 2, h: 1.2, c: 'wallDark' },
      { x: 6, z: 10, w: 2, d: 2, h: 1.2, c: 'wallDark' },
      { x: -16, z: 2, w: 2.4, d: 2.4, h: 2.2, c: 'wallDark' },
      { x: 16, z: -2, w: 2.4, d: 2.4, h: 2.2, c: 'wallDark' },
      { x: -4, z: -4, w: 2, d: 2, h: 1.2, c: 'wallDark' },
      { x: 4, z: 4, w: 2, d: 2, h: 1.2, c: 'wallDark' },
      { x: -26, z: -8, w: 2, d: 2, h: 1.2, c: 'wallDark' },
      { x: -18, z: -16, w: 2, d: 2, h: 1.2, c: 'wallDark' },
      { x: 27, z: 8, w: 2, d: 2, h: 1.2, c: 'wallDark' },
      { x: 18, z: 16, w: 2, d: 2, h: 1.2, c: 'wallDark' },
      { x: -4, z: -14, w: 3, d: 1.5, h: 1.2, c: 'wallDark' },
      { x: -9, z: -2, w: 2, d: 2, h: 2.2, c: 'wallDark' },
      { x: 9, z: 2, w: 2, d: 2, h: 2.2, c: 'wallDark' },
    ],
    decor: [
      // The gantry crane over mid: legs at the yard edges, jib overhead.
      { x: -8, y: 3.5, z: 0, w: 0.8, h: 7, d: 0.8, c: 'steel' },
      { x: 8, y: 3.5, z: 0, w: 0.8, h: 7, d: 0.8, c: 'steel' },
      { x: 0, y: 7.2, z: 0, w: 17, h: 0.7, d: 0.7, c: 'steel' },
      { x: -4, y: 6.4, z: 0, w: 1.2, h: 1.2, d: 1.2, c: 'amber', glow: 'amber', glowH: 1.2 },
    ],
    sites: {
      A: { minX: -26, maxX: -15, minZ: -18, maxZ: -8, label: 'A' },
      B: { minX: 15, maxX: 26, minZ: 8, maxZ: 18, label: 'B' },
    },
    spawns: {
      attacker: [
        { x: -4, z: 17, yaw: 0 },
        { x: 0, z: 17.5, yaw: 0 },
        { x: 4, z: 17, yaw: 0 },
      ],
      defender: [
        { x: -6, z: -17, yaw: Math.PI },
        { x: 0, z: -17.5, yaw: Math.PI },
        { x: 6, z: -17, yaw: Math.PI },
        { x: -12, z: -15, yaw: Math.PI },
        { x: 12, z: -15, yaw: Math.PI },
      ],
    },
    nodes: [
      { x: 0, z: 16 }, { x: -9, z: 13 }, { x: 9, z: 13 }, { x: -16, z: 9 },
      { x: 0, z: 9 }, { x: 25, z: 11 }, { x: -23, z: 2 }, { x: -7, z: 4 },
      { x: 7, z: 4 }, { x: 23, z: 2 }, { x: -23, z: -6 }, { x: 0, z: -7 },
      { x: 23, z: -7 }, { x: -21, z: -13 }, { x: 0, z: -16 }, { x: 20, z: 13 },
      { x: -7, z: -12 }, { x: 7, z: -13 }, { x: 15, z: 5 }, { x: -5, z: 12 },
      { x: 5, z: 12 },
    ],
    edges: [
      [0, 1], [0, 2], [0, 4], [0, 19], [0, 20],
      [1, 3], [1, 19], [2, 5], [2, 20],
      [3, 6], [4, 7], [4, 8], [5, 9],
      [6, 10], [7, 8], [7, 11], [8, 9], [8, 11],
      [9, 18], [10, 13], [11, 14], [11, 16], [11, 17],
      [12, 14], [12, 17], [13, 16], [14, 17], [15, 5],
      [16, 17], [17, 12], [18, 8],
    ],
    roles: [
      { role: 'holdA', holdNode: 13, patrol: [13, 10, 16] },
      { role: 'holdB', holdNode: 15, patrol: [15, 18, 5] },
      { role: 'roam', holdNode: 11, patrol: [11, 7, 8, 17, 12] },
      { role: 'roam', holdNode: 8, patrol: [8, 4, 7, 11, 17] },
      { role: 'sniper', holdNode: 11, patrol: [11, 17, 12] },
    ],
    lamps: [[-21, -13, 0xffb454], [20, 13, 0x2fd4ff], [0, 16, 0x37c8e8], [0, 0, 0xff5d7a]],
    skyline: 'cranes',
    rain: true,
  },
};

function paintGround(palette, wet) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = wet ? '#1d1713' : '#171a21';
  ctx.fillRect(0, 0, 256, 256);
  // Asphalt speckle.
  for (let i = 0; i < 900; i += 1) {
    const shade = wet ? 26 + Math.floor(Math.random() * 18) : 18 + Math.floor(Math.random() * 22);
    ctx.fillStyle = `rgb(${shade},${shade + 3},${shade + 8})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  if (wet) {
    // Puddles: darker blotches that catch the lamps.
    for (let i = 0; i < 26; i += 1) {
      ctx.fillStyle = 'rgba(8,10,14,0.5)';
      ctx.beginPath();
      ctx.ellipse(Math.random() * 256, Math.random() * 256, 8 + Math.random() * 22, 5 + Math.random() * 12, Math.random() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Faint paving grid.
  ctx.strokeStyle = 'rgba(232,236,242,0.05)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 256; i += 32) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(256, i); ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// Slab test for a 2D segment against an AABB.
function segmentHitsBox(ax, az, bx, bz, box) {
  const dx = bx - ax;
  const dz = bz - az;
  let tmin = 0;
  let tmax = 1;
  if (Math.abs(dx) < 1e-9) {
    if (ax < box.minX || ax > box.maxX) return false;
  } else {
    let t1 = (box.minX - ax) / dx;
    let t2 = (box.maxX - ax) / dx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  if (Math.abs(dz) < 1e-9) {
    if (az < box.minZ || az > box.maxZ) return false;
  } else {
    let t1 = (box.minZ - az) / dz;
    let t2 = (box.maxZ - az) / dz;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  return true;
}

export function buildArena(scene, arenaId) {
  const spec = ARENAS[arenaId] || ARENAS.neon;
  const pal = spec.palette;
  const colliders = [];
  const tallColliders = [];
  const shootables = [];
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const materials = new Map();
  const flickerMats = [];

  function materialFor(colorKey, glowKey) {
    const key = `${colorKey}:${glowKey ?? 0}`;
    if (!materials.has(key)) {
      materials.set(
        key,
        new THREE.MeshStandardMaterial({
          color: pal[colorKey],
          roughness: spec.ground.wet ? 0.55 : 0.85,
          metalness: spec.ground.wet ? 0.3 : 0.15,
          emissive: glowKey ? pal[glowKey] : 0x000000,
          emissiveIntensity: glowKey ? 0.9 : 0,
        }),
      );
    }
    return materials.get(key);
  }

  // Ground.
  const groundTex = paintGround(pal, spec.ground.wet);
  groundTex.repeat.set(spec.ground.repeat[0], spec.ground.repeat[1]);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(spec.ground.size[0], spec.ground.size[1]),
    new THREE.MeshStandardMaterial({
      map: groundTex,
      roughness: spec.ground.wet ? 0.35 : 0.95,
      metalness: spec.ground.wet ? 0.3 : 0.05,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  shootables.push(ground);

  // Site floor decals: a glowing outline on the ground marks each plant zone.
  function siteDecal(site, color) {
    const geo = new THREE.PlaneGeometry(site.maxX - site.minX, site.maxZ - site.minZ);
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.1, depthWrite: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set((site.minX + site.maxX) / 2, 0.02, (site.minZ + site.maxZ) / 2);
    scene.add(mesh);
    const edge = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(site.minX, 0.03, site.minZ),
        new THREE.Vector3(site.maxX, 0.03, site.minZ),
        new THREE.Vector3(site.maxX, 0.03, site.maxZ),
        new THREE.Vector3(site.minX, 0.03, site.maxZ),
      ]),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8 }),
    );
    scene.add(edge);
  }

  for (const box of spec.boxes) {
    const mesh = new THREE.Mesh(boxGeo, materialFor(box.c, box.glow));
    mesh.scale.set(box.w, box.h, box.d);
    mesh.position.set(box.x, box.h / 2, box.z);
    mesh.castShadow = box.h > 1.5;
    mesh.receiveShadow = true;
    scene.add(mesh);
    shootables.push(mesh);
    const collider = {
      minX: box.x - box.w / 2,
      maxX: box.x + box.w / 2,
      minZ: box.z - box.d / 2,
      maxZ: box.z + box.d / 2,
      h: box.h,
    };
    colliders.push(collider);
    if (box.h > EYE_BLOCK) tallColliders.push(collider);
    // Neon trim along the top edge of glowing boxes.
    if (box.glow) {
      const trim = new THREE.Mesh(
        new THREE.BoxGeometry(box.w + 0.06, box.glowH, box.d + 0.06),
        new THREE.MeshBasicMaterial({ color: pal[box.glow] }),
      );
      trim.position.set(box.x, box.h - box.glowH / 2, box.z);
      scene.add(trim);
    }
  }

  // Decor: visual-only geometry, never a collider.
  for (const piece of spec.decor) {
    const mat = new THREE.MeshBasicMaterial({ color: pal[piece.c] });
    if (piece.flicker) flickerMats.push(mat);
    const mesh = new THREE.Mesh(boxGeo, mat);
    mesh.scale.set(piece.w, piece.h, piece.d);
    mesh.position.set(piece.x, piece.y, piece.z);
    scene.add(mesh);
  }

  // Distant skyline: dark towers for Neon, crane silhouettes for Harbor.
  const skyline = new THREE.Group();
  if (spec.skyline === 'towers') {
    const towerMat = new THREE.MeshBasicMaterial({ color: 0x11141d });
    const windowMat = new THREE.MeshBasicMaterial({ color: pal.cyan, transparent: true, opacity: 0.55 });
    const towerGeo = new THREE.BoxGeometry(1, 1, 1);
    const winGeo = new THREE.PlaneGeometry(1, 0.5);
    const spots = [
      [-48, -34, 14, 22], [48, -36, 18, 30], [-52, 10, 12, 16], [52, 8, 15, 24],
      [-40, 34, 16, 26], [42, 34, 13, 18], [-18, -42, 20, 34], [20, -42, 16, 28],
      [-60, -14, 10, 20], [60, -16, 12, 22],
    ];
    for (const [x, z, w, h] of spots) {
      const tower = new THREE.Mesh(towerGeo, towerMat);
      tower.scale.set(w, h, w);
      tower.position.set(x, h / 2, z);
      skyline.add(tower);
      const windows = new THREE.Mesh(winGeo, windowMat);
      windows.scale.set(w * 0.6, 1, 1);
      windows.position.set(x, h * 0.55, z + w / 2 + 0.05);
      skyline.add(windows);
    }
  } else {
    // Crane silhouettes: two gantry shapes beyond the walls.
    const craneMat = new THREE.MeshBasicMaterial({ color: 0x140f0d });
    const craneGeo = new THREE.BoxGeometry(1, 1, 1);
    for (const [x, z, w, h] of [[-44, -26, 2, 26], [44, -24, 2, 22], [-40, 28, 2, 20], [46, 26, 2, 24]]) {
      const leg = new THREE.Mesh(craneGeo, craneMat);
      leg.scale.set(w, h, w);
      leg.position.set(x, h / 2, z);
      skyline.add(leg);
      const jib = new THREE.Mesh(craneGeo, craneMat);
      jib.scale.set(22, 1.2, 1.2);
      jib.position.set(x + 8, h - 1, z);
      skyline.add(jib);
    }
    // Container stacks outside the walls.
    const stackMat = new THREE.MeshBasicMaterial({ color: 0x1a130f });
    for (const [x, z, w, h] of [[-38, 12, 8, 5], [38, -12, 8, 7], [-36, -30, 10, 4], [36, 30, 10, 6]]) {
      const stack = new THREE.Mesh(craneGeo, stackMat);
      stack.scale.set(w, h, 3);
      stack.position.set(x, h / 2, z);
      skyline.add(stack);
    }
  }
  scene.add(skyline);

  siteDecal(spec.sites.A, pal.magenta);
  siteDecal(spec.sites.B, pal.amber);

  // Lighting: cold moonlight for Neon, low amber sun for Harbor.
  const hemi = spec.rain
    ? new THREE.HemisphereLight(0xffd9b0, 0x241a12, 0.7)
    : new THREE.HemisphereLight(0x8fa3c7, 0x1a1410, 0.85);
  scene.add(hemi);
  const key = spec.rain
    ? new THREE.DirectionalLight(0xffb070, 1.2)
    : new THREE.DirectionalLight(0xbfd4ff, 1.5);
  key.position.set(spec.rain ? 20 : -18, spec.rain ? 18 : 30, spec.rain ? 14 : -12);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -36;
  key.shadow.camera.right = 36;
  key.shadow.camera.top = 26;
  key.shadow.camera.bottom = -26;
  key.shadow.camera.far = 80;
  scene.add(key);
  for (const [x, z, color] of spec.lamps) {
    const lamp = new THREE.PointLight(color, 18, 26, 1.8);
    lamp.position.set(x, 6, z);
    scene.add(lamp);
  }

  // Rain: a single Points cloud of drops falling over the yard, wrapping.
  let rain = null;
  let rainVel = null;
  if (spec.rain) {
    const COUNT = 700;
    const pos = new Float32Array(COUNT * 3);
    rainVel = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i += 1) {
      pos[i * 3] = (Math.random() - 0.5) * 60;
      pos[i * 3 + 1] = Math.random() * 18;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 44;
      rainVel[i] = 10 + Math.random() * 6;
    }
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    rain = new THREE.Points(rainGeo, new THREE.PointsMaterial({
      color: 0x9fb4c8, size: 0.06, transparent: true, opacity: 0.55, depthWrite: false,
    }));
    rain.frustumCulled = false;
    scene.add(rain);
  }

  // Waypoint adjacency.
  const adjacency = spec.nodes.map(() => []);
  for (const [a, b] of spec.edges) {
    adjacency[a].push(b);
    adjacency[b].push(a);
  }

  // Per-frame life: the neon sign flickers, the rain falls.
  let flickerClock = 0;
  function animate(dt, now) {
    flickerClock += dt;
    for (const mat of flickerMats) {
      const on = Math.sin(flickerClock * 7) > -0.85 || Math.sin(flickerClock * 23) > 0.6;
      mat.color.setHex(on ? pal.magenta : 0x3a0d1c);
    }
    if (rain) {
      const pos = rain.geometry.attributes.position;
      for (let i = 0; i < rainVel.length; i += 1) {
        let y = pos.getY(i) - rainVel[i] * dt;
        if (y < 0) y += 18;
        pos.setY(i, y);
      }
      pos.needsUpdate = true;
    }
  }

  return {
    id: arenaId,
    name: spec.name,
    bounds: spec.bounds,
    colliders,
    tallColliders,
    shootables,
    sites: spec.sites,
    spawns: spec.spawns,
    nodes: spec.nodes,
    adjacency,
    roles: spec.roles,
    animate,
    nearestNode(x, z) {
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < spec.nodes.length; i += 1) {
        const d = flatDist(x, z, spec.nodes[i].x, spec.nodes[i].z);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    },
    // Breadth-first route between two nodes; returns node indices.
    findPath(from, to) {
      if (from === to) return [from];
      const prev = new Array(spec.nodes.length).fill(-1);
      const queue = [from];
      prev[from] = from;
      while (queue.length > 0) {
        const current = queue.shift();
        for (const next of adjacency[current]) {
          if (prev[next] !== -1) continue;
          prev[next] = current;
          if (next === to) {
            const path = [to];
            let node = to;
            while (node !== from) {
              node = prev[node];
              path.unshift(node);
            }
            return path;
          }
          queue.push(next);
        }
      }
      return [from, to];
    },
    inSite(x, z, site) {
      return x >= site.minX && x <= site.maxX && z >= site.minZ && z <= site.maxZ;
    },
    // Push a circle (player/bot) out of every collider it overlaps.
    collideCircle(pos, radius) {
      for (const c of colliders) {
        const cx = Math.max(c.minX, Math.min(pos.x, c.maxX));
        const cz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
        const dx = pos.x - cx;
        const dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= radius * radius) continue;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          pos.x = cx + (dx / d) * radius;
          pos.z = cz + (dz / d) * radius;
        } else {
          // Centre inside the box: push out along the smallest penetration.
          const pushLeft = pos.x - c.minX + radius;
          const pushRight = c.maxX - pos.x + radius;
          const pushUp = pos.z - c.minZ + radius;
          const pushDown = c.maxZ - pos.z + radius;
          const min = Math.min(pushLeft, pushRight, pushUp, pushDown);
          if (min === pushLeft) pos.x = c.minX - radius;
          else if (min === pushRight) pos.x = c.maxX + radius;
          else if (min === pushUp) pos.z = c.minZ - radius;
          else pos.z = c.maxZ + radius;
        }
      }
      pos.x = Math.max(spec.bounds.minX + radius, Math.min(spec.bounds.maxX - radius, pos.x));
      pos.z = Math.max(spec.bounds.minZ + radius, Math.min(spec.bounds.maxZ - radius, pos.z));
    },
    // 2D segment vs tall colliders: true when nothing tall stands between.
    hasLineOfSight(ax, az, bx, bz) {
      for (const c of tallColliders) {
        if (segmentHitsBox(ax, az, bx, bz, c)) return false;
      }
      return true;
    },
  };
}
