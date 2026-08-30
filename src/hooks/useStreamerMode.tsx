import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

// ============================================================================
// Streamer Mode — a per-user, broadcast-safe render of the game so a marketer
// going LIVE on TikTok (or any platform that flags real-money gambling) shows a
// clean "bird flying up a curve" arcade view with NO gambling tells, while
// regular players keep the full UI at the same time (two UIs, one deployment).
//
// Why marketers specifically: a marketer plays with NON-WITHDRAWABLE demo_balance
// (see fn_is_marketer_account -> _wallet_move 'demo'), so betting on camera risks
// no real money; their real earnings are commissions withdrawn via the Marketer
// hub. Streamer Mode strips the visual gambling signals TikTok's vision/OCR
// classifiers flag (see the risk assessment): plane->bird, no "bet"/"cash out"
// wording, no "x" on the multiplier, no crash text, no live-bets wall, no chat,
// no promos/branding wordmark. Money figures + deposit/withdraw stay (client
// choice), and the header shows the site's own domain (never the "Aviator" word).
//
// Default: ON for role='marketer' (their primary purpose is streaming), with a
// header toggle so a marketer can flip to the full UI when not live. Persisted
// per-browser in localStorage. Players never see the toggle and are unaffected.
// ============================================================================

interface StreamerCtx {
  enabled: boolean;      // is the broadcast-safe render active
  canToggle: boolean;    // only marketers may toggle
  toggle: () => void;
}

const Ctx = createContext<StreamerCtx>({ enabled: false, canToggle: false, toggle: () => {} });

const LS_KEY = 'aviator_streamer_mode';

export function StreamerModeProvider({ role, children }: { role: string | null | undefined; children: ReactNode }) {
  const isMarketer = role === 'marketer';
  // Per-browser override: null = follow the role default (marketers => on).
  const [override, setOverride] = useState<boolean | null>(() => {
    try { const v = localStorage.getItem(LS_KEY); return v == null ? null : v === '1'; } catch { return null; }
  });
  const enabled = isMarketer ? (override ?? true) : false;   // players: always off
  const toggle = useCallback(() => {
    setOverride((prev) => {
      const cur = prev ?? true;
      const next = !cur;
      try { localStorage.setItem(LS_KEY, next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  }, []);
  return <Ctx.Provider value={{ enabled, canToggle: isMarketer, toggle }}>{children}</Ctx.Provider>;
}

export function useStreamerMode(): StreamerCtx {
  return useContext(Ctx);
}
