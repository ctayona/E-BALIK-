import {useEffect,useState} from "react";
import AdminModal from "../../components/ui/AdminModal";
import {BTN,SelectInput,TextInput,TextArea} from "../../components/ui/primitives";
import {ITEM_CATEGORIES} from "../../utils/itemOptions";
import {privacyRead,privacyWrite,type ReviewReport} from "../../utils/privacyApi";

export default function ReportApprovals(){
 const [rows,setRows]=useState<ReviewReport[]>([]),[available,setAvailable]=useState(true),[loading,setLoading]=useState(true),[more,setMore]=useState(false);
 const [kind,setKind]=useState("all"),[state,setState]=useState("pending"),[category,setCategory]=useState(""),[q,setQ]=useState(""),[offset,setOffset]=useState(0),[refresh,setRefresh]=useState(0);
 const [selected,setSelected]=useState<ReviewReport|null>(null),[decision,setDecision]=useState("approved"),[note,setNote]=useState(""),[requestId,setRequestId]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 useEffect(()=>{let active=true;setLoading(true);setError("");const timer=setTimeout(()=>{
  privacyRead<{available:boolean;reports:ReviewReport[];has_more:boolean}>("report-publication",{kind,state,category,q,offset}).then(data=>{if(active){setRows(data.reports);setAvailable(data.available);setMore(data.has_more);}}).catch(e=>{if(active){setRows([]);setError(e.message);}}).finally(()=>{if(active)setLoading(false);});
 },200);return()=>{active=false;clearTimeout(timer);};},[kind,state,category,q,offset,refresh]);
 function filter(set:(v:string)=>void,value:string){set(value);setOffset(0);}
 async function review(){if(!selected)return;setBusy(true);setError("");try{
  await privacyWrite("report-publication",{kind:selected.kind,item_id:selected.item_id,version:selected.version,state:decision,note,request_id:requestId},"Review report publication");
  setSelected(null);setRefresh(n=>n+1);
 }catch(e){setError(e instanceof Error?e.message:"Review failed. Refresh the report.");}finally{setBusy(false);}}
 return <section className="space-y-4 p-4 sm:p-6 text-ink">
  <div><h1 className="text-2xl font-semibold">Approve Reports</h1><p className="mt-1 text-sm text-ink-muted">Review campus posts before they appear in the hub, matching, search and public feed. Approval does not confirm physical custody or ownership. Content edits require review again.</p></div>
  <div className="grid gap-3 rounded-2xl border border-line bg-[var(--surface)] p-4 sm:grid-cols-2 lg:grid-cols-4">
   <label className="text-sm">Report type<SelectInput value={kind} onChange={e=>filter(setKind,e.target.value)}><option value="all">All reports</option><option value="missing">Lost reports</option><option value="found">Found reports</option></SelectInput></label>
   <label className="text-sm">Review state<SelectInput value={state} onChange={e=>filter(setState,e.target.value)}><option value="pending">Awaiting review</option><option value="approved">Approved</option><option value="rejected">Needs changes</option></SelectInput></label>
   <label className="text-sm">Category<SelectInput value={category} onChange={e=>filter(setCategory,e.target.value)}><option value="">All categories</option>{ITEM_CATEGORIES.map(c=><option key={c}>{c}</option>)}</SelectInput></label>
   <label className="text-sm">Item title<TextInput value={q} onChange={e=>filter(setQ,e.target.value)} placeholder="Filter item titles"/></label>
  </div>
  {!available&&<p role="status">Report review is not available yet. Apply the scan privacy/report review migration before activation.</p>}
  {error&&<p role="alert" className="rounded-xl border border-rose-300 p-3 text-ink">{error}</p>}
  <div className="max-h-[60vh] overflow-auto rounded-2xl border border-line" role="region" aria-label="Report approval queue" tabIndex={0}>
   <table className="w-full min-w-[720px] text-left text-sm"><thead className="sticky top-0 bg-[var(--surface)]"><tr>{["Report","Type/category","Location","Submitted","Review"].map(h=><th className="p-4" key={h}>{h}</th>)}</tr></thead><tbody>
    {rows.map(row=><tr className="border-t border-line" key={row.kind+row.item_id}><td className="p-4"><strong>{row.item_name}</strong><p className="text-xs text-ink-muted">{row.reference}</p></td><td className="p-4">{row.kind} · {row.category}</td><td className="p-4">{row.location}</td><td className="p-4">{new Date(row.created_at).toLocaleString("en-PH",{timeZone:"Asia/Manila"})}</td><td className="p-4"><button type="button" className={BTN.ghost} onClick={()=>{setSelected(row);setNote("");setDecision("approved");setRequestId(crypto.randomUUID());}}>Review</button></td></tr>)}
    {!rows.length&&<tr><td className="p-6" colSpan={5}>{loading?"Loading reports…":"No reports match these filters."}</td></tr>}
   </tbody></table>
  </div>
  <div className="flex flex-wrap items-center gap-3"><button type="button" disabled={!offset||loading} className={BTN.ghost} onClick={()=>setOffset(n=>n-50)}>Previous</button><button type="button" disabled={!more||loading||offset>=900} className={BTN.ghost} onClick={()=>setOffset(n=>n+50)}>Next</button><button type="button" className={BTN.ghost} disabled={loading} onClick={()=>setRefresh(n=>n+1)}>Refresh</button></div>
  {selected&&<AdminModal title={selected.item_name} description={`${selected.reference} · ${selected.kind} report`} onClose={()=>setSelected(null)} busy={busy} footer={<><button className={BTN.ghost} disabled={busy} onClick={()=>setSelected(null)}>Close</button>{selected.state==="pending"&&<button className={BTN.primary} disabled={busy||(decision==="rejected"&&note.trim().length<5)} onClick={()=>void review()}>{busy?"Saving…":"Save review"}</button>}</>}>
   <div className="space-y-4 text-sm text-ink">
    <p className="whitespace-pre-wrap break-words">{selected.description||"No description"}</p><p>{selected.location} · {selected.category}</p>
    {selected.image_url&&<img src={selected.image_url} alt="Submitted item" referrerPolicy="no-referrer" className="max-h-64 w-full rounded-xl object-contain"/>}
    <p>Custody: {selected.custody_status||"Not applicable"}. This decision only controls publication.</p>
    {selected.state==="pending"&&<><label className="block">Decision<SelectInput value={decision} onChange={e=>setDecision(e.target.value)}><option value="approved">Approve publication</option><option value="rejected">Reject / needs changes</option></SelectInput></label><label className="block">Reason (required for rejection)<TextArea value={note} onChange={e=>setNote(e.target.value)} maxLength={300}/></label></>}
    {error&&<p role="alert">{error}</p>}
   </div>
  </AdminModal>}
 </section>;
}
