// Neon Breach II — shared colour language.
//
// Two arenas, one look each, drawn from the same inks: the Neon District
// stays cold cyan/magenta under moonlight, while Harbor Yard burns amber
// at dusk in the rain. Team colours never change between maps, so a player
// reads friend from foe at a glance on either one.
export const NIGHT = {
  sky: 0x0a0d16,
  fog: 0x0a0d16,
  ground: 0x171a21,
  wall: 0x2b2f3a,
  wallDark: 0x1e222b,
  steel: 0x3a4152,
  cyan: 0x2fd4ff,
  magenta: 0xff4d8d,
  amber: 0xffb454,
};

export const DUSK = {
  sky: 0x1c1210,
  fog: 0x241612,
  ground: 0x201a17,
  wall: 0x3a2f28,
  wallDark: 0x2a211c,
  steel: 0x4a3f36,
  cyan: 0x37c8e8,
  magenta: 0xff5d7a,
  amber: 0xffa03c,
};

export const TEAM = {
  breach: 0x2fd4ff,
  warden: 0xff4d8d,
};

export const UI = {
  ink: 0xe8ecf2,
  dim: 0x8b93a5,
  danger: 0xff5252,
  good: 0x59d98c,
  amber: 0xffb454,
  cyan: 0x2fd4ff,
  magenta: 0xff4d8d,
};

// CSS twins of the UI colours, for the HUD stylesheet.
export const CSS = {
  accent: '#2fd4ff',
  magenta: '#ff4d8d',
  amber: '#ffb454',
  ink: '#e8ecf2',
  muted: '#8b93a5',
  danger: '#ff5252',
  good: '#59d98c',
  panel: 'rgba(10, 13, 22, 0.86)',
  hairline: 'rgba(232, 236, 242, 0.16)',
};
