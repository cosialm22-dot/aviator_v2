import { useState } from 'react';
import { UserPlus, X } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import PlayerCombobox, { type PlayerLite } from '../../components/PlayerCombobox';
import { Button, Card } from '../../ui/kit';
import { errMsg, friendly } from './shared';

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
    <Card title="Add a marketer">
      {!selected ? (
        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-muted">Find a player</label>
          <PlayerCombobox onSelect={p => { setErr(null); setSelected(p); }} />
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3 rounded-lg bg-raised py-2 pl-3 pr-1.5">
            <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[12px] font-semibold text-white" style={{ backgroundColor: selected.avatar_color }}>
              {selected.username[0]?.toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-ink">{selected.username}</span>
              <span className="block text-[12px] text-faint">Joined {new Date(selected.created_at).toLocaleDateString()}</span>
            </span>
            <button
              type="button"
              aria-label="Choose a different player"
              onClick={() => { setSelected(null); setErr(null); }}
              disabled={promoting}
              className="grid h-8 w-8 place-items-center rounded-lg text-muted transition-colors hover:bg-white/[0.06] hover:text-ink disabled:opacity-40"
            >
              <X size={15} />
            </button>
          </div>
          <Button type="button" variant="primary" onClick={promote} loading={promoting} className="flex-shrink-0">
            {!promoting && <UserPlus size={14} />}Promote to marketer
          </Button>
        </div>
      )}

      {err && (
        <p role="alert" className="mt-3 text-[13px] text-down">{err}</p>
      )}
      <p className="mt-3 text-[12px] text-faint">
        Promotes an existing player; a unique referral code is generated automatically. Admins and super admins cannot be made marketers.
      </p>
    </Card>
  );
}
