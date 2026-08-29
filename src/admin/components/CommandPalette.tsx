import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Globe, Megaphone, Ticket, Bell, Users, Gamepad2,
  Banknote, ShieldAlert, Wallet, Settings, Search, CornerDownLeft,
  type LucideIcon,
} from 'lucide-react';
import { useAdmin, canAccess, type Section } from '../roleContext';

// ============================================================================
// ⌘K / Ctrl-K command palette for the operator admin. Jump to any section the
// current role can access in two keystrokes. Keyboard-first (↑/↓ move, ↵ run,
// Esc close), filtered live. Borrowed from invest254's platform CommandPalette,
// adapted to aviator's react-router admin + RBAC (roleContext.canAccess).
// UI-only: route guards + server RPCs remain the real gate.
// ============================================================================

interface Cmd {
  id: string;
  label: string;
  hint: string;
  section: Section;
  path: string;
  icon: LucideIcon;
}

const ALL_COMMANDS: Cmd[] = [
  { id: 'dashboard',    label: 'Dashboard',       hint: 'Overview & KPIs',        section: 'dashboard',    path: '/admin',             icon: LayoutDashboard },
  { id: 'platform',     label: 'Platform Console',hint: 'All brands',             section: 'platform',     path: '/admin/platform',    icon: Globe },
  { id: 'marketing',    label: 'Marketing',       hint: 'Affiliates & promos',    section: 'marketing',    path: '/admin/marketing',   icon: Megaphone },
  { id: 'promo',        label: 'Promo Codes',     hint: 'Redeemable rewards',     section: 'marketing',    path: '/admin/promo-codes', icon: Ticket },
  { id: 'notifications',label: 'Notifications',   hint: 'Broadcasts & alerts',    section: 'notifications',path: '/admin/notifications',icon: Bell },
  { id: 'users',        label: 'Players',         hint: 'Accounts & balances',    section: 'users',        path: '/admin/users',       icon: Users },
  { id: 'game',         label: 'Game Control',    hint: 'Rounds & settings',      section: 'game',         path: '/admin/game',        icon: Gamepad2 },
  { id: 'withdrawals',  label: 'Withdrawals',     hint: 'Review payouts',         section: 'withdrawals',  path: '/admin/withdrawals', icon: Banknote },
  { id: 'risk',         label: 'Risk & Fraud',    hint: 'Flags & scoring',        section: 'risk',         path: '/admin/risk',        icon: ShieldAlert },
  { id: 'finance',      label: 'Finance',         hint: 'Ledger & totals',        section: 'finance',      path: '/admin/finance',     icon: Wallet },
  { id: 'settings',     label: 'Settings',        hint: 'System & staff',         section: 'settings',     path: '/admin/settings',    icon: Settings },
];

export default function CommandPalette() {
  const { role } = useAdmin();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Only the sections this role can actually reach.
  const commands = useMemo(() => ALL_COMMANDS.filter((c) => canAccess(role, c.section)), [role]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(s) || c.hint.toLowerCase().includes(s));
  }, [q, commands]);

  // Global ⌘K / Ctrl-K toggle; Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    if (active >= filtered.length) setActive(filtered.length > 0 ? filtered.length - 1 : 0);
  }, [filtered, active]);

  const run = useCallback((cmd: Cmd | undefined) => {
    if (!cmd) return;
    setOpen(false);
    navigate(cmd.path);
  }, [navigate]);

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); run(filtered[active]); }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/60 px-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-white/10 bg-panel-raised shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-white/10 px-4">
          <Search size={16} className="text-slate-400" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
            onKeyDown={onInputKey}
            placeholder="Jump to…"
            className="w-full bg-transparent py-3.5 text-sm text-white outline-none placeholder:text-slate-500"
            aria-label="Search admin sections"
          />
          <kbd className="hidden shrink-0 rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400 sm:block">ESC</kbd>
        </div>

        <ul className="max-h-[52vh] overflow-y-auto py-1.5">
          {filtered.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-slate-500">No matches</li>
          )}
          {filtered.map((cmd, i) => {
            const Icon = cmd.icon;
            const isActive = i === active;
            return (
              <li key={cmd.id}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => run(cmd)}
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                    isActive ? 'bg-white/10 text-white' : 'text-slate-300 hover:bg-white/5'
                  }`}
                >
                  <Icon size={16} strokeWidth={1.75} className={isActive ? 'text-white' : 'text-slate-400'} />
                  <span className="flex-1">{cmd.label}</span>
                  <span className="text-xs text-slate-500">{cmd.hint}</span>
                  {isActive && <CornerDownLeft size={13} className="text-slate-400" />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
