import { useState } from 'react';
import { Wallet, LogOut, Menu, X } from 'lucide-react';
import type { Profile } from '../../types';

interface Props {
  profile: Profile | null;
  balance: number;
  onAuthOpen: () => void;
  onWalletOpen: () => void;
  onSignOut: () => void;
}

export default function Header({ profile, balance, onAuthOpen, onWalletOpen, onSignOut }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="bg-[#0d0d1a] border-b border-[#2a2a45] px-4 h-12 flex items-center justify-between relative z-30 flex-shrink-0">
      {/* Logo — matches image: italic bold red "Aviator" */}
      <div className="flex items-center gap-1">
        <span
          className="font-black italic text-xl tracking-tight"
          style={{
            color: '#cc0018',
            fontFamily: '"Georgia", serif',
            textShadow: '0 0 12px rgba(200,0,24,0.5)',
          }}
        >
          Aviator
        </span>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-2">
        {profile ? (
          <>
            {/* Balance — KShs */}
            <button
              onClick={onWalletOpen}
              className="hidden sm:flex items-center gap-1.5 hover:opacity-90 transition"
            >
              <span className="text-slate-400 text-xs font-semibold">KShs</span>
              <span
                className="text-base font-bold tabular-nums"
                style={{ color: '#22c55e', textShadow: '0 0 8px rgba(34,197,94,0.4)' }}
              >
                {balance.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </button>

            {/* Deposit */}
            <button
              onClick={onWalletOpen}
              className="hidden sm:flex items-center gap-1 px-3 py-1.5 bg-[#22c55e] hover:bg-[#16a34a] text-white rounded-lg text-xs font-bold transition shadow-lg shadow-green-500/20"
            >
              <Wallet size={12} />
              Deposit
            </button>

            {/* Avatar + username */}
            <div className="hidden sm:flex items-center gap-2 px-2 py-1.5 rounded-lg border border-[#2a2a45]">
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold"
                style={{ backgroundColor: profile.avatar_color }}
              >
                {profile.username[0]?.toUpperCase()}
              </div>
              <span className="text-slate-300 text-xs font-medium">{profile.username}</span>
            </div>

            <button
              onClick={onSignOut}
              className="hidden sm:flex p-1.5 text-slate-500 hover:text-white hover:bg-[#1a1a2e] rounded-lg transition"
              title="Sign out"
            >
              <LogOut size={14} />
            </button>

            {/* Mobile menu toggle */}
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="sm:hidden p-1.5 text-slate-400 hover:text-white transition"
            >
              {menuOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={onAuthOpen}
              className="px-3 py-1.5 text-sm font-semibold text-slate-400 hover:text-white transition"
            >
              Sign In
            </button>
            <button
              onClick={onAuthOpen}
              className="px-4 py-1.5 bg-[#22c55e] hover:bg-[#16a34a] text-white rounded-lg text-sm font-bold transition shadow-lg shadow-green-500/20"
            >
              Register
            </button>
          </div>
        )}
      </div>

      {/* Mobile dropdown */}
      {menuOpen && profile && (
        <div className="sm:hidden absolute top-12 right-0 left-0 bg-[#0d0d1a] border-b border-[#2a2a45] p-4 space-y-3 shadow-xl z-40">
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
          <div className="flex gap-2">
            <button
              onClick={() => { onWalletOpen(); setMenuOpen(false); }}
              className="flex-1 flex items-center justify-center gap-2 py-2 bg-[#22c55e] text-white rounded-lg text-sm font-bold"
            >
              <Wallet size={14} /> Deposit
            </button>
            <button
              onClick={() => { onSignOut(); setMenuOpen(false); }}
              className="flex items-center gap-2 px-4 py-2 bg-[#1a1a2e] text-slate-300 rounded-lg text-sm"
            >
              <LogOut size={14} /> Sign Out
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
