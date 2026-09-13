/* ==========================================================================
   storage.js — StorageManager
   Safe localStorage wrapper: corrupt data, disabled storage and private mode
   all degrade to an in-memory store instead of crashing the game.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  var api = factory(
    (typeof module === 'object' && module.exports) ? require('./config.js') : (root.GA || {}),
    (typeof module === 'object' && module.exports) ? require('./utils.js') : (root.GA || {})
  );
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  if (root) { root.GA = root.GA || {}; Object.assign(root.GA, api); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Config, Utils) {
  'use strict';

  var KEYS = (Config && Config.STORAGE_KEYS) || { prefix: 'ga.featherrush.v1.' };
  var LEADERBOARD = (Config && Config.LEADERBOARD) || { max: 10, keep: 50 };
  var clamp = (Utils && Utils.clamp) || function (v, a, b) { return Math.max(a, Math.min(b, v)); };

  function probeBackend() {
    try {
      var ls = (typeof localStorage !== 'undefined') ? localStorage : null;
      if (!ls) { return null; }
      var probe = KEYS.prefix + '__probe';
      ls.setItem(probe, '1');
      ls.removeItem(probe);
      return ls;
    } catch (err) {
      return null;
    }
  }

  function createMemoryBackend() {
    var map = Object.create(null);
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; },
      setItem: function (k, v) { map[k] = String(v); },
      removeItem: function (k) { delete map[k]; }
    };
  }

  function createStorage(options) {
    options = options || {};
    var backend = options.backend || probeBackend();
    var persistent = !!backend;
    if (!backend) { backend = createMemoryBackend(); }

    function key(name) { return KEYS.prefix + name; }

    function readRaw(name) {
      try { return backend.getItem(key(name)); } catch (err) { return null; }
    }

    function writeRaw(name, value) {
      try { backend.setItem(key(name), value); return true; }
      catch (err) {
        // Quota exceeded / storage disabled: keep running with the memory copy.
        persistent = false;
        return false;
      }
    }

    function readJson(name, fallback) {
      var raw = readRaw(name);
      if (raw == null || raw === '') { return fallback; }
      try {
        var parsed = JSON.parse(raw);
        return parsed == null ? fallback : parsed;
      } catch (err) {
        return fallback;
      }
    }

    function writeJson(name, value) {
      try { return writeRaw(name, JSON.stringify(value)); }
      catch (err) { return false; }
    }

    function normalizeEntry(raw) {
      if (!raw || typeof raw !== 'object') { return null; }
      var nick = Utils && Utils.sanitizeNickname ? Utils.sanitizeNickname(raw.nickname) : String(raw.nickname || '');
      var score = Number(raw.score);
      if (!nick || !isFinite(score)) { return null; }
      score = Math.max(0, Math.round(score));
      var bird = typeof raw.bird === 'string' && raw.bird ? raw.bird : 'scout';
      var date = Number(raw.date);
      if (!isFinite(date) || date <= 0) { date = Date.now(); }
      var worms = Number(raw.worms);
      return {
        nickname: nick,
        score: score,
        bird: bird,
        date: date,
        worms: isFinite(worms) ? Math.max(0, Math.round(worms)) : 0
      };
    }

    var api = {
      get persistent() { return persistent; },

      get: function (name, fallback) { return readJson(name, fallback); },
      set: function (name, value) { return writeJson(name, value); },
      remove: function (name) { try { backend.removeItem(key(name)); } catch (err) { /* ignore */ } },

      /* ---------- nickname ---------- */
      getNickname: function () {
        var nick = readRaw(KEYS.nickname);
        return nick ? (Utils.sanitizeNickname ? Utils.sanitizeNickname(nick) : String(nick)) : '';
      },
      setNickname: function (nick) {
        var clean = Utils.sanitizeNickname ? Utils.sanitizeNickname(nick) : String(nick || '');
        if (clean) { writeRaw(KEYS.nickname, clean); }
        return clean;
      },

      /* ---------- selected bird ---------- */
      getBirdId: function (validIds, fallback) {
        var stored = readRaw(KEYS.bird);
        if (stored && (!validIds || validIds.indexOf(stored) >= 0)) { return stored; }
        return fallback;
      },
      setBirdId: function (id) { return writeRaw(KEYS.bird, String(id)); },

      /* ---------- sound settings ---------- */
      getSound: function () {
        return {
          music: readRaw(KEYS.music) !== '0',
          sfx: readRaw(KEYS.sfx) !== '0'
        };
      },
      setSound: function (settings) {
        settings = settings || {};
        if (typeof settings.music === 'boolean') { writeRaw(KEYS.music, settings.music ? '1' : '0'); }
        if (typeof settings.sfx === 'boolean') { writeRaw(KEYS.sfx, settings.sfx ? '1' : '0'); }
        return api.getSound();
      },

      /* ---------- stats ---------- */
      getGamesPlayed: function () {
        var n = Number(readRaw(KEYS.games));
        return isFinite(n) && n > 0 ? Math.floor(n) : 0;
      },
      incrementGamesPlayed: function () {
        var next = api.getGamesPlayed() + 1;
        writeRaw(KEYS.games, String(next));
        return next;
      },

      /* ---------- leaderboard ---------- */
      getScores: function () {
        var raw = readJson(KEYS.scores, []);
        if (!Array.isArray(raw)) { return []; }
        var out = [];
        for (var i = 0; i < raw.length; i++) {
          var entry = normalizeEntry(raw[i]);
          if (entry) { out.push(entry); }
        }
        out.sort(function (a, b) { return b.score - a.score || a.date - b.date; });
        return out;
      },

      getBest: function () {
        var scores = api.getScores();
        return scores.length ? scores[0].score : 0;
      },

      /** Saves a result and reports the achieved rank and whether it beat the old best. */
      addScore: function (entry) {
        var clean = normalizeEntry(entry);
        if (!clean) { return { saved: false, rank: -1, isHighScore: false, best: api.getBest(), entry: null }; }

        var previousBest = api.getBest();
        var scores = api.getScores();
        scores.push(clean);
        scores.sort(function (a, b) { return b.score - a.score || a.date - b.date; });

        var rank = scores.indexOf(clean) + 1;
        var trimmed = scores.slice(0, LEADERBOARD.keep);
        writeJson(KEYS.scores, trimmed);

        return {
          saved: true,
          rank: rank,
          isHighScore: clean.score > previousBest && clean.score > 0,
          best: Math.max(previousBest, clean.score),
          entry: clean
        };
      },

      getTopScores: function (limit) {
        return api.getScores().slice(0, limit || LEADERBOARD.max);
      },

      clearScores: function () { api.remove(KEYS.scores); return api.getScores(); },

      /** Used by tests and the "reset" flow. */
      clearAll: function () {
        ['nickname', 'bird', 'scores', 'music', 'sfx', 'games'].forEach(function (name) { api.remove(name); });
      }
    };

    return api;
  }

  return { createStorage: createStorage };
});
