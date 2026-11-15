// The HUD: every DOM element the player sees, driven from one place. The
// game calls set* methods; this module never reads game state on its own.
// The minimap is a 2D canvas drawn from the arena's walls, sites and the
// live positions of the player and the bots. New in v2: a damage-direction
// arc that points at whoever just shot you, a scope overlay for the sniper,
// a team roster showing who is still standing, and throwable counts.
const KILLFEED_MAX = 5;

export function createHud(world) {
  const $ = (id) => document.getElementById(id);
  const els = {
    hpNum: $('hp-num'),
    hpBar: $('hp-bar').firstElementChild,
    armorBar: $('armor-bar').firstElementChild,
    ammoMag: $('ammo-mag'),
    ammoReserve: $('ammo-reserve'),
    ammoBox: $('ammo'),
    weaponName: $('weapon-name'),
    money: $('money'),
    throwables: $('throwables'),
    timer: $('round-timer'),
    scoreUs: $('score-us'),
    scoreThem: $('score-them'),
    roundNum: $('round-num'),
    objective: $('objective'),
    crosshair: $('crosshair'),
    hitmarker: $('hitmarker'),
    killfeed: $('killfeed'),
    banner: $('banner'),
    bannerTitle: $('banner').querySelector('h2'),
    bannerCopy: $('banner').querySelector('p'),
    plantbar: $('plantbar'),
    plantFill: $('plantbar').querySelector('.bar > i'),
    damage: $('damage'),
    damageDir: $('damage-dir'),
    scope: $('scope'),
    roster: $('roster'),
    flash: $('flash'),
    minimap: $('minimap'),
    overlayStart: $('overlay-start'),
    overlayBuy: $('overlay-buy'),
    overlayEnd: $('overlay-end'),
    endTitle: $('end-title'),
    endCopy: $('end-copy'),
    endScore: $('end-score'),
    endStats: $('end-stats'),
    buyMoney: $('buy-money'),
    buyList: $('buy-list'),
    mapCards: document.querySelectorAll('.map-card'),
  };
  const mapCtx = els.minimap.getContext('2d');
  // The arena reference is mutable: switching maps reuses this one HUD
  // instance instead of building a second one (which would double the
  // click listeners on the shared start/buy/end buttons).
  let worldRef = world;
  let mapScaleX = els.minimap.width / (worldRef.bounds.maxX - worldRef.bounds.minX);
  let mapScaleZ = els.minimap.height / (worldRef.bounds.maxZ - worldRef.bounds.minZ);
  const toMapX = (x) => (x - worldRef.bounds.minX) * mapScaleX;
  const toMapY = (z) => (z - worldRef.bounds.minZ) * mapScaleZ;
  let lastRoster = '';

  let bannerTimer = 0;
  let hitTimer = 0;
  let damageDirTimer = 0;
  let flashTimer = 0;
  let playHandler = null;
  let buyDoneHandler = null;
  let nextHandler = null;
  let mapHandler = null;
  let selectedMap = 'neon';

  $('play').addEventListener('click', () => playHandler && playHandler());
  $('buy-done').addEventListener('click', () => buyDoneHandler && buyDoneHandler());
  $('end-next').addEventListener('click', () => nextHandler && nextHandler());
  for (const card of els.mapCards) {
    card.addEventListener('click', () => {
      selectedMap = card.dataset.map;
      for (const other of els.mapCards) other.classList.toggle('picked', other === card);
      if (mapHandler) mapHandler(selectedMap);
    });
  }

  function formatTime(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  return {
    onPlay(fn) { playHandler = fn; },
    onBuyDone(fn) { buyDoneHandler = fn; },
    onNext(fn) { nextHandler = fn; },
    onMap(fn) { mapHandler = fn; },
    get map() { return selectedMap; },

    setHealth(hp, armor) {
      els.hpNum.textContent = String(Math.round(hp));
      els.hpNum.classList.toggle('low', hp <= 30);
      els.hpBar.style.width = `${Math.max(0, hp)}%`;
      els.armorBar.style.width = `${Math.max(0, Math.min(100, armor))}%`;
    },
    setAmmo(mag, reserve) {
      els.ammoMag.textContent = String(mag);
      els.ammoReserve.textContent = `/ ${reserve}`;
      els.ammoBox.classList.toggle('empty', mag === 0);
    },
    setWeapon(name) {
      els.weaponName.textContent = name;
    },
    setMoney(amount) {
      els.money.textContent = `$${amount.toLocaleString('en-US')}`;
      els.buyMoney.textContent = `$${amount.toLocaleString('en-US')}`;
    },
    setThrowables(frags, smokes, flashes) {
      els.throwables.textContent = `GL-4 frag × ${frags} · SK-2 smoke × ${smokes} · FB-9 flash × ${flashes}`;
    },
    setTimer(seconds, phase) {
      els.timer.textContent =
        phase === 'buy' ? `BUY ${formatTime(seconds)}` : phase === 'over' ? '—' : formatTime(seconds);
      els.timer.classList.toggle('low', phase === 'live' && seconds <= 15);
    },
    setScore(us, them, round) {
      els.scoreUs.textContent = String(us);
      els.scoreThem.textContent = String(them);
      els.roundNum.textContent = String(round);
    },
    setObjective(text) {
      els.objective.textContent = text;
    },
    setSpreadGap(pixels) {
      els.crosshair.style.setProperty('--gap', `${pixels.toFixed(0)}px`);
    },
    setScoped(scoped) {
      els.scope.hidden = !scoped;
      els.crosshair.style.visibility = scoped ? 'hidden' : 'visible';
    },
    hitMarker(kill) {
      els.hitmarker.classList.toggle('kill', kill);
      els.hitmarker.classList.add('on');
      hitTimer = 140;
    },
    damageFlash() {
      els.damage.style.opacity = '1';
      setTimeout(() => { els.damage.style.opacity = '0'; }, 130);
    },
    // A red arc at the screen edge pointing toward the shooter.
    damageFrom(angleDegrees) {
      els.damageDir.style.setProperty('--dir', `${angleDegrees}deg`);
      els.damageDir.classList.add('on');
      damageDirTimer = 900;
    },
    flashBang(strength) {
      els.flash.style.opacity = String(Math.max(0, Math.min(1, strength)));
      flashTimer = 700 * Math.max(0.2, strength);
    },
    addKillfeed(text, headshot) {
      const div = document.createElement('div');
      div.innerHTML = text;
      if (headshot) div.classList.add('headshot');
      els.killfeed.prepend(div);
      while (els.killfeed.children.length > KILLFEED_MAX) els.killfeed.lastChild.remove();
      setTimeout(() => div.remove(), 6000);
    },
    banner(title, copy, kind, ms = 2600) {
      els.bannerTitle.textContent = title;
      els.bannerCopy.textContent = copy;
      els.banner.className = kind ? `on ${kind}` : 'on';
      bannerTimer = ms;
    },
    hideBanner() {
      els.banner.classList.remove('on');
      bannerTimer = 0;
    },
    setPlant(progress) {
      if (progress === null) {
        els.plantbar.classList.remove('on');
        return;
      }
      els.plantbar.classList.add('on');
      els.plantFill.style.width = `${Math.round(progress * 100)}%`;
    },
    showOverlay(name) {
      els.overlayStart.hidden = name !== 'start';
      els.overlayBuy.hidden = name !== 'buy';
      els.overlayEnd.hidden = name !== 'end';
    },
    hideOverlays() {
      els.overlayStart.hidden = true;
      els.overlayBuy.hidden = true;
      els.overlayEnd.hidden = true;
    },
    showEnd(title, copy, us, them, stats) {
      els.endTitle.textContent = title;
      els.endCopy.textContent = copy;
      els.endScore.textContent = `${us} — ${them}`;
      els.endStats.textContent = stats || '';
      this.showOverlay('end');
    },
    // The buy menu is rebuilt each time it opens so prices and ownership
    // always match the round state.
    renderBuy(catalogue, money, owned) {
      els.buyList.innerHTML = '';
      for (const item of catalogue) {
        const div = document.createElement('div');
        div.className = 'buy-item';
        const price = item.price;
        const isOwned = item.weapon ? owned[item.weapon] : false;
        if (isOwned) div.classList.add('owned');
        div.innerHTML = `<span class="key">${item.keyLabel}</span><span class="name">${item.label}</span><span class="desc">${item.desc}</span><span class="price">$${price}</span>`;
        div.addEventListener('click', () => item.onBuy && item.onBuy());
        els.buyList.appendChild(div);
      }
      this.setMoney(money);
    },
    // Roster: who on each team is still standing, under the minimap.
    // Rebuilds the DOM only when the text actually changes (this runs
    // every fixed step, and innerHTML churn 60 times a second is wasteful).
    setRoster(bots) {
      const aliveUs = bots.filter((b) => b.alive && b.ally).length;
      const aliveThem = bots.filter((b) => b.alive && !b.ally).length;
      const deadUs = bots.filter((b) => !b.alive && b.ally).map((b) => b.name).join(' ');
      const deadThem = bots.filter((b) => !b.alive && !b.ally).map((b) => b.name).join(' ');
      const html =
        `<div class="team cyan">BREACH ${aliveUs} alive${deadUs ? ` · <s>${deadUs}</s>` : ''}</div>` +
        `<div class="team magenta">WARDEN ${aliveThem} alive${deadThem ? ` · <s>${deadThem}</s>` : ''}</div>`;
      if (html !== lastRoster) {
        lastRoster = html;
        els.roster.innerHTML = html;
      }
    },
    // Swap the arena under a live HUD (map picker). Recomputes the
    // minimap scales for the new bounds and clears the roster cache.
    setWorld(newWorld) {
      worldRef = newWorld;
      mapScaleX = els.minimap.width / (worldRef.bounds.maxX - worldRef.bounds.minX);
      mapScaleZ = els.minimap.height / (worldRef.bounds.maxZ - worldRef.bounds.minZ);
      lastRoster = '';
    },
    // Minimap: walls in grey, sites outlined, player as a cyan wedge,
    // allies cyan dots, enemies magenta dots (visible when recently seen).
    drawMinimap(player, bots, spikeSite) {
      const ctx = mapCtx;
      const W = els.minimap.width;
      const H = els.minimap.height;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(23,26,33,0.9)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(232,236,242,0.35)';
      for (const c of worldRef.colliders) {
        ctx.fillRect(toMapX(c.minX), toMapY(c.minZ), (c.maxX - c.minX) * mapScaleX, (c.maxZ - c.minZ) * mapScaleZ);
      }
      for (const key of ['A', 'B']) {
        const site = worldRef.sites[key];
        ctx.strokeStyle = key === 'A' ? '#ff4d8d' : '#ffb454';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(toMapX(site.minX), toMapY(site.minZ), (site.maxX - site.minX) * mapScaleX, (site.maxZ - site.minZ) * mapScaleZ);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.font = 'bold 11px system-ui';
        ctx.fillText(key, toMapX(site.minX) + 3, toMapY(site.minZ) + 12);
      }
      if (spikeSite) {
        // A red diamond at the planted spike's site centre.
        const cx = toMapX((spikeSite.minX + spikeSite.maxX) / 2);
        const cy = toMapY((spikeSite.minZ + spikeSite.maxZ) / 2);
        ctx.fillStyle = '#ff5252';
        ctx.beginPath();
        ctx.moveTo(cx, cy - 5);
        ctx.lineTo(cx + 5, cy);
        ctx.lineTo(cx, cy + 5);
        ctx.lineTo(cx - 5, cy);
        ctx.closePath();
        ctx.fill();
      }
      for (const bot of bots) {
        if (!bot.alive) continue;
        ctx.fillStyle = bot.ally ? '#2fd4ff' : '#ff4d8d';
        ctx.beginPath();
        ctx.arc(toMapX(bot.position.x), toMapY(bot.position.z), 3, 0, Math.PI * 2);
        ctx.fill();
      }
      // Player wedge, rotated to the facing yaw. On the map +x is right and
      // +z is down, so the wedge angle is -yaw (a triangle drawn pointing up
      // rotated by -yaw points along the camera forward).
      const px = toMapX(player.position.x);
      const py = toMapY(player.position.z);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(-player.yaw);
      ctx.fillStyle = '#e8ecf2';
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(4.5, 5);
      ctx.lineTo(-4.5, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    },
    // Called every animation frame for the timed bits (banner, hitmarker).
    frame(dt) {
      if (bannerTimer > 0) {
        bannerTimer -= dt * 1000;
        if (bannerTimer <= 0) els.banner.classList.remove('on');
      }
      if (hitTimer > 0) {
        hitTimer -= dt * 1000;
        if (hitTimer <= 0) els.hitmarker.classList.remove('on');
      }
      if (damageDirTimer > 0) {
        damageDirTimer -= dt * 1000;
        if (damageDirTimer <= 0) els.damageDir.classList.remove('on');
      }
      if (flashTimer > 0) {
        flashTimer -= dt * 1000;
        if (flashTimer <= 0) els.flash.style.opacity = '0';
      }
    },
  };
}
