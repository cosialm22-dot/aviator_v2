import { useState } from 'react';
import { UserPlus, X } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import PlayerCombobox, { type PlayerLite } from '../../components/PlayerCombobox';
import { HEAD, errMsg, friendly } from './shared';
import { Spin } from './components';

// "Add a marketer" card for the Affiliates tab (super_admin only). The operator
// searches registered players in a typeahead, selects one, then confirms the
// promotion. Promotion itself is server-enforced via admin_promote_to_marketer,
// which is keyed by username, rejects operators / existing marketers / self, and
// generates the referral code. This component only orchestrates selection and
// the single RPC call; the parent reloads the affiliate list on success.
export default function PromoteMarketer({ onPromoted }: { onPromoted: (message: string) => void }) {
  const [selected, setSelected] = useState<PlayerLite | null>(null);
  const [promoting, setPromoting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function promote() {
    if (!selected || promoting) return;
    setErr(null);
    setPromoting(true);
    try {
      const { error } = await supabase.rpc('admin_promote_to_marketer', { p_username: selected.username });
      if (error) throw new Error(friendly(error.message));
      const name = selected.username;
      setSelected(null);
      onPromoted(`${name} is now a marketer.`);
    } catch (e) {
      setErr(errMsg(e, 'Could not promote that player.'));
    } finally {
      setPromoting(false);
    }
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <div className={HEAD}>Add a marketer</div>

      {!selected ? (
        <div className="mt-3">
          <label className="text-[11px] font-medium text-muted block mb-1.5">Find a player</label>
          <PlayerCombobox onSelect={p => { setErr(null); setSelected(p); }} />
        </div>
      ) : (
        <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-2.5 flex-1 min-w-0 rounded-lg border border-line bg-canvas px-3 py-2.5">
            <span className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-semibold flex-shrink-0" style={{ backgroundColor: selected.avatar_color }}>
              {selected.username[0]?.toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] text-ink font-medium truncate">{selected.username}</span>
              <span className="block text-[11px] text-faint">Joined {new Date(selected.created_at).toLocaleDateString()}</span>
            </span>
            <button
              type="button"
              aria-label="Choose a different player"
              onClick={() => { setSelected(null); setErr(null); }}
              disabled={promoting}
              className="text-faint hover:text-ink transition-colors disabled:opacity-40"
            >
              <X size={16} />
            </button>
          </div>
          <button
            type="button"
            onClick={promote}
            disabled={promoting}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-brand hover:bg-brand-dark text-white text-[13px] font-semibold transition-colors disabled:opacity-50 flex-shrink-0"
          >
            {promoting ? <Spin /> : <UserPlus size={15} />}Promote to marketer
          </button>
        </div>
      )}

      {err && (
        <p role="alert" className="mt-2.5 text-[12px] text-down">{err}</p>
      )}
      <p className="text-[12px] text-faint mt-2.5">
        Promotes an existing player; a unique referral code is generated automatically. Admins and super admins cannot be made marketers.
      </p>
    </div>
  );
}
