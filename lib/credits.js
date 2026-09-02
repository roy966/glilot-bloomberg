export const DEFAULT_DAILY_BUDGET = 20000;
export const CREDITS_PER_TWEET = 15;
export const CREDITS_FLOOR = 15;

export function creditsForCall(tweetCount) {
  const n = Math.max(0, Number(tweetCount) || 0);
  return Math.max(CREDITS_FLOOR, CREDITS_PER_TWEET * n);
}

export function dailyBudget(env = process.env) {
  const raw = env.TWITTER_DAILY_READ_BUDGET;
  if (raw == null || raw === "") return DEFAULT_DAILY_BUDGET;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_BUDGET;
}

export function utcDate(d = new Date()) {
  return new Date(d).toISOString().slice(0, 10);
}

export function rollCredits(state, now = new Date()) {
  const day = utcDate(now);
  const credits =
    state?.credits && state.credits.date === day
      ? { date: day, used: Number(state.credits.used) || 0 }
      : { date: day, used: 0 };
  return { ...state, credits };
}

export function wouldExceed(used, nextCallCost, budget) {
  return used + nextCallCost > budget;
}
