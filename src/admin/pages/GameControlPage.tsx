import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { getMultiplierAtTime, formatMultiplier } from '../../lib/gameEngine';
import { Activity, Target, Settings } from 'lucide-react';

interface GameRoundRow { id:string; crash_multiplier:number; status:string; started_at:string|null; crashed_at:string|null; source:string; queue_id:string|null }
interface CQItem { id:string; crash_point:number; position:number; status:string; created_at:string }
interface GSetting { key:string; value:any; description:string|null }

const POLL_MS=3000; const TICK_MS=150; const ZOMBIE_MS=12e4; const MIN_C=1; const MAX_C=80;
type Tab='monitor'|'queue'|'params';

function fmtKES(n:number):string{return n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(1)+'K':n.toLocaleString('en-KE')}
function elapsed(iso:string|null):number{return iso?Math.floor((Date.now()-new Date(iso).getTime())/1e3):0}
function sc(s:string):string{return s==='flying'?'bg-emerald-500 text-white':s==='crashed'?'bg-red-500 text-white':s==='waiting'?'bg-amber-500 text-black':'bg-slate-600 text-white'}

const CAP = 'text-[11px] font-medium uppercase tracking-[0.08em] text-muted';
function Spin() { return <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-current border-r-transparent animate-spin" />; }

export default function GameControlPage(){
const[tab,setTab]=useState<Tab>('monitor');
const[round,setRound]=useState<GameRoundRow|null>(null);
const[bCnt,setBCnt]=useState(0);const[bTot,setBTot]=useState(0);
const[mult,setMult]=useState(1);
const[queue,setQueue]=useState<CQItem[]>([]);
const[gSet,setGSet]=useState<GSetting[]>([]);
const[zCnt,setZCnt]=useState(0);
const[loading,setLoading]=useState(true);
const[err,setErr]=useState<string|null>(null);
const[sVal,setSVal]=useState('');const[bVal,setBVal]=useState('');
const[shFC,setShFC]=useState(false);const[shCl,setShCl]=useState(false);const[shRc,setShRc]=useState(false);
const[ev,setEv]=useState<Record<string,string>>({});
const[saving,setSaving]=useState<string|null>(null);
const[lock,setLock]=useState<string|null>(null);
const pRef=useRef<ReturnType<typeof setInterval>>();
const tRef=useRef<ReturnType<typeof setInterval>>();
const aRef=useRef<AbortController|null>(null);

const fetchAll=useCallback(async()=>{try{aRef.current?.abort();const ac=new AbortController();aRef.current=ac;const s=ac.signal;const[rr,ar,qr,sr,zr]=await Promise.all([supabase.from('game_rounds').select('*').order('created_at',{ascending:false}).limit(1).maybeSingle().abortSignal(s),supabase.from('game_rounds').select('id').eq('status','flying').limit(1).maybeSingle().abortSignal(s),supabase.from('crash_queue').select('*').order('position',{ascending:true}).limit(100).abortSignal(s),supabase.from('system_settings').select('*').eq('category','game').order('key').abortSignal(s),supabase.from('game_rounds').select('id',{count:'exact',head:true}).eq('status','flying').lt('started_at',new Date(Date.now()-ZOMBIE_MS).toISOString()).abortSignal(s)]);if(s.aborted)return;let active=(rr.data??null)as GameRoundRow|null;if(ar.data&&active?.status!=='flying'){const fr=await supabase.from('game_rounds').select('*').eq('id',ar.data.id).maybeSingle().abortSignal(s);if(!s.aborted&&fr.data)active=fr.data as GameRoundRow}setRound(active);if(active?.status==='flying'){const br=await supabase.from('bets').select('amount',{count:'exact'}).eq('round_id',active.id).eq('status','active').abortSignal(s);if(!s.aborted&&br.data){setBCnt(br.count??0);setBTot(br.data.reduce((sm:number,b:any)=>sm+Number(b.amount),0))}}else{setBCnt(0);setBTot(0)}setQueue((qr.data??[])as CQItem[]);setGSet((sr.data??[])as GSetting[]);setZCnt(zr.count??0);setEv(prev=>{const nxt={...prev};for(const sx of(sr.data??[])as GSetting[]){if(!(sx.key in nxt))nxt[sx.key]=String(sx.value)}return nxt});setErr(null)}catch(e:any){if(e?.name==='AbortError')return;setErr(e?.message||'Fetch failed')}finally{setLoading(false)}},[]);

useEffect(()=>{if(round?.status!=='flying'||!round.started_at){setMult(1);return}const st=new Date(round.started_at).getTime();const tick=()=>{const m=getMultiplierAtTime(Date.now()-st);setMult(m>=Number(round.crash_multiplier)?Number(round.crash_multiplier):m)};tick();tRef.current=setInterval(tick,TICK_MS);return()=>clearInterval(tRef.current)},[round?.status,round?.started_at,round?.crash_multiplier]);

useEffect(()=>{fetchAll();pRef.current=setInterval(fetchAll,POLL_MS);return()=>{clearInterval(pRef.current);clearInterval(tRef.current);aRef.current?.abort()}},[fetchAll]);

const audit=useCallback(async(action:string,tid?:string,dt?:any)=>{try{const{data:{session}}=await supabase.auth.getSession();if(!session?.user?.id)return;await supabase.from('admin_audit_log').insert({admin_id:session.user.id,action,target_type:'game',target_id:tid||null,details:dt||null})}catch{}},[]);

const forceCrash=async()=>{if(!round||round.status!=='flying'||lock)return;setLock('fc');try{const{error:fcErr}=await supabase.rpc('admin_force_crash',{p_round_id:round.id});if(fcErr)throw fcErr;setShFC(false);fetchAll()}catch(e:any){setErr(e?.message||'Failed')}finally{setLock(null)}};

const recoverZ=async()=>{if(lock)return;setLock('rc');try{const{error:rzErr}=await supabase.rpc('admin_recover_zombies',{p_older_than_seconds:Math.round(ZOMBIE_MS/1000)});if(rzErr)throw rzErr;setShRc(false);fetchAll()}catch(e:any){setErr(e?.message||'Failed')}finally{setLock(null)}};

const addSingle=async()=>{if(lock)return;const v=parseFloat(sVal);if(isNaN(v)||v<MIN_C||v>MAX_C){setErr('Must be '+MIN_C+'-'+MAX_C);return}setLock('as');try{const pos=queue.length>0?Math.max(...queue.map(q=>q.position))+1:1;await supabase.from('crash_queue').insert({crash_point:v,position:pos,status:'pending',created_at:new Date().toISOString()});await audit('queue_add',null,{crash_point:v,position:pos});setSVal('');setErr(null);fetchAll()}catch(e:any){setErr(e?.message||'Add failed')}finally{setLock(null)}};

const addBatch=async()=>{if(lock)return;const lines=bVal.split(/[\n,]+/).map((l:string)=>l.trim()).filter((l:string)=>l);const vals:number[]=[];const errs:string[]=[];for(const l of lines){const v=parseFloat(l);if(isNaN(v)||v<MIN_C||v>MAX_C)errs.push('Invalid: '+l);else vals.push(v)}if(errs.length){setErr(errs.join('; '));return}if(!vals.length)return;setLock('ab');try{const bp=queue.length>0?Math.max(...queue.map(q=>q.position))+1:1;const rows=vals.map((v,i)=>({crash_point:v,position:bp+i,status:'pending',created_at:new Date().toISOString()}));await supabase.from('crash_queue').insert(rows);await audit('queue_batch_add',null,{count:vals.length});setBVal('');setErr(null);fetchAll()}catch(e:any){setErr(e?.message||'Batch failed')}finally{setLock(null)}};

const removeQ=async(id:string,cp:number)=>{if(lock)return;setLock('rm-'+id);try{await supabase.from('crash_queue').delete().eq('id',id);await audit('queue_remove',id,{crash_point:cp});fetchAll()}catch(e:any){setErr(e?.message||'Remove failed')}finally{setLock(null)}};

const clearQ=async()=>{if(lock)return;setLock('cq');try{const ids=queue.filter(q=>q.status==='pending').map(q=>q.id);for(const id of ids)await supabase.from('crash_queue').delete().eq('id',id);await audit('queue_clear',null,{count:ids.length});setShCl(false);fetchAll()}catch(e:any){setErr(e?.message||'Clear failed')}finally{setLock(null)}};

const saveS=async(key:string)=>{if(lock)return;const raw=ev[key];const orig=gSet.find(sx=>sx.key===key);if(!orig||String(orig.value)===raw)return;let parsed:any=raw;if(raw==='true')parsed=true;else if(raw==='false')parsed=false;else if(!isNaN(Number(raw))&&raw.trim()!=='')parsed=Number(raw);setSaving(key);try{await supabase.from('system_settings').update({value:parsed,updated_at:new Date().toISOString()}).eq('key',key);await audit('setting_updated',key,{old:orig.value,new:parsed});fetchAll()}catch(e:any){setErr(e?.message||'Save failed')}finally{setSaving(null)}};

const isF=round?.status==='flying';const pendingQ=queue.filter(q=>q.status==='pending');
const TABS=[{k:'monitor'as Tab,l:'Live Monitor',i:Activity},{k:'queue'as Tab,l:'Crash Queue',i:Target},{k:'params'as Tab,l:'Settings',i:Settings}];

return(
  <div className="-m-6 p-6 sm:p-8 bg-canvas min-h-[calc(100dvh-3.5rem)]">
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] font-semibold text-ink tracking-tight">Game Control</h1>
          <p className="text-[13px] text-muted mt-1">Crash queue, live monitor, settings</p>
        </div>
        <div className="flex items-center gap-3">
          {err&&<span role="alert" className="px-3 py-1.5 bg-rose-50 border border-rose-200 rounded-lg text-down text-[12px] max-w-[280px] truncate" title={err}>{err}</span>}
          <button onClick={fetchAll} disabled={loading} className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-line bg-surface text-[13px] text-muted hover:text-ink hover:border-brand/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 transition-colors disabled:opacity-50">{loading&&<Spin />}{loading?'Refreshing':'Refresh'}</button>
        </div>
      </div>

      <div className="inline-flex gap-1 bg-slate-100 border border-line rounded-lg p-1">
        {TABS.map(t=>(
          <button key={t.k} onClick={()=>setTab(t.k)} className={'inline-flex items-center gap-2 px-4 py-1.5 rounded-md text-[13px] font-medium transition-colors '+((tab===t.k)?'bg-surface text-ink shadow-sm':'text-muted hover:text-ink')}><t.i size={14} strokeWidth={1.75} />{t.l}</button>
        ))}
      </div>

      {tab==='monitor'&&(<div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-xl border border-line bg-surface p-5">
            <div className="flex items-center justify-between"><span className={CAP}>Status</span><span className={'h-2 w-2 rounded-full '+(isF?'bg-up animate-pulse':round?.status==='crashed'?'bg-down':'bg-faint')} /></div>
            <div className="mt-3"><span className={'inline-flex px-2.5 py-1 rounded-md text-[11px] font-bold '+(isF?'bg-emerald-50 text-up':round?.status==='crashed'?'bg-rose-50 text-down':'bg-slate-100 text-muted')}>{round?.status?.toUpperCase()||'—'}</span></div>
            <div className="text-[11px] text-muted mt-2">Source: <span className="text-ink font-mono">{round?.source||'algorithm'}</span></div>
          </div>
          <div className="rounded-xl border border-line bg-surface p-5">
            <span className={CAP}>Multiplier</span>
            <div className={'mt-3 text-2xl font-semibold font-mono tabular-nums '+(isF?'text-up':'text-ink')}>{isF?formatMultiplier(mult):formatMultiplier(Number(round?.crash_multiplier??1))}</div>
            {isF&&<div className="text-[11px] text-amber-600 font-medium mt-1">Crash at {Number(round?.crash_multiplier).toFixed(2)}x</div>}
          </div>
          <div className="rounded-xl border border-line bg-surface p-5">
            <span className={CAP}>Elapsed</span>
            <div className="mt-3 text-2xl font-semibold text-ink tabular-nums">{isF&&round?.started_at?elapsed(round.started_at)+'s':'—'}</div>
            {round?.crashed_at&&<div className="text-[11px] text-muted mt-1">Crashed {new Date(round.crashed_at).toLocaleTimeString()}</div>}
          </div>
          <div className="rounded-xl border border-line bg-surface p-5">
            <span className={CAP}>Exposure</span>
            <div className="mt-3 flex items-baseline gap-1.5"><span className="text-2xl font-semibold text-ink tabular-nums">{isF?bCnt:'—'}</span><span className="text-[11px] text-muted">bets</span></div>
            <div className="text-[11px] text-muted mt-1 font-mono">{isF?'KSh '+fmtKES(bTot):'—'}</div>
          </div>
        </div>
        {isF&&(<div className="rounded-xl border border-rose-200 bg-rose-50/40 p-5 flex items-center justify-between gap-4 flex-wrap">
          <div><div className="text-ink font-semibold text-sm">Emergency: Force Crash</div><p className="text-[12px] text-muted mt-1">Crashes at current multiplier. All active bets lose. Audited.</p></div>
          <button onClick={()=>setShFC(true)} className="px-4 py-2.5 bg-down hover:brightness-95 text-white font-semibold text-sm rounded-lg transition flex-shrink-0">Force Crash Now</button>
        </div>)}
        {!round&&!loading&&(<div className="rounded-xl border border-line bg-surface p-16 text-center"><div className="text-ink font-semibold text-lg">Waiting for game activity</div><div className="text-[13px] text-muted mt-1">Open the game in another tab to start a round</div></div>)}
        {zCnt>0&&(<div className="rounded-xl border border-amber-200 bg-amber-50/50 p-5 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3"><span className="h-2 w-2 rounded-full bg-amber-500" /><div><div className="text-ink font-semibold text-sm">{zCnt} zombie round{zCnt!==1?'s':''} detected</div><div className="text-[12px] text-muted">Stuck 2+ minutes. Recover to mark as crashed.</div></div></div>
          <button onClick={()=>setShRc(true)} className="px-4 py-2.5 rounded-lg border border-amber-300 bg-amber-100 text-amber-700 font-semibold text-sm hover:bg-amber-200 transition-colors">Recover All</button>
        </div>)}
      </div>)}

      {tab==='queue'&&(<div className="space-y-6">
        <div className="rounded-xl border border-line bg-surface p-6 space-y-4">
          <div className="flex gap-3">
            <input type="number" value={sVal} onChange={e=>setSVal(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addSingle()} placeholder="1-80" min={MIN_C} max={MAX_C} step="0.01" className="flex-1 px-4 py-3 bg-surface border border-line rounded-lg text-sm text-ink font-mono placeholder:text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus:border-brand/40 transition" />
            <button onClick={addSingle} disabled={lock==='as'||!sVal.trim()} className="inline-flex items-center gap-2 px-5 py-3 bg-brand hover:bg-brand-dark text-white font-semibold text-sm rounded-lg transition-colors disabled:opacity-40 flex-shrink-0">{lock==='as'&&<Spin />}Add</button>
          </div>
          <details className="group">
            <summary className="text-[12px] text-muted cursor-pointer hover:text-ink">Batch add (one per line, comma-separated)</summary>
            <div className="mt-3 space-y-3">
              <textarea value={bVal} onChange={e=>setBVal(e.target.value)} placeholder="1.23,4.56,12.00" rows={3} className="w-full px-4 py-3 bg-surface border border-line rounded-lg text-sm text-ink font-mono placeholder:text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus:border-brand/40 resize-none transition" />
              <button onClick={addBatch} disabled={lock==='ab'||!bVal.trim()} className="inline-flex items-center gap-2 px-4 py-2.5 border border-line bg-surface hover:border-brand/40 hover:text-brand text-ink font-semibold text-sm rounded-lg transition-colors disabled:opacity-40">{lock==='ab'&&<Spin />}Add {bVal.trim()?bVal.split(/[\n,]+/).filter((l:string)=>l.trim()).length:0} items</button>
            </div>
          </details>
        </div>
        <div className="rounded-xl border border-line bg-surface overflow-hidden">
          <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface"><tr className="border-b border-line text-[10px] uppercase tracking-[0.08em] text-faint">
                <th className="text-left px-5 py-3 font-medium w-12">#</th><th className="text-left px-5 py-3 font-medium">Multiplier</th><th className="text-left px-5 py-3 font-medium">Status</th><th className="text-left px-5 py-3 font-medium hidden lg:table-cell">Added</th><th className="text-right px-5 py-3 font-medium w-24" />
              </tr></thead>
              <tbody className="divide-y divide-line">
                {queue.length===0?(<tr><td colSpan={5} className="px-5 py-16 text-center text-faint text-[12px]">Queue empty — crash points come from algorithm</td></tr>):queue.map(q=>(
                  <tr key={q.id} className="hover:bg-canvas transition-colors">
                    <td className="px-5 py-3 text-muted font-mono text-xs">{q.position}</td>
                    <td className="px-5 py-3 text-ink font-mono font-semibold">{Number(q.crash_point).toFixed(2)}x</td>
                    <td className="px-5 py-3"><span className={'inline-flex px-2 py-0.5 rounded-md text-[10px] font-semibold '+(q.status==='pending'?'bg-brand/10 text-brand':q.status==='used'?'bg-emerald-50 text-up':'bg-slate-100 text-muted')}>{q.status}</span></td>
                    <td className="px-5 py-3 text-muted text-xs hidden lg:table-cell">{new Date(q.created_at).toLocaleTimeString()}</td>
                    <td className="px-5 py-3 text-right"><button onClick={()=>removeQ(q.id,q.crash_point)} disabled={lock==='rm-'+q.id||q.status!=='pending'} className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted hover:text-down disabled:opacity-30 transition-colors">{lock==='rm-'+q.id&&<Spin />}Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pendingQ.length>0&&(<div className="px-5 py-3 border-t border-line flex items-center justify-between"><span className="text-[11px] text-muted">{pendingQ.length} pending</span><button onClick={()=>setShCl(true)} className="px-3 py-1.5 rounded-lg border border-rose-200 bg-rose-50 text-down text-[11px] font-medium hover:bg-rose-100 transition-colors">Clear All</button></div>)}
        </div>
      </div>)}

      {tab==='params'&&(<div className="rounded-xl border border-line bg-surface overflow-hidden">{gSet.length===0?(<div className="p-16 text-center text-faint text-[12px]">No game settings found</div>):(<div className="divide-y divide-line">{gSet.map(s=>{const changed=ev[s.key]!==String(s.value);return(
        <div key={s.key} className="px-6 py-5 flex items-center justify-between gap-6 hover:bg-canvas transition-colors">
          <div className="min-w-0 flex-1"><div className="text-[13px] text-ink font-mono">{s.key.replace('game.','')}</div>{s.description&&<div className="text-[11px] text-muted mt-1">{s.description}</div>}</div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <input type="text" value={ev[s.key]??String(s.value)} onChange={e=>setEv(prev=>({...prev,[s.key]:e.target.value}))} className={'w-24 px-3 py-2 bg-surface border rounded-lg text-sm text-right text-ink font-mono focus:outline-none transition '+(changed?'border-brand/50 ring-1 ring-brand/20':'border-line')} />
            {changed&&(<><button onClick={()=>saveS(s.key)} disabled={saving===s.key} className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-brand text-white hover:bg-brand-dark transition-colors disabled:opacity-40">{saving===s.key?'Saving':'Save'}</button><button onClick={()=>setEv(prev=>({...prev,[s.key]:String(s.value)}))} className="px-2.5 py-1.5 rounded-md text-xs font-medium border border-line text-muted hover:text-ink transition-colors">Reset</button></>)}
          </div>
        </div>
      )})}</div>)}</div>)}

      {shFC&&<Modal title="Force Crash" msg={'Crash round at '+formatMultiplier(mult)+'? All active bets will lose. This cannot be undone.'} btn="Force Crash" color="bg-down hover:brightness-95" loading={lock==='fc'} onConfirm={forceCrash} onCancel={()=>setShFC(false)} />}
      {shRc&&<Modal title="Recover Zombie Rounds" msg={'Mark '+zCnt+' stuck round(s) as crashed? These never completed (browser closed mid-flight).'} btn="Recover All" color="bg-amber-600 hover:bg-amber-700" loading={lock==='rc'} onConfirm={recoverZ} onCancel={()=>setShRc(false)} />}
      {shCl&&<Modal title="Clear Queue" msg={'Remove all '+pendingQ.length+' pending crash point(s)? This cannot be undone.'} btn="Clear All" color="bg-down hover:brightness-95" loading={lock==='cq'} onConfirm={clearQ} onCancel={()=>setShCl(false)} />}
    </div>
  </div>);}

function Modal({title,msg,btn,color,loading,onConfirm,onCancel}:any){return(
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/30 backdrop-blur-sm" onClick={onCancel}>
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
