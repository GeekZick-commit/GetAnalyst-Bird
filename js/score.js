/* ==========================================================================
   score.js — ScoreManager: score, combo multiplier, per-run statistics and
   the difficulty targets that grow with the score.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  var api = factory(
    (typeof module === 'object' && module.exports) ? require('./config.js') : (root.GA || {})
  );
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  if (root) { root.GA = root.GA || {}; Object.assign(root.GA, api); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Config) {
  'use strict';

  var COMBO = Config.COMBO;
  var OBSTACLE = Config.OBSTACLE;
  var DIFFICULTY = Config.DIFFICULTY;

  function multiplierFor(comboCount) {
    var mult = 1;
    for (var i = 0; i < COMBO.steps.length; i++) {
      if (comboCount >= COMBO.steps[i].count) { mult = COMBO.steps[i].multiplier; }
    }
    return mult;
  }

  /** Target difficulty values for a given score (game smooths them over time). */
  function difficultyForScore(score) {
    var i, stage = DIFFICULTY[0], next = null;
    for (i = 0; i < DIFFICULTY.length; i++) {
      if (score >= DIFFICULTY[i].minScore) { stage = DIFFICULTY[i]; next = DIFFICULTY[i + 1] || null; }
    }
    return {
      level: stage.level,
      stage: stage,
      next: next,
      // how far we already are towards the next stage (0..1) — used to blend smoothly
      progress: next ? Math.max(0, Math.min(1, (score - stage.minScore) / (next.minScore - stage.minScore))) : 1
    };
  }

  function ScoreManager(options) {
    options = options || {};
    this.best = options.best || 0;
    this.reset();
  }

  ScoreManager.prototype.reset = function () {
    this.score = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.multiplier = 1;
    this.obstaclesPassed = 0;
    this.distance = 0;
    this.wormCounts = { green: 0, blue: 0, purple: 0, gold: 0, red: 0 };
    this.totalWorms = 0;
    this.healthyWorms = 0;
    this.redWorms = 0;
    this.pointsFromWorms = 0;
    this.pointsFromObstacles = 0;
    this.hits = 0;
    this.comboEvents = [];
  };

  ScoreManager.prototype.addPoints = function (amount) {
    var next = this.score + amount;
    this.score = next < 0 ? 0 : Math.round(next);
    return this.score;
  };

  /**
   * Collects a worm.
   * Healthy worms raise the combo and are multiplied; red worms subtract a flat
   * penalty and break the combo.
   */
  ScoreManager.prototype.collectWorm = function (type) {
    var before = this.multiplier;
    var result = {
      type: type.id,
      base: type.score,
      points: 0,
      multiplier: this.multiplier,
      combo: this.combo,
      healthy: !!type.healthy,
      multiplierUp: false,
      blockedByZero: false
    };

    this.wormCounts[type.id] = (this.wormCounts[type.id] || 0) + 1;
    this.totalWorms += 1;

    if (type.healthy) {
      this.healthyWorms += 1;
      this.combo += 1;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      this.multiplier = multiplierFor(this.combo);
      var gained = type.score * this.multiplier;
      var beforeScore = this.score;
      this.addPoints(gained);
      this.pointsFromWorms += this.score - beforeScore;
      result.points = gained;
      result.multiplier = this.multiplier;
      result.combo = this.combo;
      result.multiplierUp = this.multiplier > before;
      if (result.multiplierUp) { this.comboEvents.push(this.multiplier); }
    } else {
      this.redWorms += 1;
      var priorScore = this.score;
      this.addPoints(type.score); // flat penalty, never below zero
      this.pointsFromWorms += this.score - priorScore;
      result.points = type.score;
      result.blockedByZero = priorScore <= 0;
      this.breakCombo();
      result.combo = this.combo;
      result.multiplier = this.multiplier;
    }
    return result;
  };

  ScoreManager.prototype.passObstacle = function () {
    this.obstaclesPassed += 1;
    this.addPoints(OBSTACLE.passBonus);
    this.pointsFromObstacles += OBSTACLE.passBonus;
    return OBSTACLE.passBonus;
  };

  ScoreManager.prototype.breakCombo = function () {
    var had = this.combo;
    this.combo = 0;
    this.multiplier = 1;
    return had;
  };

  ScoreManager.prototype.registerHit = function () {
    this.hits += 1;
    return this.breakCombo();
  };

  ScoreManager.prototype.addDistance = function (px) {
    if (isFinite(px) && px > 0) { this.distance += px; }
    return this.distance;
  };

  ScoreManager.prototype.getDistanceMeters = function () {
    return Math.floor(this.distance / 42);
  };

  ScoreManager.prototype.difficulty = function () {
    return difficultyForScore(this.score);
  };

  ScoreManager.prototype.snapshot = function () {
    return {
      score: this.score,
      combo: this.combo,
      bestCombo: this.bestCombo,
      multiplier: this.multiplier,
      obstaclesPassed: this.obstaclesPassed,
      worms: this.totalWorms,
      healthyWorms: this.healthyWorms,
      redWorms: this.redWorms,
      distanceMeters: this.getDistanceMeters()
    };
  };

  return {
    ScoreManager: ScoreManager,
    multiplierFor: multiplierFor,
    difficultyForScore: difficultyForScore
  };
});
