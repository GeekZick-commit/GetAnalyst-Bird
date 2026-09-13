#!/usr/bin/env node
/* ==========================================================================
   tests/firefox-perf.js — frame-time benchmark inside real Firefox.
   Chromium and Firefox have completely different canvas backends, so the
   Chromium numbers say little about Firefox. This drives headless Firefox
   through geckodriver (WebDriver) and reports live frame pacing plus a
   forced-rasterisation breakdown per render stage.

   Usage: node tests/firefox-perf.js
   Env: GECKODRIVER, FIREFOX_BIN, FRAME_BUDGET_MS, WDRIVER_PORT
   ========================================================================== */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const GECKODRIVER = process.env.GECKODRIVER || 'geckodriver';
const FIREFOX_BIN = process.env.FIREFOX_BIN || null;
const WD_PORT = Number(process.env.WDRIVER_PORT || 4446);
const BUDGET_MS = Number(process.env.FRAME_BUDGET_MS || 14);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const target = path.join(ROOT, path.normalize(decodeURIComponent((req.url || '/').split('?')[0])).replace(/^(\.\.[/\\])+/, ''));
      fs.readFile(target, (err, data) => {
        if (err) { res.writeHead(404).end('not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(target)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function request(method, url, body) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = http.request(url, {
      method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = raw ? JSON.parse(raw) : null; } catch (e) { parsed = raw; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (data) { req.write(data); }
    req.end();
  });
}

async function waitForGecko(timeoutMs) {
  const started = Date.now();
  for (;;) {
    try {
      const res = await request('GET', `http://127.0.0.1:${WD_PORT}/status`);
      if (res.status === 200) { return; }
    } catch (e) { /* not up yet */ }
    if (Date.now() - started > timeoutMs) { throw new Error('geckodriver did not start'); }
    await sleep(200);
  }
}

const BENCH = `
var g = window.__GA_GAME__;
g.storage.clearAll();
var nk = document.getElementById('nickname');
nk.value = 'Fox'; nk.dispatchEvent(new Event('input', { bubbles: true }));
document.getElementById('btn-play').click();
if (g.ready) { g.beginRun(); }
g.applySoundSettings({ music: false, sfx: false }, true); // measurement: no audio work
var FIXED = ${JSON.stringify(process.env.FIXED_SCALE || '')};
if (FIXED) { g.adaptiveQuality = false; g.renderScale = parseFloat(FIXED); g.resize(); }
g.score.score = 2600;
g.diff = g.snapDifficulty(2600);
for (var i = 0; i < 6; i++) {
  var prev = g.obstacles.pairs[g.obstacles.pairs.length - 1] || null;
  var p = g.obstacles.createPair(300 + i * 380, g.diff, prev);
  g.obstacles.pairs.push(p);
  g.worms.populatePassage(p, g.diff);
}
var done = arguments[arguments.length - 1];

// ---- phase A: live frame pacing ----
var samples = [];
var last = performance.now();
var timer = setInterval(function () {
  var now = performance.now();
  samples.push(now - last);
  last = now;
  if (samples.length < 90) { return; }
  clearInterval(timer);
  var sorted = samples.slice().sort(function (a, b) { return a - b; });
  var live = {
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    max: sorted[sorted.length - 1],
    fps: 1000 / (sorted.reduce(function (a, b) { return a + b; }, 0) / sorted.length),
    slow: samples.filter(function (d) { return d > 33; }).length
  };

  // ---- phase B: forced rasterisation, per stage ----
  g.stop();
  var ctx = g.ctx;
  var N = 60;
  var flush = function () { ctx.getImageData(0, 0, 1, 1); };
  function bench(fn) {
    for (var w = 0; w < 6; w++) { fn(); flush(); }
    var t0 = performance.now();
    for (var i = 0; i < N; i++) { fn(); flush(); }
    return (performance.now() - t0) / N;
  }
  var setT = function () { ctx.setTransform(g.scale, 0, 0, g.scale, 0, 0); };
  var results = {};
  results.full = bench(function () { g.time += 1/60; g.update(1/60); g.render(); });
  results.background = bench(function () { setT(); g.background.draw(ctx); });
  results.obstacles = bench(function () { setT(); g.obstacles.draw(ctx); });
  results.worms = bench(function () { setT(); g.worms.draw(ctx, g.time); });
  results.particles = bench(function () { setT(); g.particles.draw(ctx); });
  results.bird = bench(function () { setT(); g.bird.draw(ctx, g.time); });

  done({
    live: live,
    stages: results,
    canvas: [ctx.canvas.width, ctx.canvas.height],
    scale: g.scale,
    dpr: window.devicePixelRatio,
    cssStage: (function () { var r = document.getElementById('stage').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })(),
    particles: g.particles.count(),
    worms: g.worms.count(),
    obstacles: g.obstacles.count(),
    ua: navigator.userAgent
  });
}, 16);
`;

const SOAK = `
var g = window.__GA_GAME__;
var done = arguments[arguments.length - 1];
var totalSec = SECONDS;
var mode = 'MODE';
g.storage.clearAll();
if (mode === 'idle') {
  // control run: no game loop at all, only this sampler runs
  g.stop();
} else if (mode === 'menu') {
  // game loop running, but only the menu screen is drawn
} else {
  var nk = document.getElementById('nickname');
  nk.value = 'Soak'; nk.dispatchEvent(new Event('input', { bubbles: true }));
  document.getElementById('btn-play').click();
  if (g.ready) { g.beginRun(); }
}

// keep the bird alive so the run keeps getting busier
var autopilot = setInterval(function () {
  if (mode !== 'play' || g.state !== 'PLAYING' || g.ready) { return; }
  var target = null;
  for (var i = 0; i < g.obstacles.pairs.length; i++) {
    var p = g.obstacles.pairs[i];
    if (p.x + p.width > g.bird.x - 20 && (!target || p.x < target.x)) { target = p; }
  }
  if (target && g.bird.y > target.getGapCenter() - 8 && g.bird.vy > -80) { g.onFlap(); }
}, 50);

var samples = [], scaleChanges = [];
var frames = 0, longFrames = 0, maxFrame = 0;
var lastSecond = performance.now(), lastFrame = performance.now(), t0 = lastFrame;
var lastScale = g.renderScale, lastBaked = false;

function loop(ts) {
  frames++;
  var dt = ts - lastFrame;
  lastFrame = ts;
  if (dt > maxFrame) { maxFrame = dt; }
  if (dt > 33) { longFrames++; }
  if (ts - lastSecond >= 1000) {
    var t = Math.round((ts - t0) / 1000);
    samples.push({
      t: t, fps: frames, long: longFrames, maxMs: Math.round(maxFrame),
      scale: Math.round(g.renderScale * 100) / 100,
      fx: g.particles.count(), worms: g.worms.count(), walls: g.obstacles.count(),
      score: g.score.score, lives: g.lives, baked: g.audio._loopsBaked
    });
    if (g.renderScale !== lastScale) {
      scaleChanges.push({ t: t, from: Math.round(lastScale * 100) / 100, to: Math.round(g.renderScale * 100) / 100 });
      lastScale = g.renderScale;
    }
    if (g.audio._loopsBaked !== lastBaked) {
      scaleChanges.push({ t: t, note: 'music loops ready: ' + g.audio._loopsBaked });
      lastBaked = g.audio._loopsBaked;
    }
    frames = 0; longFrames = 0; maxFrame = 0; lastSecond = ts;
  }
  if (ts - t0 < totalSec * 1000) { requestAnimationFrame(loop); }
  else { clearInterval(autopilot); done({ samples: samples, events: scaleChanges }); }
}
requestAnimationFrame(loop);
`;

async function soak(url, seconds) {
  const serverless = null;
  void serverless;
  return seconds;
}

async function main() {
  const server = await startServer();
  const url = `http://127.0.0.1:${server.address().port}/index.html`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'feather-ff-'));
  const args = ['--port', String(WD_PORT), '--allow-hosts', '127.0.0.1'];
  if (FIREFOX_BIN) { args.push('--binary', FIREFOX_BIN); }
  const gecko = spawn(GECKODRIVER, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let geckoStderr = '';
  gecko.stderr.on('data', (d) => { geckoStderr += d.toString(); });

  let sessionId = null;
  try {
    await waitForGecko(15000);
    const caps = {
      capabilities: {
        alwaysMatch: {
          browserName: 'firefox',
          'moz:firefoxOptions': {
            args: ['-headless', '-width', '1440', '-height', '900'],
            prefs: {
              'dom.webgpu.enabled': false,
              'gfx.webrender.software': true,
              'media.autoplay.default': 0,
              'media.autoplay.blocking_policy': 0
            }
          }
        }
      }
    };
    const created = await request('POST', `http://127.0.0.1:${WD_PORT}/session`, caps);
    if (created.status !== 200 || !created.body || !created.body.value) {
      throw new Error('session failed: ' + JSON.stringify(created.body).slice(0, 300));
    }
    sessionId = created.body.value.sessionId;

    await request('POST', `http://127.0.0.1:${WD_PORT}/session/${sessionId}/url`, { url });
    await sleep(2500);

    const soakSeconds = Number(process.env.SOAK_SECONDS || 0);
    if (soakSeconds > 0) {
      await request('POST', `http://127.0.0.1:${WD_PORT}/session/${sessionId}/timeouts`, {
        script: (soakSeconds + 60) * 1000, pageLoad: 60000, implicit: 0
      });
      const run = await request('POST', `http://127.0.0.1:${WD_PORT}/session/${sessionId}/execute/async`, {
        script: SOAK.replace('SECONDS', String(soakSeconds)).replace('MODE', process.env.SOAK_MODE || 'play'), args: []
      });
      if (run.status !== 200) { throw new Error('soak failed: ' + JSON.stringify(run.body).slice(0, 400)); }
      const out = run.body.value;
      console.log('soak: ' + soakSeconds + 's in Firefox, mode=' + (process.env.SOAK_MODE || 'play'));
      console.log('  t  fps  >33ms  maxms  scale  fx  worms  walls  score');
      let slowSeconds = 0;
      out.samples.forEach(function (sm) {
        if (sm.fps < 55) { slowSeconds++; }
        console.log('  ' + String(sm.t).padStart(3) + '  ' + String(sm.fps).padStart(3) + '   ' +
          String(sm.long).padStart(3) + '   ' + String(sm.maxMs).padStart(4) + '   ' +
          sm.scale.toFixed(2) + '  ' + String(sm.fx).padStart(3) + '   ' + String(sm.worms).padStart(3) +
          '    ' + String(sm.walls).padStart(3) + '  ' + String(sm.score).padStart(5) +
          (sm.baked ? '  [music ready]' : ''));
      });
      console.log('  events: ' + JSON.stringify(out.events));
      console.log('  seconds below 55 fps: ' + slowSeconds + '/' + out.samples.length);
      return 0;
    }

    const exec = await request('POST', `http://127.0.0.1:${WD_PORT}/session/${sessionId}/execute/async`, {
      script: BENCH, args: []
    });
    if (exec.status !== 200) {
      throw new Error('execute failed: ' + JSON.stringify(exec.body).slice(0, 400));
    }
    const out = exec.body.value;

    console.log('Firefox: ' + (out.ua || '').replace(/^Mozilla\/5\.0 /, ''));
    console.log('canvas ' + out.canvas.join('x') + ' (scale ' + out.scale.toFixed(3) + ', dpr ' + out.dpr +
      '), stage ' + out.cssStage.join('x'));
    console.log('content: ' + out.particles + ' particles, ' + out.worms + ' worms, ' + out.obstacles + ' obstacles');
    console.log('live pacing: avg ' + out.live.fps.toFixed(1) + ' fps, p50 ' + out.live.p50.toFixed(1) +
      ' ms, p95 ' + out.live.p95.toFixed(1) + ' ms, max ' + out.live.max.toFixed(1) +
      ' ms, frames > 33 ms: ' + out.live.slow + '/90');
    console.log('stage costs (forced rasterisation):');
    Object.keys(out.stages).forEach(function (key) {
      console.log('   ' + key.padEnd(11) + out.stages[key].toFixed(2) + ' ms');
    });

    const ok = out.stages.full <= BUDGET_MS;
    console.log((ok ? 'FIREFOX PERF OK' : 'FIREFOX PERF FAIL') + ' — full frame ' +
      out.stages.full.toFixed(2) + ' ms, budget ' + BUDGET_MS + ' ms');
    return ok ? 0 : 1;
  } finally {
    if (sessionId) {
      await request('DELETE', `http://127.0.0.1:${WD_PORT}/session/${sessionId}`).catch(() => {});
    }
    gecko.kill('SIGKILL');
    server.close();
    if (process.env.DEBUG_GECKO && geckoStderr) { console.error(geckoStderr.slice(-2000)); }
  }
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error('FIREFOX PERF FAILED: ' + (err && err.message ? err.message : err));
  process.exit(1);
});
