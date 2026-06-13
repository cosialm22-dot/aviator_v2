// ============================================================================
// Settings registry - the single source of truth for how each `system_settings`
// key is presented and edited. Every key in the DB is mapped to a typed control
// (toggle / number / select / text), a tab, a group, units, bounds, and help
// copy. Keys NOT listed here still render (see resolveField) under an "Advanced"
// group as a plain text field, so nothing is ever unmanageable - new settings
// surface automatically and degrade gracefully.
//
// This metadata is intentionally declarative and pure (no React) so the tabs and
// the field renderer share one contract and stay consistent.
// ============================================================================

export type FieldType = 'toggle' | 'number' | 'select' | 'text';
export type SettingsTabId = 'general' | 'game' | 'finance';

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  tab: SettingsTabId;
  group: string;
  help?: string;
  unit?: string;                 // e.g. 'KES', 'ms', '%'
  unitPos?: 'prefix' | 'suffix'; // KES is prefix; ms/% are suffix
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  distribution?: boolean;        // part of the crash-distribution group (sum must = 100)
}

// Ordered list. Tab + group order is derived from first appearance here.
export const FIELDS: FieldDef[] = [
  // ---- General -------------------------------------------------------------
  { key: 'system.maintenance_mode', label: 'Maintenance mode', type: 'toggle', tab: 'general', group: 'Availability',
    help: 'When enabled, players are blocked from the game while staff retain access.' },

  // ---- Game: round timing --------------------------------------------------
  { key: 'game.betting_ms', label: 'Betting window', type: 'number', tab: 'game', group: 'Round timing',
    unit: 'ms', unitPos: 'suffix', min: 1000, step: 500, help: 'How long players may place bets before take-off.' },
  { key: 'game.post_crash_ms', label: 'Post-crash pause', type: 'number', tab: 'game', group: 'Round timing',
    unit: 'ms', unitPos: 'suffix', min: 0, step: 500, help: 'Pause after a crash before the next round begins.' },

  // ---- Game: bet limits ----------------------------------------------------
  { key: 'game.min_bet', label: 'Minimum bet', type: 'number', tab: 'game', group: 'Bet limits',
    unit: 'KES', unitPos: 'prefix', min: 1, step: 1 },
  { key: 'game.max_bet', label: 'Maximum bet', type: 'number', tab: 'game', group: 'Bet limits',
    unit: 'KES', unitPos: 'prefix', min: 1, step: 1 },
  { key: 'game.max_payout', label: 'Per-bet payout cap', type: 'number', tab: 'game', group: 'Bet limits',
    unit: 'KES', unitPos: 'prefix', min: 0, step: 1000, help: 'Maximum payout a single bet can win.' },

  // ---- Game: RTP / house edge ---------------------------------------------
  { key: 'game.house_edge_percent', label: 'House edge', type: 'number', tab: 'game', group: 'House edge & RTP',
    unit: '%', unitPos: 'suffix', min: 0, max: 100, step: 0.1, help: 'Target RTP = 100 \u2212 this. Recommended band 18\u201320%.' },

  // ---- Game: crash distribution (sum must equal 100) -----------------------
  { key: 'game.instant_crash_pct', label: 'Instant (1.00x)', type: 'number', tab: 'game', group: 'Crash distribution',
    unit: '%', unitPos: 'suffix', min: 0, max: 100, step: 1, distribution: true },
  { key: 'game.low_crash_pct', label: 'Low (1.01\u20131.49x)', type: 'number', tab: 'game', group: 'Crash distribution',
    unit: '%', unitPos: 'suffix', min: 0, max: 100, step: 1, distribution: true },
  { key: 'game.mid_crash_pct', label: 'Mid (1.50\u20132.49x)', type: 'number', tab: 'game', group: 'Crash distribution',
    unit: '%', unitPos: 'suffix', min: 0, max: 100, step: 1, distribution: true },
  { key: 'game.high_crash_pct', label: 'High (2.50\u20136x)', type: 'number', tab: 'game', group: 'Crash distribution',
    unit: '%', unitPos: 'suffix', min: 0, max: 100, step: 1, distribution: true },
  { key: 'game.epic_crash_pct', label: 'Epic (6\u201320x)', type: 'number', tab: 'game', group: 'Crash distribution',
    unit: '%', unitPos: 'suffix', min: 0, max: 100, step: 1, distribution: true },
  { key: 'game.jackpot_crash_pct', label: 'Jackpot (20x+)', type: 'number', tab: 'game', group: 'Crash distribution',
    unit: '%', unitPos: 'suffix', min: 0, max: 100, step: 1, distribution: true },

  // ---- Game: crash engine --------------------------------------------------
  { key: 'game.crash_source', label: 'Crash source', type: 'select', tab: 'game', group: 'Crash engine',
    options: [{ value: 'algorithm', label: 'Algorithm (random)' }, { value: 'queue', label: 'Queue (pre-set)' }],
    help: 'Where crash points come from. Queue overrides the algorithm when items exist.' },
  { key: 'game.queue_enabled', label: 'Enable crash queue', type: 'toggle', tab: 'game', group: 'Crash engine',
    help: 'When on, queued crash points take priority over the algorithm.' },
  { key: 'game.growth_rate_per_ms', label: 'Growth rate (per ms)', type: 'number', tab: 'game', group: 'Crash engine',
    min: 0, step: 0.00001, help: 'Multiplier curve m(t)=exp(rate\u00b7ms). MUST match the client gameEngine.ts.' },
  { key: 'game.max_crash_point', label: 'Max crash point', type: 'number', tab: 'game', group: 'Crash engine',
    unit: 'x', unitPos: 'suffix', min: 1, step: 1, help: 'Upper bound on any generated crash multiplier.' },

  // ---- Game: bots ----------------------------------------------------------
  { key: 'game.bots_min', label: 'Minimum bots / round', type: 'number', tab: 'game', group: 'Simulated bots',
    min: 0, step: 1 },
  { key: 'game.bots_max', label: 'Maximum bots / round', type: 'number', tab: 'game', group: 'Simulated bots',
    min: 0, step: 1 },

  // ---- Finance -------------------------------------------------------------
  { key: 'finance.min_withdrawal', label: 'Minimum withdrawal', type: 'number', tab: 'finance', group: 'Withdrawals',
    unit: 'KES', unitPos: 'prefix', min: 0, step: 1 },
  { key: 'finance.auto_approve_threshold', label: 'Auto-approve threshold', type: 'number', tab: 'finance', group: 'Withdrawals',
    unit: 'KES', unitPos: 'prefix', min: 0, step: 100, help: 'Withdrawals below this amount are approved automatically.' },
];

const BY_KEY: Record<string, FieldDef> = Object.fromEntries(FIELDS.map(f => [f.key, f]));

// Map a DB setting category to a tab for keys not explicitly registered.
function categoryToTab(category: string): SettingsTabId {
  if (category === 'game') return 'game';
  if (category === 'finance') return 'finance';
  return 'general';
}

// Resolve a field definition for any key. Unregistered keys get a safe text
// editor under an "Advanced" group on the tab implied by their category.
export function resolveField(key: string, category: string): FieldDef {
  return BY_KEY[key] ?? {
    key,
    label: key,
    type: 'text',
    tab: categoryToTab(category),
    group: 'Advanced',
  };
}

export const DISTRIBUTION_KEYS = FIELDS.filter(f => f.distribution).map(f => f.key);

// Coerce an editor's working value into the JSON value persisted to jsonb.
export function serialize(type: FieldType, raw: string | boolean): string | number | boolean {
  if (type === 'toggle') return Boolean(raw);
  if (type === 'number') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  return String(raw);
}
