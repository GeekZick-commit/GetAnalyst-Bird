/* ==========================================================================
   particles.js — ParticleSystem: bursts, sparkles, floating score text,
   confetti and the short cyber trail. Capped pool, no runaway allocation.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  var api = factory(
    (typeof module === 'object' && module.exports) ? require('./utils.js') : (root.GA || {})
  );
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  if (root) { root.GA = root.GA || {}; Object.assign(root.GA, api); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Utils) {
  'use strict';

  var MAX_PARTICLES = 280;
  var randRange = Utils.randRange;

  function ParticleSystem(options) {
    options = options || {};
    this.max = options.max || MAX_PARTICLES;
    this.items = [];
    this.confettiOn = false;
  }

  ParticleSystem.prototype.clear = function () {
    this.items.length = 0;
    this.confettiOn = false;
  };

  ParticleSystem.prototype.count = function () { return this.items.length; };

  ParticleSystem.prototype.push = function (p) {
    if (this.items.length >= this.max) {
      // Recycle the oldest non-essential particle to stay within budget.
      this.items.shift();
    }
    p.age = 0;
    this.items.push(p);
    return p;
  };

  ParticleSystem.prototype.burst = function (x, y, color, opts) {
    opts = opts || {};
    var count = Math.max(1, Math.round(opts.count || 8));
    var speed = opts.speed || 190;
    var spread = opts.spread == null ? Utils.TAU : opts.spread;
    var base = opts.angle == null ? -Math.PI / 2 : opts.angle;
    for (var i = 0; i < count; i++) {
      var a = base + (spread === Utils.TAU ? Math.random() * Utils.TAU : randRange(-spread / 2, spread / 2));
      var v = speed * randRange(0.45, 1);
      this.push({
        kind: opts.sparkle ? 'spark' : 'dot',
        x: x, y: y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - (opts.lift || 0),
        size: (opts.size || 4) * randRange(0.7, 1.3),
        color: color,
        life: (opts.life || 0.6) * randRange(0.8, 1.25),
        gravity: opts.gravity == null ? 340 : opts.gravity,
        drag: opts.drag == null ? 1.6 : opts.drag,
        glow: !!opts.glow,
        spin: randRange(-6, 6)
      });
    }
  };

  ParticleSystem.prototype.ring = function (x, y, color, opts) {
    opts = opts || {};
    return this.push({
      kind: 'ring',
      x: x, y: y,
      vx: 0, vy: 0,
      size: opts.size || 10,
      grow: opts.grow || 150,
      color: color,
      life: opts.life || 0.42,
      gravity: 0,
      drag: 0,
      width: opts.width || 4,
      glow: !!opts.glow
    });
  };

  ParticleSystem.prototype.text = function (x, y, label, color, opts) {
    opts = opts || {};
    return this.push({
      kind: 'text',
      x: x, y: y,
      vx: 0, vy: -(opts.rise || 70),
      size: opts.size || 24,
      color: color,
      life: opts.life || 0.95,
      gravity: -20,
      drag: 0.9,
      label: label,
      glow: true
    });
  };

  ParticleSystem.prototype.trail = function (x, y, color, opts) {
    opts = opts || {};
    return this.push({
      kind: 'trail',
      x: x + randRange(-3, 3), y: y + randRange(-4, 4),
      vx: -(opts.drift || 90), vy: randRange(-14, 14),
      size: opts.size || 11,
      color: color,
      life: opts.life || 0.42,
      gravity: 0,
      drag: 0.7,
      glow: true
    });
  };

  ParticleSystem.prototype.confetti = function (count, width, height) {
    for (var i = 0; i < count; i++) {
      this.push({
        kind: 'confetti',
        x: randRange(0, width),
        y: randRange(-height * 0.35, -10),
        vx: randRange(-40, 40),
        vy: randRange(90, 210),
        size: randRange(5, 11),
        color: ['#16F3CE', '#FFD166', '#FF7A8A', '#7DF8E2', '#B98CFF', '#FFFFFF'][i % 6],
        life: randRange(2.4, 3.6),
        gravity: 55,
        drag: 0.25,
        spin: randRange(-7, 7),
        angle: randRange(0, Utils.TAU)
      });
    }
    this.confettiOn = true;
  };

  ParticleSystem.prototype.update = function (dt) {
    var items = this.items;
    for (var i = items.length - 1; i >= 0; i--) {
      var p = items[i];
      p.age += dt;
      if (p.age >= p.life) { items.splice(i, 1); continue; }
      if (p.kind === 'ring') {
        p.size += (p.grow || 120) * dt;
        continue;
      }
      p.vy += (p.gravity || 0) * dt;
      if (p.drag) {
        var k = Math.exp(-p.drag * dt);
        p.vx *= k;
        p.vy *= k;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.spin) { p.angle = (p.angle || 0) + p.spin * dt; }
    }
    if (!items.length) { this.confettiOn = false; }
  };

  ParticleSystem.prototype.draw = function (ctx) {
    var items = this.items;
    for (var i = 0; i < items.length; i++) {
      var p = items[i];
      var t = p.age / p.life;
      var alpha = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
      alpha = Math.max(0, Math.min(1, alpha));
      ctx.save();
      ctx.globalAlpha = alpha;
      if (p.glow) {
        ctx.shadowColor = p.color;
        ctx.shadowBlur = p.size * 1.6;
      }
      ctx.fillStyle = p.color;
      ctx.strokeStyle = p.color;

      if (p.kind === 'dot' || p.kind === 'trail') {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (p.kind === 'trail' ? (0.4 + 0.6 * (1 - t)) : (1 - t * 0.55)), 0, Utils.TAU);
        ctx.fill();
      } else if (p.kind === 'spark') {
        var len = p.size * 2.6 * (1 - t * 0.5);
        ctx.lineWidth = Math.max(1, p.size * 0.5);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x - len * 0.5, p.y);
        ctx.lineTo(p.x + len * 0.5, p.y);
        ctx.stroke();
      } else if (p.kind === 'ring') {
        ctx.lineWidth = Math.max(1, (p.width || 4) * (1 - t));
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Utils.TAU);
        ctx.stroke();
      } else if (p.kind === 'confetti') {
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle || 0);
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      } else if (p.kind === 'text') {
        ctx.font = '800 ' + Math.round(p.size) + 'px Montserrat, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(6, 12, 13, 0.65)';
        ctx.strokeText(p.label, p.x, p.y);
        ctx.fillText(p.label, p.x, p.y);
      }
      ctx.restore();
    }
  };

  ParticleSystem.MAX_PARTICLES = MAX_PARTICLES;
  return { ParticleSystem: ParticleSystem };
});
