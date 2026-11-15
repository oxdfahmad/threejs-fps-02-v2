// Rounds, money and the spike. One match is first to 5 rounds (max 9).
// Each round: a 12-second buy phase, then up to 100 seconds of play. The
// round ends when one team is eliminated, the spike detonates, the spike is
// defused, or the clock runs out with no plant (defenders win). Money: a
// kill pays $300, a round win $3250, a loss $1900, a plant $300. The buy
// menu now stocks five guns and three throwables; each throwable type is
// capped at two carried so one player cannot hoard the whole team's smoke.
import { ARSENAL } from './weapon.js';

export const BUY_PHASE_SECONDS = 12;
export const ROUND_SECONDS = 100;
export const PLANT_SECONDS = 3;
export const DEFUSE_SECONDS = 4;
export const SPIKE_FUSE_SECONDS = 35;
export const WIN_ROUNDS = 5;
export const MAX_ROUNDS = 9;

const PRICES = {
  smg: ARSENAL.smg.price,
  rifle: ARSENAL.rifle.price,
  shotgun: ARSENAL.shotgun.price,
  sniper: ARSENAL.sniper.price,
  frag: 300,
  smoke: 300,
  flash: 200,
  armor: 650,
};

export function createRounds(audio) {
  const state = {
    phase: 'buy', // buy | live | over
    round: 1,
    scoreUs: 0,
    scoreThem: 0,
    money: 800,
    lossStreak: 0, // consecutive lost rounds: raises the loss bonus, resets on a win
    timer: BUY_PHASE_SECONDS,
    spikePlanted: false,
    spikeSite: null,
    spikeFuse: 0,
    planting: false,
    plantProgress: 0,
    defusing: false,
    defuseProgress: 0,
    roundOver: false,
    roundResult: null, // {win: bool, reason: string}
    matchOver: false,
    kills: 0,
    deaths: 0,
    frags: 1,
    smokes: 0,
    flashes: 0,
    // Per-round transient flags the HUD reads.
    lastEvent: '',
  };

  function startBuyPhase() {
    state.phase = 'buy';
    state.timer = BUY_PHASE_SECONDS;
    state.spikePlanted = false;
    state.spikeSite = null;
    state.spikeFuse = 0;
    state.planting = false;
    state.plantProgress = 0;
    state.defusing = false;
    state.defuseProgress = 0;
    state.roundOver = false;
    state.roundResult = null;
  }

  function startLivePhase() {
    state.phase = 'live';
    state.timer = ROUND_SECONDS;
  }

  function endRound(win, reason) {
    if (state.roundOver) return;
    state.roundOver = true;
    state.phase = 'over';
    state.roundResult = { win, reason };
    if (win) {
      state.scoreUs += 1;
      state.money += 3250;
      state.lossStreak = 0;
    } else {
      state.scoreThem += 1;
      // Loss-streak bonus, CS-style: a team that keeps losing gets a
      // little more each round ($1900, then $2400, then $2900), so a bad
      // run never leaves you unable to buy.
      state.lossStreak += 1;
      state.money += 1900 + Math.min(2, state.lossStreak - 1) * 500;
    }
    if (state.scoreUs >= WIN_ROUNDS || state.scoreThem >= WIN_ROUNDS || state.round >= MAX_ROUNDS) {
      state.matchOver = true;
    }
    if (win) audio.roundWin();
    else audio.roundLose();
  }

  function nextRound() {
    state.round += 1;
    startBuyPhase();
  }

  function onKill(headshot) {
    state.kills += 1;
    state.money += 300;
    state.lastEvent = headshot ? 'Headshot +$300' : 'Elimination +$300';
  }

  function onPlant() {
    state.money += 300;
    state.lastEvent = 'Spike planted +$300';
  }

  function buy(item) {
    const price = PRICES[item];
    if (price === undefined || state.money < price) return false;
    if (item === 'frag' && state.frags >= 2) return false;
    if (item === 'smoke' && state.smokes >= 2) return false;
    if (item === 'flash' && state.flashes >= 2) return false;
    if (item === 'armor') return 'armor'; // caller applies armour, then pays
    state.money -= price;
    if (item === 'frag') state.frags += 1;
    if (item === 'smoke') state.smokes += 1;
    if (item === 'flash') state.flashes += 1;
    audio.buy();
    return true;
  }

  function payArmor() {
    if (state.money < PRICES.armor) return false;
    state.money -= PRICES.armor;
    audio.buy();
    return true;
  }

  // Fixed-step tick. Returns events for main.js: 'buy-end', 'time-out',
  // 'spike-detonated', 'spike-defused'.
  function step(dt, context) {
    const events = [];
    if (state.phase === 'buy') {
      state.timer -= dt;
      if (state.timer <= 0) {
        startLivePhase();
        events.push('buy-end');
      }
      return events;
    }
    if (state.phase !== 'live') return events;

    state.timer -= dt;

    // Planting: the player channels E inside a site.
    if (state.planting) {
      state.plantProgress += dt;
      if (state.plantProgress >= PLANT_SECONDS) {
        state.planting = false;
        state.plantProgress = 0;
        state.spikePlanted = true;
        state.spikeSite = context.site;
        state.spikeFuse = SPIKE_FUSE_SECONDS;
        onPlant();
        events.push('spike-planted');
      }
    }

    // The fuse runs once the spike is down.
    if (state.spikePlanted) {
      state.spikeFuse -= dt;
      if (state.spikeFuse <= 0) {
        endRound(true, 'Spike detonated — site destroyed');
        events.push('spike-detonated');
        return events;
      }
    }

    // A defender bot channeling the defuse wins the round for WARDEN.
    const defuser = context.defuser;
    if (state.spikePlanted && defuser && defuser.defuseProgress >= DEFUSE_SECONDS) {
      endRound(false, 'Spike defused by WARDEN');
      events.push('spike-defused');
      return events;
    }

    if (state.timer <= 0 && !state.spikePlanted) {
      endRound(false, 'Time expired — spike never planted');
      events.push('time-out');
    }
    return events;
  }

  function resetMatch() {
    state.round = 1;
    state.scoreUs = 0;
    state.scoreThem = 0;
    state.money = 800;
    state.kills = 0;
    state.deaths = 0;
    state.frags = 1;
    state.smokes = 0;
    state.flashes = 0;
    state.matchOver = false;
    startBuyPhase();
  }

  return {
    state,
    PRICES,
    startBuyPhase,
    startLivePhase,
    endRound,
    nextRound,
    onKill,
    buy,
    payArmor,
    step,
    resetMatch,
  };
}
