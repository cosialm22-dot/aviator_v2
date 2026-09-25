import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { supabase } from '../../lib/supabase';
import { Plus, Power } from 'lucide-react';
import { Badge, Button, Card, Empty, Modal, Notice, PageHeader, Select, Skeleton, TableWrap, Td, Th, inputCls } from '../ui/kit';

// Admin promo-code management (site-scoped by the RPCs). Create codes granting
// a free bet or bonus cash, with total + per-user caps and optional expiry.

/** Form row: a label (which may carry a faint qualifier) above its control. */
function FormField({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-ink">{label}</span>
      {children}
    </label>
  );
}

interface PromoCode {
  id: string; code: string; reward_kind: string; reward_value: number; wagering_x: number;
  max_redemptions: number | null; per_user_limit: number; redeemed_count: number;
  expires_at: string | null; active: boolean; created_at: string;
}
const ERR: Record<string, string> = {
  FORBIDDEN: 'No permission.', INVALID_CODE: 'Code: A–Z, 0–9, _ or - (2–31 chars).',
  INVALID_REWARD_KIND: 'Pick a reward kind.', INVALID_REWARD_VALUE: 'Reward must be > 0.', NOT_FOUND: 'Not found.',
};
const friendly = (m?: string) => { if (!m) return 'Something went wrong.'; for (const k in ERR) if (m.includes(k)) return ERR[k]; return m; };

export default function PromoCodesPage() {
  const [rows, setRows] = useState<PromoCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState<{ ok: boolean; msg: string } | null>(null);
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_list_promo_codes');
    if (error) setFlash({ ok: false, msg: friendly(error.message) });
    else setRows((data ?? []) as PromoCode[]);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function toggle(code: string, active: boolean) {
    const { error } = await supabase.rpc('admin_set_promo_active', { p_code: code, p_active: !active });
    if (error) { setFlash({ ok: false, msg: friendly(error.message) }); return; }
    void load();
  }

  return (
    <>
      <PageHeader
        title="Promo Codes"
        subtitle="Redeemable codes granting a free bet or bonus."
        actions={<Button variant="primary" onClick={() => setShowNew(true)}><Plus size={14} /> New code</Button>}
      />

      {flash && <Notice tone={flash.ok ? 'ok' : 'error'}>{flash.msg}</Notice>}

      <Card pad={false} className="overflow-hidden" title="Codes" action={<span className="text-[13px] tabular-nums text-muted">{rows.length}</span>}>
        {loading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
        ) : rows.length === 0 ? (
          <Empty title="No promo codes yet." />
        ) : (
          <TableWrap>
            <thead><tr>
              {['Code', 'Reward', 'Redemptions', 'Per user', 'Expires', 'Status', ''].map((h, i) => (
                <Th key={i} numeric={i === 2 || i === 3}>{h}</Th>
              ))}
            </tr></thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-white/[0.03]">
                  <Td className="font-mono text-[12px] font-medium text-ink">{r.code}</Td>
                  <Td className="text-muted">
                    {r.reward_kind === 'free_bet' ? 'Free bet' : 'Bonus'} · KSh <span className="tabular-nums">{Number(r.reward_value).toLocaleString('en-KE')}</span>
                  </Td>
                  <Td numeric className="text-ink">
                    {r.redeemed_count}{r.max_redemptions != null ? ` / ${r.max_redemptions}` : ''}
                  </Td>
                  <Td numeric className="text-muted">{r.per_user_limit}</Td>
                  <Td className="whitespace-nowrap tabular-nums text-muted">{r.expires_at ? new Date(r.expires_at).toLocaleDateString() : '—'}</Td>
                  <Td><Badge tone={r.active ? 'up' : 'muted'}>{r.active ? 'active' : 'off'}</Badge></Td>
                  <Td className="text-right">
                    <Button size="sm" onClick={() => void toggle(r.code, r.active)}>
                      <Power size={12} /> {r.active ? 'Disable' : 'Enable'}
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      {showNew && <NewCodeModal onClose={() => setShowNew(false)} onDone={() => { setShowNew(false); void load(); }} onError={(m) => setFlash({ ok: false, msg: m })} />}
    </>
  );
}

function NewCodeModal({ onClose, onDone, onError }: { onClose: () => void; onDone: () => void; onError: (m: string) => void }) {
  const [code, setCode] = useState('');
  const [rewardKind, setRewardKind] = useState('free_bet');
  const [rewardValue, setRewardValue] = useState('');
  const [maxRedemptions, setMaxRedemptions] = useState('');
  const [perUser, setPerUser] = useState('1');
  const [expires, setExpires] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    const { error } = await supabase.rpc('admin_upsert_promo_code', {
      p_code: code.trim().toUpperCase(),
      p_reward_kind: rewardKind,
      p_reward_value: Number(rewardValue),
      p_max_redemptions: maxRedemptions ? Number(maxRedemptions) : null,
      p_per_user_limit: Number(perUser) || 1,
      p_expires_at: expires ? new Date(expires).toISOString() : null,
      p_active: true,
    });
    setBusy(false);
    if (error) { onError(friendly(error.message)); return; }
    onDone();
  }
  return (
    <Modal title="New promo code" onClose={onClose} width={440}
      footer={<>
        <Button type="button" onClick={onClose}>Cancel</Button>
        <Button type="submit" form="new-promo-code" variant="primary" disabled={busy}>{busy ? 'Saving…' : 'Create code'}</Button>
      </>}>
      <form id="new-promo-code" onSubmit={save} className="space-y-4">
        <FormField label="Code">
          <input className={inputCls + ' font-mono uppercase'} value={code} required placeholder="WELCOME50" onChange={(e) => setCode(e.target.value.toUpperCase())} />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Reward">
            <Select label="Reward" className="h-9 w-full" value={rewardKind} onChange={setRewardKind}
              options={[{ value: 'free_bet', label: 'Free bet' }, { value: 'bonus_cash', label: 'Bonus cash' }]} />
          </FormField>
          <FormField label="Value (KSh)">
            <input className={inputCls + ' tabular-nums'} type="number" min={1} value={rewardValue} required onChange={(e) => setRewardValue(e.target.value)} />
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField label={<>Max total <span className="font-normal text-faint">(blank = ∞)</span></>}>
            <input className={inputCls + ' tabular-nums'} type="number" min={1} value={maxRedemptions} onChange={(e) => setMaxRedemptions(e.target.value)} />
          </FormField>
          <FormField label="Per user">
            <input className={inputCls + ' tabular-nums'} type="number" min={1} value={perUser} onChange={(e) => setPerUser(e.target.value)} />
          </FormField>
        </div>
        <FormField label={<>Expires <span className="font-normal text-faint">(optional)</span></>}>
          <input className={inputCls + ' [color-scheme:dark]'} type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </FormField>
        {rewardKind === 'bonus_cash' && (
          <p className="text-[12px] text-faint">Bonus cash credits the reserved bonus balance (spendable once the bonus/wagering engine ships).</p>
        )}
      </form>
    </Modal>
  );
}
