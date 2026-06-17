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
//
// IMPORTANT: only keys the engine actually consumes live here. Dead/duplicated
// controls (the analytics-only crash-distribution bands, the `crash_source`
// select that duplicated `queue_enabled`, and `growth_rate_per_ms` - a protocol
// constant hardcoded in the client + server curve functions) were removed so the
// page can never present a control that does nothing.
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
}

// Ordered list. Tab + group order is derived from first appearance here.
export const FIELDS: FieldDef[] = [
  // ---- General -------------------------------------------------------------
  { key: 'system.maintenance_mode', label: 'Maintenance mode', type: 'toggle', tab: 'general', group: 'Availability',
    help: 'When enabled, players are blocked from placing bets (in-flight bets still settle); staff retain access.' },

  // ---- Game: round timing --------------------------------------------------
  { key: 'game.betting_ms', label: 'Betting window', type: 'number', tab: 'game', group: 'Round timing',
    unit: 'ms', unitPos: 'suffix', min: 1000, step: 500, help: 'How long players may place bets before take-off.' },
  { key: 'game.post_crash_ms', label: 'Post-crash pause', type: 'number', tab: 'game', group: 'Round timing',
    unit: 'ms', unitPos: 'suffix', min: 0, step: 500, help: 'Pause after a crash before the next round begins.' },

  // ---- Game: bet limits ----------------------------------------------------
  { key: 'game.min_bet', label: 'Minimum bet', type: 'number', tab: 'game', group: 'Bet limits',
    unit: 'KES', unitPos: 'prefix', min: 1, step: 1, help: 'Must be <= the maximum bet.' },
  { key: 'game.max_bet', label: 'Maximum bet', type: 'number', tab: 'game', group: 'Bet limits',
    unit: 'KES', unitPos: 'prefix', min: 1, step: 1, help: 'Must be >= the minimum bet.' },
  { key: 'game.max_payout', label: 'Per-bet payout cap', type: 'number', tab: 'game', group: 'Bet limits',
    unit: 'KES', unitPos: 'prefix', min: 0, step: 1000, help: 'Maximum payout a single bet can win.' },

  // ---- Game: RTP / house edge ---------------------------------------------
  // The crash engine is PARAMETRIC: P(crash >= x) = (1 - edge)/x, so this single
  // lever sets the whole crash-point distribution AND the target RTP. There is
  // deliberately no editable "distribution band" group - the bands were unused by
  // the engine and only invited inconsistent (non-100%) configs.
  { key: 'game.house_edge_percent', label: 'House edge', type: 'number', tab: 'game', group: 'House edge & RTP',
    unit: '%', unitPos: 'suffix', min: 0, max: 40, step: 0.1,
    help: 'Sets RTP (= 100 minus this) and the entire crash-point distribution. Recommended band 18-20%.' },

  // ---- Game: crash engine --------------------------------------------------
  // `queue_enabled` is the single source of truth for whether pre-set crash points
  // override the parametric algorithm.
  { key: 'game.queue_enabled', label: 'Use preset crash queue', type: 'toggle', tab: 'game', group: 'Crash engine',
    help: 'When on, queued crash points take priority over the random algorithm.' },
  { key: 'game.max_crash_point', label: 'Max crash point', type: 'number', tab: 'game', group: 'Crash engine',
    unit: 'x', unitPos: 'suffix', min: 1, step: 1, help: 'Upper bound on any generated crash multiplier.' },

  // ---- Game: bots ----------------------------------------------------------
  { key: 'game.bots_min', label: 'Minimum bots / round', type: 'number', tab: 'game', group: 'Simulated bots',
    min: 0, step: 1, help: 'Must be <= the maximum.' },
  { key: 'game.bots_max', label: 'Maximum bots / round', type: 'number', tab: 'game', group: 'Simulated bots',
    min: 0, step: 1, help: 'Must be >= the minimum.' },

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

// Coerce an editor's working value into the JSON value persisted to jsonb.
export function serialize(type: FieldType, raw: string | boolean): string | number | boolean {
  if (type === 'toggle') return Boolean(raw);
  if (type === 'number') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  return String(raw);
}
