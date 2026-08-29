import { useState, useEffect, useRef, useCallback } from 'react';
import { Spin } from '../components/Spin';
import { errMsg } from '../../lib/errors';
import { supabase } from '../../lib/supabase';
import { useAdmin } from '../roleContext';
import { getMultiplierAtTime } from '../../lib/gameEngine';
import { Activity, Target, Power, Plus, ListPlus, Trash2, X, Radio } from 'lucide-react';

interface GameRoundRow { id:string; round_number:number; crash_multiplier:number|null; status:string; started_at:string|null; crashed_at:string|null; betting_ends_at:string|null; source:string; queue_id:string|null }
interface CQItem { id:string; crash_multiplier:number; position:number; status:string; created_at:string }

const POLL_MS=2000; const TICK_MS=120; const MIN_C=1; const MAX_C=80;
const CAP='text-[11px] font-medium uppercase tracking-[0.08em] text-muted';

function fmtMult(n:number|null|undefined):string{ return n==null?'—':Number(n).toFixed(2)+'x'; }
function elapsedMs(iso:string|null):number{ return iso?Math.max(0,Date.now()-new Date(iso).getTime()):0; }
function fmtClock(ms:number):string{ const s=Math.floor(ms/1000); const t=Math.floor((ms%1000)/100); return `${s}.${t}s`; }

export default function GameControlPage(){
  const { isSuperAdmin }=useAdmin();
  const [qEnabled,setQEnabled]=useState<boolean>(false);
  const [round,setRound]=useState<GameRoundRow|null>(null);
  const [queue,setQueue]=useState<CQItem[]>([]);
  const [loading,setLoading]=useState(true);
  const [err,setErr]=useState<string|null>(null);
  const [sVal,setSVal]=useState(''); const [bVal,setBVal]=useState('');
  const [showBatch,setShowBatch]=useState(false);
  const [confirmClear,setConfirmClear]=useState(false);
  const [lock,setLock]=useState<string|null>(null);
  const [,setNow]=useState(Date.now());
  const pRef=useRef<ReturnType<typeof setInterval>>();
  const tRef=useRef<ReturnType<typeof setInterval>>();
  const aRef=useRef<AbortController|null>(null);

  // Fetch ONLY the live round (waiting/flying) + pending queue. Used/crashed never fetched.
  const fetchAll=useCallback(async()=>{
    try{
      aRef.current?.abort(); const ac=new AbortController(); aRef.current=ac; const s=ac.signal;
      const [sr,rr,qr]=await Promise.all([
        supabase.from('system_settings').select('value').eq('key','game.queue_enabled').abortSignal(s).maybeSingle(),
        supabase.from('game_rounds').select('*').in('status',['waiting','flying']).order('round_number',{ascending:false}).limit(1).abortSignal(s).maybeSingle(),
        supabase.from('crash_queue').select('*').eq('status','pending').order('position',{ascending:true}).limit(50).abortSignal(s),
      ]);
      if(s.aborted) return;
      setQEnabled(Boolean(sr.data?.value));
      setRound((rr.data??null) as GameRoundRow|null);
      setQueue((qr.data??[]) as CQItem[]);
      setErr(null);
    }catch(e){ if(e instanceof Error&&e.name==='AbortError')return; setErr(errMsg(e,'Fetch failed')); }
    finally{ setLoading(false); }
  },[]);

  useEffect(()=>{ fetchAll(); pRef.current=setInterval(fetchAll,POLL_MS); return ()=>{clearInterval(pRef.current); aRef.current?.abort();}; },[fetchAll]);
  // smooth multiplier ticker while flying
  useEffect(()=>{ tRef.current=setInterval(()=>setNow(Date.now()),TICK_MS); return ()=>clearInterval(tRef.current); },[]);

  const isFlying=round?.status==='flying';
  const liveMult=isFlying?getMultiplierAtTime(elapsedMs(round!.started_at)):1;

  async function toggleQueue(){
    setLock('qe');
    try{ const {error}=await supabase.rpc('admin_set_setting',{p_key:'game.queue_enabled',p_value:!qEnabled}); if(error)throw error; setQEnabled(!qEnabled); }
    catch(e){ setErr(errMsg(e,'Could not change queue state')); } finally{ setLock(null); }
  }
  async function addSingle(){
    const v=parseFloat(sVal); if(!isFinite(v)||v<MIN_C||v>MAX_C){ setErr(`Crash point must be ${MIN_C}-${MAX_C}`); return; }
    setLock('as');
    try{ const {error}=await supabase.rpc('admin_queue_add',{p_crash:v}); if(error)throw error; setSVal(''); await fetchAll(); }
    catch(e){ setErr(errMsg(e,'Add failed')); } finally{ setLock(null); }
  }
  async function addBatch(){
    const pts=bVal.split(/[\n,]+/).map(x=>parseFloat(x.trim())).filter(x=>isFinite(x));
    if(pts.length===0){ setErr('No valid numbers'); return; }
    if(pts.some(x=>x<MIN_C||x>MAX_C)){ setErr(`All points must be ${MIN_C}-${MAX_C}`); return; }
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
    <div className="-m-6 p-6 sm:p-8 bg-canvas min-h-[calc(100dvh-3.5rem)]">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-[22px] font-semibold text-ink tracking-tight flex items-center gap-2.5">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-brand/10 border border-brand/20"><Target size={16} className="text-brand" /></span>
              Crash Control
            </h1>
            <p className="text-[13px] text-muted mt-1.5">Live round and the upcoming crash-point queue.</p>
          </div>
          <div className="flex items-center gap-3">
            {err&&<span role="alert" className="px-3 py-1.5 bg-down/10 border border-down/30 rounded-lg text-down text-[12px] max-w-[280px] truncate" title={err}>{err}</span>}
            <button onClick={fetchAll} disabled={loading} className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-line bg-surface text-[13px] text-muted hover:text-ink hover:border-brand/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 transition-colors disabled:opacity-50">{loading&&<Spin />}{loading?'Refreshing':'Refresh'}</button>
          </div>
        </div>

        {/* NOW — the live round */}
        <section className="rounded-2xl border border-line bg-surface overflow-hidden">
          <div className="px-6 py-4 border-b border-line flex items-center justify-between">
            <span className={CAP+' flex items-center gap-2'}><Radio size={13} className={isFlying?'text-up':'text-faint'} />Now</span>
            {round&&<span className="text-[11px] text-faint font-mono">Round #{round.round_number} · {round.source}</span>}
          </div>
          {!round?(
            <div className="px-6 py-12 text-center text-faint text-[13px]">No active round.</div>
          ):(
            <div className="px-6 py-6 flex items-center justify-between gap-6 flex-wrap">
              <div className="flex items-center gap-5">
                <span className={'inline-flex px-3 py-1.5 rounded-md text-[11px] font-bold tracking-wide '+(isFlying?'bg-up/10 text-up':round.status==='waiting'?'bg-amber-500/10 text-amber-400':'bg-white/[0.06] text-muted')}>
                  {isFlying?'FLYING':round.status==='waiting'?'BETTING':round.status.toUpperCase()}
                </span>
                <div>
                  <div className={'text-[44px] leading-none font-bold font-mono tracking-tight '+(isFlying?'text-up':'text-ink')}>
                    {isFlying?fmtMult(liveMult):fmtMult(round.crash_multiplier)}
                  </div>
                  <div className="text-[11px] text-muted mt-2 font-mono">
                    {isFlying?`live · ${fmtClock(elapsedMs(round.started_at))}`:round.status==='waiting'?'opens for bets — starts soon':'—'}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[11px] text-muted">Queued crash point</div>
                <div className="text-[20px] font-semibold font-mono text-ink mt-1">{round.queue_id?fmtMult(queue.find(q=>q.id===round.queue_id)?.crash_multiplier ?? null):'algorithm'}</div>
                <div className="text-[10px] text-faint mt-1">{round.queue_id?'consumed from queue':'random this round'}</div>
              </div>
            </div>
          )}
        </section>

        {/* UP NEXT — pending queue only */}
        <section className="rounded-2xl border border-line bg-surface overflow-hidden">
          <div className="px-6 py-4 border-b border-line flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <span className={CAP}>Up next</span>
              <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-brand/10 border border-brand/20 text-brand text-[11px] font-semibold">{queue.length} queued</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={'inline-flex items-center gap-1.5 text-[11px] font-medium '+(qEnabled?'text-up':'text-muted')}>
                <span className={'h-1.5 w-1.5 rounded-full '+(qEnabled?'bg-up animate-pulse':'bg-faint')} />{qEnabled?'Queue driving':'Algorithm driving'}
              </span>
              {isSuperAdmin&&(
                <button onClick={toggleQueue} disabled={lock==='qe'} className={'inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-semibold transition-colors disabled:opacity-50 '+(qEnabled?'border border-down/30 bg-down/10 text-down hover:bg-down/20':'bg-brand text-white hover:bg-brand-dark')}>
                  {lock==='qe'?<Spin />:<Power size={13} />}{qEnabled?'Use algorithm':'Use queue'}
                </button>
              )}
            </div>
          </div>

          {/* Add controls (super admin) */}
          {isSuperAdmin&&(
            <div className="px-6 py-4 border-b border-line bg-white/[0.02] flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2 flex-1 min-w-[220px]">
                <input type="number" value={sVal} onChange={e=>setSVal(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addSingle()} placeholder={`Crash point ${MIN_C}–${MAX_C}`} min={MIN_C} max={MAX_C} step="0.01" className="flex-1 px-3.5 py-2.5 bg-surface border border-line rounded-lg text-sm text-ink font-mono placeholder:text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus:border-brand/40 transition" />
                <button onClick={addSingle} disabled={lock==='as'||!sVal.trim()} className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-brand hover:bg-brand-dark text-white font-semibold text-[13px] rounded-lg transition-colors disabled:opacity-40">{lock==='as'?<Spin />:<Plus size={14} />}Add</button>
              </div>
              <button onClick={()=>setShowBatch(v=>!v)} className="inline-flex items-center gap-1.5 px-3.5 py-2.5 border border-line bg-surface text-muted hover:text-ink text-[13px] font-medium rounded-lg transition-colors"><ListPlus size={14} />Batch</button>
              {queue.length>0&&<button onClick={()=>setConfirmClear(true)} className="inline-flex items-center gap-1.5 px-3.5 py-2.5 border border-down/30 bg-down/10 text-down hover:bg-down/20 text-[13px] font-medium rounded-lg transition-colors"><Trash2 size={14} />Clear all</button>}
            </div>
          )}
          {isSuperAdmin&&showBatch&&(
            <div className="px-6 py-4 border-b border-line space-y-3">
              <textarea value={bVal} onChange={e=>setBVal(e.target.value)} placeholder="1.23, 4.56, 12.00 — one per line or comma-separated" rows={3} className="w-full px-3.5 py-2.5 bg-surface border border-line rounded-lg text-sm text-ink font-mono placeholder:text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus:border-brand/40 transition" />
              <div className="flex justify-end gap-2">
                <button onClick={()=>setShowBatch(false)} className="px-3.5 py-2 border border-line bg-surface text-muted text-[13px] rounded-lg">Cancel</button>
                <button onClick={addBatch} disabled={lock==='ab'||!bVal.trim()} className="inline-flex items-center gap-1.5 px-4 py-2 bg-brand hover:bg-brand-dark text-white font-semibold text-[13px] rounded-lg disabled:opacity-40">{lock==='ab'&&<Spin />}Add batch</button>
              </div>
            </div>
          )}

          {/* Queue list — pending only, in order */}
          {queue.length===0?(
            <div className="px-6 py-16 text-center">
              <Activity size={20} className="mx-auto text-faint mb-3" />
              <p className="text-faint text-[13px]">No upcoming crash points.</p>
              <p className="text-faint text-[11px] mt-1">Autofill tops the queue up automatically.</p>
            </div>
          ):(
            <ul className="divide-y divide-line">
              {queue.map((q,i)=>(
                <li key={q.id} className={'flex items-center gap-4 px-6 py-3.5 transition-colors '+(i===0?'bg-brand/[0.04]':'hover:bg-white/[0.02]')}>
                  <span className={'w-14 flex-shrink-0 text-[11px] font-semibold uppercase tracking-wide '+(i===0?'text-brand':'text-faint')}>{i===0?'Next':'+'+(i+1)}</span>
                  <span className="flex-1 font-mono text-[15px] font-semibold text-ink">{fmtMult(q.crash_multiplier)}</span>
                  <span className={'inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide '+(q.status==='pending'?(i===0?'bg-brand/10 text-brand':'bg-white/[0.06] text-muted'):'bg-white/[0.04] text-faint')}>{i===0?'on deck':'queued'}</span>
                  {isSuperAdmin?(
                    <button onClick={()=>removeOne(q.id)} disabled={lock==='rm'+q.id} title="Remove from queue" className="inline-flex items-center justify-center h-8 w-8 rounded-lg text-faint hover:text-down hover:bg-down/10 transition-colors disabled:opacity-40">{lock==='rm'+q.id?<Spin />:<X size={15} />}</button>
                  ):<span className="w-8" />}
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="text-[11px] text-faint text-center">Only the live round and upcoming crash points are shown. Used points drop off the moment a round crashes.</p>
      </div>

      {/* Clear confirm */}
      {confirmClear&&(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={()=>setConfirmClear(false)}>
          <div className="bg-surface border border-line rounded-2xl p-7 w-full max-w-sm shadow-xl" onClick={e=>e.stopPropagation()}>
            <h3 className="text-ink font-semibold text-lg">Clear queue</h3>
            <p className="text-muted text-[13px] mt-3 leading-relaxed">Remove all {queue.length} upcoming crash point(s)? Autofill will top the queue back up. This cannot be undone.</p>
            <div className="flex gap-3 mt-6">
              <button onClick={()=>setConfirmClear(false)} disabled={lock==='cl'} className="flex-1 py-2.5 border border-line bg-surface rounded-lg text-muted font-semibold text-sm hover:text-ink transition-colors disabled:opacity-40">Cancel</button>
              <button onClick={clearAll} disabled={lock==='cl'} className="flex-1 py-2.5 rounded-lg text-white font-semibold text-sm bg-down hover:brightness-95 transition disabled:opacity-40 inline-flex items-center justify-center gap-2">{lock==='cl'&&<Spin />}Clear all</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
