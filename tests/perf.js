#!/usr/bin/env node
/* ==========================================================================
   tests/perf.js — frame-time benchmark for the render/update pipeline.
   Boots the game in headless Chromium, fills the screen with obstacles,
   worms and particles, then measures pure update+render cost per frame.

   Usage: node tests/perf.js [frames]
   ========================================================================== */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.CHROME || 'chromium';
const PORT = Number(process.env.CDP_PORT || 9342);
const FRAMES = Number(process.argv[2] || 240);
const BUDGET_MS = Number(process.env.FRAME_BUDGET_MS || 12);

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

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function waitForDevTools(port, timeoutMs) {
  const started = Date.now();
  for (;;) {
    try { return await fetchJson(`http://127.0.0.1:${port}/json/version`); }
    catch (e) {
      if (Date.now() - started > timeoutMs) { throw new Error('DevTools never came up'); }
      await sleep(150);
    }
  }
}

async function main() {
  const server = await startServer();
  const url = `http://127.0.0.1:${server.address().port}/index.html`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'feather-perf-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--no-first-run', '--mute-audio', '--window-size=1440,900', '--force-device-scale-factor=1',
    `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, url
  ], { stdio: ['ignore', 'ignore', 'ignore'] });

  let ws = null;
  try {
    await waitForDevTools(PORT, 20000);
    const targets = await fetchJson(`http://127.0.0.1:${PORT}/json/list`);
    const page = targets.find((t) => t.type === 'page');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res);
      ws.addEventListener('error', rej);
    });

    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
      }
    });
    const evaluateWith = (expression, awaitPromise) => new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({
        id: mid,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: !!awaitPromise }
      }));
    }).then((r) => {
      if (r.exceptionDetails) { throw new Error(r.exceptionDetails.text); }
      return r.result.value;
    });
    const evaluate = (expression) => evaluateWith(expression, false);

    await sleep(1200);

    // Fill the world with content: long run at high difficulty with particles.
    await evaluate(`(function(){
      var g = window.__GA_GAME__;
      g.storage.clearAll();
      var nk = document.getElementById('nickname');
      nk.value = 'Perf'; nk.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('btn-play').click();
      if (g.ready) { g.beginRun(); }
      g.score.score = 2600;
      g.diff = g.snapDifficulty(2600);
      for (var i = 0; i < 6; i++) {
        var p = g.obstacles.createPair(300 + i * 380, g.diff, g.obstacles.pairs[g.obstacles.pairs.length - 1] || null);
        g.obstacles.pairs.push(p);
        g.worms.populatePassage(p, g.diff);
      }
      return true;
    })()`);

    await sleep(1500);

    // ---- phase A: real frame pacing while the game loop runs live ----
    const liveSamples = await evaluateWith(`(function(){
      var g = window.__GA_GAME__;
      var samples = [];
      var last = performance.now();
      return new Promise(function (resolve) {
        var timer = setInterval(function () {
          var now = performance.now();
          var dt = now - last;
          last = now;
          samples.push(dt);
          if (samples.length >= 80) {
            clearInterval(timer);
            var sorted = samples.slice().sort(function (a, b) { return a - b; });
            resolve({
              p50: sorted[Math.floor(sorted.length * 0.5)],
              p95: sorted[Math.floor(sorted.length * 0.95)],
              max: sorted[sorted.length - 1],
              fps: 1000 / (sorted.reduce(function (a, b) { return a + b; }, 0) / sorted.length),
              slow: samples.filter(function (d) { return d > 33; }).length,
              count: samples.length
            });
          }
        }, 16);
      });
    })()`, true);

    // ---- phase B: forced-rasterisation render benchmark ----
    const result = await evaluate(`(function(){
      var g = window.__GA_GAME__;
      g.stop();
      var ctx = g.ctx;
      var frames = ${FRAMES};
      var flush = function () { ctx.getImageData(0, 0, 1, 1); }; // force rasterisation
      var flapTarget = function () {
        var target = null;
        for (var i = 0; i < g.obstacles.pairs.length; i++) {
          var p = g.obstacles.pairs[i];
          if (p.x + p.width > g.bird.x - 20 && (!target || p.x < target.x)) { target = p; }
        }
        return target ? target.getGapCenter() : null;
      };
      for (var w = 0; w < 20; w++) { g.update(1/60); g.render(); flush(); }
      var t0 = performance.now();
      for (var i = 0; i < frames; i++) {
        var aim = flapTarget();
        if (aim != null && g.bird.y > aim - 8 && g.bird.vy > -80) { g.bird.flap(); }
        g.time += 1/60;
        g.update(1/60);
        g.render();
        flush();
        if (i % 30 === 0) { g.particles.burst(g.bird.x, g.bird.y, '#FFD166', { count: 12, speed: 220, size: 5, glow: true, sparkle: true }); }
        if (i % 45 === 0) { g.worms.populatePassage({ x: 1100, gapTop: 240, gapBottom: 500 }, g.diff); }
      }
      var total = performance.now() - t0;
      return {
        msPerFrame: total / frames,
        fps: 1000 / (total / frames),
        particles: g.particles.count(),
        worms: g.worms.count(),
        obstacles: g.obstacles.count(),
        canvas: [g.canvas.width, g.canvas.height],
        scale: g.scale
      };
    })()`);

    console.log(JSON.stringify({ live: liveSamples, render: result }, null, 1));
    const ok = result.msPerFrame <= BUDGET_MS;
    console.log((ok ? 'PERF OK' : 'PERF FAIL') + ' — render ' + result.msPerFrame.toFixed(2) + ' ms/frame (' +
      result.fps.toFixed(0) + ' fps), live p95 ' + liveSamples.p95.toFixed(1) + ' ms, live avg ' +
      liveSamples.fps.toFixed(0) + ' fps, frames > 33 ms: ' + liveSamples.slow + '/' + liveSamples.count +
      ' — ' + result.particles + ' particles, ' + result.worms + ' worms, ' + result.obstacles +
      ' obstacles; budget ' + BUDGET_MS + ' ms');
    return ok ? 0 : 1;
  } finally {
    if (ws) { try { ws.close(); } catch (e) { /* ignore */ } }
    chrome.kill('SIGKILL');
    server.close();
  }
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error('PERF FAIL: ' + err.message);
  process.exit(1);
});
