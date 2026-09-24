import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wallet, Menu, X } from 'lucide-react';
import GameMenu from './GameMenu';
import type { Profile } from '../../types';
import NotificationBell from '../notifications/NotificationBell';
import { useSiteTheme } from '../../hooks/useSiteTheme';
import BirdMark from '../game/BirdMark';
import { useStreamerMode } from '../../hooks/useStreamerMode';
import { Radio } from 'lucide-react';

interface Props {
  profile: Profile | null;
  balance: number;
  onSignInOpen: () => void;
  onRegisterOpen: () => void;
  onWalletOpen: () => void;
  onSignOut: () => void;
}


// The global chrome carries ONE job per state:
//   signed-out -> a single dominant "Register" CTA (+ a quiet "Log in" link)
//   signed-in  -> balance, deposit, and the account menu
// The Real/Demo play-mode switch deliberately does NOT live here: it is a
// betting-context choice and now sits directly above the betting panel (see
// AviatorGame), which keeps this bar uncluttered and stops it overlapping the
// logo on narrow phones.
export default function Header({ profile, balance, onSignInOpen, onRegisterOpen, onWalletOpen, onSignOut }: Props) {
  const { planeSkin } = useSiteTheme();
  const streamer = useStreamerMode();
  const domain = typeof window !== 'undefined' ? window.location.hostname.replace(/^www\./, '') : '';
  const [menuOpen, setMenuOpen] = useState(false); // the ☰ game menu (all screen sizes, as in the mock)
  const [freeBets, setFreeBets] = useState(0);      // published by the game screen
  useEffect(() => {
    const on = (e: Event) => setFreeBets(Number((e as CustomEvent<number>).detail) || 0);
    window.addEventListener('aviator:freebets', on);
    return () => window.removeEventListener('aviator:freebets', on);
  }, []);
  const navigate = useNavigate();

  return (
    <header className="bg-night border-b border-edge px-3 sm:px-4 h-10 flex items-center justify-between gap-2 relative z-30 flex-shrink-0">
      {/* Logo — allowed to shrink (min-w-0) but never clipped by the right cluster */}
      <button
        onClick={() => navigate('/')}
        className="flex items-center gap-2 min-w-0 shrink"
        aria-label="Aviator home"
      >
        {streamer.enabled
          ? <BirdMark skin={planeSkin} width={34} className="-rotate-12 flex-shrink-0" />
          : <img src="/plane.png" alt="" aria-hidden="true" className="h-5 w-auto -rotate-12 drop-shadow-[0_0_8px_rgba(200,0,24,0.55)] flex-shrink-0" />}
        <span
          className="font-black italic text-xl tracking-tight truncate"
          style={{ color: '#e51e3c', fontFamily: '"Georgia", serif', textShadow: '0 0 12px rgba(229,30,60,0.45)' }}
        >
          {streamer.enabled ? domain : 'Aviator'}
        </span>
      </button>

      {/* Right side — never shrinks, so the CTA is always fully visible */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {profile ? (
          <>
            {/* Balance — always visible (incl. mobile) so players can watch it
                update live while they bet/cash out. Tapping opens the wallet.
                Compacts on phones to protect the logo from clipping. */}
            <button
              onClick={onWalletOpen}
              aria-label="Your balance. Tap to open your wallet."
              className="flex items-center gap-1 sm:gap-1.5 hover:opacity-90 transition"
            >
              <span className="text-slate-400 text-[10px] sm:text-xs font-semibold">KES</span>
              <span className="text-sm font-bold tabular-nums" style={{ color: '#28a745', textShadow: '0 0 8px rgba(40,167,69,0.35)' }}>
                {balance.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </button>

            {/* Streamer Mode toggle — marketers only. ON = broadcast-safe UI for going LIVE. */}
            {streamer.canToggle && (
              <button
                onClick={streamer.toggle}
                aria-label={streamer.enabled ? 'Streamer mode on — tap to show full UI' : 'Streamer mode off — tap to go live-safe'}
                title={streamer.enabled ? 'Live-safe UI ON' : 'Live-safe UI OFF'}
                className={'inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold transition-colors ' +
                  (streamer.enabled ? 'bg-red-600/20 text-red-400 border border-red-600/40' : 'bg-white/[0.06] text-slate-400 border border-transparent')}
              >
                <Radio size={12} className={streamer.enabled ? 'animate-pulse' : ''} />
                {streamer.enabled ? 'LIVE' : 'GO LIVE'}
              </button>
            )}

            {/* Deposit */}
            <button
              onClick={onWalletOpen}
              className="hidden sm:flex items-center gap-1 px-3 py-1.5 bg-win hover:bg-win-dark text-white rounded-md text-xs font-bold transition shadow-lg shadow-green-900/30"
            >
              <Wallet size={12} />
              Deposit
            </button>

            {/* Notifications bell (live) */}
            <NotificationBell />

</>
        ) : (
          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              onClick={onSignInOpen}
              className="px-2.5 sm:px-3 py-2 text-sm font-semibold text-slate-300 hover:text-white transition whitespace-nowrap rounded-lg"
            >
              Log in
            </button>
            <button
              onClick={onRegisterOpen}
              className="px-4 sm:px-5 py-2 bg-win hover:bg-win-dark text-white rounded-lg text-sm font-bold transition shadow-lg shadow-green-500/20 whitespace-nowrap active:scale-95"
            >
              Register
            </button>
          </div>
        )}
        <button
          onClick={() => setMenuOpen((v) => !v)}
          onMouseDown={(e) => e.stopPropagation()}
          className="-mr-1 p-1.5 text-[#9ea0a3] transition hover:text-white"
          aria-label="Game menu"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {menuOpen && (
        <GameMenu profile={profile} freeBetCount={freeBets} onClose={() => setMenuOpen(false)} onWalletOpen={onWalletOpen} onSignOut={onSignOut} />
      )}

    </header>
  );
}
