import { CloudRain, Zap } from 'lucide-react';
import type { FreeBet, OpenRain } from '../../hooks/usePromos';

// One compact row, only when there is something to take: a rain drop to claim and/or free bets.
// A free bet stakes on panel 1 with a 2.00x auto cash-out (server-settled).
const FREE_BET_DEFAULT_AUTO = 2.0;

interface Props {
  freeBets: FreeBet[];
  rain: OpenRain | null;
  busy: boolean;
  canUseFreeBet: boolean;
  onClaimRain: (rainId: string) => void;
  onUseFreeBet: (freeBetId: string, auto: number) => void;
}

const k = (n: number) => Number(n).toLocaleString('en-KE', { maximumFractionDigits: 0 });

export default function PromoBar({ freeBets, rain, busy, canUseFreeBet, onClaimRain, onUseFreeBet }: Props) {
  if (!rain && freeBets.length === 0) return null;
  return (
    <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto scrollbar-thin">
      {rain && (
        <button onClick={() => onClaimRain(rain.id)} disabled={busy}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-g-info px-3.5 text-[13px] font-bold text-white disabled:opacity-60 active:scale-95">
          <CloudRain size={15} />Claim {k(rain.per_user)} KES
        </button>
      )}
      {freeBets.map((fb) => (
        <button key={fb.id} onClick={() => onUseFreeBet(fb.id, FREE_BET_DEFAULT_AUTO)} disabled={!canUseFreeBet || busy}
          aria-label={`Use free bet of ${k(fb.amount)} KES`}
          className="flex h-9 shrink-0 items-center gap-1 rounded-full border border-win/50 bg-win/10 px-3.5 text-[13px] font-bold text-g-money disabled:opacity-40 active:scale-95">
          <Zap size={13} className="fill-current" />Free {k(fb.amount)}
        </button>
      ))}
    </div>
  );
}
