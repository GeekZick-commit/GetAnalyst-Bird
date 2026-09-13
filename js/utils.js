/* ==========================================================================
   utils.js — small shared helpers (no DOM, unit-testable in Node)
   ========================================================================== */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  if (root) { root.GA = root.GA || {}; Object.assign(root.GA, api); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var TAU = Math.PI * 2;

  function clamp(v, min, max) { return v < min ? min : (v > max ? max : v); }

  function lerp(a, b, t) { return a + (b - a) * t; }

  /** Frame-rate independent exponential approach. */
  function approach(current, target, rate, dt) {
    var t = 1 - Math.exp(-rate * dt);
    return current + (target - current) * t;
  }

  function randRange(min, max) { return min + Math.random() * (max - min); }

  function randInt(min, max) { return Math.floor(min + Math.random() * (max - min + 1)); }

  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

  function chance(p) { return Math.random() < p; }

  /** Weighted pick: entries = [{ weight, ... }] */
  function weightedPick(entries) {
    var total = 0, i;
    for (i = 0; i < entries.length; i++) { total += Math.max(0, entries[i].weight || 0); }
    if (total <= 0) { return entries.length ? entries[0] : null; }
    var roll = Math.random() * total;
    for (i = 0; i < entries.length; i++) {
      roll -= Math.max(0, entries[i].weight || 0);
      if (roll <= 0) { return entries[i]; }
    }
    return entries[entries.length - 1];
  }

  /** Deterministic 32-bit PRNG (mulberry32) for stable decorative layouts. */
  function makeRng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Circle (cx,cy,r) vs axis-aligned rect overlap test. */
  function circleRectOverlap(cx, cy, r, rx, ry, rw, rh) {
    var nx = clamp(cx, rx, rx + rw);
    var ny = clamp(cy, ry, ry + rh);
    var dx = cx - nx, dy = cy - ny;
    return (dx * dx + dy * dy) < (r * r);
  }

  function formatScore(n) {
    var v = Math.max(0, Math.round(n || 0));
    return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  var NICK_RE = /[^\p{L}\p{N}_-]/gu;

  /** Keep only allowed characters, collapse length to 16. */
  function sanitizeNickname(raw) {
    if (raw == null) { return ''; }
    return String(raw).replace(NICK_RE, '').slice(0, 16);
  }

  /** @returns {{ok: boolean, value: string, error: string}} */
  function validateNickname(raw) {
    var value = sanitizeNickname(raw);
    if (!value) { return { ok: false, value: '', error: 'Enter a nickname to play.' }; }
    if (value.length < 2) { return { ok: false, value: value, error: 'Nickname must be at least 2 characters.' }; }
    if (value.length > 16) { return { ok: false, value: value, error: 'Nickname must be 16 characters or fewer.' }; }
    return { ok: true, value: value, error: '' };
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** Tiny event emitter used to keep modules decoupled. */
  function createEmitter() {
    var handlers = {};
    return {
      on: function (name, fn) {
        (handlers[name] = handlers[name] || []).push(fn);
        return function () { this.off(name, fn); }.bind(this);
      },
      off: function (name, fn) {
        var list = handlers[name];
        if (!list) { return; }
        var i = list.indexOf(fn);
        if (i >= 0) { list.splice(i, 1); }
      },
      emit: function (name, payload) {
        var list = handlers[name];
        if (!list) { return; }
        for (var i = 0; i < list.length; i++) {
          try { list[i](payload); } catch (err) { /* listener errors must not break the game */ }
        }
      },
      clear: function () { handlers = {}; }
    };
  }

  function formatDate(ts) {
    var d = new Date(ts || Date.now());
    if (isNaN(d.getTime())) { return '—'; }
    var dd = String(d.getDate()).padStart(2, '0');
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    return dd + '.' + mm + '.' + d.getFullYear();
  }

  return {
    TAU: TAU,
    clamp: clamp,
    lerp: lerp,
    approach: approach,
    randRange: randRange,
    randInt: randInt,
    pick: pick,
    chance: chance,
    weightedPick: weightedPick,
    makeRng: makeRng,
    circleRectOverlap: circleRectOverlap,
    formatScore: formatScore,
    sanitizeNickname: sanitizeNickname,
    validateNickname: validateNickname,
    escapeHtml: escapeHtml,
    createEmitter: createEmitter,
    formatDate: formatDate
  };
});
