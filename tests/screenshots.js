#!/usr/bin/env node
/* ==========================================================================
   tests/screenshots.js — renders the game in headless Chromium and saves
   screenshots so the visuals can be reviewed. Development helper, not part
   of the test suite.

   Usage: node tests/screenshots.js [outputDir]
   ========================================================================== */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'feather-rush-shots'));
const CHROME = process.env.CHROME || 'chromium';
const PORT = Number(process.env.CDP_PORT || 9336);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url) {
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
  fs.mkdirSync(OUT, { recursive: true });
  const server = await startServer();
  const url = `http://127.0.0.1:${server.address().port}/index.html`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'feather-shots-'));

  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio',
    '--autoplay-policy=no-user-gesture-required', '--window-size=1440,900',
    '--force-device-scale-factor=1',
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
    const send = (method, params) => new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
    });
    const evaluate = (expression) => send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: false })
      .then((r) => {
        if (r.exceptionDetails) { throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception || '')); }
        return r.result.value;
      });

    const shot = async (name) => {
      const box = await evaluate("(function(){var r=document.getElementById('stage').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()");
      const res = await send('Page.captureScreenshot', {
        format: 'png',
        clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1 }
      });
      const file = path.join(OUT, name);
      fs.writeFileSync(file, Buffer.from(res.data, 'base64'));
      console.log('saved ' + file);
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await sleep(1200);

    const G = 'window.__GA_GAME__';

    // 1. main menu with a nickname and the leaderboard populated
    await evaluate(`(function(){
      var g = ${G}, GA = window.GA;
      g.storage.clearAll();
      g.menuSelector.select('cyber', { silent: true });
      var nk = document.getElementById('nickname');
      nk.value = 'Zig';
      nk.dispatchEvent(new Event('input', { bubbles: true }));
      var scores = [
        { nickname: 'BirdMaster', score: 4210, bird: 'scout' },
        { nickname: 'Kate', score: 3990, bird: 'professor' },
        { nickname: 'Neo', score: 2870, bird: 'cyber' },
        { nickname: 'Zig', score: 1240, bird: 'cyber' }
      ];
      scores.forEach(function (s, i) { g.storage.addScore({ nickname: s.nickname, score: s.score, bird: s.bird, date: Date.now() - i * 86400000 }); });
      g.enterMenu();
      return true;
    })()`);
    await sleep(900);
    await shot('01-menu.png');

    // 2. character select
    await evaluate(`(function(){ ${G}.showSelect(); return true; })()`);
    await sleep(700);
    await shot('02-select.png');

    // 3. gameplay — autopilot so the frame shows a real run
    await evaluate(`(function(){
      var g = ${G};
      g.menuSelector.select('cyber', { silent: true });
      document.getElementById('btn-play').click();
      window.__autopilot = setInterval(function(){
        if (g.state !== 'PLAYING') { return; }
        var target = null;
        for (var i = 0; i < g.obstacles.pairs.length; i++) {
          var p = g.obstacles.pairs[i];
          if (p.x + p.width > g.bird.x - 20 && (!target || p.x < target.x)) { target = p; }
        }
        if (target && g.bird.y > target.getGapCenter() - 8 && g.bird.vy > -80) { g.input.onFlap(); }
      }, 40);
      return true;
    })()`);
    await sleep(4200);
    await shot('03-gameplay.png');

    // 4. pause overlay
    await evaluate(`(function(){ ${G}.togglePause(); return true; })()`);
    await sleep(600);
    await shot('04-pause.png');
    await evaluate(`(function(){ ${G}.togglePause(); return true; })()`);

    // 5. game over with a new high score + confetti
    await evaluate(`(function(){
      var g = ${G};
      clearInterval(window.__autopilot);
      g.score.score = 5320;
      g.lives = 1; g.bird.invulnerable = 0;
      var pair = g.obstacles.pairs[0];
      if (!pair) { pair = g.obstacles.createPair(g.bird.x - 40, g.diff, null); g.obstacles.pairs.push(pair); }
      pair.x = g.bird.x - 40;
      pair.gapTop = g.bird.y + 120;
      pair.gapBottom = g.bird.y + 320;
      return true;
    })()`);
    await sleep(700);
    await shot('05-gameover.png');

    // 6. mid-game close-up of the three characters (menu cards)
    await evaluate(`(function(){
      var g = ${G};
      g.enterMenu();
      g.lives = 3;
      return true;
    })()`);
    await sleep(900);
    await shot('06-menu-cards.png');
  } finally {
    if (ws) { try { ws.close(); } catch (e) { /* ignore */ } }
    chrome.kill('SIGKILL');
    server.close();
  }
  console.log('screenshots in ' + OUT);
}

main().catch((err) => { console.error('FAILED: ' + err.message); process.exit(1); });
