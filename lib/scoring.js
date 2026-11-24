// Points for one answer. Always computed on the server from server timestamps:
// the client never sends a score or a response time.
//
// Default rules (same as the original QuizBlitz formula):
//   correct answer  : base 500 + speed bonus up to 500 (linear, full bonus at 0 ms, none at the buzzer)
//   streak bonus    : +100 per consecutive correct answer beyond the first, capped at +500
//   wrong / missing : 0 and the streak resets

const DEFAULT_SCORING = Object.freeze({ basePoints: 500, speedBonus: 500, streakStep: 100, streakCap: 500 });

function normaliseScoring(cfg = {}) {
  const int = (v, def, min, max) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  };
  return {
    basePoints: int(cfg.basePoints, DEFAULT_SCORING.basePoints, 0, 5000),
    speedBonus: int(cfg.speedBonus, DEFAULT_SCORING.speedBonus, 0, 5000),
    streakStep: int(cfg.streakStep, DEFAULT_SCORING.streakStep, 0, 1000),
    streakCap: int(cfg.streakCap, DEFAULT_SCORING.streakCap, 0, 5000),
  };
}

/** Base + speed points for a correct answer given `responseMs` out of `timeLimitMs`. */
function speedPoints(responseMs, timeLimitMs, cfg = DEFAULT_SCORING) {
  const limit = Math.max(1, Number(timeLimitMs) || 1);
  const ms = Number.isFinite(Number(responseMs)) ? Number(responseMs) : limit;
  const ratio = Math.min(1, Math.max(0, ms / limit));
  return Math.round(cfg.basePoints + cfg.speedBonus * (1 - ratio));
}

/** Streak bonus once the player's streak (including this answer) is `streak`. */
function streakBonus(streak, cfg = DEFAULT_SCORING) {
  return Math.min(Math.max(streak - 1, 0) * cfg.streakStep, cfg.streakCap);
}

module.exports = { DEFAULT_SCORING, normaliseScoring, speedPoints, streakBonus };
