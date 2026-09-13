/* ==========================================================================
   tests/unit.test.js — dependency-free logic tests (run with `node tests/unit.test.js`)
   Covers: utils, storage, scoring/combo, worms, obstacles + fair generation,
   particles, bird physics and character balance.
   ========================================================================== */
'use strict';

var path = require('path');
var Utils = require(path.join(__dirname, '..', 'js', 'utils.js'));
var Config = require(path.join(__dirname, '..', 'js', 'config.js'));
var Storage = require(path.join(__dirname, '..', 'js', 'storage.js'));
var Score = require(path.join(__dirname, '..', 'js', 'score.js'));
var Particles = require(path.join(__dirname, '..', 'js', 'particles.js'));
var BirdMod = require(path.join(__dirname, '..', 'js', 'bird.js'));
var WormMod = require(path.join(__dirname, '..', 'js', 'worm.js'));
var ObstacleMod = require(path.join(__dirname, '..', 'js', 'obstacle.js'));
var Background = require(path.join(__dirname, '..', 'js', 'background.js'));
var AudioMod = require(path.join(__dirname, '..', 'js', 'audio.js'));

var passed = 0;
var failed = 0;
var failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  \u2713 ' + name);
  } catch (err) {
    failed++;
    failures.push({ name: name, error: err });
    console.log('  \u2717 ' + name + '\n      ' + (err && err.message));
  }
}

function group(name) {
  console.log('\n' + name);
}

function assert(cond, msg) {
  if (!cond) { throw new Error(msg || 'assertion failed'); }
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error((msg || 'not equal') + ' (actual: ' + JSON.stringify(actual) + ', expected: ' + JSON.stringify(expected) + ')');
  }
}

function assertClose(actual, expected, tolerance, msg) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error((msg || 'not close') + ' (actual: ' + actual + ', expected: ' + expected + ' ±' + tolerance + ')');
  }
}

/* ============================== utils ============================== */

group('utils');

test('sanitizeNickname keeps allowed characters only', function () {
  assertEqual(Utils.sanitizeNickname('Zi g!'), 'Zig');
  assertEqual(Utils.sanitizeNickname('a_b-c9'), 'a_b-c9');
  assertEqual(Utils.sanitizeNickname('  \u0418\u0432\u0430\u043d  '), '\u0418\u0432\u0430\u043d');
  assertEqual(Utils.sanitizeNickname('<script>x</script>'), 'scriptxscript');
});

test('sanitizeNickname truncates to 16 characters', function () {
  assertEqual(Utils.sanitizeNickname('abcdefghijklmnopqrstuvwxyz').length, 16);
});

test('validateNickname rejects empty / short / too long', function () {
  assertEqual(Utils.validateNickname('').ok, false);
  assertEqual(Utils.validateNickname('a').ok, false);
  assertEqual(Utils.validateNickname('ab').ok, true);
  assertEqual(Utils.validateNickname('!!!!').ok, false);
  var long = Utils.validateNickname('abcdefghijklmnopqrstuvwxyz');
  assertEqual(long.ok, true, 'long names are truncated, not rejected');
  assertEqual(long.value.length, 16);
});

test('clamp / lerp / approach behave', function () {
  assertEqual(Utils.clamp(12, 0, 10), 10);
  assertEqual(Utils.clamp(-5, 0, 10), 0);
  assertEqual(Utils.lerp(0, 10, 0.5), 5);
  assert(Utils.approach(0, 10, 1, 0.1) > 0 && Utils.approach(0, 10, 1, 0.1) < 10);
  assert(Utils.approach(0, 10, 1, 10) > 9.9, 'approaches quickly with a large dt');
});

test('weightedPick respects weights', function () {
  var entries = [{ weight: 0, id: 'a' }, { weight: 10, id: 'b' }];
  for (var i = 0; i < 50; i++) { assertEqual(Utils.weightedPick(entries).id, 'b'); }
});

test('circleRectOverlap detects overlap and separation', function () {
  assertEqual(Utils.circleRectOverlap(50, 50, 10, 45, 45, 20, 20), true);
  assertEqual(Utils.circleRectOverlap(100, 50, 10, 45, 45, 20, 20), false);
  assertEqual(Utils.circleRectOverlap(42, 50, 10, 45, 45, 20, 20), true, 'edge touch counts');
});

test('formatScore groups thousands', function () {
  assertEqual(Utils.formatScore(0), '0');
  assertEqual(Utils.formatScore(3240), '3 240');
  assertEqual(Utils.formatScore(1234567), '1 234 567');
});

test('makeRng is deterministic', function () {
  var a = Utils.makeRng(42), b = Utils.makeRng(42);
  for (var i = 0; i < 10; i++) { assertEqual(a(), b()); }
  assert(Utils.makeRng(1)() !== Utils.makeRng(2)());
});

test('createEmitter isolates listener errors', function () {
  var em = Utils.createEmitter();
  var hits = 0;
  em.on('x', function () { throw new Error('boom'); });
  em.on('x', function () { hits++; });
  em.emit('x');
  assertEqual(hits, 1);
});

/* ============================== storage ============================== */

group('storage');

function memoryStorage() {
  var map = Object.create(null);
  return Storage.createStorage({
    backend: {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; },
      setItem: function (k, v) { map[k] = String(v); },
      removeItem: function (k) { delete map[k]; }
    }
  });
}

test('nickname round-trip is sanitized', function () {
  var s = memoryStorage();
  assertEqual(s.getNickname(), '');
  s.setNickname('Ze g!');
  assertEqual(s.getNickname(), 'Zeg');
});

test('selected bird falls back when missing or unknown', function () {
  var s = memoryStorage();
  var ids = ['scout', 'professor', 'cyber'];
  assertEqual(s.getBirdId(ids, 'scout'), 'scout');
  s.setBirdId('cyber');
  assertEqual(s.getBirdId(ids, 'scout'), 'cyber');
  s.setBirdId('nonsense');
  assertEqual(s.getBirdId(ids, 'scout'), 'scout', 'unknown id must not be used');
});

test('sound settings persist', function () {
  var s = memoryStorage();
  assertEqual(s.getSound().music, true);
  s.setSound({ music: false, sfx: true });
  assertEqual(s.getSound().music, false);
  assertEqual(s.getSound().sfx, true);
});

test('scores are sorted, ranked and capped', function () {
  var s = memoryStorage();
  s.addScore({ nickname: 'A', score: 100, bird: 'scout', date: 1 });
  var high = s.addScore({ nickname: 'B', score: 500, bird: 'cyber', date: 2 });
  assertEqual(high.rank, 1);
  assertEqual(high.isHighScore, true);
  var low = s.addScore({ nickname: 'C', score: 50, bird: 'professor', date: 3 });
  assertEqual(low.rank, 3);
  assertEqual(low.isHighScore, false);
  assertEqual(s.getBest(), 500);

  for (var i = 0; i < 60; i++) {
    s.addScore({ nickname: 'P' + i, score: 1000 + i, bird: 'scout', date: 100 + i });
  }
  assertEqual(s.getTopScores(10).length, 10);
  assertEqual(s.getTopScores(10)[0].score, 1059);
  assert(s.getScores().length <= Config.LEADERBOARD.keep, 'history is trimmed');
});

test('corrupt payloads never throw', function () {
  var s = memoryStorage();
  s.set('scores', { not: 'an array' });
  assertEqual(s.getScores().length, 0);
  var s2 = memoryStorage();
  s2.set('scores', [null, 42, { nickname: '', score: 10 }, { nickname: 'ok', score: 'NaN' }, { nickname: 'Good', score: 20, bird: 'cyber', date: 5 }]);
  assertEqual(s2.getScores().length, 1);
  assertEqual(s2.getScores()[0].nickname, 'Good');
});

test('clearScores empties the board', function () {
  var s = memoryStorage();
  s.addScore({ nickname: 'A', score: 10, bird: 'scout', date: 1 });
  s.clearScores();
  assertEqual(s.getScores().length, 0);
  assertEqual(s.getBest(), 0);
});

test('games played counter increments', function () {
  var s = memoryStorage();
  assertEqual(s.getGamesPlayed(), 0);
  s.incrementGamesPlayed();
  s.incrementGamesPlayed();
  assertEqual(s.getGamesPlayed(), 2);
});

test('storage survives a broken backend', function () {
  var s = Storage.createStorage({ backend: null });
  s.setNickname('Zig');
  assertEqual(s.persistent, false);
  assertEqual(s.getNickname(), 'Zig', 'memory fallback still works in-session');
});

/* ============================== scoring ============================== */

group('score & combo');

test('worm values and combo multipliers', function () {
  var sm = new Score.ScoreManager();
  var green = Config.WORMS.types[0];
  var blue = Config.WORMS.types[1];
  var purple = Config.WORMS.types[2];
  var gold = Config.WORMS.types[3];

  assertEqual(sm.collectWorm(green).points, 10);
  assertEqual(sm.multiplier, 1);
  assertEqual(sm.collectWorm(green).points, 10);
  var third = sm.collectWorm(green);
  assertEqual(third.multiplier, 2, '3rd worm activates x2');
  assertEqual(third.points, 20, 'multiplier applies to the worm that triggers it');
  assertEqual(third.multiplierUp, true);

  assertEqual(sm.collectWorm(blue).points, 50); // 25 * 2
  assertEqual(sm.collectWorm(purple).points, 100);
  assertEqual(sm.collectWorm(gold).points, 300, 'the 6th worm already pays x3');

  sm.reset();
  for (var i = 0; i < 5; i++) { sm.collectWorm(green); }
  assertEqual(sm.multiplier, 2);
  var sixth = sm.collectWorm(blue);
  assertEqual(sixth.multiplier, 3, '6th worm activates x3');
  assertEqual(sixth.points, 75);

  sm.reset();
  for (var j = 0; j < 9; j++) { sm.collectWorm(green); }
  var tenth = sm.collectWorm(green);
  assertEqual(tenth.multiplier, 4, '10th worm activates x4');
  assertEqual(tenth.points, 40);
});

test('red worm subtracts a flat penalty and breaks the combo', function () {
  var sm = new Score.ScoreManager();
  var green = Config.WORMS.types[0];
  var red = Config.WORMS.types[4];
  for (var i = 0; i < 4; i++) { sm.collectWorm(green); }
  assert(sm.combo === 4 && sm.multiplier === 2);
  var before = sm.score;
  var info = sm.collectWorm(red);
  assertEqual(info.points, -25);
  assertEqual(info.healthy, false);
  assertEqual(sm.score, before - 25);
  assertEqual(sm.combo, 0);
  assertEqual(sm.multiplier, 1);
});

test('score can never go below zero', function () {
  var sm = new Score.ScoreManager();
  var red = Config.WORMS.types[4];
  sm.collectWorm(red);
  assertEqual(sm.score, 0);
  sm.addPoints(10);
  sm.collectWorm(red);
  assertEqual(sm.score, 0);
});

test('passing an obstacle awards +10 (and breaks nothing)', function () {
  var sm = new Score.ScoreManager();
  sm.collectWorm(Config.WORMS.types[0]);
  sm.collectWorm(Config.WORMS.types[0]);
  sm.passObstacle();
  assertEqual(sm.score, 30);
  assertEqual(sm.combo, 2, 'combo is not touched by passing');
  assertEqual(sm.obstaclesPassed, 1);
});

test('hits reset the combo', function () {
  var sm = new Score.ScoreManager();
  sm.collectWorm(Config.WORMS.types[0]);
  sm.collectWorm(Config.WORMS.types[0]);
  sm.registerHit();
  assertEqual(sm.combo, 0);
  assertEqual(sm.multiplier, 1);
  assertEqual(sm.hits, 1);
});

test('difficulty stages grow with score and never jump', function () {
  var l1 = Score.difficultyForScore(0);
  var l2 = Score.difficultyForScore(200);
  var l6 = Score.difficultyForScore(99999);
  assertEqual(l1.level, 1);
  assertEqual(l2.level, 2);
  assertEqual(l6.level, 6);
  assert(l1.stage.speed < l2.stage.speed, 'speed grows');
  assert(l1.stage.gap > l6.stage.gap, 'gap shrinks');
  assert(l1.stage.interval > l6.stage.interval, 'passages come faster');
  for (var i = 1; i < Config.DIFFICULTY.length; i++) {
    assert(Config.DIFFICULTY[i].speed > Config.DIFFICULTY[i - 1].speed);
    assert(Config.DIFFICULTY[i].gap < Config.DIFFICULTY[i - 1].gap);
    assert(Config.DIFFICULTY[i].gap >= Config.OBSTACLE.minGap, 'stage gap stays above the hard floor');
  }
});

test('multiplierFor thresholds', function () {
  assertEqual(Score.multiplierFor(0), 1);
  assertEqual(Score.multiplierFor(2), 1);
  assertEqual(Score.multiplierFor(3), 2);
  assertEqual(Score.multiplierFor(5), 2);
  assertEqual(Score.multiplierFor(6), 3);
  assertEqual(Score.multiplierFor(9), 3);
  assertEqual(Score.multiplierFor(10), 4);
  assertEqual(Score.multiplierFor(500), 4);
});

/* ============================== worms ============================== */

group('worms');

test('typeById works for all five types', function () {
  ['green', 'blue', 'purple', 'gold', 'red'].forEach(function (id) {
    assertEqual(WormMod.typeById(id).id, id);
  });
  assertEqual(Config.WORMS.types.length, 5);
});

test('pickWormType never returns red when excluded', function () {
  for (var i = 0; i < 400; i++) {
    assert(WormMod.pickWormType({ healthyOnly: true }).healthy === true);
  }
});

test('worm rarity: green is the most common, gold the rarest', function () {
  var counts = { green: 0, blue: 0, purple: 0, gold: 0, red: 0 };
  for (var i = 0; i < 4000; i++) { counts[WormMod.pickWormType().id]++; }
  assert(counts.green > counts.blue, 'green > blue');
  assert(counts.blue > counts.purple, 'blue > purple');
  assert(counts.purple > counts.gold, 'purple > gold');
  assert(counts.gold > 0, 'gold does appear');
});

test('worms inside a passage stay within the passage', function () {
  var wm = new WormMod.WormManager();
  var diff = { level: 3, wormChance: 0.9 };
  for (var i = 0; i < 200; i++) {
    wm.reset();
    var list = wm.populatePassage({ x: 1200, gapTop: 200, gapBottom: 460 }, diff);
    assert(list.length >= Config.WORMS.spawnMin, 'at least one worm');
    list.forEach(function (w) {
      assert(w.y > 200 && w.y < 460, 'worm y inside the passage: ' + w.y);
    });
  }
});

test('worm collision uses the bird hitbox', function () {
  var w = new WormMod.Worm(WormMod.typeById('green'), 320, 300);
  var bird = { x: 320, y: 300, hitboxRadius: Config.FLIGHT.hitboxRadius };
  assertEqual(w.intersects(bird), true);
  bird.y = 300 + w.radius + Config.FLIGHT.hitboxRadius + 5;
  assertEqual(w.intersects(bird), false);
});

test('simultaneous collections are all returned', function () {
  var wm = new WormMod.WormManager();
  wm.spawn(WormMod.typeById('green'), 320, 300);
  wm.spawn(WormMod.typeById('blue'), 322, 302);
  wm.spawn(WormMod.typeById('gold'), 318, 298);
  var bird = { x: 320, y: 300, hitboxRadius: Config.FLIGHT.hitboxRadius };
  var picked = wm.collect(bird);
  assertEqual(picked.length, 3);
  assertEqual(wm.count(), 0);
});

test('worms despawn off-screen', function () {
  var wm = new WormMod.WormManager();
  wm.spawn(WormMod.typeById('green'), 100, 300);
  for (var i = 0; i < 200; i++) { wm.update(0.05, 400); }
  assertEqual(wm.count(), 0);
});

/* ============================== obstacles ============================== */

group('obstacles');

function snappedDifficulty(score) {
  var info = Score.difficultyForScore(score);
  var stage = info.stage;
  var next = info.next;
  function blend(key) {
    if (!next) { return stage[key]; }
    var t = info.progress;
    var w = t < 0.6 ? 0 : (t - 0.6) / 0.4;
    return stage[key] + (next[key] - stage[key]) * w;
  }
  return {
    level: stage.level,
    speed: blend('speed'),
    gap: blend('gap'),
    interval: blend('interval'),
    centerDrift: blend('centerDrift'),
    wormChance: blend('wormChance')
  };
}

test('generated passages respect margins and the hard gap floor', function () {
  var om = new ObstacleMod.ObstacleManager();
  var diff = snappedDifficulty(0);
  var last = null;
  for (var i = 0; i < 400; i++) {
    diff = snappedDifficulty(i * 12);
    var pair = om.createPair(1200 + i * 400, diff, last);
    var gap = pair.gapBottom - pair.gapTop;
    assert(gap >= Config.OBSTACLE.minGap - 0.001, 'gap >= minGap (' + gap + ')');
    assert(pair.gapTop >= Config.OBSTACLE.minMarginTop - 0.001, 'top margin kept');
    assert(pair.gapBottom <= Config.WORLD.groundY - Config.OBSTACLE.minMarginBottom + 0.001, 'bottom margin kept');
    last = pair;
  }
});

test('vertical shift between consecutive passages stays flyable', function () {
  for (var attempt = 0; attempt < 200; attempt++) {
    var om = new ObstacleMod.ObstacleManager();
    var last = null;
    for (var i = 0; i < 30; i++) {
      var diff = snappedDifficulty(i * 100);
      var pair = om.createPair(1200 + i * 500, diff, last);
      if (last) {
        var shift = Math.abs(pair.getGapCenter() - last.getGapCenter());
        var allowed = Math.min(diff.centerDrift, 110 + 60 * diff.interval) + 2; // +2 for rounding to whole pixels
        assert(shift <= allowed, 'shift ' + shift.toFixed(1) + ' <= ' + allowed.toFixed(1));
      }
      last = pair;
    }
  }
});

test('collision detection is circle vs rect and forgiving on the edges', function () {
  var pair = new ObstacleMod.ObstaclePair({ x: 600, gapTop: 200, gapBottom: 460, seed: 5 });
  assertEqual(pair.collides({ x: 650, y: 100, hitboxRadius: 17 }), true, 'inside the top column');
  assertEqual(pair.collides({ x: 650, y: 330, hitboxRadius: 17 }), false, 'inside the passage');
  assertEqual(pair.collides({ x: 650, y: 550, hitboxRadius: 17 }), true, 'inside the bottom column');
  assertEqual(pair.collides({ x: 200, y: 100, hitboxRadius: 17 }), false, 'far away');
});

test('manager spawns, moves and reports passed passages', function () {
  var om = new ObstacleMod.ObstacleManager();
  var diff = snappedDifficulty(0);
  var spawnedTotal = 0;
  var passedTotal = 0;
  for (var i = 0; i < 600; i++) {
    var res = om.update(1 / 60, diff, { birdX: Config.FLIGHT.birdX });
    spawnedTotal += res.spawned.length;
    passedTotal += res.passed.length;
  }
  assert(spawnedTotal > 3, 'several passages spawned (' + spawnedTotal + ')');
  assert(passedTotal > 2, 'passages are reported as passed');
  assert(om.count() < 12, 'off-screen passages are recycled');
});

test('autopilot flies through every difficulty stage without a single hit', function () {
  Config.DIFFICULTY.forEach(function () {
    // covered by the loop below; keeps the linter calm
  });
  var stages = [0, 200, 500, 900, 1500, 3000];
  stages.forEach(function (scoreTarget) {
    var diff = snappedDifficulty(scoreTarget);
    var om = new ObstacleMod.ObstacleManager();
    var bird = new BirdMod.Bird(Config.BIRDS[0]);
    var dt = 1 / 60;
    var collisions = 0;
    var checked = 0;

    for (var t = 0; t < 90; t += dt) {
      bird.update(dt, { groundY: Config.WORLD.groundY });
      var res = om.update(dt, diff, { birdX: bird.x });

      // simple lead-compensated autopilot: aim at the next passage centre
      var target = null;
      for (var i = 0; i < om.pairs.length; i++) {
        var pair = om.pairs[i];
        if (pair.x + pair.width > bird.x - 20) {
          if (!target || pair.x < target.x) { target = pair; }
        }
      }
      if (target) {
        // bang-bang autopilot: one flap carries the bird ~80 px up, so it keeps
        // itself inside a band that ends at the passage centre
        var aim = target.getGapCenter();
        if (bird.y > aim - 8 && bird.vy > -80) { bird.flap(); }
        checked++;
      }
      if (om.collides(bird)) { collisions++; }
    }
    assertEqual(collisions, 0, 'no collisions at stage score ' + scoreTarget + ' (speed ' + diff.speed.toFixed(0) + ', gap ' + diff.gap.toFixed(0) + ')');
    assert(checked > 50, 'the autopilot actually met obstacles');
  });
});

/* ============================== particles ============================== */

group('particles');

test('particle budget is respected', function () {
  var ps = new Particles.ParticleSystem({ max: 40 });
  for (var i = 0; i < 50; i++) {
    ps.burst(10, 10, '#fff', { count: 4 });
  }
  assert(ps.count() <= 40, 'count ' + ps.count());
});

test('particles expire', function () {
  var ps = new Particles.ParticleSystem();
  ps.burst(10, 10, '#fff', { count: 5, life: 0.2 });
  ps.update(0.5);
  assertEqual(ps.count(), 0);
});

test('confetti and text particles are created', function () {
  var ps = new Particles.ParticleSystem();
  ps.confetti(20, 800, 600);
  ps.text(10, 10, '+100', '#fff', {});
  assertEqual(ps.count(), 21);
  assertEqual(ps.confettiOn, true);
});

/* ============================== bird physics ============================== */

group('bird');

test('flap gives an upward impulse, gravity pulls down', function () {
  var bird = new BirdMod.Bird(Config.BIRDS[0]);
  bird.flap();
  assert(bird.vy < 0, 'flap moves up');
  var startY = bird.y;
  bird.update(0.1, { groundY: Config.WORLD.groundY });
  assert(bird.y < startY, 'rises right after a flap');
  for (var i = 0; i < 30; i++) { bird.update(0.05, { groundY: Config.WORLD.groundY }); }
  assert(bird.y > startY, 'falls back down eventually');
});

test('physics is delta-time based, not frame based', function () {
  var a = new BirdMod.Bird(Config.BIRDS[0]);
  var b = new BirdMod.Bird(Config.BIRDS[0]);
  a.flap();
  b.flap();
  for (var i = 0; i < 60; i++) { a.update(1 / 60, { groundY: 99999 }); }
  for (var j = 0; j < 240; j++) { b.update(1 / 240, { groundY: 99999 }); }
  assertClose(a.y, b.y, Math.max(2, Math.abs(a.y) * 0.02), 'y after 1s matches across step sizes');
  assertClose(a.vy, b.vy, 6, 'vy after 1s matches across step sizes');
});

test('the bird cannot leave the world vertically', function () {
  var bird = new BirdMod.Bird(Config.BIRDS[0]);
  for (var i = 0; i < 200; i++) { bird.update(0.05, { groundY: Config.WORLD.groundY }); }
  assert(bird.y <= Config.WORLD.groundY - bird.hitboxRadius + 0.001, 'never below the ground');
  assert(bird.y >= bird.hitboxRadius - 0.001, 'never above the ceiling');

  var up = new BirdMod.Bird(Config.BIRDS[0]);
  for (var j = 0; j < 40; j++) { up.flap(); up.update(0.016, { groundY: Config.WORLD.groundY }); }
  assert(up.y >= up.hitboxRadius - 0.001, 'ceiling is respected');
});

test('every character shares exactly the same flight model and hitbox', function () {
  Config.BIRDS.forEach(function (def) {
    var bird = new BirdMod.Bird(def);
    assertEqual(bird.hitboxRadius, Config.FLIGHT.hitboxRadius);
    bird.flap();
    assertEqual(bird.vy, Config.FLIGHT.flapVelocity);
    assert(!('speed' in def) && !('hitbox' in def) && !('scoreBonus' in def) && !('lives' in def),
      'character definitions must not carry gameplay modifiers (' + def.id + ')');
  });

  var birds = Config.BIRDS.map(function (d) { return new BirdMod.Bird(d); });
  birds.forEach(function (b) { b.flap(); });
  for (var i = 0; i < 120; i++) {
    birds.forEach(function (b) { b.update(1 / 60, { groundY: Config.WORLD.groundY }); });
  }
  var ys = birds.map(function (b) { return b.y; });
  assertClose(ys[0], ys[1], 0.0001, 'scout and professor follow the same path');
  assertClose(ys[1], ys[2], 0.0001, 'professor and cyber follow the same path');
});

test('invulnerability blocks repeated hits and blinks', function () {
  var bird = new BirdMod.Bird(Config.BIRDS[1]);
  assertEqual(bird.isInvulnerable(), false);
  bird.hit();
  assertEqual(bird.isInvulnerable(), true);
  assertEqual(bird.getAlpha(0), 0.32, 'starts dim');
  assert(bird.getAlpha(1 / (Config.LIVES.blinkHz * 2)) > 0.9, 'blinks back to visible');
  bird.update(Config.LIVES.invulnerableTime + 0.01, { groundY: Config.WORLD.groundY });
  assertEqual(bird.isInvulnerable(), false);
  assertEqual(bird.getAlpha(3), 1);
});

test('three distinct characters are configured', function () {
  assertEqual(Config.BIRDS.length, 3);
  var ids = Config.BIRDS.map(function (b) { return b.id; });
  assertEqual(ids.join(','), 'scout,professor,cyber');
  Config.BIRDS.forEach(function (b) {
    assert(!!b.name && !!b.tagline, b.id + ' has a name and a tagline');
    assert(!!b.body && !!b.wing && !!b.crest, b.id + ' has its own palette');
  });
});

/* ============================== background & audio ============================== */

group('background & audio');

test('parallax layers scroll and stay ordered', function () {
  var bg = new Background.ParallaxBackground();
  bg.update(1, 300);
  assert(bg.offsets.tufts > bg.offsets.trees, 'near layers move faster');
  assert(bg.offsets.trees > bg.offsets.hillsNear, 'mid layers move faster than far ones');
  assert(bg.offsets.hillsNear > bg.offsets.clouds, 'clouds are the slowest');
  assert(bg.clouds.length > 0 && bg.trees.length > 0);
});

test('AudioManager degrades gracefully without Web Audio', function () {
  var calls = [];
  var am = new AudioMod.AudioManager({ onError: function () {} });
  am.available = false;
  assertEqual(am.ensureContext(), null);
  assertEqual(am.play('flap'), false, 'no crash without audio support');
  assertEqual(am.setSettings({ music: true, sfx: false }).sfx, false);
  am.setIntensity(4);
  assertEqual(am.intensity, 4);
  am.startMusic();
  assertEqual(am.isMusicPlaying(), false, 'music does not start without a context');
  am.stopMusic();
  void calls;
});

test('all required sound effects are defined', function () {
  var required = ['flap', 'worm_green', 'worm_blue', 'worm_purple', 'worm_gold', 'worm_red',
    'collision', 'life_lost', 'combo', 'game_over', 'high_score', 'ui_click', 'pause', 'resume'];
  required.forEach(function (name) {
    assert(AudioMod.AudioManager.SFX_NAMES.indexOf(name) >= 0, 'missing sfx: ' + name);
  });
});

/* ============================== summary ============================== */

console.log('\n' + (failed === 0 ? 'ALL TESTS PASSED' : 'FAILURES: ' + failed) + ' — ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
  failures.forEach(function (f) { console.log('  fail: ' + f.name + ' -> ' + f.error.message); });
  process.exitCode = 1;
}
