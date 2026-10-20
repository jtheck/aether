// Elo, K = 32. A missing player starts at 1000.
// Equal ratings move 16 points. Half-points round away from zero so a 1v1 stays zero-sum.

export const K = 32;
export const START_RATING = 1000;

export function expectedScore(rating, opponent) {
  return 1 / (1 + 10 ** ((opponent - rating) / 400));
}

export function roundDelta(value) {
  const sign = value < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(value));
}

/** Points added to `rating` for `score` (1 win, 0 loss) against `opponent`. */
export function ratingDelta(rating, opponent, score) {
  return roundDelta(K * (score - expectedScore(rating, opponent)));
}
