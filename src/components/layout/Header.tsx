import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wallet, LogOut, Menu, X, ChevronDown, LayoutDashboard, UserCircle } from 'lucide-react';
import type { Profile } from '../../types';
import NotificationBell from '../notifications/NotificationBell';
import { useSiteTheme } from '../../hooks/useSiteTheme';

interface Props {
  profile: Profile | null;
  balance: number;
  onSignInOpen: () => void;
  onRegisterOpen: () => void;
  onWalletOpen: () => void;
  onSignOut: () => void;
}

// Marketers get their own hub in the PLAYER shell (they are signed-in players,
// never operators). The operator admin panel (/admin) is operators-only.
const MARKETER_DASHBOARD_PATH = '/marketer';

// The global chrome carries ONE job per state:
//   signed-out -> a single dominant "Register" CTA (+ a quiet "Log in" link)
//   signed-in  -> balance, deposit, and the account menu
// The Real/Demo play-mode switch deliberately does NOT live here: it is a
// betting-context choice and now sits directly above the betting panel (see
// AviatorGame), which keeps this bar uncluttered and stops it overlapping the
// logo on narrow phones.
export default function Header({ profile, balance, onSignInOpen, onRegisterOpen, onWalletOpen, onSignOut }: Props) {
  const { planeSrc } = useSiteTheme();
  const [menuOpen, setMenuOpen] = useState(false);       // mobile hamburger sheet
  const [profileOpen, setProfileOpen] = useState(false); // desktop profile dropdown
  const navigate = useNavigate();

  const isMarketer = profile?.role === 'marketer';

  return (
    <header className="bg-night border-b border-edge px-3 sm:px-4 h-14 flex items-center justify-between gap-2 relative z-30 flex-shrink-0">
      {/* Logo — allowed to shrink (min-w-0) but never clipped by the right cluster */}
      <button
        onClick={() => navigate('/')}
        className="flex items-center gap-2 min-w-0 shrink"
        aria-label="Aviator home"
      >
        <img src={planeSrc} alt="" aria-hidden="true" className="h-5 w-auto -rotate-12 drop-shadow-[0_0_8px_rgba(200,0,24,0.55)] flex-shrink-0" />
        <span
          className="font-black italic text-xl tracking-tight truncate"
          style={{ color: '#cc0018', fontFamily: '"Georgia", serif', textShadow: '0 0 12px rgba(200,0,24,0.5)' }}
        >
          Aviator
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
              <span className="text-slate-400 text-[10px] sm:text-xs font-semibold">KShs</span>
              <span className="text-sm sm:text-base font-bold tabular-nums" style={{ color: '#22c55e', textShadow: '0 0 8px rgba(34,197,94,0.4)' }}>
                {balance.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </button>

            {/* Deposit */}
            <button
              onClick={onWalletOpen}
              className="hidden sm:flex items-center gap-1 px-3 py-2 bg-win hover:bg-win-dark text-white rounded-lg text-xs font-bold transition shadow-lg shadow-green-500/20"
            >
              <Wallet size={12} />
              Deposit
            </button>

            {/* Notifications bell (live) */}
            <NotificationBell />

            {/* Profile dropdown (desktop) - avatar is the menu trigger */}
            <div className="hidden sm:block relative">
              <button
                onClick={() => setProfileOpen(o => !o)}
                aria-haspopup="menu"
                aria-expanded={profileOpen}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg border border-edge hover:border-[#3a3a55] transition"
              >
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold"
                  style={{ backgroundColor: profile.avatar_color }}
                >
                  {profile.username[0]?.toUpperCase()}
                </div>
                <span className="text-slate-300 text-xs font-medium max-w-[120px] truncate">{profile.username}</span>
                <ChevronDown size={12} className={`text-slate-500 transition-transform ${profileOpen ? 'rotate-180' : ''}`} />
              </button>

              {profileOpen && (
                <>
                  {/* click-away backdrop */}
                  <div className="fixed inset-0 z-30" onClick={() => setProfileOpen(false)} />
                  <div role="menu" className="absolute right-0 top-full mt-1 w-56 bg-night border border-edge rounded-xl shadow-2xl z-40 overflow-hidden py-1">
                    <button
                      onClick={() => { setProfileOpen(false); navigate('/profile'); }}
                      role="menuitem"
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-slate-200 hover:bg-panel-raised transition"
                    >
                      <UserCircle size={15} className="text-[#60a5fa]" />
                      My Profile
                    </button>
                    {isMarketer && (
                      <button
                        onClick={() => { setProfileOpen(false); navigate(MARKETER_DASHBOARD_PATH); }}
                        role="menuitem"
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-slate-200 hover:bg-panel-raised transition"
                      >
                        <LayoutDashboard size={15} className="text-win" />
                        Marketer Hub
                      </button>
                    )}
                    <button
                      onClick={() => { setProfileOpen(false); onSignOut(); }}
                      role="menuitem"
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-slate-300 hover:bg-panel-raised transition"
                    >
                      <LogOut size={15} className="text-slate-500" />
                      Sign Out
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Mobile menu toggle */}
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="sm:hidden p-2 -mr-1 text-slate-300 hover:text-white transition"
              aria-label="Menu"
              aria-expanded={menuOpen}
            >
              {menuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
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
      </div>

      {/* Mobile dropdown */}
      {menuOpen && profile && (
        <div className="sm:hidden absolute top-14 right-0 left-0 bg-night border-b border-edge p-4 space-y-3 shadow-xl z-40">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold"
                style={{ backgroundColor: profile.avatar_color }}
              >
                {profile.username[0]?.toUpperCase()}
              </div>
              <div>
                <div className="text-white font-semibold text-sm">{profile.username}</div>
                <div style={{ color: '#22c55e' }} className="text-xs font-bold">
                  KShs {balance.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
            </div>
          </div>

          <button
            onClick={() => { setMenuOpen(false); navigate('/profile'); }}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-panel-raised border border-edge text-slate-200 rounded-lg text-sm font-semibold"
          >
            <UserCircle size={14} className="text-[#60a5fa]" /> My Profile
          </button>

          {isMarketer && (
            <button
              onClick={() => { setMenuOpen(false); navigate(MARKETER_DASHBOARD_PATH); }}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-panel-raised border border-edge text-slate-200 rounded-lg text-sm font-semibold"
            >
              <LayoutDashboard size={14} className="text-win" /> Marketer Hub
            </button>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => { onWalletOpen(); setMenuOpen(false); }}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-win text-white rounded-lg text-sm font-bold"
            >
              <Wallet size={14} /> Deposit
            </button>
            <button
              onClick={() => { onSignOut(); setMenuOpen(false); }}
              className="flex items-center gap-2 px-4 py-2.5 bg-panel-raised text-slate-300 rounded-lg text-sm"
            >
              <LogOut size={14} /> Sign Out
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
