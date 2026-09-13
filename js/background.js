/* ==========================================================================
   background.js — ParallaxBackground: summer sky, sun, clouds, hills,
   greenery and a grassy ground strip. Deterministic and seamless.
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
  var makeRng = Utils.makeRng;

  function buildClouds(seed, count, tile) {
    var rng = makeRng(seed), out = [];
    for (var i = 0; i < count; i++) {
      out.push({
        x: rng() * tile,
        y: 60 + rng() * 210,
        scale: 0.55 + rng() * 0.85,
        alpha: 0.55 + rng() * 0.4,
        puffs: 3 + Math.floor(rng() * 3)
      });
    }
    return out;
  }

  function buildHills(seed, count, tile, baseY, spread) {
    var rng = makeRng(seed), out = [];
    for (var i = 0; i < count; i++) {
      out.push({
        x: rng() * tile,
        w: tile / count * (0.9 + rng() * 1.1),
        h: spread * (0.55 + rng() * 0.75),
        y: baseY + rng() * 26
      });
    }
    return out;
  }

  function buildTrees(seed, count, tile) {
    var rng = makeRng(seed), out = [];
    for (var i = 0; i < count; i++) {
      out.push({
        x: rng() * tile,
        scale: 0.6 + rng() * 0.8,
        kind: rng() < 0.42 ? 'bush' : 'tree',
        tone: rng()
      });
    }
    return out;
  }

  function buildTufts(seed, count, tile) {
    var rng = makeRng(seed), out = [];
    for (var i = 0; i < count; i++) {
      out.push({ x: rng() * tile, h: 10 + rng() * 16, blades: 2 + Math.floor(rng() * 3), tone: rng() });
    }
    return out;
  }

  function ParallaxBackground() {
    this.tile = { clouds: 1900, hillsFar: 2100, hillsNear: 1700, trees: 1500, tufts: 1000 };
    this.clouds = buildClouds(1337, 10, this.tile.clouds);
    this.hillsFar = buildHills(99, 7, this.tile.hillsFar, 470, 190);
    this.hillsNear = buildHills(4242, 8, this.tile.hillsNear, 545, 150);
    this.trees = buildTrees(777, 14, this.tile.trees);
    this.tufts = buildTufts(2024, 26, this.tile.tufts);
    this.offsets = { clouds: 0, hillsFar: 0, hillsNear: 0, trees: 0, tufts: 0 };
    this.time = 0;
    this.speedRatio = 1;
  }

  ParallaxBackground.prototype.reset = function () {
    this.offsets.clouds = this.offsets.hillsFar = this.offsets.hillsNear = this.offsets.trees = this.offsets.tufts = 0;
    this.time = 0;
  };

  ParallaxBackground.prototype.update = function (dt, speed) {
    this.time += dt;
    this.speedRatio = speed / 300;
    // Slight speed-up with difficulty keeps the parallax believable.
    var s = speed * (0.9 + 0.1 * Math.min(2, this.speedRatio));
    this.offsets.clouds += s * 0.08 * dt;
    this.offsets.hillsFar += s * 0.17 * dt;
    this.offsets.hillsNear += s * 0.33 * dt;
    this.offsets.trees += s * 0.62 * dt;
    this.offsets.tufts += s * 1.0 * dt;
  };

  function tileDraw(ctx, items, offset, tileWidth, drawFn) {
    var shift = offset % tileWidth;
    for (var copy = -1; copy <= 1; copy++) {
      for (var i = 0; i < items.length; i++) {
        var x = items[i].x - shift + copy * tileWidth;
        if (x < -420 || x > WORLD.width + 420) { continue; }
        drawFn(items[i], x);
      }
    }
  }

  function drawSky(ctx) {
    var g = ctx.createLinearGradient(0, 0, 0, WORLD.groundY);
    g.addColorStop(0, '#1E63C8');
    g.addColorStop(0.34, '#4FA3E3');
    g.addColorStop(0.68, '#9BD7F2');
    g.addColorStop(1, '#FFE9B0');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, WORLD.width, WORLD.groundY + 2);
  }

  function drawSun(ctx, time) {
    var x = 1030, y = 132;
    var pulse = 1 + Math.sin(time * 0.6) * 0.03;
    var halo = ctx.createRadialGradient(x, y, 10, x, y, 230 * pulse);
    halo.addColorStop(0, 'rgba(255, 244, 191, 0.95)');
    halo.addColorStop(0.35, 'rgba(255, 226, 130, 0.35)');
    halo.addColorStop(1, 'rgba(255, 226, 130, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, 230 * pulse, 0, Utils.TAU);
    ctx.fill();

    ctx.fillStyle = '#FFF6CE';
    ctx.beginPath();
    ctx.arc(x, y, 62, 0, Utils.TAU);
    ctx.fill();
  }

  function drawCloud(ctx, cloud, x) {
    var s = cloud.scale;
    ctx.save();
    ctx.globalAlpha = cloud.alpha * 0.92;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    var puffs = cloud.puffs;
    for (var i = 0; i < puffs; i++) {
      var px = x + i * 34 * s - (puffs - 1) * 17 * s;
      var py = cloud.y + Math.sin(i * 1.7) * 10 * s;
      var pr = (26 + (i % 3) * 9) * s;
      ctx.moveTo(px + pr, py);
      ctx.arc(px, py, pr, 0, Utils.TAU);
    }
    ctx.fill();
    ctx.globalAlpha = cloud.alpha * 0.5;
    ctx.fillStyle = '#DCEFFF';
    ctx.beginPath();
    ctx.ellipse(x + 34 * s, cloud.y + 22 * s, 78 * s, 17 * s, 0, 0, Utils.TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawHill(ctx, hill, x, fill, shade) {
    var g = ctx.createLinearGradient(0, hill.y - hill.h, 0, WORLD.groundY + 20);
    g.addColorStop(0, fill);
    g.addColorStop(1, shade);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - hill.w * 0.5, WORLD.groundY + 20);
    ctx.quadraticCurveTo(x, hill.y - hill.h * 2, x + hill.w * 0.5, WORLD.groundY + 20);
    ctx.closePath();
    ctx.fill();
  }

  function drawTree(ctx, item, x) {
    var s = item.scale;
    var baseY = WORLD.groundY + 6;
    var greens = ['#3E8E5A', '#4AA26A', '#357C4E'];
    var green = greens[Math.floor(item.tone * greens.length) % greens.length];
    var darkGreen = '#2C6B41';

    if (item.kind === 'bush') {
      ctx.fillStyle = darkGreen;
      ctx.beginPath();
      ctx.ellipse(x, baseY - 10 * s, 46 * s, 26 * s, 0, 0, Utils.TAU);
      ctx.fill();
      ctx.fillStyle = green;
      ctx.beginPath();
      ctx.ellipse(x - 10 * s, baseY - 22 * s, 32 * s, 22 * s, 0, 0, Utils.TAU);
      ctx.ellipse(x + 18 * s, baseY - 18 * s, 26 * s, 18 * s, 0, 0, Utils.TAU);
      ctx.fill();
      return;
    }

    ctx.fillStyle = '#6B4A2F';
    ctx.beginPath();
    ctx.moveTo(x - 9 * s, baseY);
    ctx.lineTo(x - 5 * s, baseY - 62 * s);
    ctx.lineTo(x + 5 * s, baseY - 62 * s);
    ctx.lineTo(x + 9 * s, baseY);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = darkGreen;
    ctx.beginPath();
    ctx.ellipse(x, baseY - 84 * s, 52 * s, 40 * s, 0, 0, Utils.TAU);
    ctx.fill();
    ctx.fillStyle = green;
    ctx.beginPath();
    ctx.ellipse(x - 14 * s, baseY - 92 * s, 34 * s, 28 * s, 0, 0, Utils.TAU);
    ctx.ellipse(x + 20 * s, baseY - 80 * s, 28 * s, 24 * s, 0, 0, Utils.TAU);
    ctx.fill();
  }

  function drawGround(ctx, time) {
    var y = WORLD.groundY;
    var g = ctx.createLinearGradient(0, y, 0, WORLD.height);
    g.addColorStop(0, '#7ED957');
    g.addColorStop(0.10, '#5FBF46');
    g.addColorStop(0.34, '#3E8F3A');
    g.addColorStop(1, '#2A5F2C');
    ctx.fillStyle = g;
    ctx.fillRect(0, y, WORLD.width, WORLD.height - y);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.fillRect(0, y, WORLD.width, 4);

    // soft light sweep on the grass so the ground does not look flat
    var sweep = ((time * 60) % (WORLD.width + 400)) - 200;
    var lg = ctx.createLinearGradient(sweep - 180, 0, sweep + 180, 0);
    lg.addColorStop(0, 'rgba(255,255,255,0)');
    lg.addColorStop(0.5, 'rgba(255,255,255,0.08)');
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = lg;
    ctx.fillRect(0, y, WORLD.width, WORLD.height - y);
  }

  function drawTuft(ctx, item, x) {
    var y = WORLD.groundY + 4;
    var tones = ['#8FE86A', '#6FD24C', '#A6F07F'];
    ctx.strokeStyle = tones[Math.floor(item.tone * tones.length) % tones.length];
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (var i = 0; i < item.blades; i++) {
      var dx = (i - (item.blades - 1) / 2) * 6;
      ctx.beginPath();
      ctx.moveTo(x + dx, y);
      ctx.quadraticCurveTo(x + dx + dx * 0.5, y - item.h * 0.7, x + dx * 1.8, y - item.h);
      ctx.stroke();
    }
  }

  ParallaxBackground.prototype.draw = function (ctx, opts) {
    opts = opts || {};
    var time = this.time;

    drawSky(ctx);
    drawSun(ctx, time);

    tileDraw(ctx, this.clouds, this.offsets.clouds, this.tile.clouds, function (item, x) {
      drawCloud(ctx, item, x);
    });

    tileDraw(ctx, this.hillsFar, this.offsets.hillsFar, this.tile.hillsFar, function (item, x) {
      drawHill(ctx, item, x, '#8FC7A6', '#5FA37F');
    });

    tileDraw(ctx, this.hillsNear, this.offsets.hillsNear, this.tile.hillsNear, function (item, x) {
      drawHill(ctx, item, x, '#69B87F', '#3F8D5B');
    });

    drawGround(ctx, time);

    tileDraw(ctx, this.trees, this.offsets.trees, this.tile.trees, function (item, x) {
      drawTree(ctx, item, x);
    });

    tileDraw(ctx, this.tufts, this.offsets.tufts, this.tile.tufts, function (item, x) {
      drawTuft(ctx, item, x);
    });

    if (opts.dim) {
      // Menu / pause overlays: gently darken the world so UI stays readable.
      ctx.fillStyle = 'rgba(6, 11, 12, ' + opts.dim + ')';
      ctx.fillRect(0, 0, WORLD.width, WORLD.height);
    }
  };

  return { ParallaxBackground: ParallaxBackground };
});
