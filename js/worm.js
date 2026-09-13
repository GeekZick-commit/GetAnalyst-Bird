/* ==========================================================================
   worm.js — Worm entities and the WormManager.
   Five types with different value, rarity and look. Red worms are a trap:
   they cost score and break the combo but never take a life.
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

  var WORMS = Config.WORMS;
  var TAU = Utils.TAU;

  function typeById(id) {
    for (var i = 0; i < WORMS.types.length; i++) {
      if (WORMS.types[i].id === id) { return WORMS.types[i]; }
    }
    return WORMS.types[0];
  }

  /** Rarity roll with a guaranteed healthy worm most of the time. */
  function pickWormType(opts) {
    opts = opts || {};
    var pool = WORMS.types.filter(function (t) {
      if (opts.healthyOnly) { return t.healthy; }
      if (opts.excludeRed) { return t.id !== 'red'; }
      return true;
    });
    var entry = Utils.weightedPick(pool.map(function (t) { return { weight: t.weight, type: t }; }));
    return entry ? entry.type : WORMS.types[0];
  }

  function Worm(type, x, y) {
    this.type = type;
    this.x = x;
    this.y = y;
    this.baseY = y;
    this.radius = type.radius * Utils.randRange(1 - WORMS.sizeJitter, 1 + WORMS.sizeJitter);
    this.phase = Math.random() * TAU;
    this.bobAmp = Utils.randRange(3, 9);
    this.bobSpeed = Utils.randRange(1.4, 2.4);
    this.spin = Utils.randRange(-0.5, 0.5);
    this.collected = false;
    this.spawnAnim = 0;
    this.segments = type.id === 'gold' ? 5 : 4;
    this.angle = Utils.randRange(-0.5, 0.5);
  }

  Worm.prototype.update = function (dt, speed) {
    this.x -= speed * dt;
    this.phase += dt * this.bobSpeed;
    this.y = this.baseY + Math.sin(this.phase) * this.bobAmp;
    this.angle += this.spin * dt * 0.4;
    if (this.spawnAnim < 1) { this.spawnAnim = Math.min(1, this.spawnAnim + dt * 3); }
    return this;
  };

  Worm.prototype.getHitbox = function () {
    return { x: this.x, y: this.y, r: this.radius * 0.98 };
  };

  Worm.prototype.intersects = function (bird) {
    var dx = this.x - bird.x;
    var dy = this.y - bird.y;
    var rr = this.radius + bird.hitboxRadius * 0.92;
    return (dx * dx + dy * dy) <= rr * rr;
  };

  Worm.prototype.draw = function (ctx, time) {
    var t = this.type;
    var r = this.radius * (0.6 + 0.4 * this.spawnAnim);
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(Math.sin(this.angle) * 0.22);

    if (t.id === 'gold') {
      var halo = ctx.createRadialGradient(0, 0, 1, 0, 0, r * 3.1);
      halo.addColorStop(0, 'rgba(255, 233, 168, 0.75)');
      halo.addColorStop(0.5, 'rgba(255, 209, 102, 0.28)');
      halo.addColorStop(1, 'rgba(255, 209, 102, 0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(0, 0, r * 3.1, 0, TAU);
      ctx.fill();
    }

    ctx.shadowColor = t.glow;
    ctx.shadowBlur = t.id === 'gold' ? 20 : 8;

    // body: a small stack of segments curled into an arc
    for (var i = this.segments - 1; i >= 0; i--) {
      var f = i / (this.segments - 1);
      var sx = -f * r * 1.35;
      var sy = Math.sin(f * Math.PI * 0.9 + (time * 2 + this.phase)) * r * 0.42;
      var sr = r * (1 - f * 0.34);
      ctx.fillStyle = i % 2 === 0 ? t.body : t.bodyDark;
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, TAU);
      ctx.fill();
    }

    // head
    ctx.fillStyle = t.body;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.16)';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // band + shine
    ctx.save();
    ctx.globalAlpha *= 0.85;
    ctx.fillStyle = t.band;
    ctx.beginPath();
    ctx.ellipse(-r * 0.15, -r * 0.3, r * 0.62, r * 0.3, -0.4, 0, TAU);
    ctx.fill();
    ctx.restore();

    // eyes
    var eyeY = -r * 0.18;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(r * 0.28, eyeY, r * 0.26, 0, TAU);
    ctx.arc(r * 0.72, eyeY + r * 0.06, r * 0.24, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#20252A';
    ctx.beginPath();
    ctx.arc(r * 0.34, eyeY + r * 0.03, r * 0.13, 0, TAU);
    ctx.arc(r * 0.76, eyeY + r * 0.09, r * 0.12, 0, TAU);
    ctx.fill();

    // mouth: smile for healthy, frown + brows for the red trap
    ctx.strokeStyle = '#20252A';
    ctx.lineWidth = Math.max(1.2, r * 0.11);
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (t.healthy) {
      ctx.arc(r * 0.46, r * 0.3, r * 0.3, 0.15 * Math.PI, 0.85 * Math.PI);
    } else {
      ctx.arc(r * 0.46, r * 0.72, r * 0.3, 1.15 * Math.PI, 1.85 * Math.PI);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(r * 0.1, eyeY - r * 0.5);
      ctx.lineTo(r * 0.44, eyeY - r * 0.2);
      ctx.moveTo(r * 0.95, eyeY - r * 0.42);
      ctx.lineTo(r * 0.62, eyeY - r * 0.16);
    }
    ctx.stroke();

    if (t.id === 'gold') {
      // sparkle
      var sp = 0.6 + Math.abs(Math.sin(time * 3 + this.phase)) * 0.6;
      ctx.fillStyle = 'rgba(255, 255, 255, ' + (0.55 * sp).toFixed(3) + ')';
      ctx.beginPath();
      ctx.moveTo(r * 1.25, -r * 1.1);
      ctx.lineTo(r * 1.45, -r * 0.55);
      ctx.lineTo(r * 1.85, -r * 0.35);
      ctx.lineTo(r * 1.45, -r * 0.15);
      ctx.lineTo(r * 1.25, r * 0.4);
      ctx.lineTo(r * 1.05, -r * 0.15);
      ctx.lineTo(r * 0.65, -r * 0.35);
      ctx.lineTo(r * 1.05, -r * 0.55);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  };

  /* ======================= manager ======================= */

  function WormManager(options) {
    options = options || {};
    this.items = [];
    this.max = options.max || 24;
  }

  WormManager.prototype.reset = function () { this.items.length = 0; };

  WormManager.prototype.count = function () { return this.items.length; };

  WormManager.prototype.spawn = function (type, x, y) {
    if (this.items.length >= this.max) { this.items.shift(); }
    var w = new Worm(type, x, y);
    this.items.push(w);
    return w;
  };

  /**
   * Fills a freshly created passage with an appetising arrangement.
   * @param {{x:number, gapTop:number, gapBottom:number}} passage
   * @returns {Worm[]} spawned worms
   */
  WormManager.prototype.populatePassage = function (passage, difficulty) {
    var spawned = [];
    var gapTop = passage.gapTop;
    var gapBottom = passage.gapBottom;
    var gap = gapBottom - gapTop;
    var centerX = passage.x + Config.OBSTACLE.width / 2;
    var count = Utils.randInt(WORMS.spawnMin, WORMS.spawnMax);
    var layout = Utils.chance(0.45) ? 'arc' : 'column';
    var i, t, y;

    for (i = 0; i < count; i++) {
      var f = count === 1 ? 0.5 : i / (count - 1);
      y = gapTop + gap * (0.24 + f * 0.52);
      t = pickWormType({ healthyOnly: true });
      spawned.push(this.spawn(t, centerX + (layout === 'arc' ? Math.sin(f * Math.PI) * 46 - 20 : 0), y));
    }

    // an occasional treat right at the edge of the passage
    if (Utils.chance(0.16 * (difficulty ? difficulty.wormChance : 1))) {
      t = pickWormType({ healthyOnly: true });
      spawned.push(this.spawn(t, centerX + 62, Utils.chance(0.5) ? gapTop + gap * 0.16 : gapBottom - gap * 0.16));
    }

    // red trap: off the natural glide path most of the time
    var redChance = 0.34 + Math.min(0.22, (difficulty ? difficulty.level : 1) * 0.03);
    if (Utils.chance(redChance)) {
      var nearTop = Utils.chance(0.5);
      var redY = nearTop ? gapTop + gap * (Utils.chance(0.5) ? 0.10 : 0.34) : gapBottom - gap * (Utils.chance(0.5) ? 0.10 : 0.34);
      spawned.push(this.spawn(typeById('red'), centerX + Utils.randRange(-10, 30), redY));
    }

    return spawned;
  };

  WormManager.prototype.update = function (dt, speed) {
    for (var i = this.items.length - 1; i >= 0; i--) {
      var w = this.items[i];
      w.update(dt, speed);
      if (w.x < -80 || w.y < -120 || w.collected) { this.items.splice(i, 1); }
    }
  };

  /** Collects every worm touched this frame (supports simultaneous pickups). */
  WormManager.prototype.collect = function (bird) {
    var collected = [];
    for (var i = this.items.length - 1; i >= 0; i--) {
      var w = this.items[i];
      if (w.collected) { continue; }
      if (w.intersects(bird)) {
        w.collected = true;
        collected.push(w);
        this.items.splice(i, 1);
      }
    }
    return collected;
  };

  WormManager.prototype.draw = function (ctx, time) {
    for (var i = 0; i < this.items.length; i++) {
      this.items[i].draw(ctx, time);
    }
  };

  return {
    Worm: Worm,
    WormManager: WormManager,
    pickWormType: pickWormType,
    typeById: typeById
  };
});
