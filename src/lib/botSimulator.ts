import type { BotPlayer } from '../types';

// 100+ realistic gamer-style names that look authentic to real crash games
const NAMES = [
  // Kenyan flavoured
  'pilot_guru', 'joseXX', 'king_aviator', 'cash_ninja', 'risk_taker254',
  'flyboy_ke', 'jet_daddy', 'sky_boss', 'turbo_wanjiku', 'million_mode',
  'early_bird', 'crash_hunter', 'big_risk', 'quick_hands', 'wanjiku_pro',
  'kamau_bets', 'odhiambo_x', 'akinyi99', 'kariuki_fx', 'muthoni_wins',
  'otieno_fly', 'wambui_cash', 'njoroge77', 'adhiambo_g', 'kiprotich_k',
  'chebet_ace', 'mutua_big', 'ndungu_x', 'awuor88', 'gitau_bet',
  'wairimu_w', 'kipchoge_7', 'cherono_99', 'wafula_pro', 'bossman_ke',
  'nairobiflyer', 'mombasaace', 'nakuru_king', 'eldoret_fx', 'thika_pilot',
  // International / gamer style
  'luckydude99', 'highroller_x', 'moonshot_g', 'fearlessbettor', 'godfrey_x',
  'double_up7', 'papiChulo22', 'rico_suave', 'darkwing_bet', 'sonic_cashout',
  'hyperspeed', 'jokerbet77', 'ghostrider_9', 'blazing_5x', 'alpha_bet',
  'xXxtreme', 'bet_machine', 'predator_x', 'legend_fly', 'money_glitch',
  'stonks_up', 'yolo_bet', 'turbopilot', 'crashproof', 'neverlose99',
  'diamond_hands', 'moon_chaser', 'rocket_man7', 'fastcash88', 'bigbet_boss',
  'jose_aviator', 'el_capitano', 'papi_fly', 'rico_bet', 'diego_x99',
  'mario_wins', 'carlos_fx', 'joseXXX', 'pablito_b', 'ramiro99',
  'ericsson_k', 'maxpower_9', 'viktorr', 'stefano88', 'lukash_bet',
  'vlad_flies', 'ivan_crash', 'andrei_x', 'borris_bet', 'mika_wins',
  // Wild / unique
  'KSH_killer', 'tenplex_man', 'fifty50x', 'go_big_bro', 'nonstop_fly',
  'fearnocrash', 'allin_mode', 'last_second', 'clutch_king', 'timing_god',
  'never2late', 'onemorebet', 'addicted_w', 'justone_more', 'cant_stop_x',
  'sensei_bet', 'pilot_zero', 'skyman77', 'ace_of_bets', 'the_gambler',
  'foxyrider', 'sneaky_cash', 'shadow_fly', 'silentwin', 'ghostcash',
  'anon_player', 'mystery_x', 'unknownpro', 'player_zero', 'no_name_bet',
  'ultra_bet', 'mega_risk', 'super_fly99', 'hyper_cash', 'turbo_mode',
  'speed_demon', 'flash_bet', 'blitz_win', 'thunder_fly', 'storm_cash',
  'dragon_bet', 'phoenix_x', 'lion_king_k', 'eagle_fly', 'hawk_cash',
  'leopard99', 'cheetah_bet', 'viper_x', 'cobra_cash', 'mamba_wins',
];

const AVATAR_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4',
  '#3b82f6', '#a855f7', '#ec4899', '#14b8a6', '#f59e0b',
  '#84cc16', '#0ea5e9', '#d946ef', '#fb923c', '#4ade80',
];

function randomBetAmount(): number {
  // KShs amounts — min 50
  const amounts = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
  const weights = [20, 25, 20, 15, 10,  5,    4,    1  ];
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < amounts.length; i++) {
    r -= weights[i];
    if (r <= 0) return amounts[i];
  }
  return 100;
}

function randomCashoutMultiplier(): number | null {
  const r = Math.random();
  // 10% lose (no cashout) — visible losses build sympathy not fear
  if (r < 0.10) return null;
  // 28% cash out 1.2x–1.6x — "safe" bots that always win small
  if (r < 0.38) return 1.20 + Math.random() * 0.40;
  // 30% cash out 1.6x–2.2x — the majority, reinforces "2x is easy" belief
  if (r < 0.68) return 1.60 + Math.random() * 0.60;
  // 16% cash out 2.2x–4x — moderate wins that look great in the bets table
  if (r < 0.84) return 2.20 + Math.random() * 1.80;
  // 10% cash out 4x–12x — exciting wins, bets table lights up green
  if (r < 0.94) return 4.0  + Math.random() * 8.0;
  // 6% hold for 12x–40x — rare whales that generate table FOMO
  return 12.0 + Math.random() * 28.0;
}

function pickName(used: Set<string>): string {
  // Shuffle and try unique name; append random suffix for infinite variety
  const shuffled = [...NAMES].sort(() => Math.random() - 0.5);
  for (const base of shuffled) {
    if (!used.has(base)) { used.add(base); return base; }
  }
  // All 100+ taken — append number
  const base = NAMES[Math.floor(Math.random() * NAMES.length)];
  const n = `${base}_${Math.floor(Math.random() * 999)}`;
  used.add(n);
  return n;
}

export function generateBots(crashPoint: number): BotPlayer[] {
  // 60–100 bots per round for a busy, realistic lobby
  const count = 60 + Math.floor(Math.random() * 41);
  const used = new Set<string>();
  const bots: BotPlayer[] = [];

  for (let i = 0; i < count; i++) {
    const desired = randomCashoutMultiplier();
    const cashoutAt = desired === null
      ? null
      : desired >= crashPoint
        ? null
        : Math.floor(desired * 100) / 100;

    bots.push({
      id: `bot-${i}-${Date.now()}`,
      username: pickName(used),
      avatar_color: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
      betAmount: randomBetAmount(),
      cashoutAt,
      hasBet: false,
      hasCashedOut: false,
    });
  }

  return bots;
}
