// Bet / cash-out failures are shown inside the action button for a moment, so they must be a
// couple of words. Maps the engines' messages (real and demo) to that form.
const SHORT: [RegExp, string][] = [
  [/sign in|AUTH_REQUIRED/i, 'Log in first'],
  [/operator|staff/i, 'Staff account'],
  [/betting is closed|BETTING_CLOSED|round not found/i, 'Betting closed'],
  [/already have a bet|ALREADY_BET/i, 'Already bet'],
  [/insufficient|INSUFFICIENT_BALANCE/i, 'Low balance'],
  [/allowed limits|BET_OUT_OF_RANGE/i, 'Outside limits'],
  [/auto-?cashout|INVALID_AUTO_CASHOUT/i, 'Min 1.01x'],
  [/too late|crashed|no longer active|not in flight|ROUND_CRASHED|BET_NOT_ACTIVE|ROUND_NOT_FLYING/i, 'Too late'],
  [/refresh|NO_WALLET|NO_PROFILE/i, 'Refresh page'],
];

export function shortBetError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e ?? '');
  for (const [re, s] of SHORT) if (re.test(m)) return s;
  return 'Try again';
}
