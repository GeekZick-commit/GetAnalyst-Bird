/* ==========================================================================
   bird.js — Bird entity + the cartoon character renderer.
   All three characters share one flight model and one hitbox; only the
   artwork, wing rhythm and cosmetic effects differ.
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

  var FLIGHT = Config.FLIGHT;
  var WORLD = Config.WORLD;
  var LIVES = Config.LIVES;
  var TAU = Utils.TAU;

  /* ======================= character artwork ======================= */

  function bodyPath(ctx) {
    ctx.beginPath();
    ctx.ellipse(0, 0, 22, 17.5, 0, 0, TAU);
  }

  function drawTail(ctx, def) {
    ctx.fillStyle = def.wingDark;
    ctx.beginPath();
    ctx.moveTo(-15, -7);
    ctx.quadraticCurveTo(-33, -21, -39, -6);
    ctx.quadraticCurveTo(-30, 0, -36, 11);
    ctx.quadraticCurveTo(-22, 13, -13, 6);
    ctx.closePath();
    ctx.fill();
  }

  function drawWing(ctx, def, wingAngle, far) {
    ctx.save();
    if (far) { ctx.globalAlpha *= 0.62; }
    ctx.translate(-2, far ? -1 : 0);
    ctx.rotate(far ? -wingAngle * 0.45 : wingAngle);
    ctx.fillStyle = far ? def.wingDark : def.wing;
    ctx.beginPath();
    ctx.moveTo(2, -2);
    ctx.quadraticCurveTo(-11, -20, -28, -11);
    ctx.quadraticCurveTo(-18, 3, 2, 5);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = def.wingDark;
    ctx.lineWidth = 1.6;
    ctx.stroke();

    if (def.id === 'cyber') {
      // geometric circuit pattern on the wing
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      ctx.moveTo(-4, -3); ctx.lineTo(-10, -9); ctx.lineTo(-19, -9);
      ctx.moveTo(-8, 0); ctx.lineTo(-13, -4); ctx.lineTo(-21, -4);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.fillRect(-21, -11, 3, 3);
      ctx.fillRect(-23, -6, 3, 3);
    } else if (def.id === 'scout') {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
      ctx.beginPath();
      ctx.ellipse(-12, -8, 8, 4.5, -0.5, 0, TAU);
      ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
      ctx.beginPath();
      ctx.ellipse(-12, -9, 7, 4, -0.5, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawCrest(ctx, def) {
    ctx.fillStyle = def.crest;
    if (def.id === 'scout') {
      // three spiky feathers
      ctx.beginPath();
      ctx.moveTo(10, -20);
      ctx.lineTo(4, -36);
      ctx.lineTo(15, -24);
      ctx.lineTo(13, -40);
      ctx.lineTo(21, -23);
      ctx.closePath();
      ctx.fill();
    } else if (def.id === 'professor') {
      // neat rounded tuft
      ctx.beginPath();
      ctx.ellipse(12, -25, 7.5, 9, -0.35, 0, TAU);
      ctx.ellipse(19, -24, 5.5, 7, -0.1, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.beginPath();
      ctx.ellipse(11, -28, 3, 3.6, -0.35, 0, TAU);
      ctx.fill();
    } else {
      // angular cyber fin
      ctx.beginPath();
      ctx.moveTo(10, -21);
      ctx.lineTo(6, -34);
      ctx.lineTo(16, -25);
      ctx.lineTo(18, -38);
      ctx.lineTo(24, -22);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(13, -22);
      ctx.lineTo(15, -33);
      ctx.stroke();
    }
  }

  function drawHead(ctx, def) {
    var headX = 15, headY = -10, headR = 12.5;

    ctx.fillStyle = def.body;
    ctx.beginPath();
    ctx.arc(headX, headY, headR, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.beginPath();
    ctx.arc(headX + 2, headY - 4, headR * 0.7, Math.PI * 1.05, Math.PI * 1.75);
    ctx.fill();

    // beak (upper + lower mandible)
    ctx.fillStyle = def.beak;
    ctx.beginPath();
    ctx.moveTo(25, -12);
    ctx.quadraticCurveTo(37, -10, 39, -4.5);
    ctx.quadraticCurveTo(30, -1.5, 24, -3);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(25, -5.2);
    ctx.quadraticCurveTo(31, -3.2, 38, -4.6);
    ctx.stroke();

    // eye — cyber uses a glowing visor-style eye
    var ex = headX + 3.4, ey = headY - 3;
    if (def.id === 'cyber') {
      ctx.fillStyle = '#06231F';
      ctx.beginPath();
      ctx.ellipse(ex + 1, ey, 6.4, 5.2, -0.12, 0, TAU);
      ctx.fill();
      ctx.fillStyle = def.accent;
      ctx.beginPath();
      ctx.ellipse(ex + 2.2, ey - 0.2, 2.9, 3.7, -0.12, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.beginPath();
      ctx.ellipse(ex + 1.4, ey - 1.6, 1.1, 1.4, -0.12, 0, TAU);
      ctx.fill();
    } else {
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(ex, ey, 5.6, 0, TAU);
      ctx.fill();
      ctx.fillStyle = def.eye;
      ctx.beginPath();
      ctx.arc(ex + 1.6, ey + 0.2, 2.8, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.beginPath();
      ctx.arc(ex + 2.8, ey - 1.6, 1.1, 0, TAU);
      ctx.fill();
    }

    if (def.glasses) {
      ctx.strokeStyle = '#2B2F55';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(ex, ey, 7.6, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(ex - 9.5, ey - 3.4, 5.2, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ex - 6.4, ey - 3.8);
      ctx.lineTo(ex - 5.2, ey - 3.6);
      ctx.stroke();
      // stern eyebrow
      ctx.strokeStyle = '#20244A';
      ctx.lineWidth = 2.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(ex - 5.5, ey - 9.6);
      ctx.quadraticCurveTo(ex + 1, ey - 12.4, ex + 6.4, ey - 8.4);
      ctx.stroke();
    } else if (def.id === 'scout') {
      // cheek blush
      ctx.fillStyle = 'rgba(255, 122, 138, 0.45)';
      ctx.beginPath();
      ctx.ellipse(ex + 3, ey + 6.6, 4.6, 3, 0, 0, TAU);
      ctx.fill();
    }

    drawCrest(ctx, def);
  }

  function drawLegs(ctx, def, tuck) {
    if (tuck) { return; }
    ctx.strokeStyle = def.beak;
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(2, 15); ctx.lineTo(1, 25);
    ctx.moveTo(10, 14); ctx.lineTo(10, 24);
    ctx.stroke();
  }

  /**
   * Draws a character centred on (0,0) facing right.
   * opts: { x, y, scale, rotation, wingAngle, tuckLegs, hitFlash, glow }
   */
  function drawBirdCharacter(ctx, def, opts) {
    opts = opts || {};
    var scale = opts.scale == null ? 1 : opts.scale;
    ctx.save();
    ctx.translate(opts.x || 0, opts.y || 0);
    ctx.rotate(opts.rotation || 0);
    ctx.scale(scale, scale);
    if (opts.alpha != null) { ctx.globalAlpha = opts.alpha; }

    if (def.glow) {
      var halo = ctx.createRadialGradient(4, 0, 4, 4, 0, 46);
      halo.addColorStop(0, 'rgba(22, 243, 206, 0.42)');
      halo.addColorStop(0.55, 'rgba(22, 243, 206, 0.14)');
      halo.addColorStop(1, 'rgba(22, 243, 206, 0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(4, 0, 46, 0, TAU);
      ctx.fill();
    }

    drawTail(ctx, def);
    drawWing(ctx, def, opts.wingAngle || 0, true);

    var grad = ctx.createLinearGradient(0, -20, 0, 22);
    grad.addColorStop(0, def.body);
    grad.addColorStop(1, def.bodyDark);
    ctx.fillStyle = grad;
    bodyPath(ctx);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.14)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.save();
    ctx.globalAlpha *= 0.9;
    ctx.fillStyle = def.belly;
    ctx.beginPath();
    ctx.ellipse(1, 7, 13.5, 9, -0.1, 0, TAU);
    ctx.fill();
    ctx.restore();

    drawWing(ctx, def, opts.wingAngle || 0, false);
    drawHead(ctx, def, opts);
    drawLegs(ctx, def, opts.tuckLegs !== false);

    if (opts.hitFlash && opts.hitFlash > 0) {
      ctx.globalAlpha = Math.min(0.85, opts.hitFlash * 2.4);
      ctx.fillStyle = '#FF5C7A';
      bodyPath(ctx);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(15, -10, 12.5, 0, TAU);
      ctx.fill();
    }

    ctx.restore();
  }

  function auraColor(def) {
    if (def.id === 'scout') { return 'rgba(255, 154, 61, 0.35)'; }
    if (def.id === 'professor') { return 'rgba(108, 124, 255, 0.35)'; }
    return 'rgba(22, 243, 206, 0.42)';
  }

  /** Idle preview used by the bird cards and the HUD portrait. */
  function drawBirdPreview(ctx, def, width, height, time, opts) {
    opts = opts || {};
    ctx.clearRect(0, 0, width, height);
    var scale = Math.min(width / 118, height / 96) * (opts.zoom || 1);
    var cx = width * 0.5;
    var cy = height * 0.56;
    var bob = Math.sin(time * 2.1 + (def.id === 'professor' ? 1.2 : 0)) * height * 0.035;

    ctx.save();
    var aura = ctx.createRadialGradient(cx, cy + bob, 2, cx, cy + bob, Math.max(width, height) * 0.52);
    aura.addColorStop(0, auraColor(def));
    aura.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = aura;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();

    if (def.id === 'cyber') {
      ctx.save();
      ctx.translate(cx, cy + bob);
      ctx.rotate(time * 0.6);
      ctx.strokeStyle = 'rgba(22, 243, 206, 0.35)';
      ctx.lineWidth = Math.max(1, width * 0.008);
      ctx.setLineDash([width * 0.06, width * 0.05]);
      ctx.beginPath();
      ctx.arc(0, 0, Math.min(width, height) * 0.42, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    var wingAngle = Math.sin(time * def.flapRate * 0.42) * 0.62;
    drawBirdCharacter(ctx, def, {
      x: cx,
      y: cy + bob,
      scale: scale,
      rotation: Math.sin(time * 1.4) * 0.05,
      wingAngle: wingAngle,
      tuckLegs: false
    });
  }

  /* ======================= Bird entity ======================= */

  function Bird(def) {
    this.def = def;
    this.hitboxRadius = FLIGHT.hitboxRadius;
    this.reset();
  }

  Bird.prototype.reset = function () {
    this.x = FLIGHT.birdX;
    this.y = WORLD.height * 0.42;
    this.vy = 0;
    this.rotation = 0;
    this.wingPhase = 0;
    this.alive = true;
    this.invulnerable = 0;
    this.hitFlash = 0;
    this.protectedTime = 0;
    this.flapCount = 0;
    this.justFlapped = false;
    return this;
  };

  Bird.prototype.flap = function () {
    if (!this.alive) { return false; }
    this.vy = FLIGHT.flapVelocity;
    this.wingPhase = 0;
    this.justFlapped = true;
    this.flapCount += 1;
    return true;
  };

  Bird.prototype.hit = function () {
    this.invulnerable = LIVES.invulnerableTime;
    this.hitFlash = 0.42;
    this.vy = Math.min(this.vy, 0) - LIVES.hitKnockback;
    this.rotation = -0.5;
    return this;
  };

  Bird.prototype.isInvulnerable = function () { return this.invulnerable > 0; };

  Bird.prototype.getAlpha = function (time) {
    if (this.invulnerable <= 0) { return 1; }
    var blink = Math.abs(Math.sin(time * Math.PI * LIVES.blinkHz));
    return 0.32 + 0.68 * blink;
  };

  Bird.prototype.getHitbox = function () {
    return { x: this.x, y: this.y, r: this.hitboxRadius };
  };

  /** @returns {{hitGround: boolean, hitCeiling: boolean}} */
  Bird.prototype.update = function (dt, opts) {
    opts = opts || {};
    var r = this.hitboxRadius;
    var groundY = opts.groundY == null ? WORLD.groundY : opts.groundY;

    this.justFlapped = false;
    this.vy += FLIGHT.gravity * dt;
    if (this.vy > FLIGHT.maxFallSpeed) { this.vy = FLIGHT.maxFallSpeed; }
    if (this.vy < FLIGHT.maxRiseSpeed) { this.vy = FLIGHT.maxRiseSpeed; }
    this.y += this.vy * dt;

    var hitGround = false, hitCeiling = false;
    if (this.y < r) { this.y = r; if (this.vy < 0) { this.vy = 0; } hitCeiling = true; }
    if (this.y > groundY - r) { this.y = groundY - r; if (this.vy > 0) { this.vy = 0; } hitGround = true; }

    var t = Utils.clamp(this.vy / 720, -1, 1);
    var target = t < 0 ? -t * FLIGHT.tiltUp : t * FLIGHT.tiltDown;
    this.rotation = Utils.approach(this.rotation, target, 10, dt);

    var wingSpeed = this.def.flapRate * (this.vy < 0 ? 1.35 : 0.62);
    this.wingPhase = (this.wingPhase + dt * wingSpeed) % TAU;

    if (this.invulnerable > 0) { this.invulnerable = Math.max(0, this.invulnerable - dt); }
    if (this.hitFlash > 0) { this.hitFlash = Math.max(0, this.hitFlash - dt * 1.6); }

    return { hitGround: hitGround, hitCeiling: hitCeiling };
  };

  /** Gentle hover used by the menu screens. */
  Bird.prototype.updateIdle = function (dt, centerY, time) {
    this.y = centerY + Math.sin(time * 1.9) * 12;
    this.rotation = Math.sin(time * 1.4) * 0.06;
    this.wingPhase = (this.wingPhase + dt * this.def.flapRate * 0.7) % TAU;
    this.hitFlash = 0;
    this.invulnerable = 0;
    return this;
  };

  Bird.prototype.getWingAngle = function () {
    return Math.sin(this.wingPhase) * 0.9 - 0.12;
  };

  Bird.prototype.draw = function (ctx, time) {
    drawBirdCharacter(ctx, this.def, {
      x: this.x,
      y: this.y,
      // the sprite is drawn slightly larger than the fair 17 px hitbox
      scale: 1.12,
      rotation: this.rotation,
      wingAngle: this.getWingAngle(),
      hitFlash: this.hitFlash,
      alpha: this.getAlpha(time)
    });
  };

  return {
    Bird: Bird,
    drawBirdCharacter: drawBirdCharacter,
    drawBirdPreview: drawBirdPreview
  };
});
