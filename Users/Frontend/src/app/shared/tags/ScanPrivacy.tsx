import {useEffect,useRef,useState} from "react";
import {tagsApi,newScanReceipt,type ScanReceipt,type SharedPoint} from "@/app/utils/tags";
import CampusVenueSelect from "../../../../../../shared/CampusVenueSelect";
import {useCampusVenues} from "../../../../../../shared/useCampusVenues";

/** This component never requests location on mount. Each recipient must be chosen explicitly. */
export default function ScanPrivacy({tag,enabled,recorded}:{tag:string;enabled:boolean;recorded?:ScanReceipt}) {
  const venues=useCampusVenues();
  const [fallbackReceipt]=useState(newScanReceipt);
  const receipt=recorded??fallbackReceipt;
  const registration=useRef<Promise<unknown>|null>(null);
  const [ready,setReady]=useState(false),[admin,setAdmin]=useState(false),[owner,setOwner]=useState(false);
  const [venue,setVenue]=useState(""),[dropOff,setDropOff]=useState(""),[point,setPoint]=useState<SharedPoint|null>(null);
  const [busy,setBusy]=useState(false),[locating,setLocating]=useState(false),[shared,setShared]=useState(false),[attempted,setAttempted]=useState(false),[notice,setNotice]=useState("");
  const sequence=useRef(0);
  useEffect(()=>{
    let active=true;
    if(enabled){
      if(recorded){setReady(true);}
      else {
        if(!registration.current) registration.current=tagsApi.recordScan(tag,receipt);
        registration.current.then(()=>{if(active)setReady(true);}).catch(()=>{if(active)setNotice("Visit logging is unavailable. You can still contact the owner or report the item.");});
      }
    }
    return ()=>{active=false;sequence.current++;};
  },[tag,enabled,receipt,recorded]);
  function locate(){
    if(!(admin||owner)){setNotice("Choose who may receive your location first.");return;}
    if(!navigator.geolocation||!window.isSecureContext){setNotice("GPS is unavailable. Choose an area or drop-off instead.");return;}
    const attempt=++sequence.current;setLocating(true);setNotice("");
    navigator.geolocation.getCurrentPosition(position=>{
      if(attempt!==sequence.current)return;
      const {latitude,longitude,accuracy}=position.coords;
      setPoint({latitude,longitude,accuracy,captured_at:new Date(position.timestamp).toISOString(),consent_version:"finder-v1"});setLocating(false);
    },()=>{if(attempt===sequence.current){setLocating(false);setNotice("GPS was declined or unavailable. You can select an area/drop-off, or continue without sharing.");}},
    {enableHighAccuracy:true,timeout:15000,maximumAge:0});
  }
  async function send(withdraw=false){
    if(!withdraw)setAttempted(true);
    setBusy(true);setNotice("");
    try{
      const proof={scan_id:receipt.scan_id,token:receipt.token};
      await tagsApi.shareScan(tag,withdraw?proof:{...proof,admin_consent:admin,owner_consent:owner,consent_version:"scan-v1",venue,drop_off:dropOff,point},withdraw?"withdraw":"share");
      setShared(!withdraw);if(withdraw){setPoint(null);setVenue("");setDropOff("");setAdmin(false);setOwner(false);setReady(false);}
      setNotice(withdraw?"Shared location removed. Basic visit metadata expires within 30 days.":"Location shared only with the recipient(s) you chose. You can remove it below while this page remains open.");
    }catch(e){setNotice(e instanceof Error?e.message:"Unable to update scan location.");}
    finally{setBusy(false);}
  }
  return <section className="mt-5 rounded-2xl border border-white/20 bg-navy-950/70 p-4 text-sm leading-6 text-white">
    <h2 className="font-semibold">Your privacy when opening a tag</h2>
    <p className="mt-2 text-white/85">{enabled?"We record the tag code and page-open time for recovery and misuse review. This does not prove a physical scan. We do not add your name, IP address or device fingerprint to this log.":"E-Balik keeps an approximate visit count and last-visit time for this tag."} GPS is never collected automatically. The owner chooses which contact details appear above.</p>
    {enabled&&<>
      <p className="mt-2 text-white/85">Optional locations are visible for up to 7 days or until resolved/withdrawn. Basic visit records expire after 30 days; aggregate counts and the last-visit time remain with the tag. Choosing neither recipient keeps your location private and does not restrict recovery information.</p>
      <details className="mt-3">
        <summary className="cursor-pointer font-semibold text-gold-200">Optional scan location: share with admins or owner</summary>
        <p className="mt-2 text-white/85">This visit is logged even without location. To send a location to admins, choose the administrator checkbox, select GPS or an area, then press Share location. Sending location in the finder report only sends it to the owner.</p>
        <fieldset disabled={busy||shared||!ready} className="mt-3 space-y-3">
          <label className="flex items-start gap-2"><input type="checkbox" checked={admin} onChange={e=>setAdmin(e.target.checked)} className="mt-1"/>I agree to share my selected area/drop-off or GPS point with authorized E-Balik administrators for recovery and misuse review.</label>
          <label className="flex items-start gap-2"><input type="checkbox" checked={owner} onChange={e=>setOwner(e.target.checked)} className="mt-1"/>I agree to share that location with this tag's current owner to help recover the item.</label>
          <label className="block">Campus area (optional)<CampusVenueSelect venues={venues.filter(v=>v!=="Other")} value={venue} onChange={setVenue} label="Scan area" placeholder="Not sure / elsewhere" className="mt-1 w-full min-w-0 rounded-xl bg-white p-3 text-navy-950"/></label>
          <label className="block">Drop-off (optional)<select value={dropOff} onChange={e=>setDropOff(e.target.value)} className="mt-1 w-full rounded-xl bg-white p-3 text-navy-950"><option value="">Not selected</option><option>OHSO guard post</option><option>Lost and Found Office</option></select></label>
          <button type="button" disabled={locating||!(admin||owner)} onClick={locate} className="min-h-11 rounded-xl border border-white/30 px-3 py-2">{locating?"Getting GPS…":"Choose my current GPS point"}</button>
          {point&&<p>Preview: {point.latitude.toFixed(5)}, {point.longitude.toFixed(5)} · ±{Math.round(point.accuracy)} m <button className="underline" type="button" onClick={()=>setPoint(null)}>Remove GPS</button></p>}
          <p className="text-white/80">A device point may differ from where the item was found. Nothing here is sent until you press Share location. To decline, close this section and continue using the tag.</p>
          <button type="button" disabled={locating||!(admin||owner)||!(venue||dropOff||point)} onClick={()=>void send()} className="min-h-11 rounded-xl bg-gold-300 px-4 py-2 font-semibold text-navy-950 disabled:opacity-50">Share location</button>
        </fieldset>
        {(shared||attempted)&&<button className="mt-3 min-h-11 underline" disabled={busy} onClick={()=>void send(true)}>Withdraw and remove shared location</button>}
      </details>
      <p className="mt-2 text-white/80">For privacy questions or deletion requests, contact <a className="underline" href="mailto:ebaliksupport@gmail.com">ebaliksupport@gmail.com</a> or the Lost and Found Office. Read the <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline">privacy notice</a>. Server/security logs are handled separately from this visit log.</p>
      {ready&&<p className="mt-2 break-all font-mono text-xs text-white/80">Visit reference: {receipt.scan_id}</p>}
    </>}
    {notice&&<p role="status" className="mt-2 text-gold-200">{notice}</p>}
  </section>;
}
