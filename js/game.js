/* ==========================================================================
   game.js — Game
   Owns the state machine (MENU / CHARACTER_SELECT / PLAYING / PAUSED /
   GAME_OVER), the fixed-step-independent game loop (delta time), collisions,
   scoring, sound wiring and the render pipeline.
   ========================================================================== */
(function (root) {
  'use strict';

  var GA = root.GA = root.GA || {};

  var Config = GA;
  var Utils = GA;

  var WORLD = Config.WORLD;
  var FLIGHT = Config.FLIGHT;
  var OBSTACLE = Config.OBSTACLE;
  var LIVES = Config.LIVES;
  var DIFFICULTY = Config.DIFFICULTY;
  var BIRDS = Config.BIRDS;

  var STATES = { MENU: 'MENU', CHARACTER_SELECT: 'CHARACTER_SELECT', PLAYING: 'PLAYING', PAUSED: 'PAUSED', GAME_OVER: 'GAME_OVER' };
  var MAX_DT = 1 / 20; // never simulate more than 50 ms in one step

  function Game(options) {
    options = options || {};
    this.doc = options.document || document;
    this.win = options.window || window;
    this.states = STATES;

    this.canvas = this.doc.getElementById('game-canvas');
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    if (!this.ctx) { throw new Error('Canvas 2D context is not available.'); }

    this.storage = options.storage || GA.createStorage();
    this.audio = options.audio || new GA.AudioManager({
      onError: function (err) { if (root.console) { root.console.warn('[audio]', err && err.message); } }
    });

    this.ui = new GA.UIManager({
      document: this.doc,
      storage: this.storage,
      audio: this.audio,
      birds: BIRDS,
      handlers: this.uiHandlers()
    });

    this.background = new GA.ParallaxBackground();
    this.particles = new GA.ParticleSystem();
    this.worms = new GA.WormManager();
    this.obstacles = new GA.ObstacleManager();

    this.score = new GA.ScoreManager({ best: this.storage.getBest() });
    this.best = this.storage.getBest();

    var storedBird = this.storage.getBirdId(BIRDS.map(function (b) { return b.id; }), BIRDS[0].id);
    this.birdDef = this.findBird(storedBird);
    this.bird = new GA.Bird(this.birdDef);

    this.selectors = [];
    this.menuSelector = new GA.BirdSelector({
      mount: this.doc.getElementById('bird-cards-menu'),
      storage: this.storage,
      audio: this.audio,
      selectedId: this.birdDef.id,
      onSelect: this.onBirdSelected.bind(this)
    });
    this.selectSelector = new GA.BirdSelector({
      mount: this.doc.getElementById('bird-cards-select'),
      storage: this.storage,
      audio: this.audio,
      selectedId: this.birdDef.id,
      wide: true,
      onSelect: this.onBirdSelected.bind(this)
    });
    this.selectors = [this.menuSelector, this.selectSelector];

    this.input = new GA.InputManager({
      document: this.doc,
      window: this.win,
      stage: this.doc.getElementById('stage'),
      onFlap: this.onFlap.bind(this),
      onPause: this.onPauseToggle.bind(this),
      onToggleSound: this.onToggleMute.bind(this),
      onAnyGesture: this.onGesture.bind(this),
      onBlur: this.onWindowBlur.bind(this),
      shouldIgnore: this.shouldIgnoreInput.bind(this)
    });

    this.state = STATES.MENU;
    this.time = 0;
    this.lastTs = 0;
    this.rafId = null;
    this.running = false;
    this.errorCount = 0;
    this.lives = LIVES.start;
    this.diff = this.snapDifficulty(0);
    this.hud = { score: -1, best: -1, multiplier: -1, lives: -1, nickname: '', birdName: '' };
    this.confettiTimer = 0;
    this.trailTimer = 0;
    this.HUD_PORTRAIT_EVERY = 0.1;
    this.portraitTimer = 0;
    this.fps = 0;
    this._lastFrameForFps = 0;

    this.installGlobalErrorHandlers();
    this.resize();
    var self = this;
    this.win.addEventListener('resize', function () { self.resize(); }, false);

    this.applySoundSettings(this.storage.getSound(), true);
    var savedNick = this.storage.getNickname();
    if (savedNick) { this.ui.setNickname(savedNick); }
    this.ui.refreshPlayButton();
    this.refreshLeaderboard();
    this.enterMenu();

    this.start();
  }

  /* ======================= helpers ======================= */

  Game.prototype.findBird = function (id) {
    for (var i = 0; i < BIRDS.length; i++) {
      if (BIRDS[i].id === id) { return BIRDS[i]; }
    }
    return BIRDS[0];
  };

  Game.prototype.snapDifficulty = function (score) {
    // Difficulty targets are interpolated towards the next stage: no jumps.
    var info = GA.difficultyForScore(score);
    var stage = info.stage;
    var next = info.next;
    function blend(key) {
      if (!next) { return stage[key]; }
      var t = info.progress;
      // only start blending in the last 40% of the stage
      var w = t < 0.6 ? 0 : (t - 0.6) / 0.4;
      return stage[key] + (next[key] - stage[key]) * w;
    }
    return {
      level: stage.level,
      speed: blend('speed'),
      gap: blend('gap'),
      interval: blend('interval'),
      centerDrift: blend('centerDrift'),
      wormChance: blend('wormChance')
    };
  };

  Game.prototype.uiHandlers = function () {
    var self = this;
    return {
      onPlay: function () { self.startRun(); },
      onPlayAgain: function () { self.startRun(); },
      onChangeBird: function () { self.showSelect(); },
      onMainMenu: function () { self.enterMenu(); },
      onResume: function () { self.togglePause(); },
      onRestart: function () { self.startRun(); },
      onPauseToggle: function () { self.togglePause(); },
      onToggleMute: function () { self.onToggleMute(); },
      onToggleMusic: function () { self.toggleChannel('music'); },
      onToggleSfx: function () { self.toggleChannel('sfx'); },
      onClearScores: function () {
        self.storage.clearScores();
        self.best = 0;
        self.score.best = 0;
        self.refreshLeaderboard();
        self.ui.toast('Leaderboard cleared');
        self.audio.play('ui_click');
      }
    };
  };

  Game.prototype.recordError = function (errOrMessage) {
    root.__GA_ERRORS__ = root.__GA_ERRORS__ || [];
    var message = errOrMessage && errOrMessage.message ? errOrMessage.message : String(errOrMessage);
    root.__GA_ERRORS__.push(message);
    return message;
  };

  Game.prototype.installGlobalErrorHandlers = function () {
    var self = this;
    this.win.addEventListener('error', function (event) {
      var err = event && event.error;
      if (root.console) { root.console.error('[feather-rush]', err || event.message); }
      self.recordError(err || event.message);
      self.errorCount += 1;
      if (self.errorCount <= 3 && self.ui) { self.ui.showFatal(err || event.message); }
    });
    this.win.addEventListener('unhandledrejection', function (event) {
      if (root.console) { root.console.error('[feather-rush] unhandled rejection', event.reason); }
      self.recordError(event.reason);
      self.errorCount += 1;
    });
  };

  /* ======================= lifecycle ======================= */

  Game.prototype.start = function () {
    if (this.running) { return; }
    this.running = true;
    var self = this;
    this.lastTs = 0;
    this.rafId = this.win.requestAnimationFrame(function (ts) { self.frame(ts); });
  };

  Game.prototype.stop = function () {
    this.running = false;
    if (this.rafId != null) { this.win.cancelAnimationFrame(this.rafId); }
    this.rafId = null;
  };

  Game.prototype.destroy = function () {
    this.stop();
    this.input.detach();
    this.audio.dispose();
    for (var i = 0; i < this.selectors.length; i++) { this.selectors[i].destroy(); }
  };

  Game.prototype.frame = function (ts) {
    if (!this.running) { return; }
    var self = this;
    var dt = this.lastTs ? (ts - this.lastTs) / 1000 : 0;
    this.lastTs = ts;
    if (!isFinite(dt) || dt < 0) { dt = 0; }
    if (dt > MAX_DT) { dt = MAX_DT; }
    this.time += dt;
    if (dt > 0) { this.fps = 1 / dt; }

    try {
      this.update(dt);
      this.render();
      if (this.errorCount > 0 && this.errorCount <= 3) { this.errorCount = 0; }
    } catch (err) {
      this.errorCount += 1;
      if (root.console) { root.console.error('[feather-rush] frame error', err); }
      if (this.errorCount >= 5) {
        this.running = false;
        this.ui.showFatal(err);
        return;
      }
    }

    this.rafId = this.win.requestAnimationFrame(function (next) { self.frame(next); });
  };

  Game.prototype.resize = function () {
    var canvas = this.canvas;
    var stage = this.doc.getElementById('stage');
    var rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
    var cssW = rect && rect.width ? rect.width : WORLD.width;
    var cssH = rect && rect.height ? rect.height : WORLD.height;
    var dpr = Utils.clamp(this.win.devicePixelRatio || 1, 1, 2);

    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    this.scale = canvas.width / WORLD.width;

    if (stage && stage.style && cssW > 0) {
      stage.style.setProperty('--u', (cssW / 1000) + 'px');
    }
    for (var i = 0; i < this.selectors.length; i++) { this.selectors[i].measure(); }
    this.ui.updateRotateHint();
  };

  /* ======================= state transitions ======================= */

  Game.prototype.enterMenu = function () {
    this.state = STATES.MENU;
    this.score.reset();
    this.obstacles.reset();
    this.worms.reset();
    this.particles.clear();
    this.lives = LIVES.start;
    this.bird.reset();
    this.diff = this.snapDifficulty(0);
    this.background.reset();
    this.ui.setHudActive(false);
    this.ui.showScreen('menu');
    this.ui.setLives(LIVES.start);
    this.ui.setSelectSubtitle(this.storage.getNickname() || this.ui.getNickname());
    this.refreshLeaderboard();
    this.startSelectors();
    this.audio.setIntensity(1);
  };

  Game.prototype.showSelect = function () {
    this.state = STATES.CHARACTER_SELECT;
    var nick = this.ui.getNickname() || this.storage.getNickname();
    this.ui.setSelectSubtitle(nick || '—');
    this.ui.showScreen('select');
    this.ui.setHudActive(false);
    this.startSelectors();
    this.audio.play('ui_click');
  };

  Game.prototype.startSelectors = function () {
    for (var i = 0; i < this.selectors.length; i++) { this.selectors[i].start(); this.selectors[i].measure(); }
  };

  Game.prototype.stopSelectors = function () {
    for (var i = 0; i < this.selectors.length; i++) { this.selectors[i].stop(); }
  };

  Game.prototype.startRun = function () {
    var check = Utils.validateNickname(this.ui.getNickname());
    if (!check.ok) {
      this.ui.setNicknameError(check.error);
      this.ui.showScreen('menu');
      this.state = STATES.MENU;
      this.startSelectors();
      this.ui.toast(check.error);
      return false;
    }

    this.storage.setNickname(check.value);
    this.ui.setNickname(check.value);
    this.birdDef = this.findBird(this.menuSelector.getSelected());
    this.storage.setBirdId(this.birdDef.id);
    this.bird = new GA.Bird(this.birdDef);

    this.score.reset();
    this.score.best = this.best;
    this.obstacles.reset();
    this.worms.reset();
    this.particles.clear();
    this.background.reset();
    this.lives = LIVES.start;
    this.diff = this.snapDifficulty(0);
    this.trailTimer = 0;
    this.confettiTimer = 0;
    this.portraitTimer = 0;
    this.hud = { score: -1, best: -1, multiplier: -1, lives: -1, nickname: '', birdName: '' };

    this.stopSelectors();
    this.state = STATES.PLAYING;
    this.ui.showScreen(null);
    this.ui.setNicknameError(null);
    this.ui.setHudActive(true);
    this.ui.setLives(LIVES.start);
    this.ui.updateHud({
      score: 0,
      best: this.best,
      multiplier: 1,
      birdName: this.birdDef.name,
      nickname: check.value
    });

    // First passage a full screen away: the player always gets time to react.
    var pair = this.obstacles.createPair(WORLD.width + 120, this.diff, null);
    this.obstacles.pairs.push(pair);
    this.worms.populatePassage(pair, this.diff);

    this.audio.unlock();
    this.audio.setIntensity(this.diff.level);
    this.audio.startMusic();
    this.ui.toast('Flap to fly — good luck, ' + check.value + '!');
    return true;
  };

  Game.prototype.togglePause = function () {
    if (this.state === STATES.PLAYING) {
      this.state = STATES.PAUSED;
      this.audio.stopMusic();
      this.audio.play('pause');
      this.ui.setPauseStats(this.score.snapshot());
      this.ui.showScreen('pause');
      return true;
    }
    if (this.state === STATES.PAUSED) {
      this.state = STATES.PLAYING;
      this.ui.showScreen(null);
      this.audio.play('resume');
      if (this.audio.settings.music) { this.audio.startMusic(); }
      this.ui.toast('Resumed');
      return true;
    }
    return false;
  };

  Game.prototype.pauseIfPlaying = function () {
    if (this.state === STATES.PLAYING) { this.togglePause(); }
  };

  Game.prototype.gameOver = function () {
    if (this.state === STATES.GAME_OVER) { return; }
    this.state = STATES.GAME_OVER;
    this.bird.alive = false;
    this.audio.stopMusic();
    this.audio.play('game_over');
    this.stopSelectors();

    var result = this.storage.addScore({
      nickname: this.ui.getNickname() || this.storage.getNickname() || 'Player',
      score: this.score.score,
      bird: this.birdDef.id,
      worms: this.score.totalWorms,
      date: Date.now()
    });
    this.storage.incrementGamesPlayed();
    var isHigh = result.saved && result.isHighScore;
    if (result.saved) { this.best = Math.max(this.best, this.score.score); }
    this.score.best = this.best;

    this.ui.setHudActive(false);
    this.ui.fillGameOver({
      title: 'GAME OVER',
      nickname: this.ui.getNickname() || this.storage.getNickname() || 'Player',
      birdId: this.birdDef.id,
      score: this.score.score,
      best: this.best,
      worms: this.score.totalWorms,
      distance: this.score.getDistanceMeters(),
      isHighScore: isHigh
    });
    this.refreshLeaderboard(result.entry);
    this.ui.showScreen('gameover');

    this.particles.burst(this.bird.x, this.bird.y, '#FF5C7A', { count: 20, speed: 250, size: 5, life: 0.7 });
    if (isHigh) {
      this.particles.confetti(90, WORLD.width, WORLD.height);
      this.confettiTimer = 0.9;
      var self = this;
      this.win.setTimeout(function () { self.audio.play('high_score'); }, 260);
    }
    return result;
  };

  Game.prototype.refreshLeaderboard = function (highlightEntry) {
    var entries = this.storage.getTopScores(Config.LEADERBOARD.max);
    this.ui.renderLeaderboard(entries, { highlight: highlightEntry || null });
    return entries;
  };

  /* ======================= input ======================= */

  Game.prototype.shouldIgnoreInput = function (reason) {
    if (this.ui.isModalOpen()) { return true; }
    if (reason === 'flap') { return this.state !== STATES.PLAYING; }
    if (reason === 'pause') { return this.state !== STATES.PLAYING && this.state !== STATES.PAUSED; }
    return false;
  };

  Game.prototype.onGesture = function () {
    if (this.state === STATES.PLAYING || this.state === STATES.PAUSED) {
      this.audio.unlock();
    }
  };

  Game.prototype.onFlap = function () {
    if (this.state !== STATES.PLAYING) { return; }
    if (!this.bird.flap()) { return; }
    this.audio.unlock();
    this.audio.play('flap');
    this.particles.burst(this.bird.x - 22, this.bird.y + 16, '#FFFFFF', {
      count: 4, speed: 90, size: 3, life: 0.34, gravity: 70, angle: Math.PI * 0.8, spread: 1.0
    });
  };

  Game.prototype.onPauseToggle = function () {
    this.togglePause();
  };

  Game.prototype.onWindowBlur = function () {
    this.pauseIfPlaying();
  };

  Game.prototype.onBirdSelected = function (id) {
    this.birdDef = this.findBird(id);
    this.storage.setBirdId(id);
    // keep both selector instances in sync
    for (var i = 0; i < this.selectors.length; i++) {
      if (this.selectors[i].getSelected() !== id) { this.selectors[i].applySelection(id, true); }
    }
    this.ui.setSelectSubtitle(this.ui.getNickname() || this.storage.getNickname() || '—');
    this.ui.renderPortrait(this.birdDef, this.time);
  };

  Game.prototype.onToggleMute = function () {
    var settings = this.storage.getSound();
    var anyOn = settings.music || settings.sfx;
    var next = { music: !anyOn, sfx: !anyOn };
    this.applySoundSettings(next, false);
    this.ui.toast(anyOn ? 'Sound muted' : 'Sound on');
    this.audio.unlock();
    this.audio.play('ui_click');
  };

  Game.prototype.toggleChannel = function (channel) {
    var settings = this.storage.getSound();
    settings[channel] = !settings[channel];
    this.applySoundSettings(settings, false);
    this.audio.unlock();
    this.audio.play('ui_click');
    this.ui.toast(channel.toUpperCase() + (settings[channel] ? ' on' : ' off'));
  };

  Game.prototype.applySoundSettings = function (settings, silent) {
    this.storage.setSound(settings);
    this.audio.setSettings(settings);
    this.ui.setSoundUI(settings);
    if (!silent && settings.music && this.state === STATES.PLAYING) { this.audio.startMusic(); }
    if (!settings.music) { this.audio.stopMusic(); }
  };

  /* ======================= update ======================= */

  Game.prototype.update = function (dt) {
    switch (this.state) {
      case STATES.PLAYING:
        this.updatePlaying(dt);
        break;
      case STATES.PAUSED:
        break;
      case STATES.GAME_OVER:
        this.updateGameOver(dt);
        break;
      default:
        this.updateIdleScene(dt);
        break;
    }
    this.particles.update(dt);
  };

  Game.prototype.updateIdleScene = function (dt) {
    var targetSpeed = 170;
    this.background.update(dt, targetSpeed);
    this.bird.reset();
    this.bird.updateIdle(dt, WORLD.groundY - 46, this.time);
    this.bird.def = this.birdDef;
    this.portraitTimer -= dt;
    if (this.portraitTimer <= 0) {
      this.ui.renderPortrait(this.birdDef, this.time);
      this.portraitTimer = this.HUD_PORTRAIT_EVERY;
    }
  };

  Game.prototype.updateGameOver = function (dt) {
    // The bird keeps tumbling down; the world stays frozen.
    if (this.bird.y < WORLD.height + 100) {
      this.bird.vy = Math.min(FLIGHT.maxFallSpeed, this.bird.vy + FLIGHT.gravity * dt);
      this.bird.y += this.bird.vy * dt;
      this.bird.rotation = Utils.approach(this.bird.rotation, 1.7, 3.2, dt);
      this.bird.wingPhase += dt * 4;
    }
    if (this.confettiTimer > 0) {
      this.confettiTimer -= dt;
      if (this.confettiTimer <= 0 && this.particles.count() < 140) {
        this.particles.confetti(50, WORLD.width, WORLD.height);
      }
    }
  };

  Game.prototype.updatePlaying = function (dt) {
    var level = this.score.difficulty();
    var target = this.snapDifficulty(this.score.score);
    // Smooth, gradual difficulty growth.
    this.diff.speed = Utils.approach(this.diff.speed, target.speed, 0.55, dt);
    this.diff.gap = Utils.approach(this.diff.gap, target.gap, 0.45, dt);
    this.diff.interval = Utils.approach(this.diff.interval, target.interval, 0.45, dt);
    this.diff.centerDrift = Utils.approach(this.diff.centerDrift, target.centerDrift, 0.45, dt);
    this.diff.wormChance = target.wormChance;
    this.diff.level = level.level;

    this.audio.setIntensity(level.level);

    // world
    this.background.update(dt, this.diff.speed);
    var flags = this.bird.update(dt, { groundY: WORLD.groundY });
    var result = this.obstacles.update(dt, this.diff, { birdX: this.bird.x });
    for (var i = 0; i < result.spawned.length; i++) {
      this.worms.populatePassage(result.spawned[i], this.diff);
    }
    for (var p = 0; p < result.passed.length; p++) {
      var bonus = this.score.passObstacle();
      var pair = result.passed[p];
      this.particles.text(pair.x + pair.width * 0.5, pair.getGapCenter() - 26, '+' + bonus, '#FFFFFF', { size: 18, life: 0.7 });
      this.audio.play('pass');
    }

    this.score.addDistance(this.diff.speed * dt);
    this.worms.update(dt, this.diff.speed);

    // collisions with obstacles
    if (!this.bird.isInvulnerable()) {
      var hitPair = this.obstacles.collides(this.bird);
      if (hitPair) { this.registerHit('obstacle'); }
      else if (flags.hitGround) { this.registerHit('ground'); }
    }

    this.collectWorms();
    this.spawnCyberTrail(dt);
    this.updateHudDom();
    this.bird.justFlapped = false;
  };

  Game.prototype.collectWorms = function () {
    var picked = this.worms.collect(this.bird);
    if (!picked.length) { return; }
    var multiplierUp = false;
    var lastMultiplier = this.score.multiplier;

    for (var i = 0; i < picked.length; i++) {
      var worm = picked[i];
      var type = worm.type;
      var before = this.score.score;
      var info = this.score.collectWorm(type);
      var gained = this.score.score - before;

      if (type.healthy) {
        this.particles.burst(worm.x, worm.y, type.body, {
          count: type.id === 'gold' ? 18 : 10,
          speed: type.id === 'gold' ? 260 : 190,
          size: type.id === 'gold' ? 5 : 4,
          life: 0.6,
          glow: true,
          sparkle: type.id === 'gold'
        });
        this.particles.ring(worm.x, worm.y, type.glow, { size: worm.radius * 0.7, grow: 170, life: 0.42, glow: true });
        this.particles.text(worm.x, worm.y - worm.radius - 12, '+' + gained, type.id === 'gold' ? '#FFE9A8' : '#FFFFFF', {
          size: type.id === 'gold' ? 30 : 22
        });
        this.audio.play('worm_' + type.id);
        if (type.id === 'gold') {
          this.particles.burst(worm.x, worm.y, '#FFFFFF', { count: 8, speed: 300, size: 3, life: 0.5, sparkle: true, glow: true });
        }
      } else {
        this.particles.burst(worm.x, worm.y, type.body, { count: 12, speed: 210, size: 4, life: 0.55 });
        this.particles.text(worm.x, worm.y - worm.radius - 12, (gained >= 0 ? '+' : '') + gained, '#FF7A8A', { size: 24 });
        this.audio.play('worm_red');
        this.ui.toast('Red worm! Combo lost', 1400);
      }

      if (info.multiplierUp) { multiplierUp = true; }
    }

    if (multiplierUp && this.score.multiplier > lastMultiplier) {
      this.ui.showCombo(this.score.multiplier);
      this.audio.play('combo', this.score.multiplier);
    }
    this.updateHudDom(true);
  };

  Game.prototype.spawnCyberTrail = function (dt) {
    this.trailTimer -= dt;
    if (this.birdDef.id !== 'cyber' || this.trailTimer > 0) { return; }
    if (this.bird.vy < 0.5 && this.particles.count() < 120) {
      this.particles.trail(this.bird.x - 26, this.bird.y + 4, this.birdDef.glow || '#16F3CE', { size: 9, life: 0.36 });
      this.trailTimer = 0.05;
    }
  };

  Game.prototype.registerHit = function (source) {
    if (this.state !== STATES.PLAYING) { return; }
    if (this.bird.isInvulnerable()) { return; }

    this.lives -= 1;
    var hadCombo = this.score.registerHit();
    this.bird.hit();
    this.ui.setLives(Math.max(0, this.lives), { lostIndex: Math.max(0, this.lives) });
    this.ui.shake();
    this.ui.flash();
    this.particles.burst(this.bird.x, this.bird.y, '#FF5C7A', { count: 14, speed: 230, size: 5, life: 0.6 });
    this.audio.play('collision');
    if (this.lives > 0) {
      this.audio.play('life_lost');
      if (hadCombo > 0) { this.ui.toast('Combo lost', 1200); }
    }
    this.updateHudDom(true);

    if (this.lives <= 0) {
      this.gameOver();
      return;
    }
    if (source === 'ground') {
      // bounce back into the air so the run can continue
      this.bird.vy = -Math.abs(FLIGHT.flapVelocity) * 0.7;
    }
  };

  Game.prototype.updateHudDom = function (force) {
    var hud = this.hud;
    var score = this.score.score;
    var best = Math.max(this.best, score);
    var multiplier = this.score.multiplier;
    var changed = force || hud.score !== score || hud.best !== best || hud.multiplier !== multiplier;
    if (!changed) { return; }

    var bump = hud.score >= 0 && score > hud.score;
    hud.score = score;
    hud.best = best;
    hud.multiplier = multiplier;
    hud.birdName = this.birdDef.name;
    hud.nickname = this.ui.getNickname();
    this.ui.updateHud({
      score: score,
      best: best,
      multiplier: multiplier,
      birdName: this.birdDef.name,
      nickname: hud.nickname,
      bumpScore: bump
    });
  };

  /* ======================= render ======================= */

  Game.prototype.render = function () {
    var ctx = this.ctx;
    var scale = this.scale || 1;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, WORLD.width, WORLD.height);

    var dim = 0;
    if (this.state === STATES.MENU) { dim = 0.30; }
    else if (this.state === STATES.CHARACTER_SELECT) { dim = 0.40; }
    else if (this.state === STATES.PAUSED) { dim = 0.45; }
    else if (this.state === STATES.GAME_OVER) { dim = 0.18; }

    this.background.draw(ctx, { dim: dim });

    if (this.state === STATES.PLAYING || this.state === STATES.PAUSED || this.state === STATES.GAME_OVER) {
      this.obstacles.draw(ctx, this.time);
      this.worms.draw(ctx, this.time);
    }

    this.bird.draw(ctx, this.time);
    this.particles.draw(ctx);

    if (this.state === STATES.PLAYING && !this.bird.isInvulnerable() && this.bird.y > WORLD.groundY - 60) {
      // subtle warning when skimming the ground
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, WORLD.groundY - 2);
      ctx.lineTo(WORLD.width, WORLD.groundY - 2);
      ctx.stroke();
      ctx.restore();
    }
  };

  /* ======================= bootstrap ======================= */

  GA.Game = Game;
  GA.STATES = STATES;

  function boot() {
    if (!GA || !GA.createStorage) { return; }
    try {
      root.__GA_GAME__ = new GA.Game();
    } catch (err) {
      if (root.console) { root.console.error('[feather-rush] failed to start', err); }
      var box = document.getElementById('fatal');
      var text = document.getElementById('fatal-text');
      if (box && text) {
        text.textContent = err && err.message ? err.message : String(err);
        box.classList.add('is-visible');
      }
    }
  }

  if (typeof document !== 'undefined' && !GA.__noAutoBoot) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot, false);
    } else {
      boot();
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
