#!/usr/bin/env node
/* ==========================================================================
   tests/browser.test.js — real-browser integration test for Feather Rush.
   Serves the project over HTTP, drives the game inside headless Chromium over
   the DevTools Protocol and reports every failed check + console error.
   No npm dependencies: only Node's http/child_process and the global WebSocket.
   ========================================================================== */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.CHROME || 'chromium';
const DEBUG_PORT = Number(process.env.CDP_PORT || 9334);
const TEST_TIMEOUT_MS = Number(process.env.TEST_TIMEOUT_MS || 90000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json'
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      const target = path.join(ROOT, path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ''));
      if (!target.startsWith(ROOT)) {
        res.writeHead(403).end('forbidden');
        return;
      }
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
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (err) { reject(err); }
      });
    }).on('error', reject);
  });
}

function waitForDevTools(port, timeoutMs) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    (function poll() {
      fetchJson(`http://127.0.0.1:${port}/json/version`)
        .then((info) => resolve(info))
        .catch(() => {
          if (Date.now() - started > timeoutMs) { reject(new Error('DevTools endpoint never came up')); return; }
          setTimeout(poll, 150);
        });
    })();
  });
}

/** Minimal CDP client over the built-in WebSocket. */
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch (err) { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) { reject(new Error(msg.error.message)); } else { resolve(msg.result); }
        return;
      }
      if (msg.method) { this.listeners.forEach((fn) => fn(msg)); }
    });
  }

  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener('open', () => resolve(new Cdp(ws)));
      ws.addEventListener('error', (err) => reject(new Error('websocket error: ' + (err && err.message))));
    });
  }

  send(method, params) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('CDP timeout for ' + method));
        }
      }, 20000);
    });
  }

  on(fn) { this.listeners.push(fn); }

  evaluate(expression) {
    return this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: false })
      .then((res) => {
        if (res.exceptionDetails) {
          throw new Error('page exception: ' + (res.exceptionDetails.exception
            ? res.exceptionDetails.exception.description || res.exceptionDetails.exception.value
            : res.exceptionDetails.text));
        }
        return res.result ? res.result.value : undefined;
      });
  }

  close() { try { this.ws.close(); } catch (err) { /* ignore */ } }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  let chrome = null;
  let server = null;
  let cdp = null;
  const consoleErrors = [];

  const cleanup = () => {
    if (cdp) { cdp.close(); }
    if (chrome && !chrome.killed) { chrome.kill('SIGKILL'); }
    if (server) { server.close(); }
  };

  try {
    server = await startServer();
    const port = server.address().port;
    const url = `http://127.0.0.1:${port}/tests/browser.html`;

    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'feather-rush-profile-'));
    chrome = spawn(CHROME, [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--mute-audio',
      '--autoplay-policy=no-user-gesture-required',
      '--window-size=1400,1000',
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${DEBUG_PORT}`,
      url
    ], { stdio: ['ignore', 'ignore', 'pipe'] });

    let chromeStderr = '';
    chrome.stderr.on('data', (d) => { chromeStderr += d.toString(); });
    chrome.on('error', (err) => { chromeStderr += '\nspawn error: ' + err.message; });

    await waitForDevTools(DEBUG_PORT, 20000);

    const targets = await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
    const page = targets.find((t) => t.type === 'page' && t.url.indexOf('browser.html') >= 0) || targets.find((t) => t.type === 'page');
    if (!page) { throw new Error('no page target found'); }

    cdp = await Cdp.connect(page.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    cdp.on((msg) => {
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        consoleErrors.push('exception: ' + (d.exception ? d.exception.description : d.text));
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        consoleErrors.push('console.error: ' + msg.params.args.map((a) => a.value || a.description || a.type).join(' '));
      } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
        consoleErrors.push('log: ' + msg.params.entry.text + ' [' + (msg.params.entry.url || '') + ']');
      }
    });

    // Wait for the harness to publish its verdict.
    const started = Date.now();
    let payload = null;
    while (Date.now() - started < TEST_TIMEOUT_MS) {
      let text = '';
      try { text = await cdp.evaluate("(document.getElementById('out')||{}).textContent || ''"); } catch (err) { text = ''; }
      const match = /TESTRESULT_START\s*([\s\S]*?)\s*TESTRESULT_END/.exec(text || '');
      if (match) { payload = JSON.parse(match[1]); break; }
      await sleep(250);
    }

    if (!payload) {
      const progress = await cdp.evaluate("(document.getElementById('out')||{}).textContent || ''").catch(() => '');
      console.log('FAIL: the browser harness did not finish within ' + TEST_TIMEOUT_MS + 'ms.');
      console.log('      last harness state: ' + String(progress).slice(0, 300));
      if (consoleErrors.length) { console.log('      console errors:\n        ' + consoleErrors.slice(0, 8).join('\n        ')); }
      return 1;
    }

    payload.info.forEach((i) => console.log('  i  ' + i.name + ': ' + i.info));
    payload.failures.forEach((f) => console.log('  x  ' + f.name + (f.extra ? ' -> ' + f.extra : '')));
    if (payload.harnessError) { console.log('  !  harness error: ' + payload.harnessError.split('\n')[0]); }

    const noise = /favicon|Autoplay|AudioContext was not allowed|net::ERR_/i;
    // 404s for optional assets (favicon and friends) are not game errors
    const realErrors = consoleErrors.filter((line) => !noise.test(line));
    if (realErrors.length) {
      console.log('  !  browser console errors:');
      realErrors.slice(0, 8).forEach((line) => console.log('     ' + line.slice(0, 200)));
    }

    const ok = payload.failed === 0 && !payload.harnessError && realErrors.length === 0;
    console.log('\n' + (ok ? 'BROWSER TESTS PASSED' : 'BROWSER TESTS FAILED') +
      ' — ' + payload.passed + '/' + payload.total + ' checks passed, ' + payload.failed + ' failed');
    if (!ok && chromeStderr && /error/i.test(chromeStderr)) {
      const lines = chromeStderr.split('\n').filter((l) => /error/i.test(l) && !/GPU|gpu|Vulkan|dbus/i.test(l));
      if (lines.length) { console.log('  browser stderr:\n     ' + lines.slice(0, 5).join('\n     ')); }
    }
    return ok ? 0 : 1;
  } catch (err) {
    console.log('FAIL: ' + (err && err.message ? err.message : String(err)));
    if (consoleErrors.length) { console.log('  console errors:\n    ' + consoleErrors.slice(0, 8).join('\n    ')); }
    return 1;
  } finally {
    cleanup();
  }
}

if (!/chromium|chrome/i.test(CHROME) && !fs.existsSync(CHROME)) {
  console.log('SKIP: chromium not found (set CHROME=/path/to/chrome)');
  process.exit(2);
}

main().then((code) => process.exit(code));
