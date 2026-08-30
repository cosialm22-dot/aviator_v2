import { useState, useEffect, useRef, useCallback } from 'react';
import { Spin } from '../components/Spin';
import { errMsg } from '../../lib/errors';
import { supabase } from '../../lib/supabase';
import { useAdmin } from '../roleContext';
import { getMultiplierAtTime } from '../../lib/gameEngine';
import { Target, Power, Plus, ListPlus, Trash2, X, Plane, Layers } from 'lucide-react';

interface LiveRound { id:string; round_number:number; status:string; started_at:string|null; betting_ends_at:string|null; source:string; queue_id:string|null; crash_point:number|null }
interface CQItem { id:string; crash_multiplier:number; position:number; status:string; created_at:string }

const POLL_MS=2000; const TICK_MS=120; const MIN_C=1; const MAX_C=80;
const CAP='text-[11px] font-semibold uppercase tracking-[0.1em] text-muted';

function fmt(n:number|null|undefined):string{ return n==null?'—':Number(n).toFixed(2)+'x'; }
function elapsedMs(iso:string|null):number{ return iso?Math.max(0,Date.now()-new Date(iso).getTime()):0; }
// colour by crash-point magnitude (matches player-facing history palette)
function cpTone(v:number|null):string{
  if(v==null) return 'text-ink';
  if(v<1.5) return 'text-down';
  if(v<2)   return 'text-amber-400';
  if(v<5)   return 'text-up';
  if(v<10)  return 'text-cyan-400';
  return 'text-amber-300';
}

export default function GameControlPage(){
  const { isSuperAdmin }=useAdmin();
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
    <div className="-m-6 min-h-[calc(100dvh-3.5rem)] bg-canvas px-4 py-6 sm:px-8 sm:py-8">
      <div className="mx-auto max-w-3xl space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand/10 border border-brand/20"><Target size={18} className="text-brand" /></span>
            <div>
              <h1 className="text-[20px] font-semibold text-ink tracking-tight">Crash Control</h1>
              <p className="text-[12px] text-muted">The round in play and the upcoming crash points.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {err&&<span role="alert" className="px-3 py-1.5 bg-down/10 border border-down/30 rounded-lg text-down text-[12px] max-w-[240px] truncate" title={err}>{err}</span>}
            <button onClick={fetchAll} disabled={loading} className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-line bg-surface text-[13px] text-muted hover:text-ink hover:border-brand/40 transition-colors disabled:opacity-50">{loading&&<Spin />}{loading?'…':'Refresh'}</button>
          </div>
        </div>

        {/* ============ NOW ============ */}
        <section className="rounded-2xl border border-line bg-surface overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-line bg-white/[0.02]">
            <span className={CAP+' flex items-center gap-2'}><Plane size={13} className={isFlying?'text-up':'text-faint'} />Now</span>
            {round&&<span className="text-[11px] text-faint font-mono">Round #{round.round_number}</span>}
          </div>

          {!round?(
            <div className="px-5 py-12 text-center">
              <p className="text-muted text-[14px] font-medium">No round in play</p>
              <p className="text-faint text-[12px] mt-1">The next round is being prepared.</p>
            </div>
          ):(
            <div className="px-5 py-6">
              <div className="flex items-end justify-between gap-6 flex-wrap">
                <div>
                  <div className="text-[11px] text-muted mb-1.5">{isFlying?'Crashes at':'Will crash at'}</div>
                  <div className={'text-[52px] leading-none font-bold font-mono tracking-tight '+cpTone(cp)}>{fmt(cp)}</div>
                  <div className="mt-3 flex items-center gap-2">
                    <span className={'inline-flex px-2.5 py-1 rounded-md text-[11px] font-bold tracking-wide '+(isFlying?'bg-up/10 text-up':'bg-amber-500/10 text-amber-400')}>
                      {isFlying?'FLYING':'BETTING OPEN'}
                    </span>
                    <span className="text-[11px] text-faint">{round.source==='queue'?'from queue':'algorithm'}</span>
                  </div>
                </div>
                {isFlying&&liveMult!=null&&(
                  <div className="text-right">
                    <div className="text-[11px] text-muted mb-1.5">Current</div>
                    <div className="text-[28px] leading-none font-semibold font-mono text-ink">{fmt(liveMult)}</div>
                    <div className="text-[10px] text-faint mt-1.5">climbing</div>
                  </div>
                )}
              </div>

              {/* progress toward the fixed crash point */}
              {isFlying&&cp&&cp>1&&(
                <div className="mt-5">
                  <div className="h-1.5 w-full rounded-full bg-white/[0.06] overflow-hidden">
                    <div className="h-full rounded-full bg-up transition-all duration-150" style={{width:pct+'%'}} />
                  </div>
                  <div className="mt-1.5 flex justify-between text-[10px] text-faint font-mono"><span>1.00x</span><span>{fmt(cp)}</span></div>
                </div>
              )}
              {isWaiting&&(
                <p className="mt-4 text-[12px] text-muted">Betting is open. The round starts when the timer ends.</p>
              )}
            </div>
          )}
        </section>

        {/* ============ UP NEXT ============ */}
        <section className="rounded-2xl border border-line bg-surface overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-line bg-white/[0.02] flex-wrap">
            <span className={CAP+' flex items-center gap-2'}><Layers size={13} className="text-brand" />Up next
              <span className="ml-1 inline-flex items-center px-2 py-0.5 rounded-md bg-brand/10 border border-brand/20 text-brand text-[11px] font-bold normal-case tracking-normal">{queue.length}</span>
            </span>
            <div className="flex items-center gap-2">
              <span className={'inline-flex items-center gap-1.5 text-[11px] font-medium '+(qEnabled?'text-up':'text-muted')}>
                <span className={'h-1.5 w-1.5 rounded-full '+(qEnabled?'bg-up animate-pulse':'bg-faint')} />{qEnabled?'Queue on':'Algorithm on'}
              </span>
              {isSuperAdmin&&(
                <button onClick={toggleQueue} disabled={lock==='qe'} className={'inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-semibold transition-colors disabled:opacity-50 '+(qEnabled?'border border-line bg-surface text-muted hover:text-ink':'bg-brand text-white hover:bg-brand-dark')}>
                  {lock==='qe'?<Spin />:<Power size={13} />}{qEnabled?'Switch to algorithm':'Use queue'}
                </button>
              )}
            </div>
          </div>

          {/* add controls */}
          {isSuperAdmin&&(
            <div className="px-5 py-3.5 border-b border-line flex items-center gap-2 flex-wrap">
              <input type="number" value={sVal} onChange={e=>setSVal(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addSingle()} placeholder={`Add crash point ${MIN_C}–${MAX_C}`} min={MIN_C} max={MAX_C} step="0.01" className="flex-1 min-w-[180px] px-3.5 py-2.5 bg-canvas border border-line rounded-lg text-sm text-ink font-mono placeholder:text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus:border-brand/40 transition" />
              <button onClick={addSingle} disabled={lock==='as'||!sVal.trim()} className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-brand hover:bg-brand-dark text-white font-semibold text-[13px] rounded-lg transition-colors disabled:opacity-40">{lock==='as'?<Spin />:<Plus size={14} />}Add</button>
              <button onClick={()=>setShowBatch(v=>!v)} className="inline-flex items-center gap-1.5 px-3.5 py-2.5 border border-line bg-surface text-muted hover:text-ink text-[13px] font-medium rounded-lg transition-colors"><ListPlus size={14} />Batch</button>
              {queue.length>0&&<button onClick={()=>setConfirmClear(true)} className="inline-flex items-center gap-1.5 px-3.5 py-2.5 border border-down/30 text-down hover:bg-down/10 text-[13px] font-medium rounded-lg transition-colors"><Trash2 size={14} />Clear</button>}
            </div>
          )}
          {isSuperAdmin&&showBatch&&(
            <div className="px-5 py-3.5 border-b border-line space-y-2.5">
              <textarea value={bVal} onChange={e=>setBVal(e.target.value)} placeholder="1.23, 4.56, 12.00" rows={3} className="w-full px-3.5 py-2.5 bg-canvas border border-line rounded-lg text-sm text-ink font-mono placeholder:text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus:border-brand/40 transition" />
              <div className="flex justify-end gap-2">
                <button onClick={()=>setShowBatch(false)} className="px-3.5 py-2 border border-line bg-surface text-muted text-[13px] rounded-lg">Cancel</button>
                <button onClick={addBatch} disabled={lock==='ab'||!bVal.trim()} className="inline-flex items-center gap-1.5 px-4 py-2 bg-brand hover:bg-brand-dark text-white font-semibold text-[13px] rounded-lg disabled:opacity-40">{lock==='ab'&&<Spin />}Add batch</button>
              </div>
            </div>
          )}

          {/* pending list */}
          {queue.length===0?(
            <div className="px-5 py-14 text-center">
              <p className="text-muted text-[13px] font-medium">No upcoming crash points</p>
              <p className="text-faint text-[11px] mt-1">Autofill tops the queue up automatically.</p>
            </div>
          ):(
            <ul className="divide-y divide-line">
              {queue.map((q,i)=>(
                <li key={q.id} className={'flex items-center gap-4 px-5 py-3 transition-colors '+(i===0?'bg-brand/[0.05]':'hover:bg-white/[0.02]')}>
                  <span className={'w-12 flex-shrink-0 text-[11px] font-bold uppercase tracking-wide '+(i===0?'text-brand':'text-faint')}>{i===0?'Next':'+'+(i+1)}</span>
                  <span className={'flex-1 font-mono text-[16px] font-semibold '+cpTone(q.crash_multiplier)}>{fmt(q.crash_multiplier)}</span>
                  {isSuperAdmin?(
                    <button onClick={()=>removeOne(q.id)} disabled={lock==='rm'+q.id} title="Remove" className="inline-flex items-center justify-center h-8 w-8 rounded-lg text-faint hover:text-down hover:bg-down/10 transition-colors disabled:opacity-40">{lock==='rm'+q.id?<Spin />:<X size={15} />}</button>
                  ):<span className="w-8" />}
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="text-center text-[11px] text-faint">Only the round in play and upcoming crash points are shown. A point disappears the moment its round crashes.</p>
      </div>

      {/* clear confirm */}
      {confirmClear&&(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={()=>setConfirmClear(false)}>
          <div className="bg-surface border border-line rounded-2xl p-7 w-full max-w-sm shadow-xl" onClick={e=>e.stopPropagation()}>
            <h3 className="text-ink font-semibold text-lg">Clear queue</h3>
            <p className="text-muted text-[13px] mt-3 leading-relaxed">Remove all {queue.length} upcoming crash point(s)? Autofill will top the queue back up.</p>
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
