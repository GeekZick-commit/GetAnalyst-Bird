/* ==========================================================================
   audio.js — AudioManager
   One AudioContext, three gain channels (master / music / sfx), procedural
   SFX and a generated loopable arcade soundtrack. Nothing is loaded from
   disk or from the network: every sound is synthesised with the Web Audio API.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  var api = factory(
    (typeof module === 'object' && module.exports) ? require('./utils.js') : (root.GA || {}),
    root
  );
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  if (root) { root.GA = root.GA || {}; Object.assign(root.GA, api); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Utils, root) {
  'use strict';

  var NOTES = {
    C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.00, A4: 440.00, B4: 493.88,
    C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.00, B5: 987.77,
    C6: 1046.50, E6: 1318.51, G6: 1567.98
  };

  // I – vi – IV – V style progression in A minor / C major, four bars.
  var PROGRESSION = [
    { bass: 110.00, chord: [220.00, 261.63, 329.63] }, // Am
    { bass: 87.31,  chord: [174.61, 220.00, 261.63] }, // F
    { bass: 130.81, chord: [196.00, 261.63, 329.63] }, // C
    { bass: 98.00,  chord: [196.00, 246.94, 293.66] }  // G
  ];

  function AudioManager(options) {
    options = options || {};
    this.onError = options.onError || function () {};
    this.settings = { music: true, sfx: true };
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.available = !!(root && (root.AudioContext || root.webkitAudioContext));
    this.unlocked = false;
    this.musicOn = false;
    this.intensity = 1;
    this._noiseBuffer = null;
    this._timer = null;
    this._step = 0;
    this._nextTime = 0;
    this._bpm = 98;
    this._lastError = null;
  }

  /* ------------------------- infrastructure ------------------------- */

  AudioManager.prototype.ensureContext = function () {
    if (this.ctx || !this.available) { return this.ctx; }
    try {
      var Ctor = root.AudioContext || root.webkitAudioContext;
      var ctx = new Ctor();
      var master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);

      var music = ctx.createGain();
      music.gain.value = this.settings.music ? 0.16 : 0;
      music.connect(master);

      var sfx = ctx.createGain();
      sfx.gain.value = this.settings.sfx ? 0.5 : 0;
      sfx.connect(master);

      this.ctx = ctx;
      this.master = master;
      this.musicGain = music;
      this.sfxGain = sfx;
      this._noiseBuffer = this._createNoise(ctx);
    } catch (err) {
      this.available = false;
      this._fail(err);
    }
    return this.ctx;
  };

  AudioManager.prototype._fail = function (err) {
    this._lastError = err;
    try { this.onError(err); } catch (e) { /* ignore */ }
  };

  AudioManager.prototype._createNoise = function (ctx) {
    var len = Math.floor(ctx.sampleRate * 1.0);
    var buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < len; i++) { data[i] = Math.random() * 2 - 1; }
    return buffer;
  };

  /** Must be called from a user gesture (autoplay policy). */
  AudioManager.prototype.unlock = function () {
    var ctx = this.ensureContext();
    if (!ctx) { return null; }
    try {
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
        var p = ctx.resume();
        if (p && typeof p.then === 'function') { p.then(function () {}, function () {}); }
      }
      this.unlocked = true;
    } catch (err) {
      this._fail(err);
    }
    return ctx;
  };

  AudioManager.prototype.setSettings = function (settings) {
    this.settings = {
      music: settings.music !== false,
      sfx: settings.sfx !== false
    };
    if (this.musicGain) { this.musicGain.gain.value = this.settings.music ? 0.16 : 0; }
    if (this.sfxGain) { this.sfxGain.gain.value = this.settings.sfx ? 0.5 : 0; }
    if (!this.settings.music) { this.stopMusic(); }
    return this.settings;
  };

  AudioManager.prototype.setIntensity = function (level) {
    this.intensity = Utils.clamp(level || 1, 1, 6);
    this._bpm = 98 + (this.intensity - 1) * 4.5; // subtle acceleration with difficulty
  };

  AudioManager.prototype.isMusicPlaying = function () { return this.musicOn; };

  /* ------------------------- low level voices ------------------------- */

  AudioManager.prototype._tone = function (o) {
    var ctx = this.ctx;
    if (!ctx) { return; }
    try {
      var t0 = o.t0 == null ? ctx.currentTime : o.t0;
      var dur = o.dur || 0.2;
      var osc = ctx.createOscillator();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(Math.max(1, o.freq), t0);
      if (o.glideTo) { osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.glideTo), t0 + dur); }

      var gain = ctx.createGain();
      var peak = Math.max(0.0002, o.gain == null ? 0.28 : o.gain);
      var attack = o.attack == null ? 0.01 : o.attack;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(peak, t0 + attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

      var node = osc;
      if (o.filter) {
        var bq = ctx.createBiquadFilter();
        bq.type = o.filter;
        bq.frequency.value = o.filterFreq || 900;
        bq.Q.value = o.q == null ? 1 : o.q;
        node.connect(bq);
        node = bq;
      }
      node.connect(gain);
      gain.connect(o.dest || this.sfxGain);
      osc.start(t0);
      osc.stop(t0 + dur + 0.03);
    } catch (err) {
      this._fail(err);
    }
  };

  AudioManager.prototype._noise = function (o) {
    var ctx = this.ctx;
    if (!ctx || !this._noiseBuffer) { return; }
    try {
      var t0 = o.t0 == null ? ctx.currentTime : o.t0;
      var dur = o.dur || 0.12;
      var src = ctx.createBufferSource();
      src.buffer = this._noiseBuffer;
      src.loop = true;

      var bq = ctx.createBiquadFilter();
      bq.type = o.filter || 'highpass';
      bq.frequency.value = o.freq || 800;
      bq.Q.value = o.q == null ? 0.7 : o.q;

      var gain = ctx.createGain();
      var peak = Math.max(0.0002, o.gain == null ? 0.18 : o.gain);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(peak, t0 + (o.attack == null ? 0.006 : o.attack));
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

      src.connect(bq);
      bq.connect(gain);
      gain.connect(o.dest || this.sfxGain);
      src.start(t0);
      src.stop(t0 + dur + 0.03);
    } catch (err) {
      this._fail(err);
    }
  };

  AudioManager.prototype._seq = function (freqs, opts) {
    opts = opts || {};
    var ctx = this.ctx;
    if (!ctx) { return; }
    var t0 = opts.t0 == null ? ctx.currentTime : opts.t0;
    var step = opts.step || 0.075;
    for (var i = 0; i < freqs.length; i++) {
      this._tone({
        freq: freqs[i],
        type: opts.type || 'triangle',
        t0: t0 + i * step,
        dur: opts.dur || 0.14,
        gain: (opts.gain == null ? 0.24 : opts.gain) * (opts.decay ? Math.pow(0.86, i) : 1),
        attack: 0.008,
        dest: opts.dest
      });
    }
  };

  /* ------------------------- SFX library ------------------------- */

  var SFX = {
    flap: function (a) {
      a._noise({ dur: 0.09, filter: 'highpass', freq: 700, gain: 0.14 });
      a._tone({ freq: 520, glideTo: 300, type: 'triangle', dur: 0.11, gain: 0.16 });
    },
    worm_green: function (a) { a._seq([NOTES.E5, NOTES.G5], { step: 0.055, dur: 0.12, gain: 0.2 }); },
    worm_blue: function (a) { a._seq([NOTES.G4, NOTES.B4, NOTES.E5], { step: 0.05, dur: 0.13, gain: 0.22, type: 'sine' }); },
    worm_purple: function (a) { a._seq([NOTES.A4, NOTES.C5, NOTES.E5, NOTES.A5], { step: 0.048, dur: 0.15, gain: 0.24, type: 'sine' }); },
    worm_gold: function (a) {
      a._seq([NOTES.C5, NOTES.E5, NOTES.G5, NOTES.C6, NOTES.E6], { step: 0.058, dur: 0.34, gain: 0.26, type: 'triangle' });
      a._noise({ dur: 0.55, filter: 'bandpass', freq: 5200, q: 1.6, gain: 0.08 });
      a._tone({ freq: NOTES.G6, type: 'sine', dur: 0.5, gain: 0.16, t0: a.ctx.currentTime + 0.22 });
    },
    worm_red: function (a) {
      a._tone({ freq: 330, glideTo: 82, type: 'sawtooth', dur: 0.36, gain: 0.2, filter: 'lowpass', filterFreq: 1200 });
    },
    collision: function (a) {
      a._noise({ dur: 0.26, filter: 'lowpass', freq: 420, gain: 0.3 });
      a._tone({ freq: 190, glideTo: 62, type: 'square', dur: 0.28, gain: 0.2, filter: 'lowpass', filterFreq: 800 });
    },
    life_lost: function (a) {
      a._tone({ freq: 420, glideTo: 150, type: 'triangle', dur: 0.32, gain: 0.24 });
      a._noise({ dur: 0.2, filter: 'lowpass', freq: 500, gain: 0.16 });
    },
    combo: function (a, level) {
      var base = [NOTES.C5, NOTES.E5, NOTES.G5, NOTES.C6, NOTES.E6];
      var count = Utils.clamp(3 + (level - 2), 3, 5);
      a._seq(base.slice(0, count), { step: 0.06, dur: 0.18, gain: 0.26, type: 'square' });
    },
    pass: function (a) {
      a._tone({ freq: NOTES.E5, type: 'sine', dur: 0.07, gain: 0.07 });
    },
    game_over: function (a) {
      a._seq([NOTES.A4, NOTES.F4, NOTES.D4, NOTES.A4 / 2], { step: 0.17, dur: 0.42, gain: 0.26, type: 'triangle' });
    },
    high_score: function (a) {
      a._seq([NOTES.C5, NOTES.E5, NOTES.G5, NOTES.C6, NOTES.G5, NOTES.C6], { step: 0.12, dur: 0.4, gain: 0.28, type: 'triangle' });
      a._noise({ dur: 0.7, filter: 'bandpass', freq: 5600, q: 1.4, gain: 0.07, t0: a.ctx.currentTime + 0.3 });
    },
    ui_click: function (a) { a._tone({ freq: 880, type: 'square', dur: 0.05, gain: 0.12 }); },
    ui_hover: function (a) { a._tone({ freq: 1180, type: 'sine', dur: 0.035, gain: 0.05 }); },
    pause: function (a) { a._seq([NOTES.E5, NOTES.C5], { step: 0.08, dur: 0.16, gain: 0.22 }); },
    resume: function (a) { a._seq([NOTES.C5, NOTES.E5], { step: 0.08, dur: 0.16, gain: 0.22 }); },
    select: function (a) { a._seq([NOTES.A4, NOTES.E5], { step: 0.055, dur: 0.14, gain: 0.2, type: 'sine' }); }
  };

  AudioManager.prototype.play = function (name, opts) {
    if (!this.available || !this.settings.sfx) { return false; }
    var ctx = this.ctx;
    if (!ctx || ctx.state === 'suspended') { return false; }
    var fn = SFX[name];
    if (!fn) { return false; }
    try {
      fn(this, opts);
      return true;
    } catch (err) {
      this._fail(err);
      return false;
    }
  };

  /* ------------------------- music ------------------------- */

  AudioManager.prototype.startMusic = function () {
    if (!this.available || !this.settings.music) { return; }
    var ctx = this.ensureContext();
    if (!ctx) { return; }
    this.musicOn = true;
    if (this._timer) { return; }
    this._step = 0;
    this._nextTime = ctx.currentTime + 0.08;
    var self = this;
    this._timer = setInterval(function () { self._tick(); }, 25);
  };

  AudioManager.prototype.stopMusic = function () {
    this.musicOn = false;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  };

  AudioManager.prototype._tick = function () {
    var ctx = this.ctx;
    if (!ctx) { return; }
    if (ctx.state === 'suspended') { return; }
    var stepDur = 60 / this._bpm / 4; // sixteenth note
    var horizon = ctx.currentTime + 0.18;
    var guard = 0;
    while (this._nextTime < horizon && guard++ < 32) {
      this._scheduleStep(this._step, this._nextTime);
      this._nextTime += stepDur;
      this._step = (this._step + 1) % 64;
    }
  };

  AudioManager.prototype._scheduleStep = function (step, t) {
    var intensity = this.intensity;
    var bar = Math.floor(step / 16) % 4;
    var prog = PROGRESSION[bar];
    var beat = step % 16;
    var gainScale = 0.85 + (intensity - 1) * 0.06;

    // Kick on 1 and 3 (plus 2.5 accents at higher difficulty)
    if (beat === 0 || beat === 8 || (intensity >= 3 && beat === 12)) {
      this._musicTone({ freq: 150, glideTo: 46, type: 'sine', t0: t, dur: 0.22, gain: 0.30 * gainScale });
    }
    // Hats on eighths, sixteenths from level 4
    if (beat % 2 === 0 || intensity >= 4) {
      this._musicNoise({ t0: t, dur: 0.05, gain: (beat % 4 === 0 ? 0.05 : 0.03) * gainScale, freq: 7200 });
    }
    // Bass line
    if (beat === 0 || beat === 6 || beat === 10) {
      this._musicTone({ freq: prog.bass * (beat === 6 ? 2 : 1), type: 'triangle', t0: t, dur: beat === 0 ? 0.5 : 0.3, gain: 0.24 * gainScale });
    }
    // Pad chord on the bar line
    if (beat === 0) {
      for (var i = 0; i < prog.chord.length; i++) {
        this._musicTone({ freq: prog.chord[i], type: 'sine', t0: t, dur: 1.7, gain: 0.075, attack: 0.35 });
      }
    }
    // Arpeggio
    var arpSteps = intensity >= 3 ? [0, 2, 4, 6, 8, 10, 12, 14] : [0, 4, 8, 12];
    var pos = arpSteps.indexOf(beat);
    if (pos >= 0) {
      var note = prog.chord[pos % prog.chord.length] * (pos % 3 === 2 ? 2 : 1);
      this._musicTone({ freq: note, type: 'square', t0: t, dur: 0.16, gain: 0.05 * gainScale, filter: 'lowpass', filterFreq: 2600 });
    }
  };

  AudioManager.prototype._musicTone = function (o) {
    o.dest = this.musicGain;
    this._tone(o);
  };

  AudioManager.prototype._musicNoise = function (o) {
    o.dest = this.musicGain;
    this._noise(o);
  };

  AudioManager.prototype.dispose = function () {
    this.stopMusic();
    try {
      if (this.ctx && typeof this.ctx.close === 'function') { this.ctx.close(); }
    } catch (err) { /* ignore */ }
    this.ctx = null;
  };

  AudioManager.NOTES = NOTES;
  AudioManager.SFX_NAMES = Object.keys(SFX);
  return { AudioManager: AudioManager };
});
