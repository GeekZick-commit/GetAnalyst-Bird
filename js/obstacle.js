/* ==========================================================================
   obstacle.js — ObstaclePair / ObstacleManager.
   Passages are carved between natural structures (mossy rocks, logs, vines),
   never pipes. Generation guarantees that every passage stays reachable.

   Performance notes: gradients are created once per style (not per frame),
   the organic bumps are precomputed per pair (no RNG in the hot path) and
   collision tests allocate nothing (they used to build two rect objects per
   pair per frame, which fed the garbage collector).
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

  var GREENS = ['#63A94F', '#7CC35D', '#4C8C3E'];

  /* ------------------------- cached paints ------------------------- */

  var PAINT = { ctx: null, column: {}, shade: {} };

  function useContext(ctx) {
    if (PAINT.ctx !== ctx) {
      PAINT.ctx = ctx;
      PAINT.column = {};
      PAINT.shade = {};
    }
  }

  function columnGradient(ctx, style, w) {
    useContext(ctx);
    var g = PAINT.column[style];
    if (!g) {
      var p = STYLE_PALETTE[style] || STYLE_PALETTE.stone;
      g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, p.top);
      g.addColorStop(0.45, p.mid);
      g.addColorStop(1, p.bottom);
      PAINT.column[style] = g;
    }
    return g;
  }

  function shadeGradient(ctx, w) {
    useContext(ctx);
    var g = PAINT.shade[w];
    if (!g) {
      g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, 'rgba(0, 0, 0, 0.20)');
      g.addColorStop(0.5, 'rgba(0, 0, 0, 0)');
      g.addColorStop(1, 'rgba(0, 0, 0, 0.16)');
      PAINT.shade[w] = g;
    }
    return g;
  }

  function makeDecor(seed, count) {
    var rng = Utils.makeRng(seed);
    var items = [];
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

  /** Precomputed silhouette bumps so the shape never shimmers or re-rolls. */
  function makeBumps(seed) {
    var rng = Utils.makeRng(seed);
    var out = [];
    for (var i = 0; i < 4; i++) {
      out.push({
        v: (i + 0.5) / 4,
        r: 0.16 + rng() * 0.13,
        j1: rng() * 5,
        j2: rng() * 5,
        dy: rng() * 0.06
      });
    }
    return out;
  }

  /* ------------------------- drawing (pair-local coords) ------------------------- */

  function paintColumn(ctx, x, y, w, h, style, bumps, isTop, cracks) {
    if (h <= 0) { return; }
    var palette = STYLE_PALETTE[style] || STYLE_PALETTE.stone;
    ctx.fillStyle = columnGradient(ctx, style, w);

    ctx.beginPath();
    ctx.moveTo(x + 4, y);
    ctx.lineTo(x + w - 4, y);
    ctx.quadraticCurveTo(x + w + 3, y + h * 0.5, x + w - 4, y + h);
    ctx.lineTo(x + 4, y + h);
    ctx.quadraticCurveTo(x - 3, y + h * 0.5, x + 4, y);
    ctx.closePath();
    ctx.fill();

    // organic bumps along both vertical edges
    for (var i = 0; i < bumps.length; i++) {
      var b = bumps[i];
      var by = y + h * b.v;
      var br = w * b.r;
      ctx.beginPath();
      ctx.arc(x + b.j1, by, br, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + w - b.j2, by + h * b.dy, br * 0.92, 0, TAU);
      ctx.fill();
    }

    // texture
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = palette.line;
    ctx.lineWidth = Math.max(1.5, w * 0.03);
    var n, gx;
    if (style === 'wood') {
      for (n = 0; n < 4; n++) {
        gx = x + w * (0.2 + n * 0.2);
        ctx.beginPath();
        ctx.moveTo(gx, y + h * 0.04);
        ctx.bezierCurveTo(gx + 8, y + h * 0.35, gx - 8, y + h * 0.65, gx + 4, y + h * 0.97);
        ctx.stroke();
      }
    } else if (style === 'stone') {
      for (n = 0; n < cracks.length; n++) {
        var cx = x + w * (0.15 + cracks[n].u * 0.7);
        var cy = y + h * (0.08 + cracks[n].v * 0.84);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + (cracks[n].r) * w * 0.5, cy + (cracks[n].tone - 0.5) * h * 0.09);
        ctx.stroke();
      }
    } else {
      for (n = 0; n < 5; n++) {
        gx = x + w * (0.2 + n * 0.15);
        ctx.beginPath();
        ctx.moveTo(gx, y);
        ctx.quadraticCurveTo(gx + 10, y + h * 0.5, gx - 6, y + h);
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
  }

  function paintLeaves(ctx, decor, x, y, w, h, isTop) {
    var baseY = isTop ? y + h : y;
    for (var i = 0; i < decor.length; i++) {
      var d = decor[i];
      var lx = x + d.u * w;
      var ly = baseY + (isTop ? -1 : 1) * (6 + d.v * h * 0.22);
      var s = w * 0.30 * d.s;
      ctx.save();
      ctx.translate(lx, ly);
      ctx.rotate(d.r + (isTop ? Math.PI : 0));
      ctx.fillStyle = GREENS[Math.floor(d.tone * GREENS.length) % GREENS.length];
      ctx.beginPath();
      ctx.ellipse(0, -s * 0.5, s * 0.5, s, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  function paintVines(ctx, x, w, from, to, isTop) {
    var len = Math.abs(from - to);
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
    this.entered = false;
    this.decor = makeDecor(this.seed, 6);
    this.cracks = makeDecor(this.seed + 7, 6);
    this.bumpsTop = makeBumps(this.seed + 13);
    this.bumpsBottom = makeBumps(this.seed + 21);
  }

  ObstaclePair.prototype.getGapCenter = function () {
    return (this.gapTop + this.gapBottom) / 2;
  };

  ObstaclePair.prototype.getGapHeight = function () {
    return this.gapBottom - this.gapTop;
  };

  /** Allocates: kept for tests and tooling, not used in the game loop. */
  ObstaclePair.prototype.getRects = function () {
    var f = OBSTACLE.edgeForgiveness;
    return [
      { x: this.x + f, y: 0, w: this.width - f * 2, h: this.gapTop - f, fromTop: true },
      { x: this.x + f, y: this.gapBottom + f, w: this.width - f * 2, h: WORLD.groundY - this.gapBottom - f * 2, fromTop: false }
    ];
  };

  /** Allocation-free circle vs axis-aligned rect overlap. */
  function hitsRect(cx, cy, r, rx, ry, rw, rh) {
    if (rh <= 0 || rw <= 0) { return false; }
    var nx = cx < rx ? rx : (cx > rx + rw ? rx + rw : cx);
    var ny = cy < ry ? ry : (cy > ry + rh ? ry + rh : cy);
    var dx = cx - nx, dy = cy - ny;
    return (dx * dx + dy * dy) < (r * r);
  }

  ObstaclePair.prototype.collides = function (bird) {
    var f = OBSTACLE.edgeForgiveness;
    var rx = this.x + f;
    var rw = this.width - f * 2;
    return hitsRect(bird.x, bird.y, bird.hitboxRadius, rx, 0, rw, this.gapTop - f) ||
      hitsRect(bird.x, bird.y, bird.hitboxRadius, rx, this.gapBottom + f, rw, WORLD.groundY - this.gapBottom - f * 2);
  };

  ObstaclePair.prototype.draw = function (ctx) {
    var w = this.width;
    ctx.save();
    ctx.translate(this.x, 0);

    paintColumn(ctx, 0, 0, w, this.gapTop, this.style, this.bumpsTop, true, this.cracks);
    paintColumn(ctx, 0, this.gapBottom, w, WORLD.groundY - this.gapBottom, this.style, this.bumpsBottom, false, this.cracks);

    if (this.style === 'vine') {
      paintVines(ctx, 0, w, this.gapTop, 0, true);
      paintVines(ctx, 0, w, this.gapBottom, WORLD.groundY, false);
    }
    paintLeaves(ctx, this.decor, 0, 0, w, this.gapTop, true);
    paintLeaves(ctx, this.decor, 0, this.gapBottom, w, WORLD.groundY - this.gapBottom, false);

    // soft ambient shadow just inside the passage: full-height shading used to
    // double the blended pixel count of every column for almost no visual gain
    var band = Math.min(120, this.gapTop);
    ctx.fillStyle = shadeGradient(ctx, w);
    if (band > 0) { ctx.fillRect(0, this.gapTop - band, w, band); }
    var bottomBand = Math.min(120, WORLD.groundY - this.gapBottom);
    if (bottomBand > 0) { ctx.fillRect(0, this.gapBottom, w, bottomBand); }

    ctx.restore();
  };

  /* ------------------------- manager ------------------------- */

  function ObstacleManager(options) {
    options = options || {};
    this.pairs = [];
    this.spawnOffset = options.spawnOffset == null ? 40 : options.spawnOffset;
    this.lastStyleIndex = 0;
    this.seedCounter = 1;
    // reused every frame so update() allocates nothing
    this.result = { spawned: [], passed: [] };
  }

  ObstacleManager.prototype.reset = function () {
    this.pairs.length = 0;
    this.seedCounter = 1;
    this.result.spawned.length = 0;
    this.result.passed.length = 0;
  };

  ObstacleManager.prototype.count = function () { return this.pairs.length; };

  /**
   * @param {number} dt
   * @param {object} diff smoothed difficulty { speed, gap, interval, centerDrift, level }
   * @param {{ birdX: number }} opts
   * @returns {{ spawned: ObstaclePair[], passed: ObstaclePair[] }} reused arrays
   */
  ObstacleManager.prototype.update = function (dt, diff, opts) {
    opts = opts || {};
    var birdX = opts.birdX == null ? WORLD.width * 0.25 : opts.birdX;
    var speed = diff.speed;
    var i;

    var result = this.result;
    result.spawned.length = 0;
    result.passed.length = 0;

    for (i = 0; i < this.pairs.length; i++) {
      this.pairs[i].x -= speed * dt;
      if (!this.pairs[i].entered && this.pairs[i].x < WORLD.width) { this.pairs[i].entered = true; }
    }

    for (i = this.pairs.length - 1; i >= 0; i--) {
      var pair = this.pairs[i];
      if (pair.x + pair.width < -80) { this.pairs.splice(i, 1); continue; }
      if (!pair.passed && pair.x + pair.width < birdX) {
        pair.passed = true;
        result.passed.push(pair);
      }
    }

    var spacing = Math.max(260, speed * diff.interval);
    var last = this.pairs.length ? this.pairs[this.pairs.length - 1] : null;
    var spawnX = WORLD.width + this.spawnOffset;
    var threshold = spawnX - spacing;

    if (!last || last.x <= threshold) {
      var x = last ? Math.max(spawnX, last.x + spacing) : spawnX;
      var created = this.createPair(x, diff, last);
      this.pairs.push(created);
      result.spawned.push(created);
    }

    return result;
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

    return new ObstaclePair({
      x: x,
      width: OBSTACLE.width,
      gapTop: Math.round(center - gap / 2),
      gapBottom: Math.round(center + gap / 2),
      style: STYLES[this.lastStyleIndex],
      seed: 1000 + (this.seedCounter++) * 37
    });
  };

  ObstacleManager.prototype.collides = function (bird) {
    for (var i = 0; i < this.pairs.length; i++) {
      if (this.pairs[i].collides(bird)) { return this.pairs[i]; }
    }
    return null;
  };

  ObstacleManager.prototype.draw = function (ctx) {
    for (var i = 0; i < this.pairs.length; i++) {
      this.pairs[i].draw(ctx);
    }
  };

  ObstacleManager.STYLES = STYLES;
  return {
    ObstaclePair: ObstaclePair,
    ObstacleManager: ObstacleManager,
    STYLE_PALETTE: STYLE_PALETTE
  };
});
