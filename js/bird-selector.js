/* ==========================================================================
   bird-selector.js — BirdSelector
   Renders the three character cards (menu + character select), keeps the
   chosen bird in localStorage and animates the idle previews.
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

  // Shared between every selector instance so both screens stay in sync.
  var bus = Utils.createEmitter();

  function BirdSelector(options) {
    options = options || {};
    this.mount = options.mount;
    this.birds = options.birds || Config.BIRDS;
    this.storage = options.storage || null;
    this.audio = options.audio || null;
    this.onSelect = options.onSelect || function () {};
    this.wide = !!options.wide;
    this.selectedId = options.selectedId || this.birds[0].id;
    this.cards = [];
    this.time = 0;
    this._raf = null;
    this._running = false;
    this._dpr = 1;

    if (this.mount) { this.build(); }
    this._onBusSelect = function (payload) {
      this.applySelection(payload && payload.id, true);
    }.bind(this);
    bus.on('select', this._onBusSelect);
  }

  BirdSelector.prototype.build = function () {
    var self = this;
    this.mount.innerHTML = '';
    this.cards = [];

    this.birds.forEach(function (def) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'bird-card' + (self.wide ? ' bird-card--wide' : '');
      card.setAttribute('role', 'radio');
      card.setAttribute('aria-checked', 'false');
      card.setAttribute('data-bird', def.id);
      card.setAttribute('aria-label', def.name + ' — ' + def.tagline);

      var canvas = document.createElement('canvas');
      canvas.className = 'bird-card__canvas';
      canvas.setAttribute('aria-hidden', 'true');

      var name = document.createElement('span');
      name.className = 'bird-card__name';
      name.textContent = def.name;

      var tag = document.createElement('span');
      tag.className = 'bird-card__tag';
      tag.textContent = def.tagline;

      var badge = document.createElement('span');
      badge.className = 'bird-card__badge';
      badge.textContent = 'SELECTED';

      card.appendChild(canvas);
      card.appendChild(name);
      card.appendChild(tag);
      card.appendChild(badge);
      card.addEventListener('click', function () { self.select(def.id); });

      self.mount.appendChild(card);
      self.cards.push({ def: def, el: card, canvas: canvas, ctx: canvas.getContext('2d'), w: 0, h: 0 });
    });

    this.applySelection(this.selectedId, true);
  };

  BirdSelector.prototype.measure = function () {
    var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    this._dpr = Math.min(2.5, Math.max(1, dpr));
    for (var i = 0; i < this.cards.length; i++) {
      var card = this.cards[i];
      var rect = card.canvas.getBoundingClientRect ? card.canvas.getBoundingClientRect() : null;
      var w = rect && rect.width ? rect.width : 120;
      var h = rect && rect.height ? rect.height : 74;
      if (Math.abs(w - card.w) > 0.5 || Math.abs(h - card.h) > 0.5) {
        card.w = w;
        card.h = h;
        card.canvas.width = Math.max(1, Math.round(w * this._dpr));
        card.canvas.height = Math.max(1, Math.round(h * this._dpr));
      }
    }
  };

  BirdSelector.prototype.render = function () {
    for (var i = 0; i < this.cards.length; i++) {
      var card = this.cards[i];
      if (!card.ctx || !card.w) { continue; }
      card.ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
      BirdModule.drawBirdPreview(card.ctx, card.def, card.w, card.h, this.time + i * 0.6, { zoom: this.wide ? 1.05 : 1 });
    }
  };

  BirdSelector.prototype.tick = function (now) {
    if (!this._running) { return; }
    var self = this;
    var t = now / 1000;
    var dt = Math.min(0.05, t - this.time);
    this.time = t;
    if (dt < 0) { this.time = t; }
    this.render();
    this._raf = (typeof requestAnimationFrame === 'function')
      ? requestAnimationFrame(function (n) { self.tick(n); })
      : null;
  };

  BirdSelector.prototype.start = function () {
    if (this._running) { return; }
    this._running = true;
    this.measure();
    var self = this;
    if (typeof requestAnimationFrame === 'function') {
      this._raf = requestAnimationFrame(function (n) { self.tick(n); });
    } else {
      this.render();
    }
  };

  BirdSelector.prototype.stop = function () {
    this._running = false;
    if (this._raf != null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this._raf);
    }
    this._raf = null;
  };

  BirdSelector.prototype.select = function (id, opts) {
    opts = opts || {};
    var changed = this.selectedId !== id;
    this.selectedId = id;
    this.updateCards();
    if (this.storage) { this.storage.setBirdId(id); }
    if (changed || opts.force) {
      if (this.audio && !opts.silent) { this.audio.play('select'); }
      if (!opts.silent) { bus.emit('select', { id: id, source: this }); }
    }
    this.onSelect(id);
    return id;
  };

  BirdSelector.prototype.updateCards = function () {
    for (var i = 0; i < this.cards.length; i++) {
      var card = this.cards[i];
      var isSel = card.def.id === this.selectedId;
      card.el.classList.toggle('is-selected', isSel);
      card.el.setAttribute('aria-checked', isSel ? 'true' : 'false');
    }
  };

  /** Applies a selection to this instance only (no storage write, no bus emit). */
  BirdSelector.prototype.applySelection = function (id, silent) {
    if (id) { this.selectedId = id; }
    this.updateCards();
    if (!silent) { this.onSelect(this.selectedId); }
    return this.selectedId;
  };

  BirdSelector.prototype.getSelected = function () {
    return this.selectedId;
  };

  BirdSelector.prototype.getSelectedDef = function () {
    for (var i = 0; i < this.birds.length; i++) {
      if (this.birds[i].id === this.selectedId) { return this.birds[i]; }
    }
    return this.birds[0];
  };

  BirdSelector.prototype.destroy = function () {
    this.stop();
    bus.off('select', this._onBusSelect);
  };

  BirdSelector.bus = bus;
  return { BirdSelector: BirdSelector };
});
