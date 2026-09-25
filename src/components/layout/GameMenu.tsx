import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Star, History, HelpCircle, MessageSquare, LayoutDashboard, Wallet, LogOut, LogIn, Bell, ChevronRight, Phone, Send, Mail, FileText, ShieldCheck, HeartHandshake } from 'lucide-react';
import { useBrand } from '../../brand/useBrand';
import type { Profile } from '../../types';
import { useSoundEnabled, setSoundEnabled } from '../../lib/sound';
import { openGamePanel, type GamePanel } from '../../lib/gamePanels';
import { Switch } from '../ui/ios';

/**
 * The ☰ menu, drawn like an iOS menu: a blurred material card, 44 pt rows with the label on the
 * left and the symbol on the right, groups split by a thick gap. Real / Demo is a segmented
 * control at the top; picking one closes the menu so the game is in view.
 */
export default function GameMenu({ profile, freeBetCount = 0, unread = 0, onClose, onWalletOpen, onSignOut, onSignIn, onNotifications, mode, onSetMode }: {
  mode: 'real' | 'demo'; onSetMode: (m: 'real' | 'demo') => void;
  profile: Profile | null; freeBetCount?: number; unread?: number; onClose: () => void;
  onWalletOpen: () => void; onSignOut: () => void; onSignIn: () => void; onNotifications: () => void;
}) {
  const navigate = useNavigate();
  const sound = useSoundEnabled();
  const brand = useBrand();
  const b = brand.config;
  const wa = b['support.whatsapp'] ? `https://wa.me/${b['support.whatsapp'].replace(/[^0-9]/g, '')}` : null;
  const support = [
    wa ? { icon: MessageSquare, label: 'WhatsApp', href: wa } : null,
    b['support.telegram'] ? { icon: Send, label: 'Telegram', href: b['support.telegram'] } : null,
    b['support.phone'] ? { icon: Phone, label: 'Call', href: `tel:${b['support.phone']}` } : null,
    brand.support_email ? { icon: Mail, label: 'Email', href: `mailto:${brand.support_email}` } : null,
  ].filter(Boolean) as { icon: typeof Star; label: string; href: string }[];
  const legal = [
    b['legal.terms'] ? { icon: FileText, label: 'Terms', to: '/legal/terms' } : null,
    b['legal.privacy'] ? { icon: ShieldCheck, label: 'Privacy', to: '/legal/privacy' } : null,
    b['legal.responsible'] ? { icon: HeartHandshake, label: 'Responsible gaming', to: '/legal/responsible' } : null,
  ].filter(Boolean) as { icon: typeof Star; label: string; to: string }[];
  const socials = (['facebook', 'instagram', 'tiktok', 'x', 'youtube'] as const)
    .map((k) => ({ k, href: b[`social.${k}` as const] as string | null })).filter((x) => !!x.href);
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
  const badge = (n: number) => (n > 0 ? <span className="min-w-[22px] rounded-full bg-ios-red px-1.5 text-center text-footnote font-semibold leading-[22px] text-white">{n > 9 ? '9+' : n}</span> : null);
  const Item = ({ icon: Icon, label, onClick, extra, destructive }: { icon: typeof Star; label: string; onClick: () => void; extra?: React.ReactNode; destructive?: boolean }) => (
    <button type="button" role="menuitem" onClick={onClick}
      className={`relative flex h-11 w-full items-center gap-3 px-4 text-left text-body transition-colors active:bg-white/10 after:absolute after:bottom-0 after:left-4 after:right-0 after:h-px after:origin-bottom after:scale-y-50 after:bg-ios-sep last:after:hidden ${destructive ? 'text-ios-red' : 'text-white'}`}>
      <span className="flex-1 truncate">{label}</span>
      {extra}
      <Icon size={19} strokeWidth={1.9} className="shrink-0" />
    </button>
  );
  const Gap = () => <div aria-hidden className="h-2 bg-black/30" />;

  return (
    <div ref={ref} role="menu" aria-label="Game menu"
      className="absolute right-2 top-full z-50 mt-1.5 max-h-[calc(100dvh-64px)] w-[280px] max-w-[calc(100vw-16px)] origin-top-right animate-[menuIn_0.2s_cubic-bezier(0.32,0.72,0,1)] overflow-y-auto overscroll-contain rounded-[14px] bg-[rgba(37,37,38,0.88)] shadow-[0_12px_40px_rgba(0,0,0,0.55)] ring-1 ring-white/[0.07] backdrop-blur-2xl backdrop-saturate-150">
      {b['features.demo'] ? (<><div className="p-2.5">
        <div className="relative grid h-8 grid-cols-2 rounded-[9px] bg-ios-fill p-[2px]" role="group" aria-label="Play mode">
          <span aria-hidden style={{ left: 2 }}
            className={`absolute bottom-[2px] top-[2px] w-[calc(50%-2px)] rounded-[7px] shadow-[0_3px_8px_rgba(0,0,0,0.12)] transition-[transform,background-color] duration-200 ease-ios ${mode === 'demo' ? 'translate-x-full bg-funmode' : 'bg-ios-cta'}`} />
          {(['real', 'demo'] as const).map((m) => (
            <button key={m} type="button" role="menuitemradio" aria-checked={mode === m} onClick={go(() => onSetMode(m))}
              className={`relative z-10 text-footnote font-semibold ${mode === m ? (m === 'real' ? 'text-ios-cta-fg' : 'text-white') : 'text-ios-label2'}`}>
              {m === 'real' ? 'Real' : 'Demo'}
            </button>
          ))}
        </div>
      </div>
      <Gap /></>) : null}

      {profile ? (
        <>
          <button type="button" role="menuitem" onClick={go(() => navigate('/profile'))} className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-white/10">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-headline text-white" style={{ backgroundColor: profile.avatar_color }}>
              {profile.username[0]?.toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-headline text-white">{profile.username}</span>
              <span className="block text-footnote text-ios-label2">Profile</span>
            </span>
            <ChevronRight size={18} strokeWidth={2.5} className="text-ios-label3" />
          </button>
          <Gap />
        </>
      ) : null}

      <div className="flex h-11 items-center gap-3 pl-4 pr-3 text-body text-white">
        <span className="flex-1">Sound</span>
        <Switch checked={sound} onChange={setSoundEnabled} label="Sound" />
      </div>
      <Gap />

      <div>
        {profile ? <Item icon={Bell} label="Notifications" onClick={go(onNotifications)} extra={badge(unread)} /> : null}
        {profile && b['features.free_bets'] ? <Item icon={Star} label="Free bets" onClick={panel('freebets')} extra={badge(freeBetCount)} /> : null}
        {profile ? <Item icon={History} label="My bets" onClick={panel('history')} /> : null}
        <Item icon={HelpCircle} label="Rules" onClick={panel('rules')} />
        {b['features.chat'] ? <Item icon={MessageSquare} label="Chat" onClick={panel('chat')} /> : null}
      </div>
      <Gap />

      {support.length > 0 && (
        <>
          <div aria-label="Support">
            {support.map((x) => (
              <a key={x.label} href={x.href} target={x.href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer" role="menuitem" onClick={onClose}
                className="relative flex h-11 w-full items-center gap-3 px-4 text-left text-body text-white transition-colors active:bg-white/10 after:absolute after:bottom-0 after:left-4 after:right-0 after:h-px after:origin-bottom after:scale-y-50 after:bg-ios-sep last:after:hidden">
                <span className="flex-1 truncate">{x.label}</span><x.icon size={19} strokeWidth={1.9} className="shrink-0" />
              </a>
            ))}
          </div>
          <Gap />
        </>
      )}

      {profile ? (
        <div>
          <Item icon={Wallet} label="Wallet" onClick={go(onWalletOpen)} />
          {profile.role === 'marketer' ? <Item icon={LayoutDashboard} label="Marketer hub" onClick={go(() => navigate('/marketer'))} /> : null}
          <Item icon={LogOut} label="Log out" onClick={go(onSignOut)} destructive />
        </div>
      ) : <div><Item icon={LogIn} label="Log in" onClick={go(onSignIn)} /></div>}

      {legal.length > 0 && (
        <>
          <Gap />
          <div>{legal.map((x) => <Item key={x.to} icon={x.icon} label={x.label} onClick={go(() => navigate(x.to))} />)}</div>
        </>
      )}
      {(socials.length > 0 || brand.licence_line || b['legal.company']) && (
        <div className="space-y-2 px-4 pb-3 pt-3">
          {socials.length > 0 && (
            <div className="flex flex-wrap gap-3 text-footnote">
              {socials.map((x) => <a key={x.k} href={x.href!} target="_blank" rel="noopener noreferrer" className="text-ios-label2 underline-offset-2 hover:underline">{x.k === 'x' ? 'X' : x.k[0].toUpperCase() + x.k.slice(1)}</a>)}
            </div>
          )}
          {(brand.licence_line || b['legal.company']) && (
            <p className="text-caption1 text-ios-label3">{[b['legal.company'], b['legal.licence_no'], brand.licence_line].filter(Boolean).join(' · ')} · {b['legal.min_age']}+</p>
          )}
        </div>
      )}
    </div>
  );
}
