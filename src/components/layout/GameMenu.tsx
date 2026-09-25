import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Volume2, Star, History, HelpCircle, MessageSquare, LayoutDashboard, Wallet, LogOut, LogIn, Bell, ChevronRight } from 'lucide-react';
import type { Profile } from '../../types';
import { useSoundEnabled, setSoundEnabled } from '../../lib/sound';
import { openGamePanel, type GamePanel } from '../../lib/gamePanels';

/** The ☰ menu: only things the game really has, one word each where possible. */
export default function GameMenu({ profile, freeBetCount = 0, unread = 0, onClose, onWalletOpen, onSignOut, onSignIn, onNotifications, mode, onSetMode }: {
  mode: 'real' | 'demo'; onSetMode: (m: 'real' | 'demo') => void;
  profile: Profile | null; freeBetCount?: number; unread?: number; onClose: () => void;
  onWalletOpen: () => void; onSignOut: () => void; onSignIn: () => void; onNotifications: () => void;
}) {
  const navigate = useNavigate();
  const sound = useSoundEnabled();
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [onClose]);

  const { pathname } = useLocation();
  const go = (fn: () => void) => () => { onClose(); fn(); };
  // Panels live on the game screen: from any other page, go there first.
  const panel = (p: GamePanel) => go(() => {
    if (pathname === '/') { openGamePanel(p); return; }
    navigate('/');
    setTimeout(() => openGamePanel(p), 120);
  });
  const badge = (n: number) => (n > 0 ? <span className="min-w-[20px] rounded-full bg-danger px-1.5 py-0.5 text-center text-[11px] font-bold text-white">{n > 9 ? '9+' : n}</span> : null);
  const Item = ({ icon: Icon, label, onClick, extra }: { icon: typeof Star; label: string; onClick: () => void; extra?: React.ReactNode }) => (
    <button type="button" role="menuitem" onClick={onClick}
      className="flex h-12 w-full items-center gap-3 px-4 text-left text-[15px] text-[#d7d7d7] transition hover:bg-[#2c2d30] active:bg-[#2c2d30]">
      <Icon size={18} className="shrink-0 text-[#9ea0a3]" />
      <span className="flex-1">{label}</span>
      {extra}
    </button>
  );

  return (
    <div ref={ref} role="menu" aria-label="Game menu"
      className="absolute right-2 top-full z-50 mt-1 max-h-[calc(100dvh-60px)] w-[300px] max-w-[calc(100vw-16px)] overflow-y-auto rounded-xl border border-[#2a2b2e] bg-[#1b1c1d] py-1 shadow-2xl">
      {profile ? (
        <button type="button" role="menuitem" onClick={go(() => navigate('/profile'))}
          className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-[#2c2d30]">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold text-white" style={{ backgroundColor: profile.avatar_color }}>
            {profile.username[0]?.toUpperCase()}
          </span>
          <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-white">{profile.username}</span>
          <ChevronRight size={16} className="text-[#7b7b7b]" />
        </button>
      ) : null}

      {/* Real / Demo: picking one closes the menu so the game is in view */}
      <div className="px-3 pb-1 pt-2">
        <div className="grid grid-cols-2 rounded-full bg-[#141516] p-1" role="group" aria-label="Play mode">
          {(['real', 'demo'] as const).map((m) => (
            <button key={m} type="button" role="menuitemradio" aria-checked={mode === m}
              onClick={go(() => onSetMode(m))}
              className={`h-10 rounded-full text-sm font-bold transition ${mode === m ? (m === 'demo' ? 'bg-funmode text-white' : 'bg-win text-white') : 'text-[#9ea0a3] hover:text-white'}`}>
              {m === 'real' ? 'Real' : 'Demo'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex h-12 items-center gap-3 px-4 text-[15px] text-[#d7d7d7]">
        <Volume2 size={18} className="text-[#9ea0a3]" />
        <span className="flex-1">Sound</span>
        <button type="button" role="switch" aria-checked={sound} aria-label="Sound" onClick={() => setSoundEnabled(!sound)}
          className={`relative h-6 w-11 rounded-full transition ${sound ? 'bg-[#28a909]' : 'bg-[#3a3b3e]'}`}>
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${sound ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
      </div>

      <div className="my-1 h-px bg-[#2a2b2e]" />
      {profile ? <Item icon={Bell} label="Notifications" onClick={go(onNotifications)} extra={badge(unread)} /> : null}
      {profile ? <Item icon={Star} label="Free bets" onClick={panel('freebets')} extra={badge(freeBetCount)} /> : null}
      {profile ? <Item icon={History} label="My bets" onClick={panel('history')} /> : null}
      <Item icon={HelpCircle} label="Rules" onClick={panel('rules')} />
      <Item icon={MessageSquare} label="Chat" onClick={panel('chat')} />

      <div className="my-1 h-px bg-[#2a2b2e]" />
      {profile ? (
        <>
          <Item icon={Wallet} label="Wallet" onClick={go(onWalletOpen)} />
          {profile.role === 'marketer' ? <Item icon={LayoutDashboard} label="Marketer hub" onClick={go(() => navigate('/marketer'))} /> : null}
          <Item icon={LogOut} label="Log out" onClick={go(onSignOut)} />
        </>
      ) : <Item icon={LogIn} label="Log in" onClick={go(onSignIn)} />}
    </div>
  );
}
