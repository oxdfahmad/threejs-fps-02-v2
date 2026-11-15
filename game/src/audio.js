// Procedural WebAudio: every effect is synthesised from oscillators and
// filtered noise, so the game ships no audio files and makes no network
// request. The context is created lazily on the first user gesture, because
// browsers block audio before one. Each weapon has its own voice: the SMG
// chatters fast and light, the sniper cracks deep, the shotgun booms wide.
export function createSoundBank() {
  let ctx = null;
  let bus = null;
  let noiseBuf = null;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      bus = ctx.createGain();
      bus.gain.value = 0.32;
      bus.connect(ctx.destination);
      const len = Math.floor(ctx.sampleRate * 0.5);
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    } catch {
      ctx = null;
      return false;
    }
    return true;
  }

  function resume() {
    if (ensure() && ctx.state === 'suspended') {
      // resume() returns a promise that rejects when the browser refuses
      // (headless, no gesture yet). Audio is optional — never let it throw.
      const result = ctx.resume();
      if (result && typeof result.catch === 'function') result.catch(() => {});
    }
  }

  // A short burst of white noise through a low-pass filter.
  function burst(duration, cutoff, level, when = 0) {
    if (!ensure()) return;
    const t0 = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    src.connect(filter).connect(gain).connect(bus);
    src.start(t0, Math.random() * 0.3);
    src.stop(t0 + duration + 0.02);
  }

  // A pitched tone with a fast decay: clicks, beeps, shot tails.
  function blip(from, to, duration, level, type = 'square', when = 0) {
    if (!ensure()) return;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(gain).connect(bus);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  return {
    unlock: resume,
    shot(kind) {
      if (kind === 'shotgun') {
        burst(0.22, 900, 0.9);
        blip(160, 45, 0.18, 0.5, 'sawtooth');
      } else if (kind === 'pistol') {
        burst(0.09, 2400, 0.6);
        blip(700, 180, 0.07, 0.35, 'square');
      } else if (kind === 'smg') {
        burst(0.07, 2600, 0.5);
        blip(880, 260, 0.05, 0.28, 'square');
      } else if (kind === 'sniper') {
        burst(0.3, 700, 1.0);
        blip(120, 30, 0.3, 0.7, 'sawtooth');
        burst(0.12, 3200, 0.35, 0.02);
      } else {
        burst(0.13, 1600, 0.75);
        blip(320, 90, 0.11, 0.45, 'sawtooth');
      }
    },
    // A distant, muffled enemy shot: quieter, low-passed harder.
    distantShot() {
      burst(0.14, 700, 0.22);
    },
    dryFire() {
      blip(1400, 900, 0.03, 0.18, 'square');
    },
    reload() {
      blip(900, 500, 0.04, 0.2, 'square', 0);
      blip(600, 900, 0.04, 0.2, 'square', 0.18);
      blip(1100, 700, 0.05, 0.25, 'square', 0.42);
    },
    scope() {
      blip(1500, 1100, 0.04, 0.2, 'sine');
    },
    hit(kill) {
      blip(kill ? 1320 : 990, 990, 0.06, 0.3, 'sine');
      if (kill) blip(1980, 1980, 0.09, 0.25, 'sine', 0.07);
    },
    hurt() {
      blip(220, 110, 0.16, 0.4, 'sawtooth');
      burst(0.1, 500, 0.25);
    },
    step() {
      burst(0.05, 420, 0.08);
    },
    // A soft landing thud when the player comes down from a jump.
    land() {
      burst(0.09, 160, 0.35);
      blip(120, 70, 0.08, 0.3, 'sine');
    },
    plantTick() {
      blip(1200, 1200, 0.05, 0.2, 'sine');
    },
    beep() {
      blip(880, 880, 0.08, 0.25, 'sine');
    },
    smokeHiss() {
      burst(1.4, 1800, 0.25);
    },
    flashRing() {
      blip(2400, 2400, 0.5, 0.22, 'sine');
      blip(1800, 1800, 0.7, 0.15, 'sine', 0.05);
    },
    explosion() {
      burst(0.9, 320, 1.0);
      blip(90, 28, 0.8, 0.8, 'sine');
      burst(0.5, 1200, 0.4, 0.05);
    },
    roundWin() {
      blip(523, 523, 0.14, 0.3, 'triangle');
      blip(659, 659, 0.14, 0.3, 'triangle', 0.13);
      blip(784, 784, 0.28, 0.32, 'triangle', 0.26);
    },
    roundLose() {
      blip(392, 392, 0.16, 0.3, 'triangle');
      blip(330, 330, 0.16, 0.3, 'triangle', 0.15);
      blip(262, 262, 0.32, 0.32, 'triangle', 0.3);
    },
    buy() {
      blip(1046, 1046, 0.07, 0.25, 'sine');
      blip(1568, 1568, 0.1, 0.22, 'sine', 0.06);
    },
  };
}
