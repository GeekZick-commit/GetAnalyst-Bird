/* ==========================================================================
   input.js — InputManager
   Keyboard (Space / ArrowUp / W, P / Escape, M), mouse and touch input with
   a single "flap" intent. UI clicks never trigger a flap.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  if (root) { root.GA = root.GA || {}; Object.assign(root.GA, api); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function noop() {}

  var UI_SELECTOR = 'button, input, textarea, select, a, label, .modal.is-open, .screen.is-active';

  function InputManager(options) {
    options = options || {};
    this.doc = options.document || (typeof document !== 'undefined' ? document : null);
    this.win = options.window || (typeof window !== 'undefined' ? window : null);
    this.stage = options.stage || null;
    this.onFlap = options.onFlap || noop;
    this.onPause = options.onPause || noop;
    this.onToggleSound = options.onToggleSound || noop;
    this.onAnyGesture = options.onAnyGesture || noop;
    this.onBlur = options.onBlur || noop;
    this.shouldIgnore = options.shouldIgnore || function () { return false; };
    this.enabled = true;
    this._attached = false;
    this._handlers = {};
    this.attach();
  }

  InputManager.prototype.attach = function () {
    if (this._attached || !this.doc) { return; }
    var self = this;
    var doc = this.doc;
    var win = this.win || doc.defaultView;
    var pointerTarget = this.stage || doc;

    this._handlers.keydown = function (e) { self._onKeyDown(e); };
    this._handlers.pointerdown = function (e) { self._onPointerDown(e); };
    this._handlers.blur = function () { self.onBlur(); };
    this._handlers.visibility = function () {
      if (doc.visibilityState === 'hidden') { self.onBlur(); }
    };
    this._handlers.contextmenu = function (e) {
      if (pointerTarget && pointerTarget.contains && pointerTarget.contains(e.target)) { e.preventDefault(); }
    };

    doc.addEventListener('keydown', this._handlers.keydown, false);
    if (win && win.PointerEvent) {
      pointerTarget.addEventListener('pointerdown', this._handlers.pointerdown, false);
    } else {
      pointerTarget.addEventListener('touchstart', this._handlers.pointerdown, { passive: false });
      pointerTarget.addEventListener('mousedown', this._handlers.pointerdown, false);
    }
    win && win.addEventListener('blur', this._handlers.blur, false);
    doc.addEventListener('visibilitychange', this._handlers.visibility, false);
    doc.addEventListener('contextmenu', this._handlers.contextmenu, false);
    this._attached = true;
  };

  InputManager.prototype.detach = function () {
    if (!this._attached || !this.doc) { return; }
    var doc = this.doc;
    var win = this.win || doc.defaultView;
    var pointerTarget = this.stage || doc;
    doc.removeEventListener('keydown', this._handlers.keydown, false);
    pointerTarget.removeEventListener('pointerdown', this._handlers.pointerdown, false);
    pointerTarget.removeEventListener('touchstart', this._handlers.pointerdown, false);
    pointerTarget.removeEventListener('mousedown', this._handlers.pointerdown, false);
    win && win.removeEventListener('blur', this._handlers.blur, false);
    doc.removeEventListener('visibilitychange', this._handlers.visibility, false);
    doc.removeEventListener('contextmenu', this._handlers.contextmenu, false);
    this._attached = false;
  };

  InputManager.prototype.setEnabled = function (enabled) {
    this.enabled = !!enabled;
    return this;
  };

  InputManager.prototype._isTypingTarget = function (target) {
    if (!target || !target.tagName) { return false; }
    var tag = target.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable === true;
  };

  InputManager.prototype._onKeyDown = function (e) {
    if (!e || e.defaultPrevented) { return; }
    var code = e.code || '';
    if (this._isTypingTarget(e.target)) { return; }

    if (code === 'Space' || code === 'ArrowUp' || code === 'KeyW') {
      e.preventDefault();
      if (e.repeat) { return; }
      this.onAnyGesture();
      if (this.enabled && !this.shouldIgnore('flap')) { this.onFlap(); }
      return;
    }
    if (code === 'KeyP' || code === 'Escape') {
      e.preventDefault();
      if (e.repeat) { return; }
      this.onAnyGesture();
      if (!this.shouldIgnore('pause')) { this.onPause(); }
      return;
    }
    if (code === 'KeyM') {
      if (e.repeat) { return; }
      this.onAnyGesture();
      if (!this.shouldIgnore('sound')) { this.onToggleSound(); }
    }
  };

  InputManager.prototype._onPointerDown = function (e) {
    if (!e) { return; }
    if (typeof e.button === 'number' && e.button > 0) { return; }
    var target = e.target;
    if (target && typeof target.closest === 'function' && target.closest(UI_SELECTOR)) { return; }
    // multi-touch: only the first finger flaps
    if (e.pointerType && e.pointerType !== 'mouse' && e.isPrimary === false) { return; }

    if (e.cancelable) { e.preventDefault(); }
    this.onAnyGesture();
    if (this.enabled && !this.shouldIgnore('flap')) { this.onFlap(); }
  };

  InputManager.UI_SELECTOR = UI_SELECTOR;
  return { InputManager: InputManager };
});
