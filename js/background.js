/* ==========================================================================
   background.js — ParallaxBackground: summer sky, sun, clouds, hills,
   greenery and a grassy ground strip.

   Performance model
   -----------------
   Frame time here is dominated by *fill rate*, not by vector work, so the
   scene is arranged to blend as few pixels as possible per frame:

   * every layer is baked once into an offscreen tile (buildCache);
   * sky + sun + distant hills form one opaque backdrop blitted with
     globalCompositeOperation = 'copy', which also replaces the per-frame
     clearRect (no alpha blending for ~830k pixels);
   * only three blended layers move: clouds, near hills, foreground greenery.
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

  /* ------------------------- layer data ------------------------- */

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

  /* ------------------------- painting (world coords) ------------------------- */

  function paintSky(ctx, w, h) {
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#1E63C8');
    g.addColorStop(0.34, '#4FA3E3');
    g.addColorStop(0.68, '#9BD7F2');
    g.addColorStop(1, '#FFE9B0');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  function paintSun(ctx, cx, cy) {
    var halo = ctx.createRadialGradient(cx, cy, 10, cx, cy, 230);
    halo.addColorStop(0, 'rgba(255, 244, 191, 0.95)');
    halo.addColorStop(0.35, 'rgba(255, 226, 130, 0.35)');
    halo.addColorStop(1, 'rgba(255, 226, 130, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, 230, 0, Utils.TAU);
    ctx.fill();

    ctx.fillStyle = '#FFF6CE';
    ctx.beginPath();
    ctx.arc(cx, cy, 62, 0, Utils.TAU);
    ctx.fill();
  }

  function paintCloud(ctx, cloud, x) {
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

  function paintHill(ctx, hill, x, fill, shade) {
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

  function paintTree(ctx, item, x) {
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

  function paintTuft(ctx, item, x) {
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

  function paintGround(ctx) {
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
  }

  /* ------------------------- background ------------------------- */

  // vertical slice of the world each moving layer needs to bake
  var LAYER = {
    clouds: { top: 0, height: 350 },
    hillsNear: { top: 380, height: 330 },
    foreground: { top: 470, height: 250 }
  };

  function ParallaxBackground() {
    this.tile = { clouds: 1900, hillsNear: 1700, foreground: 3000 };
    this.clouds = buildClouds(1337, 10, this.tile.clouds);
    this.hillsFar = buildHills(99, 7, 2100, 470, 190);
    this.hillsNear = buildHills(4242, 8, this.tile.hillsNear, 545, 150);
    this.trees = buildTrees(777, 14, 1500);
    this.tufts = buildTufts(2024, 26, 1000);
    this.offsets = { clouds: 0, hillsNear: 0, foreground: 0 };
    this.time = 0;
    this.speedRatio = 1;
    this.cache = null;
  }

  ParallaxBackground.prototype.reset = function () {
    this.offsets.clouds = this.offsets.hillsNear = this.offsets.foreground = 0;
    this.time = 0;
  };

  ParallaxBackground.prototype.update = function (dt, speed) {
    this.time += dt;
    this.speedRatio = speed / 300;
    var s = speed * (0.9 + 0.1 * Math.min(2, this.speedRatio));
    this.offsets.clouds += s * 0.08 * dt;
    this.offsets.hillsNear += s * 0.33 * dt;
    this.offsets.foreground += s * 0.78 * dt;
  };

  function makeCanvas(w, h) {
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(w));
    canvas.height = Math.max(1, Math.ceil(h));
    return canvas;
  }

  /**
   * Bakes one or more repeating sub-layers into a single tile.
   * layers: [{ items, paint, spacing }]
   */
  function bakeTile(tileWidth, slice, layers) {
    var canvas = makeCanvas(tileWidth, slice.height);
    var ctx = canvas.getContext('2d');
    ctx.translate(0, -slice.top);
    for (var l = 0; l < layers.length; l++) {
      var layer = layers[l];
      var copies = Math.ceil(tileWidth / layer.spacing);
      for (var copy = 0; copy <= copies; copy++) {
        for (var i = 0; i < layer.items.length; i++) {
          var x = layer.items[i].x + copy * layer.spacing;
          if (x > tileWidth + 260) { continue; }
          layer.paint(ctx, layer.items[i], x);
        }
      }
    }
    return canvas;
  }

  ParallaxBackground.prototype.buildCache = function () {
    if (this.cache || typeof document === 'undefined') { return this.cache; }

    // opaque backdrop: sky + sun + distant hills (blitted with 'copy')
    var backdrop = makeCanvas(WORLD.width, WORLD.groundY + 2);
    var bctx = backdrop.getContext('2d');
    paintSky(bctx, backdrop.width, backdrop.height);
    paintSun(bctx, 1030, 132);
    for (var i = -1; i <= 1; i++) {
      for (var h = 0; h < this.hillsFar.length; h++) {
        paintHill(bctx, this.hillsFar[h], this.hillsFar[h].x + i * 2100, '#8FC7A6', '#5FA37F');
      }
    }

    var ground = makeCanvas(WORLD.width, WORLD.height - WORLD.groundY);
    var gctx = ground.getContext('2d');
    gctx.translate(0, -WORLD.groundY);
    paintGround(gctx);

    this.cache = {
      backdrop: backdrop,
      ground: ground,
      groundTop: WORLD.groundY,
      clouds: bakeTile(this.tile.clouds, LAYER.clouds, [
        { items: this.clouds, paint: paintCloud, spacing: this.tile.clouds }
      ]),
      hillsNear: bakeTile(this.tile.hillsNear, LAYER.hillsNear, [
        {
          items: this.hillsNear,
          paint: function (c, item, x) { paintHill(c, item, x, '#69B87F', '#3F8D5B'); },
          spacing: this.tile.hillsNear
        }
      ]),
      foreground: bakeTile(this.tile.foreground, LAYER.foreground, [
        { items: this.trees, paint: paintTree, spacing: 1500 },
        { items: this.tufts, paint: paintTuft, spacing: 1000 }
      ]),
      sweep: null,
      ctxRef: null
    };
    return this.cache;
  };

  function blitTile(ctx, tile, tileWidth, offset, top) {
    var shift = offset % tileWidth;
    if (shift < 0) { shift += tileWidth; }
    var x = -shift;
    while (x < WORLD.width) {
      ctx.drawImage(tile, x, top);
      x += tileWidth;
    }
  }

  ParallaxBackground.prototype.draw = function (ctx) {
    var cache = this.cache || this.buildCache();
    if (!cache) { return; } // no DOM (unit tests)

    if (cache.ctxRef !== ctx) {
      cache.ctxRef = ctx;
      var grad = ctx.createLinearGradient(-200, 0, 200, 0);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(0.5, 'rgba(255,255,255,0.08)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      cache.sweep = grad;
    }

    // 'copy' both clears the frame and paints the backdrop without blending
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(cache.backdrop, 0, 0);
    ctx.globalCompositeOperation = 'source-over';

    blitTile(ctx, cache.clouds, this.tile.clouds, this.offsets.clouds, LAYER.clouds.top);
    blitTile(ctx, cache.hillsNear, this.tile.hillsNear, this.offsets.hillsNear, LAYER.hillsNear.top);

    ctx.drawImage(cache.ground, 0, cache.groundTop);

    blitTile(ctx, cache.foreground, this.tile.foreground, this.offsets.foreground, LAYER.foreground.top);

    // travelling light sweep on the grass
    var sweep = ((this.time * 60) % (WORLD.width + 400)) - 200;
    ctx.save();
    ctx.translate(sweep, 0);
    ctx.fillStyle = cache.sweep;
    ctx.fillRect(-200, cache.groundTop, 400, WORLD.height - cache.groundTop);
    ctx.restore();
  };

  /** Frees the baked layers. */
  ParallaxBackground.prototype.dropCache = function () {
    this.cache = null;
  };

  return { ParallaxBackground: ParallaxBackground };
});
