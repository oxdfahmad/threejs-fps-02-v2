# Neon Breach II — a three.js tactical FPS

A round-based tactical shooter in the Counter-Strike style, built on
three.js 0.187.0 (vendored, no network requests). You are BREACH, attacking
one of two arenas: plant the spike at site A or B, or eliminate all five
WARDEN defenders. First to 5 rounds takes the match.

## What's new in v2

- **Two arenas** — Neon District (the night plaza from v1) and Harbor Yard,
  a dusk container yard in the rain with a gantry crane over mid. Pick on
  the start screen; the map locks when the match begins.
- **Five guns** — VK-9 pistol, KR-9 Hornet SMG, AR-77 Vanta rifle, SG-12
  Riot shotgun, and the LN-7 Longshot bolt-action sniper with a real scope.
- **Aim down sights** — hold right mouse to shoulder the gun: tighter
  spread, slower movement, narrower field of view (hardest zoom on the
  sniper, with a scope overlay).
- **Three throwables** — GL-4 frag (G), SK-2 smoke (Q) that blocks sight
  for both teams for 12 seconds, and FB-9 flashbang (F) that blinds bots
  looking at the pop and whites out your screen.
- **Smarter bots** — a WARDEN sniper holds the long angle, roamers flank
  on the retake instead of single-filing down mid, and every bot is blind
  inside smoke and after a flash.
- **Better feedback** — impact sparks, a muzzle flash light, a damage
  direction arc, a team roster, and accuracy on the round-end screen.

## How to play

Open `game/index.html` from any static server (`node serve.ts` in the dev
folder serves it on http://localhost:8080) and click to play.

- **W A S D** move · **Mouse** look · **Click** fire · **Right-click** aim
- **R** reload · **Shift** sprint · **Ctrl** crouch · **Space** jump
- **1–5** switch weapon · **G** frag · **Q** smoke · **F** flash
- **E** (hold) plant the spike inside site A or B
- **B** buy menu during the buy phase · **Esc** pause

## The game

- **Gunplay** — five weapons, each with its own damage, fire rate, spread
  and recoil. Headshots deal bonus damage; firing on the move or in the air
  spreads shots wide, so stopping to aim pays. Ammo runs out; reloads take
  time. Aiming down sights tightens everything up.
- **Movement** — acceleration, friction, crouch and jump, with AABB
  collision against the map.
- **Bots** — five WARDEN defenders with roles (site holders, lane roamers,
  a mid sniper) that walk the waypoint graph, hold angles, react to what
  they see and hear, converge to defuse a planted spike, and go blind in
  smoke or after a flash. Two BREACH allies fight beside you.
- **Tactics** — a plant/defuse objective, money earned per round and per
  kill, a buy menu (five guns, three throwables, kevlar), smoke that cuts
  sight lines, and a 2D minimap with a live roster. Losing rounds in a row
  raises the loss bonus ($1900, then $2400, then $2900), so a bad run never
  leaves you unable to buy.
- **The maps** — Neon District: two sites, a mid plaza with a neon kiosk,
  lanes, corners and long sightlines, lit by cold moonlight and neon.
  Harbor Yard: container stacks, a gantry crane, wet ground and rain, lit
  by a low amber sun.
- **Sound** — every effect is synthesised with WebAudio; no audio files.

## Layout

- `game/index.html` — the page, HUD and overlays
- `game/src/main.js` — boot, fixed 60 Hz simulation, shooting, round flow
- `game/src/world.js` — both arenas, colliders, waypoints, rain, lighting
- `game/src/player.js` — movement, collision, health and armour
- `game/src/weapon.js` — the five guns, ADS and the viewmodel
- `game/src/bots.js` — WARDEN and BREACH bot AI
- `game/src/throwables.js` — frag, smoke and flashbang
- `game/src/effects.js` — impact sparks and the muzzle flash light
- `game/src/rounds.js` — rounds, economy, the spike
- `game/src/hud.js` — HUD, buy menu, kill feed, minimap, roster
- `game/src/input.js` — keyboard, mouse, pointer lock, aiming
- `game/src/audio.js` — procedural WebAudio sounds
- `game/src/palette.js`, `game/src/util.js` — colours and shared helpers
- `main.ts` — hands the game in (copies game/ + screenshots/, writes dossier.json)

## Screenshots

Deterministic captures via URL query, same seed each time:

- `?shot=start&seed=1` — buy phase at the attacker spawn (Neon District)
- `?shot=play&seed=1` — mid-round firefight with smoke on the west lane
- `?shot=harbor&seed=1&map=harbor` — Harbor Yard at dusk, sniper in hand
- `?shot=end&seed=1` — round won, scoreboard up
