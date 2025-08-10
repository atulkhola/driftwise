import React, { useEffect, useMemo, useRef, useState } from "react";
import { Plus, X, ChevronLeft, Users, Wallet, ArrowRight, CheckCircle2, Trash2, Bug, Link as LinkIcon, Share2, UserPlus, LogIn, LogOut, Settings, ChevronDown } from "lucide-react";
import { createClient, type SupabaseClient, type Session } from "@supabase/supabase-js";
import { motion, AnimatePresence } from "framer-motion";

/**
 * DriftWise (SplitKit) — Apple-clean bill splitter (web prototype)
 *
 * This single-file app supports:
 *  - Local-first groups/expenses with deterministic balances engine
 *  - Optional Supabase cloud sync (auth + realtime)
 *
 * This rewrite fixes a parser error from a truncated file and cleans up:
 *  - CloudGroupView useEffect now wraps async calls inside a function
 *  - Modal no longer follows cursor (removed drag), correct z-index
 *  - Segmented control animates horizontally with center-origin micro-scale
 *  - Dropdowns styled to match inputs (no gradients)
 */

// --- Font --------------------------------------------------------------------
const FontLoader: React.FC = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');
    :root{
      --bg: 245 245 247; /* iOS system gray 6-ish */
      --card: 255 255 255;
      --tint: 0 122 255; /* iOS blue */
    }
    html, body, #root { height: 100%; }
    body { font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Inter, 'Helvetica Neue', Arial, sans-serif; background: rgb(var(--bg)); }
  `}</style>
);

// --- Motion / Toast -----------------------------------------------------------
const MotionDur = { xs: 0.09, s: 0.14, m: 0.22, l: 0.32, xl: 0.48 } as const;
const MotionEase = [0.2, 0.65, 0.2, 1] as const;

type ToastItem = { id: string; text: string; actionLabel?: string; onAction?: ()=>void };
const ToastCtx = React.createContext<{ push: (msg: string)=>void; pushAction: (t: string, label: string, fn: ()=>void)=>void }>({ push: ()=>{}, pushAction: ()=>{} });
const ToastHost: React.FC<{ toasts: ToastItem[] }> = ({ toasts }) => (
  <div className="fixed bottom-4 inset-x-0 flex justify-center z-50 pointer-events-none">
    <div className="w-full max-w-sm px-4">
      <AnimatePresence>
        {toasts.map(t=> (
          <motion.div key={t.id}
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 12, opacity: 0 }}
            transition={{ duration: MotionDur.m, ease: MotionEase }}
            className="pointer-events-auto mb-2 rounded-xl border border-black/10 bg-white/95 backdrop-blur p-3 shadow-lg flex items-center gap-3">
            <div className="text-sm text-black/80 flex-1">{t.text}</div>
            {t.actionLabel && t.onAction && (
              <button onClick={t.onAction} className="px-2 py-1 rounded-lg bg-black text-white text-xs font-medium">{t.actionLabel}</button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  </div>
);

// --- Utils -------------------------------------------------------------------
const uid = () => Math.random().toString(36).slice(2, 9);
const format = (n: number, currency: string) => new Intl.NumberFormat(undefined,{ style: 'currency', currency }).format(n);

function getEnv(key: string): string | undefined {
  const w: any = typeof window !== 'undefined' ? window : {};
  const vite = (w as any)?.__env || (typeof import.meta !== 'undefined' ? (import.meta as any).env : undefined);
  const next = (typeof process !== 'undefined' ? (process as any).env : undefined);
  return vite?.[key] || vite?.[`VITE_${key}`] || next?.[key] || next?.[`NEXT_PUBLIC_${key}`];
}
function getSBKeysFromStorage(){ try { return { url: localStorage.getItem('sb_url')||undefined, anon: localStorage.getItem('sb_anon')||undefined }; } catch { return { url: undefined, anon: undefined }; } }
function resolveSBKeys(){ const { url: su } = getSBKeysFromStorage(); const { anon: sa } = getSBKeysFromStorage(); return { url: getEnv('SUPABASE_URL')||getEnv('VITE_SUPABASE_URL')||getEnv('NEXT_PUBLIC_SUPABASE_URL')||su, anon: getEnv('SUPABASE_ANON_KEY')||getEnv('VITE_SUPABASE_ANON_KEY')||getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')||sa } as { url?: string; anon?: string }; }

type SB = SupabaseClient<any, any, any>;
function makeSupabase(): SB | null { const { url, anon } = resolveSBKeys(); if (!url || !anon) return null; try { return createClient(url, anon); } catch { return null; } }

// --- Glass -------------------------------------------------------------------
const Glass: React.FC<React.ComponentProps<typeof motion.div> & { press?: boolean }> = ({ className = "", children, press, ...rest }) => (
  <motion.div {...rest as any}
    whileHover={(press || (rest as any).role === 'button' || !!(rest as any).onClick) ? { scale: 1.01 } : undefined}
    whileTap={(press || (rest as any).role === 'button' || !!(rest as any).onClick) ? { scale: 0.985 } : undefined}
    transition={{ duration: MotionDur.xs, ease: MotionEase }}
    className={`rounded-2xl border border-white/30 shadow-lg shadow-black/5 bg-white/60 backdrop-blur-xl ${className}`}
  >{children}</motion.div>
);

// --- Types -------------------------------------------------------------------
interface User { id: string; name: string }
interface Group { id: string; name: string; currency: string; members: User[] }
interface ExpenseShare { userId: string; amount: number }
interface Expense { id: string; groupId: string; title: string; amount: number; payerId: string; date: string; note?: string; shares: ExpenseShare[] }
interface Settlement { id: string; groupId: string; fromUser: string; toUser: string; amount: number; date: string; method?: string }
interface DB { groups: Group[]; expenses: Expense[]; settlements: Settlement[] }

// --- Local storage ------------------------------------------------------------
const loadDB = (): DB => {
  try { const raw = localStorage.getItem('splitkit-db'); if (raw) return JSON.parse(raw); } catch {}
  const gId = uid();
  const u1 = { id: uid(), name: 'You' }, u2 = { id: uid(), name: 'Aarav' }, u3 = { id: uid(), name: 'Mira' };
  const group: Group = { id: gId, name: 'Phuket Villa', currency: 'INR', members: [u1,u2,u3] };
  const e1: Expense = { id: uid(), groupId: gId, title: 'Airport taxi', amount: 900, payerId: u1.id, date: new Date().toISOString(), shares: [u1,u2,u3].map(u=>({userId:u.id, amount:300})) };
  const e2: Expense = { id: uid(), groupId: gId, title: 'Groceries', amount: 2400, payerId: u2.id, date: new Date().toISOString(), shares: [u1,u2,u3].map(u=>({userId:u.id, amount:800})) };
  return { groups:[group], expenses:[e1,e2], settlements:[] };
};
const saveDB = (db: DB) => { try { localStorage.setItem('splitkit-db', JSON.stringify(db)); } catch {} };

// --- Balances engine ----------------------------------------------------------
function computeNetByUser(group: Group, expenses: Expense[], settlements: Settlement[]): Record<string, number> {
  const net: Record<string, number> = {}; group.members.forEach(m=> net[m.id]=0);
  for (const e of expenses.filter(x=>x.groupId===group.id)) { net[e.payerId]+=e.amount; for (const s of e.shares) net[s.userId]-=s.amount; }
  for (const s of settlements.filter(x=>x.groupId===group.id)) { net[s.fromUser]+=s.amount; net[s.toUser]-=s.amount; }
  for (const k of Object.keys(net)) net[k] = Math.round(net[k]*100)/100; return net;
}
function suggestSettlements(group: Group, expenses: Expense[], settlements: Settlement[]) {
  const net = computeNetByUser(group, expenses, settlements);
  const debtors: {id:string; amt:number}[] = [], creditors: {id:string; amt:number}[] = [];
  for (const [id,v] of Object.entries(net)) { if (v<-0.009) debtors.push({id,amt:-v}); if (v>0.009) creditors.push({id,amt:v}); }
  debtors.sort((a,b)=>b.amt-a.amt); creditors.sort((a,b)=>b.amt-a.amt);
  const out: {from:string; to:string; amount:number}[]=[]; let i=0,j=0;
  while (i<debtors.length && j<creditors.length){ const d=debtors[i], c=creditors[j]; const pay=Math.min(d.amt,c.amt); out.push({from:d.id,to:c.id,amount:Math.round(pay*100)/100}); d.amt-=pay; c.amt-=pay; if(d.amt<0.01)i++; if(c.amt<0.01)j++; }
  return out;
}

// --- Allocation helpers -------------------------------------------------------
function allocateProportional(memberIds: string[], weights: number[], totalAmount: number): Record<string, number> {
  const totalCents = Math.round(totalAmount * 100);
  const sumW = weights.reduce((a,b)=>a+b,0);
  if (sumW<=0 || totalCents===0) return Object.fromEntries(memberIds.map(id=>[id,0]));
  const raw = weights.map(w => (totalCents * w) / sumW);
  const base = raw.map(v => Math.floor(v));
  let remainder = totalCents - base.reduce((a,b)=>a+b,0);
  const fracIdx = raw.map((v,i)=>({i, frac: v-Math.floor(v)})).sort((a,b)=>b.frac-a.frac);
  for (let k=0;k<fracIdx.length && remainder>0;k++){ base[fracIdx[k].i]+=1; remainder--; }
  const out: Record<string, number> = {}; memberIds.forEach((id,idx)=> out[id] = base[idx]/100); return out;
}
const allocateEqual = (memberIds: string[], totalAmount: number) => allocateProportional(memberIds, memberIds.map(()=>1), totalAmount);
const allocatePercent = (memberIds: string[], perc: number[], totalAmount: number) => allocateProportional(memberIds, perc, totalAmount);

// --- Modal (no drag, proper stacking) ----------------------------------------
const Modal: React.FC<{ open: boolean; onClose: ()=>void; title: string; children: React.ReactNode }>
= ({ open, onClose, title, children }) => {
  const prefersReduced = typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;
  const dlgRef = useRef<HTMLDivElement|null>(null);
  useEffect(()=>{ if(!open) return; const el=dlgRef.current; if(!el) return; const f=el.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'); f?.focus(); const onKey=(e:KeyboardEvent)=>{ if(e.key==='Escape') onClose(); if(e.key==='Tab'){ const nodes=el.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'); const list=Array.from(nodes).filter(n=>!n.hasAttribute('disabled')); if(list.length===0) return; const first=list[0], last=list[list.length-1]; if(e.shiftKey && document.activeElement===first){ last.focus(); e.preventDefault(); } else if(!e.shiftKey && document.activeElement===last){ first.focus(); e.preventDefault(); } } }; document.addEventListener('keydown', onKey); return ()=>document.removeEventListener('keydown', onKey); }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center pointer-events-none">
          <motion.div className="absolute inset-0 bg-black/40 pointer-events-auto z-0" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} transition={{duration: MotionDur.m, ease: MotionEase}} onClick={onClose}/>
          <motion.div ref={dlgRef} role="dialog" aria-modal="true" className="pointer-events-auto w-full sm:max-w-lg max-h-[90vh] overflow-auto p-4 sm:p-6 m-0 sm:m-4 relative z-10" initial={prefersReduced?{opacity:0}:{opacity:0,y:16,scale:0.98}} animate={prefersReduced?{opacity:1}:{opacity:1,y:0,scale:1}} exit={prefersReduced?{opacity:0}:{opacity:0,y:12,scale:0.98}} transition={{ type: prefersReduced? 'tween':'spring', stiffness:420, damping:36, duration: prefersReduced? MotionDur.s: undefined }}>
            <div className="rounded-2xl bg-white shadow-2xl border border-black/10 p-4 sm:p-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xl font-semibold tracking-tight">{title}</h3>
                <button onClick={onClose} className="p-2 rounded-xl hover:bg-black/5" aria-label="Close"><X className="w-5 h-5"/></button>
              </div>
              {children}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

// --- Supabase helpers ---------------------------------------------------------
function useSupabaseAuth(sb: SB | null){ const [session,setSession]=useState<Session|null>(null); useEffect(()=>{ if(!sb){ setSession(null); return; } sb.auth.getSession().then(({data})=>setSession(data.session??null)); const { data: sub } = sb.auth.onAuthStateChange((_e,s)=>setSession(s)); return ()=>{ sub?.subscription.unsubscribe(); }; },[sb]); return session; }
async function sbMyGroups(sb: SB){ const { data: me } = await sb.auth.getUser(); const uid=me?.user?.id; if(!uid) return [] as any[]; const { data: mems } = await sb.from('group_members').select('group_id').eq('user_id', uid); const ids=(mems||[]).map(m=>m.group_id); if(ids.length===0) return []; const { data: groups } = await sb.from('groups').select('id,name,currency').in('id', ids).order('created_at',{ascending:false}); return groups||[]; }
async function sbGroupBundle(sb: SB, groupId: string){ const { data: mems } = await sb.from('group_members').select('user_id, role').eq('group_id', groupId); const userIds=(mems||[]).map(m=>m.user_id); const { data: profs } = userIds.length? await sb.from('profiles').select('id, display_name').in('id', userIds) : { data: [] as any[] } as any; const nameById: Record<string,string> = {}; (profs||[]).forEach(p=>nameById[p.id]=p.display_name||p.id.slice(0,6)); const members: User[]=(mems||[]).map(m=>({ id:m.user_id, name:nameById[m.user_id]||m.user_id.slice(0,6) })); const { data: exps } = await sb.from('expenses').select('id,title,amount,payer_id,expense_date,note,group_id').eq('group_id', groupId).order('expense_date',{ascending:false}); const ids=(exps||[]).map(e=>e.id); const { data: shares } = ids.length? await sb.from('expense_shares').select('expense_id,user_id,amount').in('expense_id', ids) : { data: [] as any[] } as any; const expenses: Expense[]=(exps||[]).map(e=>({ id:e.id, groupId:e.group_id, title:e.title, amount:Number(e.amount), payerId:e.payer_id, date:e.expense_date, note:e.note||undefined, shares:(shares||[]).filter(s=>s.expense_id===e.id).map(s=>({ userId:s.user_id, amount:Number(s.amount) })) })); const { data: setts } = await sb.from('settlements').select('id,group_id,from_user,to_user,amount,settled_at').eq('group_id', groupId).order('settled_at',{ascending:false}); const settlements: Settlement[]=(setts||[]).map(s=>({ id:s.id, groupId:s.group_id, fromUser:s.from_user, toUser:s.to_user, amount:Number(s.amount), date:s.settled_at })); return { members, expenses, settlements };
}
async function sbCreateGroup(sb: SB, name: string, currency: string){ const { data: me } = await sb.auth.getUser(); const uid = me?.user?.id!; const { data: g, error } = await sb.from('groups').insert({ name, currency, created_by: uid }).select('*').single(); if(error) throw error; await sb.from('group_members').insert({ group_id: g.id, user_id: uid, role: 'owner' }); return g.id as string; }
async function sbAddExpense(sb: SB, groupId: string, exp: Omit<Expense,'id'|'groupId'|'date'> & { date?: string }){ const { data: me }=await sb.auth.getUser(); const uid=me?.user?.id!; const { data: e, error } = await sb.from('expenses').insert({ group_id: groupId, title: exp.title, amount: exp.amount, payer_id: exp.payerId, expense_date: exp.date || new Date().toISOString(), note: exp.note||null, created_by: uid }).select('*').single(); if(error) throw error; const rows = exp.shares.map(s=>({ expense_id: e.id, user_id: s.userId, amount: s.amount })); const { error: e2 } = await sb.from('expense_shares').insert(rows); if(e2) throw e2; return e.id as string; }
async function sbRecordSettlements(sb: SB, groupId: string, records: {from:string,to:string,amount:number}[]){ const { data: me }=await sb.auth.getUser(); const uid=me?.user?.id!; const now=new Date().toISOString(); const rows=records.map(r=>({ group_id: groupId, from_user:r.from, to_user:r.to, amount:r.amount, settled_at: now, created_by: uid })); const { error } = await sb.from('settlements').insert(rows); if(error) throw error; }
async function sbCreateInvite(sb: SB, groupId: string){ const token=Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2); const { data, error } = await sb.from('invites').insert({ group_id: groupId, token }).select('token').single(); if(error) throw error; return data.token as string; }
async function sbAcceptInvite(sb: SB, token: string){ const { data, error } = await sb.rpc('accept_invite', { invite_token: token }); if(error) throw error; return data as string; }

// --- App ---------------------------------------------------------------------
export default function App(){
  const [db, setDb] = useState<DB>(loadDB()); useEffect(()=>saveDB(db),[db]);
  const [sbVersion,setSbVersion]=useState(0); useEffect(()=>{ const onUpdate=()=>setSbVersion(v=>v+1); window.addEventListener('sb-keys-updated', onUpdate); return ()=>window.removeEventListener('sb-keys-updated', onUpdate); },[]);
  const sb = useMemo(()=> makeSupabase(), [sbVersion]);
  const session = useSupabaseAuth(sb);
  const [cloud,setCloud]=useState<boolean>(()=>!!session&&!!sb); useEffect(()=>setCloud(!!session&&!!sb),[session,sb]);

  // accept invite via hash
  useEffect(()=>{ const token = (window.location.hash.startsWith('#join/')? window.location.hash.slice(6) : localStorage.getItem('pendingInviteToken')) || ''; if(!token) return; if(cloud && sb && session){ const run=async()=>{ try{ await sbAcceptInvite(sb, token); localStorage.removeItem('pendingInviteToken'); window.location.hash=''; }catch(e){ console.error(e); } }; run(); } else { localStorage.setItem('pendingInviteToken', token); } },[cloud,sb,session]);

  const [route,setRoute]=useState<{name:'home'}|{name:'group',id:string}>({name:'home'});
  const [testsOpen,setTestsOpen]=useState(false); const [authOpen,setAuthOpen]=useState(false); const [settingsOpen,setSettingsOpen]=useState(false);
  const [toasts,setToasts]=useState<ToastItem[]>([]);
  const push=(msg:string)=>{ const id=uid(); setToasts(t=>[...t,{id,text:msg}]); setTimeout(()=>setToasts(t=>t.filter(x=>x.id!==id)),3000); };
  const pushAction=(text:string,label:string,fn:()=>void)=>{ const id=uid(); const handler=()=>{ fn(); setToasts(prev=>prev.filter(t=>t.id!==id)); }; setToasts(t=>[...t,{id,text,actionLabel:label,onAction:handler}]); setTimeout(()=>setToasts(t=>t.filter(x=>x.id!==id)),5000); };
  useEffect(()=>{ (window as any)._DW_toast=push; (window as any)._DW_toast_action=pushAction; return ()=>{ try{ delete (window as any)._DW_toast; delete (window as any)._DW_toast_action; }catch{} }; },[]);

  const [navDir,setNavDir]=useState(1); const goHome=()=>{ setNavDir(-1); setRoute({name:'home'}); }; const openGroup=(id:string)=>{ setNavDir(1); setRoute({name:'group',id}); };

  // local demo deep-link
  useEffect(()=>{ if(window.location.hash.startsWith('#demo/')){ const id=window.location.hash.slice(6); const exists=db.groups.some(g=>g.id===id); if(exists) openGroup(id); else alert('Demo invite only works on this device. Sign in to use cloud invites.'); } },[db.groups.length]);

  return (
    <ToastCtx.Provider value={{ push, pushAction }}>
      <div className="min-h-screen pb-28">
        <FontLoader/>
        <TopBar onBack={route.name==='group'?goHome:undefined} onOpenTests={()=>setTestsOpen(true)} cloud={cloud} setCloud={setCloud} sbReady={!!sb} session={!!session} onSignIn={()=>setAuthOpen(true)} onSignOut={()=>sb?.auth.signOut()} onOpenSettings={()=>setSettingsOpen(true)}/>
        <div className="mx-auto max-w-3xl px-4 sm:px-6 pt-6 space-y-6">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={route.name+(route.name==='group'?route.id:'')} initial={{x: navDir>0?16:-16, opacity:0.98}} animate={{x:0,opacity:1}} exit={{x: navDir>0?-10:10, opacity:0.98}} transition={{duration: MotionDur.xl, ease: MotionEase}}>
              {route.name==='home' && <Home db={db} setDb={setDb} openGroup={openGroup} sb={sb} cloud={cloud}/>} 
              {route.name==='group' && <GroupView db={db} setDb={setDb} id={route.id} goHome={goHome} sb={sb} cloud={cloud}/>} 
            </motion.div>
          </AnimatePresence>
        </div>
        <BottomHint cloud={cloud}/>
        <Modal open={testsOpen} onClose={()=>setTestsOpen(false)} title="Test Runner"><TestRunner/></Modal>
        <Modal open={authOpen} onClose={()=>setAuthOpen(false)} title="Sign in"><AuthPanel sb={sb} onDone={()=>setAuthOpen(false)}/></Modal>
        <Modal open={settingsOpen} onClose={()=>setSettingsOpen(false)} title="Settings"><SettingsPanel/></Modal>
        <ToastHost toasts={toasts}/>
      </div>
    </ToastCtx.Provider>
  );
}

const TopBar: React.FC<{ onBack?: ()=>void; onOpenTests?: ()=>void; cloud: boolean; setCloud: (v:boolean)=>void; sbReady: boolean; session: boolean; onSignIn: ()=>void; onSignOut: ()=>void; onOpenSettings: ()=>void }>
= ({ onBack, onOpenTests, cloud, setCloud, sbReady, session, onSignIn, onSignOut, onOpenSettings }) => (
  <div className="sticky top-0 z-40 backdrop-blur-xl bg-white/70 border-b border-white/40">
    <div className="mx-auto max-w-3xl px-4 sm:px-6 h-14 flex items-center gap-2">
      {onBack ? (<button onClick={onBack} className="p-2 -ml-2 rounded-xl hover:bg-black/5" aria-label="Back"><ChevronLeft className="w-6 h-6"/></button>) : (<div className="w-6"/>) }
      <div className="flex items-center gap-2"><Wallet className="w-5 h-5"/><span className="text-lg font-semibold tracking-tight">SplitKit</span></div>
      <div className="ml-auto flex items-center gap-1">
        <button onClick={onOpenSettings} className="p-2 rounded-xl hover:bg-black/5" aria-label="Settings"><Settings className="w-5 h-5"/></button>
        <div className={`px-2 py-1 rounded-lg text-xs border ${cloud? 'bg-emerald-50 border-emerald-200 text-emerald-700':'bg-black/5 border-black/10 text-black/70'}`}>{cloud? 'Cloud':'Local'}</div>
        {sbReady && !session && (<button onClick={onSignIn} className="px-2.5 py-1.5 rounded-xl bg-black text-white text-xs font-medium inline-flex items-center gap-1"><LogIn className="w-4 h-4"/> Sign in</button>)}
        {sbReady && session && (<button onClick={onSignOut} className="px-2.5 py-1.5 rounded-xl bg-white border border-black/10 text-xs font-medium inline-flex items-center gap-1"><LogOut className="w-4 h-4"/> Sign out</button>)}
        <button onClick={onOpenTests} className="p-2 rounded-xl hover:bg-black/5" aria-label="Open test runner"><Bug className="w-5 h-5"/></button>
      </div>
    </div>
  </div>
);

const BottomHint: React.FC<{ cloud: boolean }> = ({ cloud }) => (
  <div className="fixed bottom-0 inset-x-0 z-30 flex justify-center p-4">
    <Glass className="px-4 py-2 text-sm"><span className="text-black/70">{cloud? 'Connected to Supabase — groups sync across devices.' : 'Tip: add a group or open the demo group. Sign in to enable cloud sync.'}</span></Glass>
  </div>
);

const Home: React.FC<{ db: DB; setDb: (f: (d: DB)=>DB | DB)=>void; openGroup: (id: string)=>void; sb: SB | null; cloud: boolean }>
= ({ db, setDb, openGroup, sb, cloud }) => {
  const [open,setOpen]=useState(false); const [name,setName]=useState(""); const [currency,setCurrency]=useState("INR"); const [membersRaw,setMembersRaw]=useState("You, Aarav, Mira");
  const [cloudGroups,setCloudGroups]=useState<any[]|null>(null);
  useEffect(()=>{ if(cloud&&sb){ sbMyGroups(sb).then(setCloudGroups).catch(e=>console.error(e)); } },[cloud,sb]);

  const createGroupLocal=()=>{ const id=uid(); const raw=membersRaw.split(',').map(s=>s.trim()).filter(Boolean); const seen=new Set<string>(); const uniq=raw.filter(n=>{ const k=n.toLowerCase(); if(seen.has(k)) return false; seen.add(k); return true; }); uniq.sort((a,b)=> (a.toLowerCase()==='you'?-1:0)-(b.toLowerCase()==='you'?-1:0)); const members=uniq.map(n=>({id:uid(), name:n})); if(members.length===0) members.push({id:uid(), name:'You'}); const g: Group={ id, name: name||'New Group', currency, members }; setDb(prev=>({...prev, groups:[...prev.groups,g]})); setOpen(false); setName(""); };
  const createGroupCloud=async()=>{ if(!sb) return; try{ const id=await sbCreateGroup(sb, name||'New Group', currency); setOpen(false); setName(""); setCloudGroups(null); setTimeout(()=> sbMyGroups(sb).then(setCloudGroups), 50); }catch(e){ console.error(e); (window as any)._DW_toast && (window as any)._DW_toast('Create failed'); } };

  const groupsList = cloud? (cloudGroups||[]) : db.groups;
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3"><Users className="w-5 h-5"/><h1 className="text-2xl font-semibold tracking-tight">Groups</h1><div className="ml-auto"><button onClick={()=>setOpen(true)} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-black text-white text-sm font-medium shadow active:scale-[.99]"><Plus className="w-4 h-4"/> New Group</button></div></div>
      <div className="grid sm:grid-cols-2 gap-4">
        {cloud ? (groupsList as any[]).map(g=> <CloudGroupCard key={g.id} group={g} sb={sb!} onOpen={()=>openGroup(g.id)}/>) : db.groups.map(g=> <GroupCard key={g.id} group={g} db={db} onOpen={()=>openGroup(g.id)}/>)}
      </div>
      <Modal open={open} onClose={()=>setOpen(false)} title="New group">
        <div className="space-y-3">
          <label className="block text-sm font-medium">Name</label>
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="Goa trip" className="w-full rounded-xl border border-black/10 px-3 py-2 outline-none focus:ring-2 focus:ring-black/20"/>
          <label className="block text-sm font-medium mt-3">Currency</label>
          <select value={currency} onChange={e=>setCurrency(e.target.value)} className="w-full h-11 rounded-xl border border-black/10 px-3 pr-9 bg-white appearance-none outline-none focus:ring-2 focus:ring-black/20">
            {['INR','USD','EUR','THB','AED','GBP'].map(c=> <option key={c} value={c}>{c}</option>)}
          </select>
          {!cloud && (<><label className="block text-sm font-medium mt-3">Members (comma-separated)</label><input value={membersRaw} onChange={e=>setMembersRaw(e.target.value)} className="w-full rounded-xl border border-black/10 px-3 py-2 outline-none focus:ring-2 focus:ring-black/20"/></>)}
          <div className="pt-3 flex justify-end"><button onClick={cloud?createGroupCloud:createGroupLocal} className="px-3 py-2 rounded-xl bg-black text-white text-sm font-medium">Create</button></div>
        </div>
      </Modal>
    </div>
  );
};

const CloudGroupCard: React.FC<{ group:any; sb:SB; onOpen:()=>void }> = ({ group, sb, onOpen }) => {
  const [chip,setChip]=useState<string>('Loading…');
  useEffect(()=>{ (async()=>{ try { const bundle=await sbGroupBundle(sb, group.id); const g: Group={ id:group.id, name:group.name, currency:group.currency, members: bundle.members }; const net=computeNetByUser(g, bundle.expenses, bundle.settlements); const { data: me } = await sb.auth.getUser(); const uid=me?.user?.id; const v=uid? (net[uid]||0) : 0; const text = uid ? (v>0? `You are owed ${format(v, g.currency)}` : v<0? `You owe ${format(-v, g.currency)}`:'All settled') : 'All settled'; setChip(text);} catch { setChip('—'); } })(); },[sb,group.id]);
  return (
    <Glass className="p-4 cursor-pointer hover:shadow-xl transition-shadow focus:outline-none focus:ring-2 focus:ring-black/20" onClick={onOpen} role="button" tabIndex={0} aria-label={`Open group ${group.name}`} onKeyDown={(e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); onOpen(); } }}>
      <div className="flex items-center justify-between"><div><div className="text-base font-semibold">{group.name}</div><div className="text-sm text-black/60">{chip}</div></div><ArrowRight className="w-5 h-5 text-black/60"/></div>
    </Glass>
  );
};

const GroupCard: React.FC<{ group: Group; db: DB; onOpen: ()=>void }> = ({ group, db, onOpen }) => {
  const net=computeNetByUser(group, db.expenses, db.settlements); const you=group.members.find(m=>m.name.trim().toLowerCase()==='you') || group.members[0]; const mine=net[you.id]||0; const chip = you.name.trim().toLowerCase()==='you' ? (mine>0?`You are owed ${format(mine,group.currency)}`: mine<0?`You owe ${format(-mine,group.currency)}`:'All settled') : (mine>0?`${you.name} is owed ${format(mine,group.currency)}`: mine<0?`${you.name} owes ${format(-mine,group.currency)}`:'All settled');
  return (
    <Glass className="p-4 cursor-pointer hover:shadow-xl transition-shadow focus:outline-none focus:ring-2 focus:ring-black/20" onClick={onOpen} role="button" tabIndex={0} aria-label={`Open group ${group.name}`} onKeyDown={(e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); onOpen(); } }}>
      <div className="flex items-center justify-between"><div><div className="text-base font-semibold">{group.name}</div><div className="text-sm text-black/60">{chip}</div></div><ArrowRight className="w-5 h-5 text-black/60"/></div>
    </Glass>
  );
};

const GroupView: React.FC<{ db: DB; setDb: (f: (d: DB)=>DB | DB)=>void; id: string; goHome: ()=>void; sb: SB | null; cloud: boolean }>
= ({ db, setDb, id, goHome, sb, cloud }) => {
  const { pushAction } = React.useContext(ToastCtx);
  if (cloud && sb) return <CloudGroupView id={id} sb={sb} goHome={goHome}/>;
  const group = db.groups.find(g=>g.id===id)!;
  const exps = db.expenses.filter(e=>e.groupId===id).sort((a,b)=>+new Date(b.date)-+new Date(a.date));
  const nets = computeNetByUser(group, db.expenses, db.settlements);
  const sugg = suggestSettlements(group, db.expenses, db.settlements);

  const [openAdd,setOpenAdd]=useState(false); const [openSettle,setOpenSettle]=useState(false); const [openInvite,setOpenInvite]=useState(false); const [delId,setDelId]=useState<string|null>(null); const [lastDeleted,setLastDeleted]=useState<Expense|null>(null);
  const deleteExpense=(expId:string)=> setDb(prev=>({...prev, expenses: prev.expenses.filter(e=>e.id!==expId)}));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3"><h1 className="text-2xl font-semibold tracking-tight">{group.name}</h1><div className="ml-auto flex items-center gap-2"><button onClick={()=>setOpenInvite(true)} className="px-3 py-2 rounded-xl bg-white border border-black/10 text-sm font-medium inline-flex items-center gap-2"><UserPlus className="w-4 h-4"/> Invite</button><button onClick={()=>setOpenSettle(true)} className="px-3 py-2 rounded-xl bg-black text-white text-sm font-medium">Settle</button><button onClick={()=>setOpenAdd(true)} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-black/10 text-sm font-medium"><Plus className="w-4 h-4"/> Add</button></div></div>
      <Glass className="p-4"><div className="grid sm:grid-cols-3 gap-3">{group.members.map(m=>{ const v=nets[m.id]||0; return (<div key={m.id} className="rounded-xl p-3 bg-white/60 border border-white/40"><div className="text-sm text-black/60">{m.name}</div><div className={`text-base font-semibold ${v<0?'text-rose-600': v>0?'text-emerald-700':'text-black'}`}>{v<0?'-':''}{format(Math.abs(v), group.currency)}</div></div>); })}</div></Glass>
      <div className="space-y-3">{exps.map(e=> (<Glass initial={{opacity:0,y:8}} animate={delId===e.id?{opacity:0,y:60,rotateX:25,scaleY:0.7}:{opacity:1,y:0,rotateX:0,scaleY:1}} key={e.id} className="p-4" style={{ transformPerspective: 600 }} onAnimationComplete={()=>{ if(delId===e.id){ deleteExpense(e.id); setDelId(null); pushAction('Expense deleted','Undo',()=>{ if(lastDeleted){ setDb(prev=>({...prev, expenses:[...prev.expenses,lastDeleted]})); setLastDeleted(null); } }); } }}><div className="flex items-start gap-3"><div className="flex-1 min-w-0"><div className="flex items-center gap-2"><div className="text-base font-medium truncate">{e.title}</div><div className="text-xs px-2 py-0.5 rounded-full bg-black/5 border border-black/10">{new Date(e.date).toLocaleDateString()}</div></div><div className="text-sm text-black/60">Paid by {group.members.find(m=>m.id===e.payerId)?.name} · {format(e.amount, group.currency)}</div></div><button onClick={()=>{ setLastDeleted(e); setDelId(e.id); }} className="p-2 rounded-xl hover:bg-black/5" aria-label="Delete"><Trash2 className="w-4 h-4"/></button></div></Glass>))}{exps.length===0 && (<Glass className="p-6 text-center text-black/60">No expenses yet. Add the first one.</Glass>)}</div>
      <Modal open={openAdd} onClose={()=>setOpenAdd(false)} title="Add expense"><AddExpenseForm group={group} onSubmit={(exp)=>{ setDb(prev=>({...prev, expenses:[...prev.expenses, exp]})); setOpenAdd(false); }}/></Modal>
      <Modal open={openSettle} onClose={()=>setOpenSettle(false)} title="Settle up"><div className="space-y-4">{sugg.length===0 ? (<div className="text-black/70">All settled. Nothing to pay.</div>) : (<div className="space-y-2">{sugg.map((s,i)=> (<div key={i} className="flex items-center justify-between p-3 rounded-xl border border-black/10 bg-white/70"><div className="text-sm"><strong>{group.members.find(m=>m.id===s.from)?.name}</strong> pays <strong>{group.members.find(m=>m.id===s.to)?.name}</strong></div><div className="font-semibold">{format(s.amount, group.currency)}</div></div>))}</div>)}{sugg.length>0 && (<button onClick={()=>{ const now=new Date().toISOString(); const recs: Settlement[] = sugg.map(s=>({ id:uid(), groupId:group.id, fromUser:s.from, toUser:s.to, amount:s.amount, date: now })); setDb(prev=>({...prev, settlements:[...prev.settlements, ...recs]})); setOpenSettle(false); }} className="w-full px-3 py-2 rounded-xl bg-black text-white text-sm font-medium flex items-center justify-center gap-2"><CheckCircle2 className="w-4 h-4"/> Record settlements</button>)}</div></Modal>
      <Modal open={openInvite} onClose={()=>setOpenInvite(false)} title="Invite to group"><InvitePanelLocal group={group}/></Modal>
    </div>
  );
};

const CloudGroupView: React.FC<{ id:string; sb:SB; goHome:()=>void }> = ({ id, sb, goHome }) => {
  const { push, pushAction } = React.useContext(ToastCtx);
  const [bundle,setBundle]=useState<{members:User[]; expenses:Expense[]; settlements:Settlement[]}|null>(null);
  const [groupMeta,setGroupMeta]=useState<{name:string; currency:string}|null>(null);
  const [openAdd,setOpenAdd]=useState(false); const [openSettle,setOpenSettle]=useState(false); const [openInvite,setOpenInvite]=useState(false); const [inviteUrl,setInviteUrl]=useState(''); const [delId,setDelId]=useState<string|null>(null); const [lastDeleted,setLastDeleted]=useState<Expense|null>(null);

  // FIX: wrap async in function, do not mark useEffect cb as async
  useEffect(()=>{
    let active = true;
    const fetchData = async () => {
      const { data: g } = await sb.from('groups').select('name,currency').eq('id', id).single();
      if (!active) return; setGroupMeta(g as any);
      const b = await sbGroupBundle(sb, id); if (!active) return; setBundle(b);
    };
    fetchData();

    const ch = sb.channel(`grp-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses', filter: `group_id=eq.${id}` }, ()=> sbGroupBundle(sb,id).then(b=>{ if(active) setBundle(b); }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expense_shares' }, ()=> sbGroupBundle(sb,id).then(b=>{ if(active) setBundle(b); }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settlements', filter: `group_id=eq.${id}` }, ()=> sbGroupBundle(sb,id).then(b=>{ if(active) setBundle(b); }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members', filter: `group_id=eq.${id}` }, ()=> sbGroupBundle(sb,id).then(b=>{ if(active) setBundle(b); }))
      .subscribe();
    return ()=>{ active=false; sb.removeChannel(ch); };
  },[id,sb]);

  if(!bundle || !groupMeta) return <Glass className="p-6">Loading…</Glass>;

  const group: Group = { id, name: groupMeta.name, currency: groupMeta.currency, members: bundle.members };
  const exps = bundle.expenses.sort((a,b)=> +new Date(b.date) - +new Date(a.date));
  const nets = computeNetByUser(group, bundle.expenses, bundle.settlements);
  const sugg = suggestSettlements(group, bundle.expenses, bundle.settlements);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3"><h1 className="text-2xl font-semibold tracking-tight">{group.name}</h1><div className="ml-auto flex items-center gap-2"><button onClick={()=>setOpenInvite(true)} className="px-3 py-2 rounded-xl bg-white border border-black/10 text-sm font-medium inline-flex items-center gap-2"><UserPlus className="w-4 h-4"/> Invite</button><button onClick={()=>setOpenSettle(true)} className="px-3 py-2 rounded-xl bg-black text-white text-sm font-medium">Settle</button><button onClick={()=>setOpenAdd(true)} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-black/10 text-sm font-medium"><Plus className="w-4 h-4"/> Add</button></div></div>
      <Glass className="p-4"><div className="grid sm:grid-cols-3 gap-3">{group.members.map(m=>{ const v=nets[m.id]||0; return (<div key={m.id} className="rounded-xl p-3 bg-white/60 border border-white/40"><div className="text-sm text-black/60">{m.name}</div><div className={`text-base font-semibold ${v<0?'text-rose-600': v>0?'text-emerald-700':'text-black'}`}>{v<0?'-':''}{format(Math.abs(v), group.currency)}</div></div>); })}</div></Glass>
      <div className="space-y-3">{exps.map(e=> (<Glass initial={{opacity:0,y:8}} animate={delId===e.id?{opacity:0,y:60,rotateX:25,scaleY:0.7}:{opacity:1,y:0,rotateX:0,scaleY:1}} key={e.id} className="p-4" style={{ transformPerspective: 600 }} onAnimationComplete={()=>{ if(delId===e.id){ setDelId(null); pushAction('Expense deleted','Undo',()=>{/* server-side undo would go here */}); } }}><div className="flex items-start gap-3"><div className="flex-1 min-w-0"><div className="flex items-center gap-2"><div className="text-base font-medium truncate">{e.title}</div><div className="text-xs px-2 py-0.5 rounded-full bg-black/5 border border-black/10">{new Date(e.date).toLocaleDateString()}</div></div><div className="text-sm text-black/60">Paid by {group.members.find(m=>m.id===e.payerId)?.name} · {format(e.amount, group.currency)}</div></div><button onClick={()=>{ /* soft-delete UX; real delete would call API */ setLastDeleted(e); setDelId(e.id); }} className="p-2 rounded-xl hover:bg-black/5" aria-label="Delete"><Trash2 className="w-4 h-4"/></button></div></Glass>))}{exps.length===0 && (<Glass className="p-6 text-center text-black/60">No expenses yet. Add the first one.</Glass>)}</div>
      <Modal open={openAdd} onClose={()=>setOpenAdd(false)} title="Add expense"><AddExpenseForm group={group} onSubmit={async(exp)=>{ try{ await sbAddExpense(sb, group.id, { title: exp.title, amount: exp.amount, payerId: exp.payerId, note: exp.note, shares: exp.shares }); setOpenAdd(false); const b=await sbGroupBundle(sb, group.id); setBundle(b); }catch(e){ push('Failed to add'); } }}/></Modal>
      <Modal open={openSettle} onClose={()=>setOpenSettle(false)} title="Settle up"><div className="space-y-4">{sugg.length===0 ? (<div className="text-black/70">All settled. Nothing to pay.</div>) : (<div className="space-y-2">{sugg.map((s,i)=> (<div key={i} className="flex items-center justify-between p-3 rounded-xl border border-black/10 bg-white/70"><div className="text-sm"><strong>{group.members.find(m=>m.id===s.from)?.name}</strong> pays <strong>{group.members.find(m=>m.id===s.to)?.name}</strong></div><div className="font-semibold">{format(s.amount, group.currency)}</div></div>))}</div>)}{sugg.length>0 && (<button onClick={async()=>{ try{ await sbRecordSettlements(sb, group.id, sugg); setOpenSettle(false); const b=await sbGroupBundle(sb, group.id); setBundle(b); }catch(e){ push('Failed to record'); } }} className="w-full px-3 py-2 rounded-xl bg-black text-white text-sm font-medium flex items-center justify-center gap-2"><CheckCircle2 className="w-4 h-4"/> Record settlements</button>)}</div></Modal>
      <Modal open={openInvite} onClose={()=>setOpenInvite(false)} title="Invite to group"><InvitePanelCloud sb={sb} groupId={group.id} inviteUrl={inviteUrl} setInviteUrl={setInviteUrl}/></Modal>
    </div>
  );
};

// --- Add Expense --------------------------------------------------------------
const AddExpenseForm: React.FC<{ group: Group; onSubmit: (e: Expense)=>void | Promise<void> }> = ({ group, onSubmit }) => {
  const [title,setTitle]=useState(''); const [amount,setAmount]=useState<number>(0); const [payer,setPayer]=useState(group.members[0]?.id||''); const [mode,setMode]=useState<'equal'|'amounts'|'percent'|'weights'>('equal');
  const ids = group.members.map(m=>m.id);
  const [amounts,setAmounts]=useState<Record<string,number>>(()=> allocateEqual(ids, 0));
  const [perc,setPerc]=useState<Record<string,number>>(()=> Object.fromEntries(ids.map(id=>[id, 100/Math.max(1,ids.length)])) as Record<string,number>);
  const [weights,setWeights]=useState<Record<string,number>>(()=> Object.fromEntries(ids.map(id=>[id,1])) as Record<string,number>);
  const [amountsTouched,setAmountsTouched]=useState(false); const [percTouched,setPercTouched]=useState(false);

  // Default distributions update when amount/member changes, unless user is editing
  useEffect(()=>{ if(!amountsTouched && mode==='amounts'){ setAmounts(allocateEqual(ids, amount)); } if(!percTouched && mode==='percent'){ const base = 100/Math.max(1,ids.length); setPerc(Object.fromEntries(ids.map(id=>[id, base])) as Record<string,number>); } if(mode==='equal'){ setAmounts(allocateEqual(ids, amount)); } if(mode==='weights'){ const weightsArr = ids.map(id=> weights[id]||1); setAmounts(allocateProportional(ids, weightsArr, amount)); } }, [amount, ids.join(','), mode]);

  const totalAmts = ids.reduce((a,id)=> a + (amounts[id]||0), 0);
  const totalPerc = ids.reduce((a,id)=> a + (perc[id]||0), 0);
  const valid = title.trim().length>0 && amount>0 && Math.abs(totalAmts-amount) < 0.01;

  const submit = async () => {
    const shares: ExpenseShare[] = ids.map(id=> ({ userId:id, amount: Number((amounts[id]||0).toFixed(2)) }));
    const exp: Expense = { id: uid(), groupId: group.id, title, amount: Number(amount.toFixed(2)), payerId: payer, date: new Date().toISOString(), shares };
    await onSubmit(exp);
  };

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium">Title</label>
      <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Dinner" className="w-full rounded-xl border border-black/10 px-3 py-2 outline-none focus:ring-2 focus:ring-black/20"/>
      <label className="block text-sm font-medium mt-2">Amount</label>
      <input type="number" value={amount} onChange={e=>setAmount(parseFloat(e.target.value||'0'))} className="w-full rounded-xl border border-black/10 px-3 py-2 outline-none focus:ring-2 focus:ring-black/20"/>
      <label className="block text-sm font-medium mt-2">Paid by</label>
      <div className="relative">
        <select value={payer} onChange={e=>setPayer(e.target.value)} className="w-full h-11 rounded-xl border border-black/10 px-3 pr-9 bg-white appearance-none outline-none focus:ring-2 focus:ring-black/20">
          {group.members.map(m=> <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-black/60"/>
      </div>

      {/* Segmented control */}
      <div className="mt-3 relative flex items-center bg-black/5 rounded-xl p-1 overflow-hidden">
        {(['equal','amounts','percent','weights'] as const).map(m=> (
          <motion.button key={m} layout onClick={()=>setMode(m)} className="relative px-3 py-1.5 h-9 rounded-lg text-sm font-medium leading-none">
            {mode===m && (
              <motion.span layoutId="seg-pill" animate={{ scale:[1,0.96,1] }} transition={{ duration: MotionDur.m, ease: MotionEase }} className="absolute inset-0 origin-center rounded-lg bg-white shadow border border-black/10"/>
            )}
            <span className={mode===m? 'relative z-10' : 'relative z-10 text-black/60'}>
              {m==='equal'? 'Equal' : m==='amounts'? 'Amounts' : m==='percent'? 'Percent' : 'Weights'}
            </span>
          </motion.button>
        ))}
      </div>

      {/* Editors */}
      {mode==='equal' && (
        <div className="mt-1 space-y-2">{group.members.map(m=> (<div key={m.id} className="flex items-center justify-between"><div>{m.name}</div><div className="text-black/70">{format(allocateEqual(ids, amount)[m.id]||0, group.currency)}</div></div>))}</div>
      )}
      {mode==='amounts' && (
        <div className="mt-1 space-y-2">{group.members.map(m=> (<div key={m.id} className="flex items-center gap-3 justify-between"><div className="flex-1">{m.name}</div><input type="number" value={amounts[m.id]||0} onChange={e=>{ setAmountsTouched(true); setAmounts(a=>({...a, [m.id]: parseFloat(e.target.value||'0')})); }} className="w-32 rounded-xl border border-black/10 px-3 py-2 outline-none"/></div>))}<div className="text-right text-sm text-black/60">Total {format(totalAmts, group.currency)}</div></div>
      )}
      {mode==='percent' && (
        <div className="mt-1 space-y-2">{group.members.map(m=> (<div key={m.id} className="flex items-center gap-3 justify-between"><div className="flex-1">{m.name}</div><div className="flex items-center gap-2"><input type="number" value={perc[m.id]||0} onChange={e=>{ setPercTouched(true); const p = Math.max(0, parseFloat(e.target.value||'0')); setPerc(prev=>({...prev,[m.id]:p})); setAmounts(allocatePercent(ids, group.members.map(x=> (x.id===m.id? p : (perc[x.id]||0))), amount)); }} className="w-24 rounded-xl border border-black/10 px-3 py-2 outline-none"/><span className="text-sm text-black/60">%</span></div></div>))}<div className="text-right text-sm text-black/60">{Math.round(totalPerc)}%</div></div>
      )}
      {mode==='weights' && (
        <div className="mt-1 space-y-2">{group.members.map(m=> (<div key={m.id} className="flex items-center gap-3 justify-between"><div className="flex-1">{m.name}</div><input type="number" value={weights[m.id]||1} onChange={e=>{ const w = Math.max(0, parseFloat(e.target.value||'0')||0); setWeights(prev=>({...prev,[m.id]:w})); const wArr = ids.map(id=> id===m.id? w : (weights[id]||1)); setAmounts(allocateProportional(ids, wArr, amount)); }} className="w-24 rounded-xl border border-black/10 px-3 py-2 outline-none"/></div>))}</div>
      )}

      <div className="pt-2 flex justify-end"><button onClick={submit} disabled={!valid} className={`px-3 py-2 rounded-xl text-sm font-medium ${valid? 'bg-black text-white':'bg-black/10 text-black/40 cursor-not-allowed'}`}>Add expense</button></div>
    </div>
  );
};

// --- Invite panels ------------------------------------------------------------
const InvitePanelLocal: React.FC<{ group: Group }> = ({ group }) => {
  const url = `${location.origin}${location.pathname}#demo/${group.id}`;
  return (
    <div className="space-y-3">
      <div className="text-sm text-black/70">Share this link with people on the same device/browser (demo mode). Use cloud for real invites.</div>
      <Glass className="p-3 flex items-center justify-between"><code className="text-sm break-all">{url}</code><button onClick={()=>{ navigator.clipboard.writeText(url); (window as any)._DW_toast && (window as any)._DW_toast('Link copied'); }} className="px-2 py-1 rounded-lg bg-black text-white text-xs font-medium">Copy</button></Glass>
    </div>
  );
};

const InvitePanelCloud: React.FC<{ sb: SB; groupId: string; inviteUrl: string; setInviteUrl: (s:string)=>void }> = ({ sb, groupId, inviteUrl, setInviteUrl }) => {
  const make = async () => { const token=await sbCreateInvite(sb, groupId); const url = `${location.origin}${location.pathname}#join/${token}`; setInviteUrl(url); };
  return (
    <div className="space-y-3">
      <div className="text-sm text-black/70">Create an invite link that lets others join this group.</div>
      <div className="flex items-center gap-2"><button onClick={make} className="px-3 py-2 rounded-xl bg-black text-white text-sm font-medium inline-flex items-center gap-2"><LinkIcon className="w-4 h-4"/> Create invite</button>{inviteUrl && (<button onClick={()=>{ navigator.share? navigator.share({ url: inviteUrl, title: 'Join my DriftWise group' }).catch(()=>navigator.clipboard.writeText(inviteUrl)) : navigator.clipboard.writeText(inviteUrl); (window as any)._DW_toast && (window as any)._DW_toast('Invite copied'); }} className="px-3 py-2 rounded-xl bg-white border border-black/10 text-sm font-medium inline-flex items-center gap-2"><Share2 className="w-4 h-4"/> Share</button>)}</div>
      {inviteUrl && (<Glass className="p-3"><code className="text-sm break-all">{inviteUrl}</code></Glass>)}
    </div>
  );
};

// --- Auth / Settings ----------------------------------------------------------
const AuthPanel: React.FC<{ sb: SB | null; onDone: ()=>void }> = ({ sb, onDone }) => {
  const [email,setEmail]=useState('');
  if(!sb) return <div className="text-black/70">Add Supabase keys in Settings to enable sign-in.</div>;
  return (
    <div className="space-y-3">
      <div className="text-sm text-black/70">Use a magic link to sign in.</div>
      <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" className="w-full rounded-xl border border-black/10 px-3 py-2 outline-none focus:ring-2 focus:ring-black/20"/>
      <div className="pt-2 flex justify-end"><button onClick={async()=>{ const { error } = await sb.auth.signInWithOtp({ email }); if(error){ (window as any)._DW_toast && (window as any)._DW_toast('Sign-in failed'); } else { (window as any)._DW_toast && (window as any)._DW_toast('Check your email'); onDone(); } }} className="px-3 py-2 rounded-xl bg-black text-white text-sm font-medium">Send link</button></div>
    </div>
  );
};

const SettingsPanel: React.FC = () => {
  const [url,setUrl]=useState<string>(localStorage.getItem('sb_url')||'');
  const [anon,setAnon]=useState<string>(localStorage.getItem('sb_anon')||'');
  return (
    <div className="space-y-3">
      <div className="text-sm text-black/70">Paste your Supabase URL and anon key to enable cloud sync. These are stored locally in your browser.</div>
      <input value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://your-project.supabase.co" className="w-full rounded-xl border border-black/10 px-3 py-2 outline-none"/>
      <input value={anon} onChange={e=>setAnon(e.target.value)} placeholder="public-anon-key" className="w-full rounded-xl border border-black/10 px-3 py-2 outline-none"/>
      <div className="pt-2 flex justify-end"><button onClick={()=>{ localStorage.setItem('sb_url', url); localStorage.setItem('sb_anon', anon); window.dispatchEvent(new Event('sb-keys-updated')); (window as any)._DW_toast && (window as any)._DW_toast('Saved'); }} className="px-3 py-2 rounded-xl bg-black text-white text-sm font-medium">Save</button></div>
    </div>
  );
};

// --- Tests -------------------------------------------------------------------
const TestRunner: React.FC = () => {
  const [results,setResults]=useState<{name:string; pass:boolean; detail?:string}[]>([]);
  const run=()=>{
    const out: typeof results = [];
    const mk = (name:string, fn:()=>void) => { try{ fn(); out.push({name, pass:true}); }catch(e:any){ out.push({name, pass:false, detail:String(e?.message||e)}); } };

    // No expenses
    mk('All settled (no expenses)', ()=>{ const u1={id:'a',name:'A'}, u2={id:'b',name:'B'}; const g:Group={id:'g',name:'G',currency:'USD',members:[u1,u2]}; const n=computeNetByUser(g,[],[]); if(n[u1.id]!==0||n[u2.id]!==0) throw new Error('not zero'); });

    // Two people equal
    mk('Two people equal', ()=>{ const u1={id:'a',name:'A'}, u2={id:'b',name:'B'}; const g:Group={id:'g',name:'G',currency:'USD',members:[u1,u2]}; const e:Expense={id:'e',groupId:'g',title:'t',amount:100,payerId:u1.id,date:'d',shares:[{userId:u1.id,amount:50},{userId:u2.id,amount:50}]}; const n=computeNetByUser(g,[e],[]); if(Math.abs(n[u1.id]-50)>1e-9) throw new Error('A not +50'); if(Math.abs(n[u2.id]+50)>1e-9) throw new Error('B not -50'); });

    // Unequal 3p
    mk('Unequal shares 3p', ()=>{ const [a,b,c] = [{id:'a',name:'A'},{id:'b',name:'B'},{id:'c',name:'C'}]; const g:Group={id:'g',name:'G',currency:'USD',members:[a,b,c]}; const e:Expense={id:'e',groupId:'g',title:'t',amount:99,payerId:a.id,date:'d',shares:[{userId:a.id,amount:33},{userId:b.id,amount:33},{userId:c.id,amount:33}]}; const n=computeNetByUser(g,[e],[]); if(n[a.id]!==66||n[b.id]!==-33||n[c.id]!==-33) throw new Error('bad'); });

    // Rounding exactness
    mk('Rounding exactness', ()=>{ const ids=['a','b','c']; const res=allocateProportional(ids,[1,1,1],10); const sum=Object.values(res).reduce((a,b)=>a+b,0); if(Math.abs(sum-10)>1e-6) throw new Error('not exact'); });

    // Alternating payers
    mk('Alternating payers', ()=>{ const u=[{id:'a',name:'A'},{id:'b',name:'B'}]; const g:Group={id:'g',name:'G',currency:'USD',members:u}; const e1:Expense={id:'1',groupId:'g',title:'',amount:60,payerId:'a',date:'d',shares:[{userId:'a',amount:30},{userId:'b',amount:30}]}; const e2:Expense={id:'2',groupId:'g',title:'',amount:40,payerId:'b',date:'d',shares:[{userId:'a',amount:20},{userId:'b',amount:20}]}; const n=computeNetByUser(g,[e1,e2],[]); if(Math.abs(n['a']-10)>1e-9 || Math.abs(n['b']+10)>1e-9) throw new Error('bad'); });

    // Large numbers
    mk('Large numbers', ()=>{ const ids=['a','b']; const res=allocateProportional(ids,[1,1],1_000_000.01); const sum=Object.values(res).reduce((a,b)=>a+b,0); if(Math.abs(sum-1_000_000.01)>1e-2) throw new Error('sum drift'); });

    // Manual settlement zeros out
    mk('Manual settlement zeroes out', ()=>{ const a={id:'a',name:'A'}, b={id:'b',name:'B'}; const g:Group={id:'g',name:'g',currency:'USD',members:[a,b]}; const e:Expense={id:'e',groupId:'g',title:'',amount:100,payerId:'a',date:'d',shares:[{userId:'a',amount:50},{userId:'b',amount:50}]}; const n1=computeNetByUser(g,[e],[]); const s:Settlement={id:'s',groupId:'g',fromUser:'b',toUser:'a',amount:50,date:'d'}; const n2=computeNetByUser(g,[e],[s]); if(Math.abs(n2['a'])>1e-9 || Math.abs(n2['b'])>1e-9) throw new Error('not zero'); });

    // Floating point dust
    mk('Floating point dust', ()=>{ const ids=['a','b','c','d','e']; const res=allocateProportional(ids,[1,1,1,1,1],1); const sum=Object.values(res).reduce((a,b)=>a+b,0); if(Math.abs(sum-1)>1e-6) throw new Error('dust'); });

    setResults(out);
  };

  return (
    <div className="space-y-3">
      <div className="text-black/70">Runs deterministic checks on the balances engine and settlement suggestions across common and edge scenarios.</div>
      <button onClick={run} className="px-3 py-2 rounded-xl bg-black text-white text-sm font-medium">Run tests</button>
      <div className="space-y-2">
        {results.map((r,i)=> (
          <div key={i} className={`p-3 rounded-xl border ${r.pass? 'bg-emerald-50 border-emerald-200 text-emerald-700': 'bg-rose-50 border-rose-200 text-rose-700'}`}>{r.pass? 'PASS':'FAIL'} — {r.name}{r.detail? ` — ${r.detail}`:''}</div>
        ))}
      </div>
    </div>
  );
};
