import {useEffect,useState} from "react";
import {tagsApi,type SharedScan} from "@/app/utils/tags";
import {CX} from "@/app/utils/clay";

export default function SharedScanHistory({tag}:{tag:string}){
 const [rows,setRows]=useState<SharedScan[]>([]),[available,setAvailable]=useState(false),[error,setError]=useState(""),[refresh,setRefresh]=useState(0);
 const [now,setNow]=useState(Date.now());
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),10000);return()=>clearInterval(timer);},[]);
 useEffect(()=>{let active=true;tagsApi.scanHistory(tag).then(data=>{if(active){setRows(data.scans);setAvailable(data.available);setError("");}}).catch(()=>{if(active)setError("Shared visit activity could not be refreshed.");});return()=>{active=false;};},[tag,refresh]);
 if(!available&&!error)return null;
 return <section className="space-y-3 rounded-2xl border border-line p-4 text-ink">
  <div className="flex flex-wrap items-center justify-between gap-2"><h3 className={CX.label}>Locations shared with you</h3><button type="button" className={CX.btnGhost} onClick={()=>setRefresh(n=>n+1)}>Refresh</button></div>
  <p className={CX.helper}>Only visits where the scanner explicitly selected owner sharing appear here. A page visit does not confirm an item was found.</p>
  {error&&<p role="alert">{error}</p>}
  <div className="max-h-80 space-y-3 overflow-y-auto">{rows.map(row=><article key={row.scan_id} className="border-t border-line pt-3 text-sm">
   <strong>{new Date(row.scanned_at).toLocaleString()}</strong>
   <p>{row.location_expires_at&&Date.parse(row.location_expires_at)>now?(row.venue||row.drop_off||"GPS shared"):"Location expired or removed"}</p>{row.venue&&row.drop_off&&row.location_expires_at&&Date.parse(row.location_expires_at)>now&&<p>Drop-off: {row.drop_off}</p>}
   {row.latitude!=null&&row.longitude!=null&&row.location_expires_at&&Date.parse(row.location_expires_at)>now&&<p>Device point: {row.latitude.toFixed(5)}, {row.longitude.toFixed(5)} · ±{Math.round(row.accuracy||0)} m</p>}
   {row.resolved_at&&<p>Resolved; location removed.</p>}
  </article>)}</div>
  {!error&&!rows.length&&<p className={CX.helper}>No scan locations have been shared with you.</p>}
 </section>;
}
