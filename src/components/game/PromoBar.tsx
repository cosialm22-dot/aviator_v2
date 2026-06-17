import { Gift, CloudRain, Zap } from 'lucide-react';
import type { FreeBet, OpenRain } from '../../hooks/usePromos';

// Compact promotions strip shown above the betting panels in real-money mode:
// a claimable rain drop (if open) and the player's active free bets. Using a
// free bet stakes it on slot 1 at a default 2.00x auto-cashout (server-settled).
const FREE_BET_DEFAULT_AUTO = 2.0;

interface Props {
  freeBets: FreeBet[];
  rain: OpenRain | null;
  busy: boolean;
  canUseFreeBet: boolean;
  onClaimRain: (rainId: string) => void;
  onUseFreeBet: (freeBetId: string, auto: number) => void;
}

const ksh = (n: number) => `KSh ${Number(n).toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;

export default function PromoBar({ freeBets, rain, busy, canUseFreeBet, onClaimRain, onUseFreeBet }: Props) {
  if (!rain && freeBets.length === 0) return null;

  return (
    <div className="flex flex-shrink-0 flex-col gap-1.5 border-t border-edge bg-night px-3 py-2">
      {rain && (
        <button
          onClick={() => onClaimRain(rain.id)}
          disabled={busy}
          className="flex items-center justify-between gap-2 w-full rounded-lg px-3 py-2 bg-gradient-to-r from-[#1d4ed8] to-[#0ea5e9] text-white font-bold text-xs shadow-lg shadow-blue-900/40 disabled:opacity-60 active:scale-[0.99] transition"
        >
          <span className="flex items-center gap-1.5">
            <CloudRain size={14} />
            {rain.message?.trim() ? rain.message : 'Money rain is live!'}
          </span>
          <span className="flex items-center gap-1 bg-white/20 rounded-md px-2 py-0.5">
            Claim {ksh(rain.per_user)}
          </span>
        </button>
      )}

      {freeBets.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-thin">
          <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500 font-semibold flex-shrink-0">
            <Gift size={12} className="text-win" /> Free bets
          </span>
          {freeBets.map((fb) => (
            <button
              key={fb.id}
              onClick={() => onUseFreeBet(fb.id, FREE_BET_DEFAULT_AUTO)}
              disabled={!canUseFreeBet || busy}
              title={canUseFreeBet ? `Stake on slot 1 at ${FREE_BET_DEFAULT_AUTO.toFixed(2)}x` : 'Slot 1 is busy - cash out or clear it first'}
              className="flex items-center gap-1 flex-shrink-0 rounded-md px-2.5 py-1 bg-panel-raised border border-win/40 text-win text-[11px] font-bold hover:bg-win/10 disabled:opacity-40 disabled:cursor-not-allowed transition active:scale-95"
            >
              <Zap size={11} className="fill-current" />
              {ksh(fb.amount)} free
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
