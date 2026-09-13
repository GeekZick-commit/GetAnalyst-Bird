/* ==========================================================================
   config.js — brand palette, gameplay tuning, characters, worms, difficulty
   Colors are sampled from the real GetAnalyst identity (#16F3CE turquoise).
   ========================================================================== */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  if (root) { root.GA = root.GA || {}; Object.assign(root.GA, api); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var PALETTE = {
    accent: '#16F3CE',
    accentSoft: '#7DF8E2',
    accentDeep: '#0ACAA6',
    accentDark: '#08A285',
    ink: '#0B0E0F',
    surface: '#1C1C1C',
    text: '#FFFFFF',
    muted: '#8E8E8E',
    danger: '#FF5C7A',
    gold: '#FFD166'
  };

  var WORLD = {
    width: 1280,
    height: 720,
    groundY: 644,      // y of the walkable ground line
    ceilingY: 0
  };

  // Identical flight model for every character — fair leaderboard.
  var FLIGHT = {
    birdX: 320,          // fixed horizontal position of the bird
    hitboxRadius: 17,    // identical hitbox for all birds
    gravity: 1950,       // px/s^2
    flapVelocity: -560,  // px/s impulse
    maxFallSpeed: 980,
    maxRiseSpeed: -720,
    tiltUp: -0.42,
    tiltDown: 0.78
  };

  var LIVES = {
    start: 3,
    invulnerableTime: 1.3,     // seconds of protection after a hit
    blinkHz: 9,                // blink frequency while protected
    hitKnockback: 220          // small upward bounce after a hit
  };

  // Difficulty stages are keyed by score and interpolated smoothly (no jumps).
  var DIFFICULTY = [
    { level: 1, minScore: 0,    speed: 265, gap: 302, interval: 1.75, centerDrift: 150, wormChance: 0.85 },
    { level: 2, minScore: 150,  speed: 310, gap: 282, interval: 1.62, centerDrift: 170, wormChance: 0.88 },
    { level: 3, minScore: 400,  speed: 360, gap: 262, interval: 1.48, centerDrift: 190, wormChance: 0.90 },
    { level: 4, minScore: 800,  speed: 415, gap: 240, interval: 1.34, centerDrift: 210, wormChance: 0.92 },
    { level: 5, minScore: 1400, speed: 470, gap: 222, interval: 1.22, centerDrift: 225, wormChance: 0.94 },
    { level: 6, minScore: 2200, speed: 520, gap: 212, interval: 1.14, centerDrift: 235, wormChance: 0.96 }
  ];

  var OBSTACLE = {
    width: 104,
    minGap: 200,         // hard floor: a pass is always physically possible
    minMarginTop: 60,    // never flush against the ceiling
    minMarginBottom: 70, // never flush against the ground
    passBonus: 10,
    edgeForgiveness: 3   // shrinks the hitbox of the obstacle slightly
  };

  var COMBO = {
    steps: [
      { count: 3, multiplier: 2 },
      { count: 6, multiplier: 3 },
      { count: 10, multiplier: 4 }
    ],
    resetOnHit: true
  };

  var WORMS = {
    types: [
      {
        id: 'green', name: 'Green Worm', score: 10, weight: 50, healthy: true,
        body: '#6EE7A8', bodyDark: '#38B77C', band: '#A7F3D0', glow: '#6EE7A8', radius: 15
      },
      {
        id: 'blue', name: 'Blue Worm', score: 25, weight: 26, healthy: true,
        body: '#5CC8FF', bodyDark: '#2C86C9', band: '#BFE9FF', glow: '#5CC8FF', radius: 16
      },
      {
        id: 'purple', name: 'Purple Worm', score: 50, weight: 13, healthy: true,
        body: '#B98CFF', bodyDark: '#7B4FD1', band: '#E4D4FF', glow: '#B98CFF', radius: 17
      },
      {
        id: 'gold', name: 'Golden Worm', score: 100, weight: 4, healthy: true,
        body: '#FFD166', bodyDark: '#D69A1F', band: '#FFF3D0', glow: '#FFE9A8', radius: 18
      },
      {
        id: 'red', name: 'Red Worm', score: -25, weight: 7, healthy: false,
        body: '#FF7A8A', bodyDark: '#C43F55', band: '#FFC9D1', glow: '#FF5C7A', radius: 15
      }
    ],
    spawnMin: 1,
    spawnMax: 3,
    sizeJitter: 0.16
  };

  // Three visually distinct characters, identical mechanics.
  var BIRDS = [
    {
      id: 'scout',
      name: 'SCOUT',
      displayName: 'Scout',
      tagline: 'Tiny, curious, a little bit reckless.',
      flapRate: 15,          // visual only
      body: '#FF9A3D',
      bodyDark: '#E1701B',
      belly: '#FFE0B2',
      wing: '#FF6F3C',
      wingDark: '#D8501F',
      beak: '#FFD166',
      eye: '#20252A',
      crest: '#FF5C7A',
      accent: '#16F3CE'
    },
    {
      id: 'professor',
      name: 'PROFESSOR',
      displayName: 'Professor',
      tagline: 'Serious, analytical, slightly comic.',
      flapRate: 9,
      body: '#6C7CFF',
      bodyDark: '#4653C4',
      belly: '#EDEBFF',
      wing: '#8A97FF',
      wingDark: '#5A67D8',
      beak: '#FFC46B',
      eye: '#181C33',
      crest: '#C9CEFF',
      accent: '#16F3CE',
      glasses: true
    },
    {
      id: 'cyber',
      name: 'CYBER',
      displayName: 'Cyber',
      tagline: 'Futuristic, confident, wired for speed.',
      flapRate: 12,
      body: '#16F3CE',
      bodyDark: '#08A285',
      belly: '#DFFFF8',
      wing: '#0ACAA6',
      wingDark: '#067A66',
      beak: '#FFD166',
      eye: '#04231F',
      crest: '#7DF8E2',
      accent: '#FFFFFF',
      glow: '#16F3CE'
    }
  ];

  var STORAGE_KEYS = {
    prefix: 'ga.featherrush.v1.',
    nickname: 'nickname',
    bird: 'bird',
    scores: 'scores',
    music: 'music',
    sfx: 'sfx',
    muted: 'muted',
    games: 'games'
  };

  var LEADERBOARD = { max: 10, keep: 50 };

  return {
    PALETTE: PALETTE,
    WORLD: WORLD,
    FLIGHT: FLIGHT,
    LIVES: LIVES,
    DIFFICULTY: DIFFICULTY,
    OBSTACLE: OBSTACLE,
    COMBO: COMBO,
    WORMS: WORMS,
    BIRDS: BIRDS,
    STORAGE_KEYS: STORAGE_KEYS,
    LEADERBOARD: LEADERBOARD
  };
});
