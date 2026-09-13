/* ==========================================================================
   ui.js — UIManager
   Owns every DOM element: screens, HUD, leaderboard, game over panel,
   toasts, the confirm modal and sound toggles.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  var api = factory(
    (typeof module === 'object' && module.exports) ? require('./utils.js') : (root.GA || {}),
    (typeof module === 'object' && module.exports) ? require('./config.js') : (root.GA || {}),
    (typeof module === 'object' && module.exports) ? require('./bird.js') : (root.GA || {})
  );
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  if (root) { root.GA = root.GA || {}; Object.assign(root.GA, api); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Utils, Config, BirdModule) {
  'use strict';

  var IDS = [
    'stage', 'hud', 'hud-portrait', 'hud-bird', 'hud-nick', 'hud-score', 'hud-best', 'hud-combo',
    'hud-lives', 'btn-pause', 'btn-sound', 'combo-banner', 'ready-hint', 'perf-hud',
    'screen-menu', 'screen-select', 'screen-pause', 'screen-gameover',
    'nickname', 'nickname-hint', 'btn-play', 'leaderboard-menu', 'btn-clear-menu',
    'toggle-music', 'toggle-sfx', 'toggle-music-pause', 'toggle-sfx-pause',
    'select-nick', 'btn-select-back', 'btn-select-play',
    'btn-resume', 'btn-restart-pause', 'btn-menu-pause', 'pause-stats',
    'go-title', 'go-new-high', 'go-player', 'go-bird', 'go-score', 'go-best', 'go-extra',
    'btn-play-again', 'btn-change-bird', 'btn-main-menu',
    'toast', 'rotate-hint', 'modal', 'modal-title', 'modal-text', 'modal-ok', 'modal-cancel',
    'fatal', 'fatal-text', 'game-canvas'
  ];

  var SCREENS = {
    menu: 'screen-menu',
    select: 'screen-select',
    pause: 'screen-pause',
    gameover: 'screen-gameover'
  };

  function UIManager(options) {
    options = options || {};
    this.doc = options.document || (typeof document !== 'undefined' ? document : null);
    this.storage = options.storage || null;
    this.audio = options.audio || null;
    this.handlers = options.handlers || {};
    this.birds = options.birds || Config.BIRDS;
    this.el = {};
    this.hearts = [];
    this.screen = null;
    this._modalResolve = null;
    this._toastTimer = null;
    this._lastHearts = Config.LIVES.start;
    if (this.doc) {
      this.cacheRefs();
      this.bind();
      this.buildLives(Config.LIVES.start);
      this.updateRotateHint();
    }
  }

  UIManager.prototype.cacheRefs = function () {
    for (var i = 0; i < IDS.length; i++) {
      this.el[IDS[i]] = this.doc.getElementById(IDS[i]);
    }
  };

  UIManager.prototype.on = function (name, fn) {
    this.handlers[name] = fn;
    return this;
  };

  UIManager.prototype._call = function (name) {
    var fn = this.handlers[name];
    if (typeof fn === 'function') { fn(); }
  };

  UIManager.prototype.bind = function () {
    var self = this;
    function click(id, handler) {
      var el = self.el[id];
      if (el) { el.addEventListener('click', function (e) { e.preventDefault(); handler(); }); }
    }

    click('btn-play', function () { self._call('onPlay'); });
    click('btn-select-play', function () { self._call('onPlay'); });
    click('btn-select-back', function () { self._call('onMainMenu'); });
    click('btn-play-again', function () { self._call('onPlayAgain'); });
    click('btn-change-bird', function () { self._call('onChangeBird'); });
    click('btn-main-menu', function () { self._call('onMainMenu'); });
    click('btn-resume', function () { self._call('onResume'); });
    click('btn-restart-pause', function () { self._call('onRestart'); });
    click('btn-menu-pause', function () { self._call('onMainMenu'); });
    click('btn-pause', function () { self._call('onPauseToggle'); });
    click('btn-sound', function () { self._call('onToggleMute'); });
    click('toggle-music', function () { self._call('onToggleMusic'); });
    click('toggle-sfx', function () { self._call('onToggleSfx'); });
    click('toggle-music-pause', function () { self._call('onToggleMusic'); });
    click('toggle-sfx-pause', function () { self._call('onToggleSfx'); });
    click('btn-clear-menu', function () { self.confirmClearScores(); });
    click('modal-cancel', function () { self.closeConfirm(false); });
    click('modal-ok', function () { self.closeConfirm(true); });

    var nick = this.el.nickname;
    if (nick) {
      nick.addEventListener('input', function () { self.handleNicknameInput(); });
      nick.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          var check = Utils.validateNickname(nick.value);
          if (check.ok) { self._call('onPlay'); } else { self.setNicknameError(check.error); }
        }
      });
      nick.addEventListener('blur', function () { self.refreshPlayButton(); });
    }

    if (this.doc.defaultView) {
      this.doc.defaultView.addEventListener('resize', function () { self.updateRotateHint(); });
      this.doc.defaultView.addEventListener('orientationchange', function () { self.updateRotateHint(); });
    }
  };

  /* ------------------------- screens ------------------------- */

  UIManager.prototype.showScreen = function (name) {
    this.screen = name || null;
    for (var key in SCREENS) {
      if (!Object.prototype.hasOwnProperty.call(SCREENS, key)) { continue; }
      var el = this.el[SCREENS[key]];
      if (!el) { continue; }
      el.classList.toggle('is-active', key === name);
    }
  };

  UIManager.prototype.setHudActive = function (active) {
    if (this.el.hud) { this.el.hud.classList.toggle('is-active', !!active); }
  };

  /* ------------------------- nickname ------------------------- */

  UIManager.prototype.handleNicknameInput = function () {
    var input = this.el.nickname;
    if (!input) { return; }
    var clean = Utils.sanitizeNickname(input.value);
    if (clean !== input.value) { input.value = clean; }
    var check = Utils.validateNickname(clean);
    // While typing we only complain about the length, not about emptiness.
    if (!clean) { this.setNicknameError(null); } else { this.setNicknameError(check.ok ? null : check.error); }
    this.refreshPlayButton();
  };

  UIManager.prototype.setNicknameError = function (message) {
    var hint = this.el['nickname-hint'];
    var input = this.el.nickname;
    if (hint) {
      hint.textContent = message || '2–16 characters: letters, digits, _ or -';
      hint.classList.toggle('is-error', !!message);
    }
    if (input) { input.classList.toggle('is-invalid', !!message); }
  };

  UIManager.prototype.refreshPlayButton = function () {
    var btn = this.el['btn-play'];
    if (!btn) { return; }
    var check = Utils.validateNickname(this.getNickname());
    btn.disabled = !check.ok;
    btn.title = check.ok ? '' : check.error;
  };

  UIManager.prototype.getNickname = function () {
    return this.el.nickname ? Utils.sanitizeNickname(this.el.nickname.value) : '';
  };

  UIManager.prototype.setNickname = function (value) {
    if (!this.el.nickname) { return ''; }
    var clean = Utils.sanitizeNickname(value);
    this.el.nickname.value = clean;
    this.setNicknameError(null);
    this.refreshPlayButton();
    return clean;
  };

  UIManager.prototype.setSelectSubtitle = function (nickname) {
    if (this.el['select-nick']) {
      this.el['select-nick'].textContent = 'Player: ' + (nickname || '—');
    }
  };

  /* ------------------------- HUD ------------------------- */

  UIManager.prototype.buildLives = function (count) {
    var host = this.el['hud-lives'];
    if (!host) { return; }
    host.innerHTML = '';
    this.hearts = [];
    for (var i = 0; i < count; i++) {
      var span = this.doc.createElement('span');
      span.className = 'life';
      span.textContent = '❤️';
      host.appendChild(span);
      this.hearts.push(span);
    }
    this._lastHearts = count;
  };

  UIManager.prototype.setLives = function (lives, opts) {
    opts = opts || {};
    var lostIndex = opts.lostIndex == null ? -1 : opts.lostIndex;
    for (var i = 0; i < this.hearts.length; i++) {
      var heart = this.hearts[i];
      var isLost = i >= lives;
      heart.classList.toggle('is-lost', isLost);
      if (i === lostIndex) {
        heart.classList.remove('is-hit');
        // restart the animation
        void heart.offsetWidth;
        heart.classList.add('is-hit');
      }
    }
    this._lastHearts = lives;
  };

  UIManager.prototype.updateHud = function (state) {
    var el = this.el;
    if (el['hud-score']) {
      el['hud-score'].textContent = Utils.formatScore(state.score);
      if (state.bumpScore) {
        el['hud-score'].classList.remove('is-bump');
        void el['hud-score'].offsetWidth;
        el['hud-score'].classList.add('is-bump');
      }
    }
    if (el['hud-best']) { el['hud-best'].textContent = Utils.formatScore(state.best); }
    if (el['hud-combo']) { el['hud-combo'].textContent = 'x' + (state.multiplier || 1); }
    if (el['hud-bird']) { el['hud-bird'].textContent = (state.birdName || '').toUpperCase(); }
    if (el['hud-nick']) { el['hud-nick'].textContent = state.nickname || '—'; }
  };

  UIManager.prototype.renderPortrait = function (def, time) {
    var canvas = this.el['hud-portrait'];
    if (!canvas || !def) { return; }
    var ctx = canvas.getContext('2d');
    if (!ctx) { return; }
    var dpr = Math.min(2.5, Math.max(1, (this.doc.defaultView && this.doc.defaultView.devicePixelRatio) || 1));
    var w = 48, h = 48;
    if (canvas.width !== Math.round(w * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    BirdModule.drawBirdPreview(ctx, def, w, h, time || 0, { zoom: 1.35 });
  };

  UIManager.prototype.showCombo = function (multiplier) {
    var banner = this.el['combo-banner'];
    if (!banner) { return; }
    banner.textContent = 'COMBO x' + multiplier + '!';
    banner.classList.remove('is-showing');
    void banner.offsetWidth;
    banner.classList.add('is-showing');
  };

  UIManager.prototype.setReadyHint = function (visible, nickname) {
    var el = this.el['ready-hint'];
    if (!el) { return; }
    el.classList.toggle('is-visible', !!visible);
    var text = el.querySelector('.ready-hint__text');
    if (text && visible) {
      text.innerHTML = '<b>SPACE</b> · <b>TAP</b> · <b>CLICK</b> — to start flying';
    }
    void nickname;
  };

  UIManager.prototype.setPerfVisible = function (visible) {
    var el = this.el['perf-hud'];
    if (el) { el.classList.toggle('is-visible', !!visible); }
  };

  UIManager.prototype.setPerfText = function (text) {
    var el = this.el['perf-hud'];
    if (el) { el.textContent = text || ''; }
  };

  UIManager.prototype.toast = function (message, ms) {
    var el = this.el.toast;
    if (!el) { return; }
    el.textContent = message;
    el.classList.add('is-visible');
    if (this._toastTimer) { clearTimeout(this._toastTimer); }
    var self = this;
    this._toastTimer = setTimeout(function () {
      el.classList.remove('is-visible');
      self._toastTimer = null;
    }, ms || 2200);
  };

  /* ------------------------- leaderboard ------------------------- */

  UIManager.prototype.renderLeaderboard = function (entries, opts) {
    opts = opts || {};
    var host = this.el['leaderboard-menu'];
    if (!host) { return; }
    host.innerHTML = '';
    if (!entries || !entries.length) {
      var empty = this.doc.createElement('li');
      empty.className = 'leaderboard__empty';
      empty.textContent = 'No scores yet — be the first!';
      host.appendChild(empty);
      return;
    }
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var li = this.doc.createElement('li');
      li.className = 'leaderboard__row' + (i === 0 ? ' leaderboard__row--top' : '');
      li.title = 'Played on ' + Utils.formatDate(entry.date);
      if (opts.highlight && opts.highlight === entry) { li.classList.add('leaderboard__row--new'); }

      var rank = this.doc.createElement('span');
      rank.className = 'leaderboard__rank';
      rank.textContent = (i + 1) + '.';

      var name = this.doc.createElement('span');
      name.className = 'leaderboard__name';
      name.textContent = entry.nickname;

      var score = this.doc.createElement('span');
      score.className = 'leaderboard__score';
      score.textContent = Utils.formatScore(entry.score);

      var bird = this.doc.createElement('span');
      bird.className = 'leaderboard__bird';
      bird.textContent = birdName(entry.bird);

      li.appendChild(rank);
      li.appendChild(name);
      li.appendChild(score);
      li.appendChild(bird);
      host.appendChild(li);
    }
  };

  function birdName(id) {
    for (var i = 0; i < Config.BIRDS.length; i++) {
      if (Config.BIRDS[i].id === id) { return Config.BIRDS[i].displayName; }
    }
    return id || '—';
  }

  UIManager.prototype.confirmClearScores = function () {
    var self = this;
    return this.openConfirm({
      title: 'Clear all scores?',
      text: 'The local leaderboard will be wiped. This cannot be undone.',
      okLabel: 'CLEAR'
    }).then(function (ok) {
      if (ok) { self._call('onClearScores'); }
      return ok;
    });
  };

  /* ------------------------- modal ------------------------- */

  UIManager.prototype.openConfirm = function (opts) {
    opts = opts || {};
    var self = this;
    if (!this.el.modal) { return Promise.resolve(false); }
    if (this.el['modal-title']) { this.el['modal-title'].textContent = opts.title || 'Are you sure?'; }
    if (this.el['modal-text']) { this.el['modal-text'].textContent = opts.text || ''; }
    if (this.el['modal-ok']) { this.el['modal-ok'].textContent = opts.okLabel || 'CONFIRM'; }
    this.el.modal.classList.add('is-open');
    return new Promise(function (resolve) {
      self._modalResolve = resolve;
    });
  };

  UIManager.prototype.closeConfirm = function (result) {
    if (this.el.modal) { this.el.modal.classList.remove('is-open'); }
    var resolve = this._modalResolve;
    this._modalResolve = null;
    if (resolve) { resolve(!!result); }
  };

  UIManager.prototype.isModalOpen = function () {
    return !!(this.el.modal && this.el.modal.classList.contains('is-open'));
  };

  /* ------------------------- game over ------------------------- */

  UIManager.prototype.fillGameOver = function (data) {
    var el = this.el;
    if (el['go-title']) { el['go-title'].textContent = data.title || 'GAME OVER'; }
    if (el['go-player']) { el['go-player'].textContent = data.nickname || '—'; }
    if (el['go-bird']) { el['go-bird'].textContent = birdName(data.birdId); }
    if (el['go-score']) { el['go-score'].textContent = Utils.formatScore(data.score); }
    if (el['go-best']) { el['go-best'].textContent = Utils.formatScore(data.best); }
    if (el['go-extra']) {
      el['go-extra'].textContent = (data.worms || 0) + ' / ' + (data.distance || 0) + ' m';
    }
    if (el['go-new-high']) { el['go-new-high'].classList.toggle('is-visible', !!data.isHighScore); }
  };

  UIManager.prototype.setPauseStats = function (data) {
    var host = this.el['pause-stats'];
    if (!host) { return; }
    host.innerHTML = '';
    var items = [
      { label: 'SCORE', value: Utils.formatScore(data.score) },
      { label: 'WORMS', value: String(data.worms || 0) },
      { label: 'DISTANCE', value: (data.distance || 0) + ' m' }
    ];
    for (var i = 0; i < items.length; i++) {
      var wrap = this.doc.createElement('div');
      wrap.className = 'mini-stat';
      var label = this.doc.createElement('span');
      label.textContent = items[i].label;
      var value = this.doc.createElement('b');
      value.textContent = items[i].value;
      wrap.appendChild(label);
      wrap.appendChild(value);
      host.appendChild(wrap);
    }
  };

  /* ------------------------- sound toggles ------------------------- */

  UIManager.prototype.setSoundUI = function (settings) {
    var pairs = [
      ['toggle-music', settings.music],
      ['toggle-sfx', settings.sfx],
      ['toggle-music-pause', settings.music],
      ['toggle-sfx-pause', settings.sfx]
    ];
    for (var i = 0; i < pairs.length; i++) {
      var el = this.el[pairs[i][0]];
      if (!el) { continue; }
      el.classList.toggle('is-on', !!pairs[i][1]);
      el.setAttribute('aria-pressed', pairs[i][1] ? 'true' : 'false');
    }
    var allOff = !settings.music && !settings.sfx;
    if (this.el['btn-sound']) {
      this.el['btn-sound'].textContent = allOff ? '🔇' : '🔊';
      this.el['btn-sound'].classList.toggle('is-muted', allOff);
      this.el['btn-sound'].setAttribute('aria-label', allOff ? 'Sound off' : 'Sound on');
    }
  };

  UIManager.prototype.updateRotateHint = function () {
    var el = this.el['rotate-hint'];
    if (!el || !this.doc.defaultView) { return; }
    var win = this.doc.defaultView;
    var portrait = win.innerHeight > win.innerWidth;
    var narrow = Math.min(win.innerWidth, win.innerHeight) < 720;
    el.classList.toggle('is-visible', portrait && narrow);
  };

  UIManager.prototype.showFatal = function (error) {
    var box = this.el.fatal;
    var text = this.el['fatal-text'];
    if (!box || !text) { return; }
    var message = error && error.message ? error.message : String(error || 'Unknown error');
    text.textContent = message;
    box.classList.add('is-visible');
  };

  UIManager.prototype.hideFatal = function () {
    if (this.el.fatal) { this.el.fatal.classList.remove('is-visible'); }
  };

  UIManager.prototype.shake = function () {
    var stage = this.el.stage;
    if (!stage) { return; }
    stage.classList.remove('is-shaking');
    void stage.offsetWidth;
    stage.classList.add('is-shaking');
  };

  UIManager.prototype.flash = function () {
    var stage = this.el.stage;
    if (!stage) { return; }
    stage.classList.remove('is-flashing');
    void stage.offsetWidth;
    stage.classList.add('is-flashing');
  };

  UIManager.birdName = birdName;
  return { UIManager: UIManager };
});
