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
    // user-provided flap sample (js/fart-sample.js); the synth is the fallback
    this._flapSample = null;
    this._flapSampleLoading = false;
    this._flapSampleFailed = false;
    // pre-rendered music loops (see _renderMusicLoops)
    this._loops = { calm: null, full: null };
    this._loopsBaked = false;
    this._loopBuilding = false;
    this._loopFailed = false;
    this._loopNodes = null;
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
      music.gain.value = this.settings.music ? 0.20 : 0;
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
      // Decode the flap sample and render the soundtrack in the background
      // while the player is still in the menu.
      this._decodeFlapSample();
      this._renderMusicLoops();
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
    if (this.musicGain) { this.musicGain.gain.value = this.settings.music ? 0.20 : 0; }
    if (this.sfxGain) { this.sfxGain.gain.value = this.settings.sfx ? 0.5 : 0; }
    if (!this.settings.music) { this.stopMusic(); }
    return this.settings;
  };

  AudioManager.prototype.setIntensity = function (level) {
    var next = Utils.clamp(level || 1, 1, 6);
    // Called every frame: without this guard each call would queue four
    // AudioParam automation events per frame and grow the timeline forever.
    if (next === this.intensity) { return; }
    this.intensity = next;
    this._bpm = BASE_BPM + (this.intensity - 1) * 4.5; // subtle acceleration with difficulty
    this._applyLoopMix(false);
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

  /**
   * The flap: a proper, unmistakable fart.
   * Two detuned sawtooths plus a sub sine run through a lowpass that falls from
   * 1.1 kHz to under 200 Hz while a square LFO wobbles the gain (the rasp), a
   * band-passed noise layer adds the wet sputter, and the amplitude envelope has
   * a second "blat" halfway through. Pitch, length and detune are randomised.
   */
  AudioManager.prototype._fart = function () {
    var ctx = this.ctx;
    if (!ctx) { return; }
    try {
      var t0 = ctx.currentTime;
      var dur = 0.42 + Math.random() * 0.24;          // 0.42 - 0.66 s
      var base = 74 + Math.random() * 34;             // 74 - 108 Hz: low and rude
      var detune = 1.04 + Math.random() * 0.05;
      var bottom = base * (0.40 + Math.random() * 0.16);

      // amplitude envelope with a two-stage "sputter"
      var env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.exponentialRampToValueAtTime(0.62, t0 + 0.02);
      env.gain.exponentialRampToValueAtTime(0.30, t0 + dur * 0.40);
      env.gain.setValueAtTime(0.30, t0 + dur * 0.50);
      env.gain.exponentialRampToValueAtTime(0.55, t0 + dur * 0.58);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      env.connect(this.sfxGain);

      // deep flutter
      var trem = ctx.createGain();
      trem.gain.setValueAtTime(0.55, t0);
      trem.gain.setValueAtTime(0.55, t0 + dur);
      trem.connect(env);

      var lfo = ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.setValueAtTime(14 + Math.random() * 9, t0);
      lfo.frequency.linearRampToValueAtTime(30 + Math.random() * 16, t0 + dur);
      var lfoDepth = ctx.createGain();
      lfoDepth.gain.setValueAtTime(0.62, t0);
      lfoDepth.gain.exponentialRampToValueAtTime(0.20, t0 + dur);
      lfo.connect(lfoDepth);
      lfoDepth.connect(trem.gain);
      lfo.start(t0);
      lfo.stop(t0 + dur + 0.02);

      // falling lowpass = the pitch of the rasp dropping away
      var filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 8;
      filter.frequency.setValueAtTime(1100, t0);
      filter.frequency.exponentialRampToValueAtTime(190, t0 + dur);
      filter.connect(trem);

      var voices = [
        { freq: base, type: 'sawtooth', gain: 0.5 },
        { freq: base * detune, type: 'sawtooth', gain: 0.34 },
        { freq: base * 0.5, type: 'sine', gain: 0.42 }
      ];
      for (var i = 0; i < voices.length; i++) {
        var v = voices[i];
        var osc = ctx.createOscillator();
        osc.type = v.type;
        osc.frequency.setValueAtTime(v.freq, t0);
        osc.frequency.exponentialRampToValueAtTime(Math.max(24, bottom * (v.type === 'sine' ? 0.5 : 1)), t0 + dur);
        var voiceGain = ctx.createGain();
        voiceGain.gain.value = v.gain;
        osc.connect(voiceGain);
        voiceGain.connect(filter);
        osc.start(t0);
        osc.stop(t0 + dur + 0.02);
      }

      // wet sputter on top
      this._noise({
        t0: t0, dur: dur * 0.75, filter: 'bandpass', freq: 620, q: 0.9,
        gain: 0.22, attack: 0.02
      });
      this._noise({ t0: t0 + dur * 0.5, dur: dur * 0.4, filter: 'bandpass', freq: 420, q: 0.8, gain: 0.16 });
    } catch (err) {
      this._fail(err);
    }
  };

  /* ------------------------- flap sample ------------------------- */

  AudioManager.prototype._decodeFlapSample = function () {
    if (this._flapSample || this._flapSampleLoading || this._flapSampleFailed) { return; }
    var ctx = this.ctx;
    var uri = (root.GA && root.GA.FART_SAMPLE) || null;
    if (!ctx || !uri || typeof atob !== 'function' || typeof Uint8Array === 'undefined') {
      this._flapSampleFailed = true;
      return;
    }

    var self = this;
    var settled = false;
    this._flapSampleLoading = true;

    function ok(buffer) {
      if (settled) { return; }
      settled = true;
      self._flapSample = buffer;
      self._flapSampleLoading = false;
    }
    function fail() {
      if (settled) { return; }
      settled = true;
      self._flapSampleFailed = true;
      self._flapSampleLoading = false;
    }

    try {
      var base64 = uri.slice(uri.indexOf(',') + 1);
      var binary = atob(base64);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) { bytes[i] = binary.charCodeAt(i); }

      var maybePromise = null;
      try {
        maybePromise = ctx.decodeAudioData(bytes.buffer, ok, fail);
      } catch (inner) {
        // very old signature: decodeAudioData(buffer) only
        maybePromise = ctx.decodeAudioData(bytes.buffer);
      }
      if (maybePromise && typeof maybePromise.then === 'function') {
        maybePromise.then(ok, fail);
      }
    } catch (err) {
      fail();
    }
  };

  /** Plays the recorded fart; falls back to the synthesised one. */
  AudioManager.prototype._playFlap = function () {
    var ctx = this.ctx;
    var buffer = this._flapSample;
    if (!ctx || !buffer) { this._fart(); return; }
    try {
      var src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = 0.93 + Math.random() * 0.15; // keeps repeats from sounding identical
      var gain = ctx.createGain();
      gain.gain.value = 0.95;
      src.connect(gain);
      gain.connect(this.sfxGain);
      src.start();
    } catch (err) {
      this._fart();
    }
  };

  /* ------------------------- SFX library ------------------------- */

  var SFX = {
    // the flap is the recorded fart sample, with the synth as a fallback
    flap: function (a) { a._playFlap(); },
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

  /* ------------------------- music -------------------------
     The soundtrack is rendered once into looping AudioBuffers with an
     OfflineAudioContext (two intensity variants that are cross-faded), so
     playback costs exactly two AudioBufferSources and no scheduler at all.
     A live scheduler remains as a fallback when offline rendering is missing.
     --------------------------------------------------------- */

  var BASE_BPM = 98;
  var MUSIC_BARS = 4;
  var STEPS_PER_BAR = 16;

  function createNoiseBuffer(ctx) {
    var len = Math.floor(ctx.sampleRate * 1.0);
    var buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < len; i++) { data[i] = Math.random() * 2 - 1; }
    return buffer;
  }

  function voiceTone(ctx, dest, o) {
    var t0 = o.t0;
    var dur = o.dur || 0.2;
    var osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(Math.max(1, o.freq), t0);
    if (o.glideTo) { osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.glideTo), t0 + dur); }

    var gain = ctx.createGain();
    var peak = Math.max(0.0002, o.gain == null ? 0.2 : o.gain);
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
    gain.connect(dest);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  function voiceNoise(ctx, dest, noiseBuffer, o) {
    if (!noiseBuffer) { return; }
    var t0 = o.t0;
    var dur = o.dur || 0.1;
    var src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;

    var bq = ctx.createBiquadFilter();
    bq.type = o.filter || 'highpass';
    bq.frequency.value = o.freq || 800;
    bq.Q.value = o.q == null ? 0.7 : o.q;

    var gain = ctx.createGain();
    var peak = Math.max(0.0002, o.gain == null ? 0.12 : o.gain);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + (o.attack == null ? 0.006 : o.attack));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    src.connect(bq);
    bq.connect(gain);
    gain.connect(dest);
    src.start(t0);
    src.stop(t0 + dur + 0.03);
  }

  /** Schedules one sixteenth-note step of the loop. */
  function scheduleMusicStep(ctx, dest, noiseBuffer, step, t, intensity) {
    var bar = Math.floor(step / STEPS_PER_BAR) % PROGRESSION.length;
    var prog = PROGRESSION[bar];
    var beat = step % STEPS_PER_BAR;
    var gainScale = 0.85 + (intensity - 1) * 0.06;

    if (beat === 0 || beat === 8 || (intensity >= 3 && beat === 12)) {
      voiceTone(ctx, dest, { freq: 150, glideTo: 46, type: 'sine', t0: t, dur: 0.22, gain: 0.30 * gainScale });
    }
    if (beat % 2 === 0 || intensity >= 4) {
      voiceNoise(ctx, dest, noiseBuffer, {
        t0: t, dur: 0.05, gain: (beat % 4 === 0 ? 0.05 : 0.03) * gainScale, freq: 7200
      });
    }
    if (beat === 0 || beat === 6 || beat === 10) {
      voiceTone(ctx, dest, {
        freq: prog.bass * (beat === 6 ? 2 : 1), type: 'triangle', t0: t,
        dur: beat === 0 ? 0.5 : 0.3, gain: 0.24 * gainScale
      });
    }
    if (beat === 0) {
      for (var i = 0; i < prog.chord.length; i++) {
        voiceTone(ctx, dest, { freq: prog.chord[i], type: 'sine', t0: t, dur: 1.7, gain: 0.075, attack: 0.35 });
      }
    }
    var arpSteps = intensity >= 3 ? [0, 2, 4, 6, 8, 10, 12, 14] : [0, 4, 8, 12];
    var pos = arpSteps.indexOf(beat);
    if (pos >= 0) {
      var note = prog.chord[pos % prog.chord.length] * (pos % 3 === 2 ? 2 : 1);
      voiceTone(ctx, dest, {
        freq: note, type: 'square', t0: t, dur: 0.16, gain: 0.05 * gainScale,
        filter: 'lowpass', filterFreq: 2600
      });
    }
  }

  AudioManager.prototype._renderMusicLoops = function () {
    if (this._loopsBaked || this._loopBuilding) { return; }
    var OAC = root.OfflineAudioContext || root.webkitOfflineAudioContext;
    if (!OAC || !this.ctx) { return; }

    var self = this;
    // Render the loop at 22 kHz: everything in this soundtrack lives below
    // 8 kHz, and halving the sample rate halves the render time and memory.
    var sampleRate = Math.min(22050, this.ctx.sampleRate);
    var beat = 60 / BASE_BPM / 4;
    var steps = MUSIC_BARS * STEPS_PER_BAR;
    var duration = steps * beat + 0.05;
    var frames = Math.ceil(sampleRate * duration);

    this._loopBuilding = true;
    var variants = [
      { key: 'calm', intensity: 1.6 },
      { key: 'full', intensity: 5 }
    ];
    var index = 0;

    function fail(err) {
      self._loopBuilding = false;
      self._loopsBaked = false;
      self._loopFailed = true;
      if (root.console) {
        root.console.warn('[audio] offline music unavailable, falling back to the live scheduler', err && err.message);
      }
    }

    // Variants are rendered one after another so no single task blocks the
    // main thread for long (this runs in the background during the menu).
    function renderNext() {
      if (index >= variants.length) {
        self._loopsBaked = true;
        self._loopBuilding = false;
        if (self.musicOn) { self._startLoopSources(); }
        self._stopScheduler();
        return;
      }
      var variant = variants[index++];
      var off;
      try {
        off = new OAC(1, frames, sampleRate);
      } catch (err) {
        fail(err);
        return;
      }
      var dest = off.createGain();
      dest.gain.value = 1;
      dest.connect(off.destination);
      var noise = createNoiseBuffer(off);
      for (var i = 0; i < steps; i++) {
        scheduleMusicStep(off, dest, noise, i, 0.02 + i * beat, variant.intensity);
      }
      off.startRendering().then(function (buffer) {
        self._loops[variant.key] = buffer;
        if (typeof setTimeout === 'function') { setTimeout(renderNext, 0); } else { renderNext(); }
      }).catch(fail);
    }

    renderNext();
  };

  AudioManager.prototype._startLoopSources = function () {
    var ctx = this.ctx;
    if (!ctx || !this._loops.calm || !this._loops.full) { return; }
    if (this._loopNodes) { return; }
    try {
      var t0 = ctx.currentTime + 0.06;
      var calm = ctx.createBufferSource();
      calm.buffer = this._loops.calm;
      calm.loop = true;
      var full = ctx.createBufferSource();
      full.buffer = this._loops.full;
      full.loop = true;

      var calmGain = ctx.createGain();
      var fullGain = ctx.createGain();
      calmGain.gain.value = 1;
      fullGain.gain.value = 0;
      calm.connect(calmGain);
      full.connect(fullGain);
      calmGain.connect(this.musicGain);
      fullGain.connect(this.musicGain);
      calm.start(t0);
      full.start(t0);

      this._loopNodes = { calm: calm, full: full, calmGain: calmGain, fullGain: fullGain };
      this._applyLoopMix(true);
    } catch (err) {
      this._fail(err);
    }
  };

  AudioManager.prototype._applyLoopMix = function (immediate) {
    var nodes = this._loopNodes;
    if (!nodes || !this.ctx) { return; }
    var k = Utils.clamp((this.intensity - 1) / 4, 0, 1);
    var now = this.ctx.currentTime;
    var rate = 1 + (this.intensity - 1) * 0.012;
    try {
      if (immediate) {
        nodes.fullGain.gain.setValueAtTime(k, now);
        nodes.calmGain.gain.setValueAtTime(1 - k, now);
        nodes.calm.playbackRate.setValueAtTime(rate, now);
        nodes.full.playbackRate.setValueAtTime(rate, now);
      } else {
        nodes.fullGain.gain.setTargetAtTime(k, now, 0.5);
        nodes.calmGain.gain.setTargetAtTime(1 - k, now, 0.5);
        nodes.calm.playbackRate.setTargetAtTime(rate, now, 0.8);
        nodes.full.playbackRate.setTargetAtTime(rate, now, 0.8);
      }
    } catch (err) {
      this._fail(err);
    }
  };

  AudioManager.prototype._stopLoopSources = function () {
    var nodes = this._loopNodes;
    if (!nodes) { return; }
    this._loopNodes = null;
    try {
      nodes.calm.stop();
      nodes.full.stop();
      nodes.calm.disconnect();
      nodes.full.disconnect();
      nodes.calmGain.disconnect();
      nodes.fullGain.disconnect();
    } catch (err) { /* already stopped */ }
  };

  /** Low-cost fallback used only until the offline loops are ready. */
  AudioManager.prototype._startScheduler = function () {
    if (this._timer || this._loopNodes) { return; }
    var self = this;
    this._step = 0;
    this._nextTime = this.ctx.currentTime + 0.08;
    this._timer = setInterval(function () { self._tick(); }, 60);
  };

  AudioManager.prototype._stopScheduler = function () {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  };

  AudioManager.prototype.startMusic = function () {
    if (!this.available || !this.settings.music) { return; }
    var ctx = this.ensureContext();
    if (!ctx) { return; }
    this.musicOn = true;
    if (this._loopsBaked) {
      this._startLoopSources();
      return;
    }
    if (this._loopFailed || this._loopNodes) { return; }
    this._startScheduler();
    this._renderMusicLoops();
  };

  AudioManager.prototype.stopMusic = function () {
    this.musicOn = false;
    this._stopScheduler();
    this._stopLoopSources();
  };

  AudioManager.prototype._tick = function () {
    var ctx = this.ctx;
    if (!ctx || ctx.state === 'suspended') { return; }
    var stepDur = 60 / this._bpm / 4;
    var horizon = ctx.currentTime + 0.3;
    var guard = 0;
    while (this._nextTime < horizon && guard++ < 32) {
      scheduleMusicStep(ctx, this.musicGain, this._noiseBuffer, this._step, this._nextTime, this.intensity);
      this._nextTime += stepDur;
      this._step = (this._step + 1) % (MUSIC_BARS * STEPS_PER_BAR);
    }
  };

  AudioManager.prototype.dispose = function () {
    this.stopMusic();
    this._loops = { calm: null, full: null };
    this._loopsBaked = false;
    try {
      if (this.ctx && typeof this.ctx.close === 'function') { this.ctx.close(); }
    } catch (err) { /* ignore */ }
    this.ctx = null;
  };

  AudioManager.NOTES = NOTES;
  AudioManager.SFX_NAMES = Object.keys(SFX);
  return { AudioManager: AudioManager };
});
