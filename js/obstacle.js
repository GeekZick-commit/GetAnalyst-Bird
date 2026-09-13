/* ==========================================================================
   obstacle.js — ObstaclePair / ObstacleManager.
   Passages are carved between natural structures (mossy rocks, logs, vines),
   never pipes. Generation guarantees that every passage stays reachable.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  var api = factory(
    (typeof module === 'object' && module.exports) ? require('./utils.js') : (root.GA || {}),
    (typeof module === 'object' && module.exports) ? require('./config.js') : (root.GA || {})
  );
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  if (root) { root.GA = root.GA || {}; Object.assign(root.GA, api); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Utils, Config) {
  'use strict';

  var WORLD = Config.WORLD;
  var OBSTACLE = Config.OBSTACLE;
  var TAU = Utils.TAU;

  var STYLES = ['stone', 'wood', 'vine'];

  var STYLE_PALETTE = {
    stone: { top: '#93A2AE', mid: '#6E7D8A', bottom: '#49555F', line: '#3B454D', moss: '#5FA36B', mossDark: '#3F7C4C' },
    wood: { top: '#B9834F', mid: '#96613A', bottom: '#6B4426', line: '#52321A', moss: '#6FAE5F', mossDark: '#49803E' },
    vine: { top: '#7C8C4A', mid: '#5B6B33', bottom: '#3A4722', line: '#2C361A', moss: '#8FC65B', mossDark: '#5E8F3B' }
  };

  function makeDecor(seed, kind) {
    var rng = Utils.makeRng(seed);
    var items = [];
    var count = kind === 'leaf' ? 9 : 12;
    for (var i = 0; i < count; i++) {
      items.push({
        u: rng(),
        v: rng(),
        s: 0.55 + rng() * 0.8,
        r: (rng() - 0.5) * 1.4,
        tone: rng()
      });
    }
    return items;
  }

  /* ------------------------- drawing helpers ------------------------- */

  function organicColumn(ctx, x, y, w, h, palette, seed, isTop) {
    if (h <= 0) { return; }
    var rng = Utils.makeRng(seed);
    var grad = ctx.createLinearGradient(x, 0, x + w, 0);
    grad.addColorStop(0, palette.top);
    grad.addColorStop(0.45, palette.mid);
    grad.addColorStop(1, palette.bottom);
    ctx.fillStyle = grad;

    // main mass
    ctx.beginPath();
    ctx.moveTo(x + 4, y);
    ctx.lineTo(x + w - 4, y);
    ctx.quadraticCurveTo(x + w + 3, y + h * 0.5, x + w - 4, y + h);
    ctx.lineTo(x + 4, y + h);
    ctx.quadraticCurveTo(x - 3, y + h * 0.5, x + 4, y);
    ctx.closePath();
    ctx.fill();

    // organic bumps along both vertical edges
    var bumps = 4;
    for (var i = 0; i < bumps; i++) {
      var v = (i + 0.5) / bumps;
      var by = y + h * v;
      var br = w * (0.16 + rng() * 0.13);
      ctx.beginPath();
      ctx.arc(x + rng() * 5, by, br, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + w - rng() * 5, by + h * 0.06, br * 0.92, 0, TAU);
      ctx.fill();
    }

    // texture
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = palette.line;
    ctx.lineWidth = Math.max(1.5, w * 0.03);
    if (palette === STYLE_PALETTE.wood) {
      for (var g = 0; g < 4; g++) {
        var gx = x + w * (0.2 + g * 0.2);
        ctx.beginPath();
        ctx.moveTo(gx, y + h * 0.04);
        ctx.bezierCurveTo(gx + 8, y + h * 0.35, gx - 8, y + h * 0.65, gx + 4, y + h * 0.97);
        ctx.stroke();
      }
    } else if (palette === STYLE_PALETTE.stone) {
      for (var c = 0; c < 6; c++) {
        var cx = x + w * (0.15 + rng() * 0.7);
        var cy = y + h * (0.08 + rng() * 0.84);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + (rng() - 0.5) * w * 0.5, cy + (rng() - 0.5) * h * 0.09);
        ctx.stroke();
      }
    } else {
      for (var v2 = 0; v2 < 5; v2++) {
        var vx = x + w * (0.2 + v2 * 0.15);
        ctx.beginPath();
        ctx.moveTo(vx, y);
        ctx.quadraticCurveTo(vx + 10, y + h * 0.5, vx - 6, y + h);
        ctx.stroke();
      }
    }
    ctx.restore();

    // moss / foliage cap on the passage-facing side
    var capY = isTop ? y + h : y;
    var capH = Math.max(12, h * 0.09);
    ctx.fillStyle = palette.moss;
    ctx.beginPath();
    ctx.ellipse(x + w * 0.5, capY, w * 0.56, capH, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = palette.mossDark;
    ctx.beginPath();
    ctx.ellipse(x + w * 0.42, capY + (isTop ? -capH * 0.35 : capH * 0.35), w * 0.34, capH * 0.55, 0, 0, TAU);
    ctx.fill();
    void isTop;
  }

  function drawLeaves(ctx, decor, x, y, w, h, isTop) {
    var baseY = isTop ? y + h : y;
    for (var i = 0; i < decor.length; i++) {
      var d = decor[i];
      var lx = x + d.u * w;
      var ly = baseY + (isTop ? -1 : 1) * (6 + d.v * h * 0.22);
      var s = w * 0.30 * d.s;
      var greens = ['#63A94F', '#7CC35D', '#4C8C3E'];
      ctx.save();
      ctx.translate(lx, ly);
      ctx.rotate(d.r + (isTop ? Math.PI : 0));
      ctx.fillStyle = greens[Math.floor(d.tone * greens.length) % greens.length];
      ctx.beginPath();
      ctx.ellipse(0, -s * 0.5, s * 0.5, s, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawVines(ctx, pair, isTop) {
    var x = pair.x, w = pair.width;
    var from = isTop ? pair.gapTop : pair.gapBottom;
    var to = isTop ? 0 : WORLD.groundY;
    var len = from - to;
    if (len <= 40) { return; }
    var y0 = isTop ? from - 10 : from + 10;
    var dir = isTop ? -1 : 1;
    ctx.save();
    ctx.strokeStyle = '#4C8C3E';
    ctx.lineWidth = 3.2;
    ctx.lineCap = 'round';
    for (var i = 0; i < 2; i++) {
      var vx = x + w * (0.28 + i * 0.42);
      ctx.beginPath();
      ctx.moveTo(vx, y0);
      ctx.quadraticCurveTo(vx + 14 * (i ? 1 : -1), y0 + dir * len * 0.5, vx - 6 * (i ? 1 : -1), y0 + dir * Math.min(len * 0.92, 210));
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ------------------------- obstacle pair ------------------------- */

  function ObstaclePair(opts) {
    this.x = opts.x;
    this.width = opts.width || OBSTACLE.width;
    this.gapTop = opts.gapTop;
    this.gapBottom = opts.gapBottom;
    this.style = opts.style || 'stone';
    this.seed = opts.seed || Math.floor(Math.random() * 1e9);
    this.passed = false;
    this.decor = makeDecor(this.seed, 'leaf');
    this.crackDecor = makeDecor(this.seed + 7, 'crack');
    this.entered = false;
  }

  ObstaclePair.prototype.getGapCenter = function () {
    return (this.gapTop + this.gapBottom) / 2;
  };

  ObstaclePair.prototype.getGapHeight = function () {
    return this.gapBottom - this.gapTop;
  };

  ObstaclePair.prototype.getRects = function () {
    var f = OBSTACLE.edgeForgiveness;
    return [
      { x: this.x + f, y: 0, w: this.width - f * 2, h: this.gapTop - f, fromTop: true },
      { x: this.x + f, y: this.gapBottom + f, w: this.width - f * 2, h: WORLD.groundY - this.gapBottom - f * 2, fromTop: false }
    ];
  };

  ObstaclePair.prototype.collides = function (bird) {
    var rects = this.getRects();
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i];
      if (r.h <= 0) { continue; }
      if (Utils.circleRectOverlap(bird.x, bird.y, bird.hitboxRadius, r.x, r.y, r.w, r.h)) { return true; }
    }
    return false;
  };

  ObstaclePair.prototype.draw = function (ctx, time) {
    var palette = STYLE_PALETTE[this.style] || STYLE_PALETTE.stone;
    var w = this.width;

    organicColumn(ctx, this.x, 0, w, this.gapTop, palette, this.seed, true);
    organicColumn(ctx, this.x, this.gapBottom, w, WORLD.groundY - this.gapBottom, palette, this.seed + 3, false);

    if (this.style === 'vine') {
      drawVines(ctx, this, true);
      drawVines(ctx, this, false);
    }
    drawLeaves(ctx, this.decor, this.x, 0, w, this.gapTop, true);
    drawLeaves(ctx, this.decor, this.x, this.gapBottom, w, WORLD.groundY - this.gapBottom, false);

    // soft ambient shadow inside the passage so depth reads well
    var shade = ctx.createLinearGradient(this.x, 0, this.x + w, 0);
    shade.addColorStop(0, 'rgba(0, 0, 0, 0.20)');
    shade.addColorStop(0.5, 'rgba(0, 0, 0, 0)');
    shade.addColorStop(1, 'rgba(0, 0, 0, 0.16)');
    ctx.fillStyle = shade;
    ctx.fillRect(this.x, 0, w, this.gapTop);
    ctx.fillRect(this.x, this.gapBottom, w, WORLD.groundY - this.gapBottom);
    void time;
  };

  /* ------------------------- manager ------------------------- */

  function ObstacleManager(options) {
    options = options || {};
    this.pairs = [];
    this.spawnOffset = options.spawnOffset == null ? 40 : options.spawnOffset;
    this.lastStyleIndex = 0;
    this.seedCounter = 1;
  }

  ObstacleManager.prototype.reset = function () {
    this.pairs.length = 0;
    this.seedCounter = 1;
  };

  ObstacleManager.prototype.count = function () { return this.pairs.length; };

  /**
   * @param {number} dt
   * @param {object} diff smoothed difficulty { speed, gap, interval, centerDrift, level }
   * @param {{ birdX: number }} opts
   * @returns {{ spawned: ObstaclePair[], passed: ObstaclePair[] }}
   */
  ObstacleManager.prototype.update = function (dt, diff, opts) {
    opts = opts || {};
    var birdX = opts.birdX == null ? WORLD.width * 0.25 : opts.birdX;
    var speed = diff.speed;
    var i;

    for (i = 0; i < this.pairs.length; i++) {
      this.pairs[i].x -= speed * dt;
      if (!this.pairs[i].entered && this.pairs[i].x < WORLD.width) { this.pairs[i].entered = true; }
    }

    var passed = [];
    for (i = this.pairs.length - 1; i >= 0; i--) {
      var pair = this.pairs[i];
      if (pair.x + pair.width < -80) { this.pairs.splice(i, 1); continue; }
      if (!pair.passed && pair.x + pair.width < birdX) {
        pair.passed = true;
        passed.push(pair);
      }
    }

    var spacing = Math.max(260, speed * diff.interval);
    var spawned = [];
    var last = this.pairs.length ? this.pairs[this.pairs.length - 1] : null;
    var spawnX = WORLD.width + this.spawnOffset;
    var threshold = spawnX - spacing;

    if (!last || last.x <= threshold) {
      var x = last ? Math.max(spawnX, last.x + spacing) : spawnX;
      var pair2 = this.createPair(x, diff, last);
      this.pairs.push(pair2);
      spawned.push(pair2);
    }

    return { spawned: spawned, passed: passed };
  };

  ObstacleManager.prototype.createPair = function (x, diff, last) {
    var gap = Utils.clamp(diff.gap, OBSTACLE.minGap, 360);
    var minCenter = OBSTACLE.minMarginTop + gap / 2;
    var maxCenter = WORLD.groundY - OBSTACLE.minMarginBottom - gap / 2;
    if (maxCenter < minCenter) { maxCenter = minCenter = (minCenter + maxCenter) / 2; }

    var prevCenter = last ? last.getGapCenter() : WORLD.height * 0.46;
    // The vertical shift between two passages must stay flyable: it is capped by
    // both the stage drift and the time the player has before the next passage.
    var maxDelta = Math.min(diff.centerDrift, 110 + 60 * diff.interval);
    var delta = Utils.randRange(-maxDelta, maxDelta);
    var center = Utils.clamp(prevCenter + delta, minCenter, maxCenter);

    // Keep consecutive styles varied without making difficulty jump.
    this.lastStyleIndex = (this.lastStyleIndex + 1 + (Utils.chance(0.4) ? 1 : 0)) % STYLES.length;

    var pair = new ObstaclePair({
      x: x,
      width: OBSTACLE.width,
      gapTop: Math.round(center - gap / 2),
      gapBottom: Math.round(center + gap / 2),
      style: STYLES[this.lastStyleIndex],
      seed: 1000 + (this.seedCounter++) * 37
    });
    return pair;
  };

  ObstacleManager.prototype.collides = function (bird) {
    for (var i = 0; i < this.pairs.length; i++) {
      if (this.pairs[i].collides(bird)) { return this.pairs[i]; }
    }
    return null;
  };

  ObstacleManager.prototype.draw = function (ctx, time) {
    for (var i = 0; i < this.pairs.length; i++) {
      this.pairs[i].draw(ctx, time);
    }
  };

  ObstacleManager.STYLES = STYLES;
  return {
    ObstaclePair: ObstaclePair,
    ObstacleManager: ObstacleManager,
    STYLE_PALETTE: STYLE_PALETTE
  };
});
