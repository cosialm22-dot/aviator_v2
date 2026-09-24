import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Volume2, Star, History, Gauge, HelpCircle, MessageSquare, Home, UserCircle, LayoutDashboard, Wallet, LogOut } from 'lucide-react';
import type { Profile } from '../../types';
import { useSoundEnabled, setSoundEnabled } from '../../lib/sound';
import { openGamePanel } from '../../lib/gamePanels';

/**
 * The ☰ game menu from the owner's mock: player card, Sound, then Free Bets, My Bet History, Game
 * Limits, How To Play and Chat, the account links, and Home at the bottom. Only features the game
 * really has are listed (no Music or Animation switch, no "Provably Fair" page).
 */
export default function GameMenu({ profile, freeBetCount = 0, onClose, onWalletOpen, onSignOut }: {
  profile: Profile | null; freeBetCount?: number; onClose: () => void; onWalletOpen: () => void; onSignOut: () => void;
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

  const go = (fn: () => void) => () => { onClose(); fn(); };
  const Item = ({ icon: Icon, label, onClick, extra }: { icon: typeof Star; label: string; onClick: () => void; extra?: React.ReactNode }) => (
    <button type="button" role="menuitem" onClick={onClick}
      className="flex w-full items-center gap-3 border-b border-[#141516] px-4 py-3 text-left text-[14px] text-[#d7d7d7] transition hover:bg-[#2c2d30]">
      <Icon size={16} className="shrink-0 text-[#9ea0a3]" />
      <span className="flex-1">{label}</span>
      {extra}
    </button>
  );

  return (
    <div ref={ref} role="menu" aria-label="Game menu"
      className="absolute right-2 top-full z-50 mt-1 w-[320px] max-w-[calc(100vw-16px)] overflow-hidden rounded-xl border border-[#2a2b2e] bg-[#1b1c1d] shadow-2xl">
      {profile ? (
        <div className="flex items-center gap-3 bg-[#2c2d30] px-4 py-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-base font-bold text-white" style={{ backgroundColor: profile.avatar_color }}>
            {profile.username[0]?.toUpperCase()}
          </span>
          <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-white">{profile.username}</span>
          <button type="button" onClick={go(() => navigate('/profile'))}
            className="flex items-center gap-1.5 rounded-full border border-[#5c5d60] px-3 py-1.5 text-[12px] text-[#d7d7d7] hover:text-white">
            <UserCircle size={14} />Change Avatar
          </button>
        </div>
      ) : null}

      <div className="flex items-center gap-3 border-b border-[#141516] px-4 py-3 text-[14px] text-[#d7d7d7]">
        <Volume2 size={16} className="text-[#9ea0a3]" />
        <span className="flex-1">Sound</span>
        <button type="button" role="switch" aria-checked={sound} aria-label="Sound" onClick={() => setSoundEnabled(!sound)}
          className={`relative h-5 w-9 rounded-full transition ${sound ? 'bg-[#28a909]' : 'bg-[#3a3b3e]'}`}>
          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${sound ? 'left-[18px]' : 'left-0.5'}`} />
        </button>
      </div>

      <div className="h-2 bg-[#141516]" />
      {profile ? <Item icon={Star} label="Free Bets" onClick={go(() => openGamePanel('freebets'))}
        extra={freeBetCount > 0 ? <span className="rounded-full bg-[#28a909] px-2 py-0.5 text-[11px] font-bold text-white">{freeBetCount}</span> : null} /> : null}
      {profile ? <Item icon={History} label="My Bet History" onClick={go(() => openGamePanel('history'))} /> : null}
      <Item icon={Gauge} label="Game Limits" onClick={go(() => openGamePanel('limits'))} />
      <Item icon={HelpCircle} label="How To Play" onClick={go(() => openGamePanel('howto'))} />
      <Item icon={MessageSquare} label="Chat" onClick={go(() => openGamePanel('chat'))} />

      {profile ? (
        <>
          <div className="h-2 bg-[#141516]" />
          <Item icon={Wallet} label="Deposit" onClick={go(onWalletOpen)} />
          <Item icon={UserCircle} label="My Profile" onClick={go(() => navigate('/profile'))} />
          {profile.role === 'marketer' ? <Item icon={LayoutDashboard} label="Marketer Hub" onClick={go(() => navigate('/marketer'))} /> : null}
          <Item icon={LogOut} label="Sign Out" onClick={go(onSignOut)} />
        </>
      ) : null}

      <button type="button" role="menuitem" onClick={go(() => navigate('/'))}
        className="flex w-full items-center justify-center gap-2 bg-[#2c2d30] py-2.5 text-[13px] text-[#9ea0a3] hover:text-white">
        <Home size={14} />Home
      </button>
    </div>
  );
}
