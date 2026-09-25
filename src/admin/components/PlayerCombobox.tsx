import { useState, useEffect, useRef, useCallback, useId } from 'react';
import { Search, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { inputCls } from '../ui/kit';

// ============================================================================
// PlayerCombobox - accessible typeahead that searches registered *players* by
// username and emits the selected account. Players are read directly from
// `profiles` (RLS policy "Users can read all profiles" permits any authenticated
// staff member to read); only role = 'player' accounts that are not banned are
// offered, because the consumers (promote-to-marketer, add-staff) act on players.
//
// Self-contained and reusable: it owns the query, debounce, keyboard handling,
// and WAI-ARIA combobox semantics; the parent only receives onSelect(player).
// It does not perform the privileged action itself - that stays with the caller
// so the same control can back different mutations.
// ============================================================================

export interface PlayerLite {
  id: string;
  username: string;
  avatar_color: string;
  created_at: string;
}

const DEBOUNCE_MS = 250;
const MAX_RESULTS = 8;

export default function PlayerCombobox({
  onSelect,
  placeholder = 'Search players by username\u2026',
  disabled = false,
}: {
  onSelect: (player: PlayerLite) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<PlayerLite[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1); // highlighted option index
  const [searched, setSearched] = useState(false); // a query has completed for the current term

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const reqId = useRef(0); // guards against out-of-order async responses
  const listboxId = useId();

  // Debounced search. role='player' + not banned, username prefix/substring match.
  useEffect(() => {
    const q = term.trim();
    if (q === '') { setResults([]); setSearched(false); setLoading(false); return; }
    setLoading(true);
    const myReq = ++reqId.current;
    const t = setTimeout(async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, username, avatar_color, created_at')
        .eq('role', 'player')
        .eq('is_banned', false)
        .ilike('username', `%${q}%`)
        .order('username', { ascending: true })
        .limit(MAX_RESULTS);
      if (myReq !== reqId.current) return; // a newer query superseded this one
      setResults(error ? [] : ((data ?? []) as PlayerLite[]));
      setSearched(true);
      setLoading(false);
      setActive(-1);
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [term]);

  // Close on outside click.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const choose = useCallback((p: PlayerLite) => {
    onSelect(p);
    setTerm('');
    setResults([]);
    setSearched(false);
    setOpen(false);
    setActive(-1);
  }, [onSelect]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      setActive(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && active >= 0 && active < results.length) { e.preventDefault(); choose(results[active]); }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActive(-1);
    }
  }

  const showPanel = open && term.trim() !== '';

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listboxId}-opt-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          value={term}
          placeholder={placeholder}
          onChange={e => { setTerm(e.target.value); setOpen(true); }}
          onFocus={() => term.trim() !== '' && setOpen(true)}
          onKeyDown={onKeyDown}
          className={inputCls + ' pl-8 pr-10 disabled:opacity-50'}
        />
        {term !== '' && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => { setTerm(''); setResults([]); setSearched(false); setOpen(false); inputRef.current?.focus(); }}
            className="absolute right-0.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-muted transition-colors hover:bg-white/[0.06] hover:text-ink"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {showPanel && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Matching players"
          className="absolute z-30 mt-1.5 max-h-72 w-full overflow-y-auto rounded-xl bg-raised p-1 shadow-[0_12px_40px_rgba(0,0,0,0.5)] ring-1 ring-white/[0.08]"
        >
          {loading && (
            <li className="flex items-center gap-2 px-3 py-2.5 text-[13px] text-muted">
              <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-current border-r-transparent animate-spin" />
              Searching&hellip;
            </li>
          )}
          {!loading && searched && results.length === 0 && (
            <li className="px-3 py-2.5 text-[13px] text-faint">No matching players found.</li>
          )}
          {!loading && results.map((p, i) => (
            <li
              key={p.id}
              id={`${listboxId}-opt-${i}`}
              role="option"
              aria-selected={active === i}
              onMouseEnter={() => setActive(i)}
              onMouseDown={e => { e.preventDefault(); choose(p); }}
              className={'flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 ' + (active === i ? 'bg-brand text-white' : 'text-ink')}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold text-white" style={{ backgroundColor: p.avatar_color }}>
                {p.username[0]?.toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{p.username}</span>
                <span className={'block text-[12px] tabular-nums ' + (active === i ? 'text-white/70' : 'text-faint')}>Joined {new Date(p.created_at).toLocaleDateString()}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
