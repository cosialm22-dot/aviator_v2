import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, X, Plus, RotateCcw, Radio } from 'lucide-react';
import GameMenu from './GameMenu';
import type { Profile } from '../../types';
import { useSiteTheme } from '../../hooks/useSiteTheme';
import BirdMark from '../game/BirdMark';
import PlaneMark from '../brand/PlaneMark';
import { brandWordmark } from '../../brand/runtime';
import { useStreamerMode } from '../../hooks/useStreamerMode';
import { useNotifications } from '../../hooks/useNotifications';
import NotificationsSheet from '../notifications/NotificationsSheet';
import { useWinBalance } from '../../hooks/useWinBalance';

interface Props {
  profile: Profile | null;
  balance: number;
  mode: 'real' | 'demo';
  onSetMode: (m: 'real' | 'demo') => void;
  /** Demo play-money balance while the game is in Demo; null in Real. */
  demoBalance: number | null;
  onDemoReset: () => void;
  /** A deposit or withdrawal is being confirmed: the balance shows a spinner. */
  busy: 'deposit' | 'withdraw' | null;
  onSignInOpen: () => void;
  onRegisterOpen: () => void;
  onWalletOpen: () => void;
  onSignOut: () => void;
}

const kes = (n: number) => n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// One bar, one job per state. Signed out: Log in + Register. Signed in: the balance (tap = wallet,
// the + makes deposit obvious) and the menu. Unread notifications show as a dot on the menu.
export default function Header({ profile, balance, mode, onSetMode, demoBalance, onDemoReset, busy, onSignInOpen, onRegisterOpen, onWalletOpen, onSignOut }: Props) {
  const { birdId, brand } = useSiteTheme();
  const cfg = brand.config;
  const streamer = useStreamerMode();
  // The classic brand keeps its original red italic wordmark; every other brand writes its own
  // wordmark in its title face and accent colour.
  const classicMark = Object.keys(brand.theme_tokens ?? {}).length === 0;
  const word = brandWordmark(brand);
  const markMode = cfg['look.header_mark'];
  const domain = typeof window !== 'undefined' ? window.location.hostname.replace(/^www\./, '') : '';
  const [menuOpen, setMenuOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [freeBets, setFreeBets] = useState(0);      // published by the game screen
  useEffect(() => {
    const on = (e: Event) => setFreeBets(Number((e as CustomEvent<number>).detail) || 0);
    window.addEventListener('aviator:freebets', on);
    return () => window.removeEventListener('aviator:freebets', on);
  }, []);
  const notes = useNotifications(!!profile);
  const navigate = useNavigate();
  const dot = notes.unread > 0 || freeBets > 0;
  // Shown values count up (and wait for a win to fly in) instead of jumping.
  const shownBalance = useWinBalance(balance);
  const shownDemo = useWinBalance(demoBalance ?? 0);

  return (
    <header className="relative z-30 flex h-[calc(44px+env(safe-area-inset-top))] shrink-0 items-center justify-between gap-2 border-b border-g-line bg-g-bar px-2 pt-[env(safe-area-inset-top)] sm:px-3">
      <button onClick={() => navigate('/')} className="flex h-11 min-w-0 shrink items-center gap-1.5 pl-1" aria-label={`${word} home`} data-testid="brand-home">
        {streamer.enabled ? (
          <>
            <BirdMark skin={birdId} width={30} className="-rotate-12 shrink-0" />
            <span className="truncate font-title text-lg font-extrabold tracking-tight text-g-accent sm:text-xl">
              {cfg['stream.show_domain'] ? domain : word}
            </span>
          </>
        ) : markMode === 'logo' && brand.logo_url ? (
          <img src={brand.logo_url} alt={word} className="h-7 w-auto max-w-[160px] object-contain sm:h-8" data-testid="brand-logo" />
        ) : (
          <>
            {markMode === 'plane' && (
              <PlaneMark model={cfg['plane.model']} body={cfg['plane.body']} accent={cfg['plane.accent']} canopy={cfg['plane.canopy']} imageUrl={cfg['plane.image_url']}
                width={34} className="hidden -rotate-12 min-[380px]:inline-block sm:w-[40px]" />
            )}
            {classicMark
              ? <span className="truncate text-lg font-extrabold italic tracking-tight text-g-accent sm:text-xl" style={{ fontFamily: 'Georgia, serif' }}>{word}</span>
              : <span className="truncate font-title text-lg tracking-tight text-g-accent sm:text-xl" style={{ fontWeight: 'var(--heading-weight)' as unknown as number }} data-testid="brand-wordmark">{word}</span>}
          </>
        )}
      </button>

      <div className="flex shrink-0 items-center gap-1.5">
        {demoBalance != null ? (
          <div data-balance-target className="flex h-9 items-center gap-0.5 rounded-full bg-funmode/15 pl-3 pr-0.5 text-funmode" aria-label="Demo balance">
            <span className="text-sm font-bold tabular-nums">{Math.floor(shownDemo).toLocaleString('en-KE')}</span>
            <button onClick={onDemoReset} aria-label="Reset demo balance" className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/10"><RotateCcw size={14} /></button>
          </div>
        ) : profile ? (
          <button data-balance-target onClick={onWalletOpen} aria-label={`Balance KES ${kes(balance)}. Open wallet`}
            className="flex h-9 items-center gap-1.5 rounded-full bg-g-money-bg pl-3 pr-1 active:scale-95">
            <span className="text-sm font-bold tabular-nums text-g-money">{kes(shownBalance)}</span>
            {busy ? (
              <span role="status" aria-label={busy === 'deposit' ? 'Waiting for M-Pesa' : 'Processing withdrawal'} title={busy === 'deposit' ? 'Waiting for M-Pesa' : 'Processing withdrawal'}
                className="grid h-7 w-7 place-items-center"><span className="h-4 w-4 animate-spin rounded-full border-2 border-g-money border-t-transparent" /></span>
            ) : (
              <span className="grid h-7 w-7 place-items-center rounded-full bg-win text-g-cta-fg"><Plus size={16} strokeWidth={3} /></span>
            )}
          </button>
        ) : (
          <button onClick={onSignInOpen} className="h-9 whitespace-nowrap rounded-full px-3 text-sm font-semibold text-g-text hover:text-white">Log in</button>
        )}
        {!profile && cfg['features.registrations'] && (
          <button onClick={onRegisterOpen} className="h-9 whitespace-nowrap rounded-full bg-win px-3.5 text-sm font-bold text-g-cta-fg transition hover:bg-g-cta-hi active:scale-95">Register</button>
        )}

        {profile && streamer.canToggle && (
          <button onClick={streamer.toggle} aria-label={streamer.enabled ? 'Streamer mode on' : 'Streamer mode off'}
            className={`inline-flex h-9 items-center gap-1 rounded-full px-2.5 text-[11px] font-bold ${streamer.enabled ? 'bg-red-600/20 text-red-400' : 'bg-white/[0.06] text-slate-400'}`}>
            <Radio size={13} className={streamer.enabled ? 'animate-pulse' : ''} />{streamer.enabled ? 'LIVE' : 'GO LIVE'}
          </button>
        )}

        <button onClick={() => setMenuOpen((v) => !v)} onMouseDown={(e) => e.stopPropagation()}
          className="relative grid h-11 w-11 place-items-center text-g-mute transition hover:text-white"
          aria-label={dot ? 'Game menu, new items' : 'Game menu'} aria-haspopup="menu" aria-expanded={menuOpen}>
          {menuOpen ? <X size={22} /> : <Menu size={22} />}
          {dot && !menuOpen ? <span className="absolute right-2 top-2.5 h-2 w-2 rounded-full bg-danger" /> : null}
        </button>
      </div>

      {menuOpen && (
        <GameMenu profile={profile} freeBetCount={freeBets} unread={notes.unread}
          onClose={() => setMenuOpen(false)} onWalletOpen={onWalletOpen} onSignOut={onSignOut} onSignIn={onSignInOpen}
          mode={mode} onSetMode={onSetMode}
          onNotifications={() => setNotesOpen(true)} />
      )}
      {notesOpen && <NotificationsSheet {...notes} onClose={() => setNotesOpen(false)} />}
    </header>
  );
}
