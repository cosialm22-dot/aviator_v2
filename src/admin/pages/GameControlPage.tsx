import { useState, useEffect, useRef, useCallback } from 'react';
import { Spin } from '../components/Spin';
import { errMsg } from '../../lib/errors';
import { supabase } from '../../lib/supabase';
import { useAdmin } from '../roleContext';
import { getMultiplierAtTime, formatMultiplier } from '../../lib/gameEngine';
import { Activity, Target, Power } from 'lucide-react';

interface GameRoundRow { id:string; crash_multiplier:number; status:string; started_at:string|null; crashed_at:string|null; source:string; queue_id:string|null }
interface CQItem { id:string; crash_multiplier:number; position:number; status:string; created_at:string }

const POLL_MS=3000; const TICK_MS=150; const ZOMBIE_MS=12e4; const MIN_C=1; const MAX_C=80;
type Tab='monitor'|'queue';

function fmtKES(n:number):string{return n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(1)+'K':n.toLocaleString('en-KE')}
function elapsed(iso:string|null):number{return iso?Math.floor((Date.now()-new Date(iso).getTime())/1e3):0}


const CAP = 'text-[11px] font-medium uppercase tracking-[0.08em] text-muted';

export default function GameControlPage(){
const{isSuperAdmin}=useAdmin();
const[tab,setTab]=useState<Tab>('monitor');
const[qEnabled,setQEnabled]=useState<boolean>(false);
const[round,setRound]=useState<GameRoundRow|null>(null);
const[bCnt,setBCnt]=useState(0);const[bTot,setBTot]=useState(0);
const[mult,setMult]=useState(1);
const[queue,setQueue]=useState<CQItem[]>([]);
const[zCnt,setZCnt]=useState(0);
const[loading,setLoading]=useState(true);
const[err,setErr]=useState<string|null>(null);
const[sVal,setSVal]=useState('');const[bVal,setBVal]=useState('');
const[shFC,setShFC]=useState(false);const[shCl,setShCl]=useState(false);const[shRc,setShRc]=useState(false);
const[lock,setLock]=useState<string|null>(null);
const pRef=useRef<ReturnType<typeof setInterval>>();
const tRef=useRef<ReturnType<typeof setInterval>>();
const aRef=useRef<AbortController|null>(null);

const fetchAll=useCallback(async()=>{try{aRef.current?.abort();const ac=new AbortController();aRef.current=ac;const s=ac.signal;const[rr,ar,qr,zr]=await Promise.all([supabase.from('game_rounds').select('*').order('created_at',{ascending:false}).limit(1).abortSignal(s).maybeSingle(),supabase.from('game_rounds').select('id').eq('status','flying').limit(1).abortSignal(s).maybeSingle(),supabase.from('crash_queue').select('*').eq('status','pending').order('position',{ascending:true}).limit(100).abortSignal(s),supabase.from('game_rounds').select('id',{count:'exact',head:true}).eq('status','flying').lt('started_at',new Date(Date.now()-ZOMBIE_MS).toISOString()).abortSignal(s)]);if(s.aborted)return;let active=(rr.data??null)as GameRoundRow|null;if(ar.data&&active?.status!=='flying'){const fr=await supabase.from('game_rounds').select('*').eq('id',ar.data.id).abortSignal(s).maybeSingle();if(!s.aborted&&fr.data)active=fr.data as GameRoundRow}setRound(active);if(active?.status==='flying'){const br=await supabase.from('bets').select('amount',{count:'exact'}).eq('round_id',active.id).eq('status','active').abortSignal(s);if(!s.aborted&&br.data){setBCnt(br.count??0);setBTot(br.data.reduce((sm:number,b:{amount:number})=>sm+Number(b.amount),0))}}else{setBCnt(0);setBTot(0)}setQueue((qr.data??[])as CQItem[]);setZCnt(zr.count??0);setErr(null)}catch(e){if(e instanceof Error&&e.name==='AbortError')return;setErr(errMsg(e,'Fetch failed'))}finally{setLoading(false)}},[]);

useEffect(()=>{if(round?.status!=='flying'||!round.started_at){setMult(1);return}const st=new Date(round.started_at).getTime();const tick=()=>{const m=getMultiplierAtTime(Date.now()-st);setMult(m>=Number(round.crash_multiplier)?Number(round.crash_multiplier):m)};tick();tRef.current=setInterval(tick,TICK_MS);return()=>clearInterval(tRef.current)},[round?.status,round?.started_at,round?.crash_multiplier]);

const loadQEnabled=useCallback(async()=>{const{data}=await supabase.from('system_settings').select('value').eq('key','game.queue_enabled').maybeSingle();setQEnabled(Boolean(data?.value))},[]);

useEffect(()=>{fetchAll();loadQEnabled();pRef.current=setInterval(fetchAll,POLL_MS);return()=>{clearInterval(pRef.current);clearInterval(tRef.current);aRef.current?.abort()}},[fetchAll,loadQEnabled]);

const toggleQueue=async()=>{if(lock)return;setLock('qe');try{const{error:qeErr}=await supabase.rpc('admin_set_setting',{p_key:'game.queue_enabled',p_value:!qEnabled});if(qeErr)throw qeErr;await loadQEnabled();setErr(null)}catch(e){setErr(errMsg(e,'Failed'))}finally{setLock(null)}};

const forceCrash=async()=>{if(!round||round.status!=='flying'||lock)return;setLock('fc');try{const{error:fcErr}=await supabase.rpc('admin_force_crash',{p_round_id:round.id});if(fcErr)throw fcErr;setShFC(false);fetchAll()}catch(e){setErr(errMsg(e,'Failed'))}finally{setLock(null)}};

const recoverZ=async()=>{if(lock)return;setLock('rc');try{const{error:rzErr}=await supabase.rpc('admin_recover_zombies',{p_older_than_seconds:Math.round(ZOMBIE_MS/1000)});if(rzErr)throw rzErr;setShRc(false);fetchAll()}catch(e){setErr(errMsg(e,'Failed'))}finally{setLock(null)}};

const addSingle=async()=>{if(lock)return;const v=parseFloat(sVal);if(isNaN(v)||v<MIN_C||v>MAX_C){setErr('Must be '+MIN_C+'-'+MAX_C);return}setLock('as');try{const{error:aErr}=await supabase.rpc('admin_queue_add',{p_crash:v});if(aErr)throw aErr;setSVal('');setErr(null);fetchAll()}catch(e){setErr(errMsg(e,'Add failed'))}finally{setLock(null)}};

const addBatch=async()=>{if(lock)return;const lines=bVal.split(/[\n,]+/).map((l:string)=>l.trim()).filter((l:string)=>l);const vals:number[]=[];const errs:string[]=[];for(const l of lines){const v=parseFloat(l);if(isNaN(v)||v<MIN_C||v>MAX_C)errs.push('Invalid: '+l);else vals.push(v)}if(errs.length){setErr(errs.join('; '));return}if(!vals.length)return;setLock('ab');try{const{error:bErr}=await supabase.rpc('admin_queue_add_batch',{p_points:vals});if(bErr)throw bErr;setBVal('');setErr(null);fetchAll()}catch(e){setErr(errMsg(e,'Batch failed'))}finally{setLock(null)}};

const removeQ=async(id:string)=>{if(lock)return;setLock('rm-'+id);try{const{error:rErr}=await supabase.rpc('admin_queue_remove',{p_id:id});if(rErr)throw rErr;setErr(null);fetchAll()}catch(e){setErr(errMsg(e,'Remove failed'))}finally{setLock(null)}};

const clearQ=async()=>{if(lock)return;setLock('cq');try{const{error:cErr}=await supabase.rpc('admin_queue_clear');if(cErr)throw cErr;setShCl(false);setErr(null);fetchAll()}catch(e){setErr(errMsg(e,'Clear failed'))}finally{setLock(null)}};

const isF=round?.status==='flying';const pendingQ=queue.filter(q=>q.status==='pending');
const TABS=[{k:'monitor'as Tab,l:'Live Monitor',i:Activity},{k:'queue'as Tab,l:'Crash Queue',i:Target}];

return(
  <div className="-m-6 p-6 sm:p-8 bg-canvas min-h-[calc(100dvh-3.5rem)]">
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] font-semibold text-ink tracking-tight">Game Control</h1>
          <p className="text-[13px] text-muted mt-1">Live monitor and crash queue</p>
        </div>
        <div className="flex items-center gap-3">
          {err&&<span role="alert" className="px-3 py-1.5 bg-down/10 border border-down/30 rounded-lg text-down text-[12px] max-w-[280px] truncate" title={err}>{err}</span>}
          <button onClick={fetchAll} disabled={loading} className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-line bg-surface text-[13px] text-muted hover:text-ink hover:border-brand/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 transition-colors disabled:opacity-50">{loading&&<Spin />}{loading?'Refreshing':'Refresh'}</button>
        </div>
      </div>

      <div className="inline-flex gap-1 bg-white/[0.06] border border-line rounded-lg p-1">
        {TABS.map(t=>(
          <button key={t.k} onClick={()=>setTab(t.k)} className={'inline-flex items-center gap-2 px-4 py-1.5 rounded-md text-[13px] font-medium transition-colors '+((tab===t.k)?'bg-surface text-ink shadow-sm':'text-muted hover:text-ink')}><t.i size={14} strokeWidth={1.75} />{t.l}</button>
        ))}
      </div>

      {tab==='monitor'&&(<div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-xl border border-line bg-surface p-5">
            <div className="flex items-center justify-between"><span className={CAP}>Status</span><span className={'h-2 w-2 rounded-full '+(isF?'bg-up animate-pulse':round?.status==='crashed'?'bg-down':'bg-faint')} /></div>
            <div className="mt-3"><span className={'inline-flex px-2.5 py-1 rounded-md text-[11px] font-bold '+(isF?'bg-up/10 text-up':round?.status==='crashed'?'bg-down/10 text-down':'bg-white/[0.06] text-muted')}>{round?.status?.toUpperCase()||'-'}</span></div>
            <div className="text-[11px] text-muted mt-2">Source: <span className="text-ink font-mono">{round?.source||'algorithm'}</span></div>
          </div>
          <div className="rounded-xl border border-line bg-surface p-5">
            <span className={CAP}>Multiplier</span>
            <div className={'mt-3 text-2xl font-semibold font-mono tabular-nums '+(isF?'text-up':'text-ink')}>{isF?formatMultiplier(mult):formatMultiplier(Number(round?.crash_multiplier??1))}</div>
            {isF&&<div className="text-[11px] text-amber-400 font-medium mt-1">Crash at {Number(round?.crash_multiplier).toFixed(2)}x</div>}
          </div>
          <div className="rounded-xl border border-line bg-surface p-5">
            <span className={CAP}>Elapsed</span>
            <div className="mt-3 text-2xl font-semibold text-ink tabular-nums">{isF&&round?.started_at?elapsed(round.started_at)+'s':'-'}</div>
            {round?.crashed_at&&<div className="text-[11px] text-muted mt-1">Crashed {new Date(round.crashed_at).toLocaleTimeString()}</div>}
          </div>
          <div className="rounded-xl border border-line bg-surface p-5">
            <span className={CAP}>Exposure</span>
            <div className="mt-3 flex items-baseline gap-1.5"><span className="text-2xl font-semibold text-ink tabular-nums">{isF?bCnt:'-'}</span><span className="text-[11px] text-muted">bets</span></div>
            <div className="text-[11px] text-muted mt-1 font-mono">{isF?'KSh '+fmtKES(bTot):'-'}</div>
          </div>
        </div>
        {isF&&(<div className="rounded-xl border border-down/30 bg-down/5 p-5 flex items-center justify-between gap-4 flex-wrap">
          <div><div className="text-ink font-semibold text-sm">Emergency: Force Crash</div><p className="text-[12px] text-muted mt-1">Crashes the round now at the current multiplier. All active bets lose. Recorded as an override and audited.</p></div>
          <button onClick={()=>setShFC(true)} className="px-4 py-2.5 bg-down hover:brightness-95 text-white font-semibold text-sm rounded-lg transition flex-shrink-0">Force Crash Now</button>
        </div>)}
        {!round&&!loading&&(<div className="rounded-xl border border-line bg-surface p-16 text-center"><div className="text-ink font-semibold text-lg">Waiting for game activity</div><div className="text-[13px] text-muted mt-1">Open the game in another tab to start a round</div></div>)}
        {zCnt>0&&(<div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-5 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3"><span className="h-2 w-2 rounded-full bg-amber-500" /><div><div className="text-ink font-semibold text-sm">{zCnt} zombie round{zCnt!==1?'s':''} detected</div><div className="text-[12px] text-muted">Stuck 2+ minutes. Recover to mark as crashed.</div></div></div>
          <button onClick={()=>setShRc(true)} className="px-4 py-2.5 rounded-lg border border-amber-500/40 bg-amber-500/20 text-amber-400 font-semibold text-sm hover:bg-amber-500/20 transition-colors">Recover All</button>
        </div>)}
      </div>)}

      {tab==='queue'&&(<div className="space-y-6">
        <div className={'rounded-xl border p-5 flex items-center justify-between gap-4 flex-wrap '+(qEnabled?'border-up/30 bg-up/5':'border-line bg-surface')}>
          <div className="flex items-start gap-3">
            <span className={'mt-1 h-2 w-2 rounded-full flex-shrink-0 '+(qEnabled?'bg-up animate-pulse':'bg-faint')} />
            <div>
              <div className="text-ink font-semibold text-sm">Preset queue {qEnabled?'ACTIVE':'INACTIVE'}</div>
              <p className="text-[12px] text-muted mt-0.5 max-w-md">{qEnabled?'Each round uses the next pending crash point below; the random algorithm is bypassed.':'Crash points come from the random algorithm. Queued points are ignored until you activate the queue.'}</p>
            </div>
          </div>
          {isSuperAdmin?(
            <button onClick={toggleQueue} disabled={lock==='qe'} className={'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 flex-shrink-0 '+(qEnabled?'border border-down/30 bg-down/10 text-down hover:bg-down/20':'bg-brand text-white hover:bg-brand-dark')}>{lock==='qe'?<Spin />:<Power size={14} />}{qEnabled?'Deactivate':'Activate queue'}</button>
          ):(
            <span className="text-[11px] text-muted flex-shrink-0">Only a super admin can change this.</span>
          )}
        </div>
        {!isSuperAdmin&&(<div className="rounded-xl border border-line bg-surface px-5 py-3 text-[12px] text-muted">You can view the crash queue. Editing crash points requires a super admin.</div>)}
        <div className="rounded-xl border border-line bg-surface p-6 space-y-4">
          <div className="flex gap-3">
            <input type="number" value={sVal} onChange={e=>setSVal(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addSingle()} placeholder="1-80" min={MIN_C} max={MAX_C} step="0.01" disabled={!isSuperAdmin} className="flex-1 px-4 py-3 bg-surface border border-line rounded-lg text-sm text-ink font-mono placeholder:text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus:border-brand/40 transition disabled:opacity-50" />
            <button onClick={addSingle} disabled={lock==='as'||!sVal.trim()||!isSuperAdmin} className="inline-flex items-center gap-2 px-5 py-3 bg-brand hover:bg-brand-dark text-white font-semibold text-sm rounded-lg transition-colors disabled:opacity-40 flex-shrink-0">{lock==='as'&&<Spin />}Add</button>
          </div>
          <details className="group">
            <summary className="text-[12px] text-muted cursor-pointer hover:text-ink">Batch add (one per line, comma-separated)</summary>
            <div className="mt-3 space-y-3">
              <textarea value={bVal} onChange={e=>setBVal(e.target.value)} placeholder="1.23,4.56,12.00" rows={3} disabled={!isSuperAdmin} className="w-full px-4 py-3 bg-surface border border-line rounded-lg text-sm text-ink font-mono placeholder:text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus:border-brand/40 resize-none transition disabled:opacity-50" />
              <button onClick={addBatch} disabled={lock==='ab'||!bVal.trim()||!isSuperAdmin} className="inline-flex items-center gap-2 px-4 py-2.5 border border-line bg-surface hover:border-brand/40 hover:text-brand text-ink font-semibold text-sm rounded-lg transition-colors disabled:opacity-40">{lock==='ab'&&<Spin />}Add {bVal.trim()?bVal.split(/[\n,]+/).filter((l:string)=>l.trim()).length:0} items</button>
            </div>
          </details>
        </div>
        <div className="flex items-center justify-between px-5 py-3 rounded-xl border border-line bg-surface"><span className="text-[12px] text-muted">Upcoming crash points</span><span className="text-[12px] font-semibold text-ink">{pendingQ.length} queued</span></div><div className="rounded-xl border border-line bg-surface overflow-hidden">
          <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface"><tr className="border-b border-line text-[10px] uppercase tracking-[0.08em] text-faint">
                <th className="text-left px-5 py-3 font-medium w-12">#</th><th className="text-left px-5 py-3 font-medium">Multiplier</th><th className="text-left px-5 py-3 font-medium">Status</th><th className="text-left px-5 py-3 font-medium hidden lg:table-cell">Added</th><th className="text-right px-5 py-3 font-medium w-24" />
              </tr></thead>
              <tbody className="divide-y divide-line">
                {queue.length===0?(<tr><td colSpan={5} className="px-5 py-16 text-center text-faint text-[12px]">No upcoming crash points - autofill will top up the queue.</td></tr>):queue.map(q=>(
                  <tr key={q.id} className="hover:bg-canvas transition-colors">
                    <td className="px-5 py-3 text-muted font-mono text-xs">{q.position}</td>
                    <td className="px-5 py-3 text-ink font-mono font-semibold">{Number(q.crash_multiplier).toFixed(2)}x</td>
                    <td className="px-5 py-3"><span className={'inline-flex px-2 py-0.5 rounded-md text-[10px] font-semibold '+(q.status==='pending'?'bg-brand/10 text-brand':q.status==='used'?'bg-up/10 text-up':'bg-white/[0.06] text-muted')}>{q.status}</span></td>
                    <td className="px-5 py-3 text-muted text-xs hidden lg:table-cell">{new Date(q.created_at).toLocaleTimeString()}</td>
                    <td className="px-5 py-3 text-right"><button onClick={()=>removeQ(q.id)} disabled={lock==='rm-'+q.id||q.status!=='pending'||!isSuperAdmin} className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted hover:text-down disabled:opacity-30 transition-colors">{lock==='rm-'+q.id&&<Spin />}Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pendingQ.length>0&&(<div className="px-5 py-3 border-t border-line flex items-center justify-between"><span className="text-[11px] text-muted">{pendingQ.length} pending</span><button onClick={()=>setShCl(true)} disabled={!isSuperAdmin} className="px-3 py-1.5 rounded-lg border border-down/30 bg-down/10 text-down text-[11px] font-medium hover:bg-down/20 transition-colors disabled:opacity-40">Clear All</button></div>)}
        </div>
      </div>)}


      {shFC&&<Modal title="Force Crash" msg={'Crash round at '+formatMultiplier(mult)+'? All active bets will lose. This cannot be undone.'} btn="Force Crash" color="bg-down hover:brightness-95" loading={lock==='fc'} onConfirm={forceCrash} onCancel={()=>setShFC(false)} />}
      {shRc&&<Modal title="Recover Zombie Rounds" msg={'Mark '+zCnt+' stuck round(s) as crashed? These never completed (browser closed mid-flight).'} btn="Recover All" color="bg-amber-600 hover:bg-amber-600" loading={lock==='rc'} onConfirm={recoverZ} onCancel={()=>setShRc(false)} />}
      {shCl&&<Modal title="Clear Queue" msg={'Remove all '+pendingQ.length+' pending crash point(s)? This cannot be undone.'} btn="Clear All" color="bg-down hover:brightness-95" loading={lock==='cq'} onConfirm={clearQ} onCancel={()=>setShCl(false)} />}
    </div>
  </div>);}

interface ModalProps { title: string; msg: string; btn: string; color: string; loading: boolean; onConfirm: () => void; onCancel: () => void }
function Modal({title,msg,btn,color,loading,onConfirm,onCancel}:ModalProps){return(
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onCancel}>
    <div className="bg-surface border border-line rounded-2xl p-7 w-full max-w-sm shadow-xl" onClick={e=>e.stopPropagation()}>
      <h3 className="text-ink font-semibold text-lg">{title}</h3>
      <p className="text-muted text-[13px] mt-3 leading-relaxed">{msg}</p>
      <div className="flex gap-3 mt-6">
        <button onClick={onCancel} disabled={loading} className="flex-1 py-2.5 border border-line bg-surface rounded-lg text-muted font-semibold text-sm hover:text-ink transition-colors disabled:opacity-40">Cancel</button>
        <button onClick={onConfirm} disabled={loading} className={'flex-1 py-2.5 rounded-lg text-white font-semibold text-sm transition disabled:opacity-40 inline-flex items-center justify-center gap-2 '+color}>{loading&&<Spin />}{btn}</button>
      </div>
    </div>
  </div>
);}
