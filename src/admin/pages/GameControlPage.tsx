import { useState, useEffect, useRef, useCallback } from 'react';
import { Spin } from '../components/Spin';
import { errMsg } from '../../lib/errors';
import { supabase } from '../../lib/supabase';
import { useAdmin } from '../roleContext';
import { getMultiplierAtTime } from '../../lib/gameEngine';
import { Power, Plus, ListPlus, Trash2, X, Plane, Layers, RefreshCw } from 'lucide-react';
import { Badge, Button, Card, Empty, ErrorState, Modal, PageHeader, inputCls } from '../ui/kit';

interface LiveRound { id:string; round_number:number; status:string; started_at:string|null; betting_ends_at:string|null; source:string; queue_id:string|null; crash_point:number|null }
interface CQItem { id:string; crash_multiplier:number; position:number; status:string; created_at:string }

const POLL_MS=2000; const TICK_MS=120; const MIN_C=1; const MAX_C=80;
const areaCls=inputCls.replace('h-9 ','')+' py-2 resize-y tabular-nums';

function fmt(n:number|null|undefined):string{ return n==null?'—':Number(n).toFixed(2)+'x'; }
function elapsedMs(iso:string|null):number{ return iso?Math.max(0,Date.now()-new Date(iso).getTime()):0; }
// colour by crash-point magnitude (matches player-facing history palette)
function cpTone(v:number|null):string{
  if(v==null) return 'text-ink';
  if(v<1.5) return 'text-down';
  if(v<2)   return 'text-warn';
  if(v<5)   return 'text-up';
  if(v<10)  return 'text-brand';
  return 'text-gold';
}

export default function GameControlPage(){
  // The crash queue and algorithm switch are shared by every brand: platform owner only.
  const { isPlatform: isSuperAdmin }=useAdmin();
  const [qEnabled,setQEnabled]=useState(false);
  const [round,setRound]=useState<LiveRound|null>(null);
  const [queue,setQueue]=useState<CQItem[]>([]);
  const [loading,setLoading]=useState(true);
  const [err,setErr]=useState<string|null>(null);
  const [sVal,setSVal]=useState(''); const [bVal,setBVal]=useState('');
  const [showBatch,setShowBatch]=useState(false);
  const [confirmClear,setConfirmClear]=useState(false);
  const [lock,setLock]=useState<string|null>(null);
  const [,setNow]=useState(Date.now());
  const closeClear=useCallback(()=>setConfirmClear(false),[]); // stable: the page re-renders every tick
  const pRef=useRef<ReturnType<typeof setInterval>>();
  const aRef=useRef<AbortController|null>(null);

  // Single source of truth: crash point comes from the DB (admin_current_round),
  // never computed on the client. Queue shows ONLY pending points.
  const fetchAll=useCallback(async()=>{
    try{
      aRef.current?.abort(); const ac=new AbortController(); aRef.current=ac; const s=ac.signal;
      const [sr,rr,qr]=await Promise.all([
        supabase.from('system_settings').select('value').eq('key','game.queue_enabled').abortSignal(s).maybeSingle(),
        supabase.rpc('admin_current_round').abortSignal(s),
        supabase.from('crash_queue').select('*').eq('status','pending').order('position',{ascending:true}).limit(50).abortSignal(s),
      ]);
      if(s.aborted) return;
      setQEnabled(Boolean(sr.data?.value));
      const r=(rr.data as {round:LiveRound|null}|null)?.round ?? null;
      setRound(r);
      setQueue((qr.data??[]) as CQItem[]);
      setErr(null);
    }catch(e){ if(e instanceof Error&&e.name==='AbortError')return; setErr(errMsg(e,'Fetch failed')); }
    finally{ setLoading(false); }
  },[]);

  useEffect(()=>{ fetchAll(); pRef.current=setInterval(fetchAll,POLL_MS); return ()=>{clearInterval(pRef.current); aRef.current?.abort();}; },[fetchAll]);
  useEffect(()=>{ const t=setInterval(()=>setNow(Date.now()),TICK_MS); return ()=>clearInterval(t); },[]);

  const isFlying=round?.status==='flying';
  const isWaiting=round?.status==='waiting';
  const cp=round?.crash_point ?? null;
  const liveMult=isFlying?getMultiplierAtTime(elapsedMs(round!.started_at)):null;
  const pct=(isFlying&&liveMult!=null&&cp&&cp>1)?Math.min(100,(liveMult/cp)*100):0;

  async function toggleQueue(){
    setLock('qe');
    try{ const {error}=await supabase.rpc('admin_set_setting',{p_key:'game.queue_enabled',p_value:!qEnabled}); if(error)throw error; setQEnabled(!qEnabled); }
    catch(e){ setErr(errMsg(e,'Could not change queue state')); } finally{ setLock(null); }
  }
  async function addSingle(){
    const v=parseFloat(sVal); if(!isFinite(v)||v<MIN_C||v>MAX_C){ setErr(`Crash point must be ${MIN_C}–${MAX_C}`); return; }
    setLock('as');
    try{ const {error}=await supabase.rpc('admin_queue_add',{p_crash:v}); if(error)throw error; setSVal(''); await fetchAll(); }
    catch(e){ setErr(errMsg(e,'Add failed')); } finally{ setLock(null); }
  }
  async function addBatch(){
    const pts=bVal.split(/[\n,]+/).map(x=>parseFloat(x.trim())).filter(x=>isFinite(x));
    if(pts.length===0){ setErr('No valid numbers'); return; }
    if(pts.some(x=>x<MIN_C||x>MAX_C)){ setErr(`All points must be ${MIN_C}–${MAX_C}`); return; }
    setLock('ab');
    try{ const {error}=await supabase.rpc('admin_queue_add_batch',{p_points:pts}); if(error)throw error; setBVal(''); setShowBatch(false); await fetchAll(); }
    catch(e){ setErr(errMsg(e,'Batch add failed')); } finally{ setLock(null); }
  }
  async function removeOne(id:string){
    setLock('rm'+id);
    try{ const {error}=await supabase.rpc('admin_queue_remove',{p_id:id}); if(error)throw error; await fetchAll(); }
    catch(e){ setErr(errMsg(e,'Remove failed')); } finally{ setLock(null); }
  }
  async function clearAll(){
    setLock('cl');
    try{ const {error}=await supabase.rpc('admin_queue_clear'); if(error)throw error; setConfirmClear(false); await fetchAll(); }
    catch(e){ setErr(errMsg(e,'Clear failed')); } finally{ setLock(null); }
  }

  return(
    <>
      <PageHeader
        title="Crash Control"
        subtitle="The round in play and the upcoming crash points."
        actions={<Button onClick={fetchAll} loading={loading}>{!loading&&<RefreshCw size={14} />}{loading?'…':'Refresh'}</Button>}
      />

      {err&&<ErrorState message={err} />}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        {/* ============ NOW ============ */}
        <Card
          title={<span className="flex items-center gap-2"><Plane size={15} className={isFlying?'text-up':'text-faint'} />Now</span>}
          action={round&&<span className="text-[13px] tabular-nums text-faint">Round #{round.round_number}</span>}
        >
          {!round?(
            <Empty icon={<Plane size={20} strokeWidth={1.75} />} title="No round in play" body="The next round is being prepared." />
          ):(
            <div className="pt-2">
              <div className="flex flex-wrap items-end justify-between gap-6">
                <div>
                  <div className="mb-1.5 text-[13px] font-medium text-muted">{isFlying?'Crashes at':'Will crash at'}</div>
                  <div className={'text-[52px] font-semibold leading-none tabular-nums tracking-[-0.02em] '+cpTone(cp)}>{fmt(cp)}</div>
                  <div className="mt-3 flex items-center gap-2">
                    <Badge tone={isFlying?'up':'warn'}>{isFlying?'FLYING':'BETTING OPEN'}</Badge>
                    <span className="text-[12px] text-faint">{round.source==='queue'?'from queue':'algorithm'}</span>
                  </div>
                </div>
                {isFlying&&liveMult!=null&&(
                  <div className="text-right">
                    <div className="mb-1.5 text-[13px] font-medium text-muted">Current</div>
                    <div className="text-[28px] font-semibold leading-none tabular-nums tracking-[-0.02em] text-ink">{fmt(liveMult)}</div>
                    <div className="mt-1.5 text-[12px] text-faint">climbing</div>
                  </div>
                )}
              </div>

              {/* progress toward the fixed crash point */}
              {isFlying&&cp&&cp>1&&(
                <div className="mt-6">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-raised">
                    <div className="h-full rounded-full bg-up transition-all duration-150" style={{width:pct+'%'}} />
                  </div>
                  <div className="mt-1.5 flex justify-between text-[12px] tabular-nums text-faint"><span>1.00x</span><span>{fmt(cp)}</span></div>
                </div>
              )}
              {isWaiting&&(
                <p className="mt-4 text-[13px] text-muted">Betting is open. The round starts when the timer ends.</p>
              )}
            </div>
          )}
        </Card>

        {/* ============ UP NEXT ============ */}
        <Card
          pad={false}
          className="overflow-hidden"
          title={<span className="flex items-center gap-2"><Layers size={15} className="text-brand" />Up next<Badge tone="brand">{queue.length}</Badge></span>}
          action={
            <div className="flex flex-wrap items-center gap-3">
              <span className={'inline-flex items-center gap-1.5 text-[13px] font-medium '+(qEnabled?'text-up':'text-muted')}>
                <span className={'h-1.5 w-1.5 rounded-full '+(qEnabled?'animate-pulse bg-up':'bg-faint')} />{qEnabled?'Queue on':'Algorithm on'}
              </span>
              {isSuperAdmin&&(
                <Button size="sm" variant={qEnabled?'default':'primary'} onClick={toggleQueue} loading={lock==='qe'}>
                  {lock!=='qe'&&<Power size={13} />}{qEnabled?'Switch to algorithm':'Use queue'}
                </Button>
              )}
            </div>
          }
        >
          {/* add controls */}
          {isSuperAdmin&&(
            <div className="flex flex-wrap items-center gap-2 px-5 pb-4 pt-2">
              <input type="number" value={sVal} onChange={e=>setSVal(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addSingle()} placeholder={`Add crash point ${MIN_C}–${MAX_C}`} min={MIN_C} max={MAX_C} step="0.01" className={inputCls+' min-w-[180px] flex-1 tabular-nums'} />
              <Button variant="primary" className="h-9" onClick={addSingle} disabled={!sVal.trim()} loading={lock==='as'}>{lock!=='as'&&<Plus size={14} />}Add</Button>
              <Button className="h-9" onClick={()=>setShowBatch(v=>!v)}><ListPlus size={14} />Batch</Button>
              {queue.length>0&&<Button variant="danger" className="h-9" onClick={()=>setConfirmClear(true)}><Trash2 size={14} />Clear</Button>}
            </div>
          )}
          {isSuperAdmin&&showBatch&&(
            <div className="space-y-2 px-5 pb-4">
              <textarea value={bVal} onChange={e=>setBVal(e.target.value)} placeholder="1.23, 4.56, 12.00" rows={3} className={areaCls} />
              <div className="flex justify-end gap-2">
                <Button onClick={()=>setShowBatch(false)}>Cancel</Button>
                <Button variant="primary" onClick={addBatch} disabled={!bVal.trim()} loading={lock==='ab'}>Add batch</Button>
              </div>
            </div>
          )}

          {/* pending list */}
          <div className="border-t border-line">
            {queue.length===0?(
              <Empty icon={<Layers size={20} strokeWidth={1.75} />} title="No upcoming crash points" body="Autofill tops the queue up automatically." />
            ):(
              <ul className="divide-y divide-line">
                {queue.map((q,i)=>(
                  <li key={q.id} className={'flex h-12 items-center gap-4 px-5 transition-colors '+(i===0?'bg-brand/10':'hover:bg-white/[0.03]')}>
                    <span className={'w-12 shrink-0 text-[13px] font-medium tabular-nums '+(i===0?'text-brand':'text-faint')}>{i===0?'Next':'+'+(i+1)}</span>
                    <span className={'flex-1 text-[15px] font-semibold tabular-nums tracking-[-0.01em] '+cpTone(q.crash_multiplier)}>{fmt(q.crash_multiplier)}</span>
                    {isSuperAdmin?(
                      <button onClick={()=>removeOne(q.id)} disabled={lock==='rm'+q.id} title="Remove" className="grid h-8 w-8 place-items-center rounded-lg text-muted transition-colors hover:bg-white/[0.06] hover:text-ink disabled:opacity-40">{lock==='rm'+q.id?<Spin />:<X size={15} />}</button>
                    ):<span className="w-8" />}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

      <p className="text-[12px] text-faint">Only the round in play and upcoming crash points are shown. A point disappears the moment its round crashes.</p>

      {/* clear confirm */}
      {confirmClear&&(
        <Modal title="Clear queue" tone="danger" width={400} onClose={closeClear}
          footer={<>
            <Button onClick={closeClear} disabled={lock==='cl'}>Cancel</Button>
            <Button variant="danger" onClick={clearAll} loading={lock==='cl'}>Clear all</Button>
          </>}>
          <p className="text-[13px] leading-5 text-muted">Remove all {queue.length} upcoming crash point(s)? Autofill will top the queue back up.</p>
        </Modal>
      )}
    </>
  );
}
