import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wallet, LogOut, Menu, X, ChevronDown, LayoutDashboard, RotateCcw, UserCircle } from 'lucide-react';
import type { Profile } from '../../types';

type PlayMode = 'real' | 'demo';

interface Props {
  profile: Profile | null;
  balance: number;
  mode: PlayMode;
  onSetMode: (mode: PlayMode) => void;
  demoBalance: number;
  onResetDemo: () => void;
  onSignInOpen: () => void;
  onRegisterOpen: () => void;
  onWalletOpen: () => void;
  onSignOut: () => void;
}

// Marketers get their own hub in the PLAYER shell (they are signed-in players,
// never operators). The operator admin panel (/admin) is operators-only.
const MARKETER_DASHBOARD_PATH = '/marketer';

export default function Header({ profile, balance, mode, onSetMode, demoBalance, onResetDemo, onSignInOpen, onRegisterOpen, onWalletOpen, onSignOut }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);       // mobile hamburger sheet
  const [profileOpen, setProfileOpen] = useState(false); // desktop profile dropdown
  const navigate = useNavigate();

  const isMarketer = profile?.role === 'marketer';

  return (
    <header className="bg-night border-b border-edge px-4 h-12 flex items-center justify-between relative z-30 flex-shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2">
        <img src="/plane.png" alt="" aria-hidden="true" className="h-5 w-auto -rotate-12 drop-shadow-[0_0_8px_rgba(200,0,24,0.55)]" />
        <span
          className="font-black italic text-xl tracking-tight"
          style={{ color: '#cc0018', fontFamily: '"Georgia", serif', textShadow: '0 0 12px rgba(200,0,24,0.5)' }}
        >
          Aviator
        </span>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-2">
        {/* Play-mode switch (Real / Demo). Demo needs no account; shown left of
            the Sign In / profile cluster on every screen size. */}
        <div className="flex items-center gap-1.5">
          {mode === 'demo' && (
            <div className="hidden sm:flex items-center gap-1.5 rounded-full bg-panel-raised border border-edge px-2 py-1">
              <span className="text-[9px] uppercase tracking-wide text-slate-500 font-bold">Demo</span>
              <span className="text-xs font-bold tabular-nums text-[#60a5fa]">
                KSh {demoBalance.toLocaleString('en-KE', { maximumFractionDigits: 0 })}
              </span>
              <button
                onClick={onResetDemo}
                title="Reset demo balance"
                aria-label="Reset demo balance"
                className="text-slate-400 hover:text-white transition active:scale-90"
              >
                <RotateCcw size={11} />
              </button>
            </div>
          )}
          <div className="flex bg-panel-raised rounded-full p-0.5" role="tablist" aria-label="Play mode">
            {(['real', 'demo'] as const).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                onClick={() => onSetMode(m)}
                className={`px-3 py-1 text-xs font-bold rounded-full transition-all ${
                  mode === m
                    ? (m === 'demo' ? 'bg-[#1d4ed8] text-white' : 'bg-win text-white')
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {m === 'real' ? 'Real' : 'Demo'}
              </button>
            ))}
          </div>
        </div>
        {profile ? (
          <>
            {/* Balance */}
            <button onClick={onWalletOpen} className="hidden sm:flex items-center gap-1.5 hover:opacity-90 transition">
              <span className="text-slate-400 text-xs font-semibold">KShs</span>
              <span className="text-base font-bold tabular-nums" style={{ color: '#22c55e', textShadow: '0 0 8px rgba(34,197,94,0.4)' }}>
                {balance.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </button>

            {/* Deposit */}
            <button
              onClick={onWalletOpen}
              className="hidden sm:flex items-center gap-1 px-3 py-1.5 bg-win hover:bg-win-dark text-white rounded-lg text-xs font-bold transition shadow-lg shadow-green-500/20"
            >
              <Wallet size={12} />
              Deposit
            </button>

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
                <span className="text-slate-300 text-xs font-medium">{profile.username}</span>
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
              className="sm:hidden p-1.5 text-slate-400 hover:text-white transition"
              aria-label="Menu"
            >
              {menuOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <button onClick={onSignInOpen} className="px-3 py-1.5 text-sm font-semibold text-slate-400 hover:text-white transition">
              Sign In
            </button>
            <button
              onClick={onRegisterOpen}
              className="px-4 py-1.5 bg-win hover:bg-win-dark text-white rounded-lg text-sm font-bold transition shadow-lg shadow-green-500/20"
            >
              Register
            </button>
          </div>
        )}
      </div>

      {/* Mobile dropdown */}
      {menuOpen && profile && (
        <div className="sm:hidden absolute top-12 right-0 left-0 bg-night border-b border-edge p-4 space-y-3 shadow-xl z-40">
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
            className="w-full flex items-center justify-center gap-2 py-2 bg-panel-raised border border-edge text-slate-200 rounded-lg text-sm font-semibold"
          >
            <UserCircle size={14} className="text-[#60a5fa]" /> My Profile
          </button>

          {isMarketer && (
            <button
              onClick={() => { setMenuOpen(false); navigate(MARKETER_DASHBOARD_PATH); }}
              className="w-full flex items-center justify-center gap-2 py-2 bg-panel-raised border border-edge text-slate-200 rounded-lg text-sm font-semibold"
            >
              <LayoutDashboard size={14} className="text-win" /> Marketer Hub
            </button>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => { onWalletOpen(); setMenuOpen(false); }}
              className="flex-1 flex items-center justify-center gap-2 py-2 bg-win text-white rounded-lg text-sm font-bold"
            >
              <Wallet size={14} /> Deposit
            </button>
            <button
              onClick={() => { onSignOut(); setMenuOpen(false); }}
              className="flex items-center gap-2 px-4 py-2 bg-panel-raised text-slate-300 rounded-lg text-sm"
            >
              <LogOut size={14} /> Sign Out
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
