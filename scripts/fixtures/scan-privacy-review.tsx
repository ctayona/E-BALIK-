// Offline browser fixtures. Every API and geolocation call is intercepted before mounting.
import React,{StrictMode} from "react";
import {createRoot} from "react-dom/client";
import ScanPrivacy from "../../Users/Frontend/src/app/shared/tags/ScanPrivacy";
import TagPage from "../../Users/Frontend/src/app/pages/tag/TagPage";
import ReportApprovals from "../../Admin/Frontend/src/pages/reports/ReportApprovals";
import ActivityLogs from "../../Admin/Frontend/src/pages/activity-logs/ActivityLogs";
import MyReports from "../../Users/Frontend/src/app/pages/my-reports/MyReports";
import Notifications from "../../Users/Frontend/src/app/pages/notifications/Notifications";
import LostItems from "../../Admin/Frontend/src/pages/lost-items/LostItems";
import {notificationTarget} from "../../Users/Frontend/src/app/utils/notifications";
import type {NavigationOptions} from "../../Users/Frontend/src/app/types";
const mode=new URLSearchParams(location.search).get("mode")||"scan-mobile";
document.documentElement.dataset.theme=mode.includes("dark")?"dark":"light";
localStorage.setItem("ebalik_admin_token","offline");
localStorage.setItem("ebalik_admin_user",JSON.stringify({account_id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",access_level:"super_admin"}));
document.getElementById("fixture-theme")!.setAttribute("href",mode.startsWith("scan")||mode.startsWith("tag")?"user.css":"admin.css");
let gpsCalls=0,records=0,shares=0,reviews=0,tagViews=0,newArrival=false;
const visits=new Set<string>();
const tagReceipt={scan_id:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",token:"fixture-receipt-secret-".repeat(3),scanned_at:new Date().toISOString()};
Object.defineProperty(navigator,"geolocation",{configurable:true,value:{getCurrentPosition(_ok:unknown,fail:(e:{code:number})=>void){gpsCalls++;fail({code:1});}}});
const row={kind:"found",item_id:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",reference:"FP-TEST",item_name:"Fixture bottle",category:"Personal Effects",description:"A blue bottle without identifying details.",location:"Gymnasium",created_at:new Date().toISOString(),state:"pending",version:1,custody_status:"in_custody",reporter:"Account holder"};
const journey=mode.startsWith("report-journey");
if(journey){row.kind="missing";row.reference="MP-TEST";localStorage.setItem("ebalik_token","offline-owner");localStorage.setItem("ebalik_user",JSON.stringify({account_id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",email:"fixture@example.invalid",fname:"Fixture",lname:"Owner",verification_status:"verified",access_level:"user"}));}
const notices:any[]=[];
const scan:any={scan_id:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",tag_id:"ABCDEFGHJK23",scanned_at:new Date().toISOString(),expires_at:new Date(Date.now()+86400000).toISOString(),admin_consent:true,owner_consent:false,shared_at:new Date().toISOString(),location_expires_at:new Date(Date.now()+3600000).toISOString(),latitude:14.5,longitude:121,accuracy:5,captured_at:new Date().toISOString(),version:2};
window.fetch=async(input,options={})=>{
 const url=new URL(String(input)),path=url.pathname;
 if(path==="/api/tags/venues")return Response.json({venues:["Gymnasium","Library"]});
 if(journey&&path==="/api/missing-items")return Response.json({items:[{item_id:row.item_id,mpost_id:row.reference,item_name:row.item_name,category:row.category,description:row.description,last_location:row.location,last_seen_date:"2026-11-25",status:"missing",publication_state:row.state}]});
 if(journey&&path==="/api/found-items")return Response.json({items:[]});
 if(journey&&path==="/api/admin/lost-items")return Response.json({items:[{id:row.reference,item:row.item_name,description:row.description,category:row.category,location:row.location,dateLost:"2026-11-25",reportedBy:"Fixture Owner",studentId:"Fixture",status:"Searching",rawStatus:"missing",publicationState:row.state,archived:false}]});
 if(journey&&path==="/api/notifications")return Response.json({notifications:[...notices]});
 if(journey&&path.includes("/api/notifications/")&&path.endsWith("/read"))return Response.json({success:true});
 if(path==="/api/tags/ABCDEFGHJK23"){
  const headers=new Headers(options.headers);
  if(mode.includes("legacy")&&headers.has("X-Tag-Scan-Id"))throw TypeError("Older backend preflight");
  if(headers.has("X-Tag-Scan-Id"))Object.assign(tagReceipt,{scan_id:headers.get('X-Tag-Scan-Id'),token:headers.get('X-Tag-Scan-Token')});
  tagViews++;visits.add(tagReceipt.scan_id);
  return Response.json({tag_id:"ABCDEFGHJK23",status:"active",item_name:"Fixture bottle",contact:{name:"Visible owner"},scan_logging:true,scan_receipt:{...tagReceipt}});
 }
 if(path.endsWith("/scan")){records++;const body=JSON.parse(String(options.body));if(Object.keys(body).sort().join()!=="scan_id,token")throw Error("Unexpected visit metadata");return Response.json({scan_id:body.scan_id,scanned_at:new Date().toISOString()});}
 if(path.endsWith("/scan/share")){const body=JSON.parse(String(options.body));if('scanned_at' in body||body.admin_consent!==true||body.owner_consent!==false||body.point!==null||body.venue!=="Gymnasium")throw Error("Consent or fallback mismatch");shares++;return Response.json({shared_at:new Date().toISOString()});}
 if(path.endsWith("/scan/withdraw")){const body=JSON.parse(String(options.body));if(Object.keys(body).sort().join()!=="scan_id,token")throw Error("Unexpected withdrawal field");return Response.json({withdrawn_at:new Date().toISOString()});}
 if(path.endsWith("/report-publication")){
  if(options.method==="POST"){const body=JSON.parse(String(options.body));if(body.state!=="approved"||body.version!==1||body.custody_status)throw Error("Review modified custody or used stale fields");reviews++;row.state="approved";row.version++;if(journey)notices.push({notification_id:"fixture-notice",title:"Report approved",message:"Your report was approved and is now posted.",notification_type:"report_approval",missing_report_reference:row.reference,link_page:"my-reports",link_label:"View my report",is_read:false,created_at:new Date().toISOString()});return Response.json({state:"approved",version:2});}
  return Response.json({available:true,reports:url.searchParams.get("state")===row.state?[{...row}]:[],has_more:false});
 }
 if(path.endsWith("/tag-scan-activity")){
  if(options.method==="POST"){const body=JSON.parse(String(options.body));if(body.version!==2)throw Error("Stale scan version");scan.resolved_at=new Date().toISOString();delete scan.latitude;delete scan.longitude;delete scan.location_expires_at;return Response.json({version:3,resolved_at:scan.resolved_at});}
  if(mode.includes("slow"))await new Promise(resolve=>setTimeout(resolve,6000));
  return Response.json({available:true,scans:[{...scan},...(newArrival?[{...scan,scan_id:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",tag_id:"ZXCVBNMASD23",resolved_at:null}]:[])],has_more:false});
 }
 if(path.endsWith("/activity-logs"))return Response.json({logs:[]});
 throw Error("Unexpected offline request "+path);
};
function ReportJourney(){
 const [stage,setStage]=React.useState("owner");const [options,setOptions]=React.useState<NavigationOptions>({highlightReportId:row.reference});
 React.useEffect(()=>{document.getElementById("fixture-theme")!.setAttribute("href",stage.startsWith("admin")?"admin.css":"user.css");},[stage]);
 return <><nav className="flex flex-wrap gap-2 p-3">{["owner","admin review","admin posts","notifications"].map(name=><button key={name} onClick={()=>setStage(name)}>QA {name}</button>)}</nav>{stage==="owner"?<MyReports onNavigate={()=>undefined} highlightId={options.highlightReportId} initialTab={options.reportsTab}/>:stage==="admin review"?<ReportApprovals/>:stage==="admin posts"?<LostItems/>:<Notifications onNavigate={(_page,next)=>{setOptions(next||{});setStage("owner");}}/>}</>;
}
const target=journey?<ReportJourney/>:mode.startsWith("tag")?<TagPage rawId={mode.includes("nfc")?"https://e-balik-kappa.vercel.app/tag/ABCDEFGHJK23":"ABCDEFGHJK23"}/>:mode.startsWith("scan")?<div className="min-h-screen bg-navy-950 p-4"><a href="mailto:owner@example.invalid" className="text-white">Basic recovery contact</a><ScanPrivacy tag="ABCDEFGHJK23" enabled/></div>:mode.startsWith("review")?<ReportApprovals/>:<ActivityLogs/>;
createRoot(document.getElementById("root")!).render(<StrictMode>{target}</StrictMode>);
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function wait(fn:()=>any){for(let i=0;i<200;i++){const v=fn();if(v)return v;await pause(40);}throw Error("Timeout "+fn);}
async function click(label:string){const el=await wait(()=>Array.from(document.querySelectorAll("button")).find(b=>b.textContent?.trim()===label&&!b.disabled));el.click();await pause(100);}
(async()=>{
 if(journey){
  const tab=async(prefix:string)=>{const button=await wait(()=>Array.from(document.querySelectorAll<HTMLButtonElement>('button[role="tab"]')).find(b=>b.textContent?.startsWith(prefix)));button.click();await pause(80);};
  await wait(()=>document.body.textContent?.includes(row.item_name));
  await tab("Posted");if(document.body.textContent?.includes(row.item_name))throw Error("Pending request appeared as a posted report");
  await tab("For approval");await wait(()=>document.body.textContent?.includes(row.item_name));
  await click("QA admin posts");await wait(()=>document.body.textContent?.includes("Lost"));await pause(250);
  if(document.body.textContent?.includes(row.item_name))throw Error("Pending report appeared in admin's posted report list");
  await click("QA admin review");await click("Review");await click("Save review");await wait(()=>row.state==="approved");
  await click("QA notifications");await wait(()=>document.body.textContent?.includes("Report approved"));await click("View my report");
  await wait(()=>document.body.textContent?.includes(row.item_name));
  if(!document.querySelector('button[role="tab"][aria-selected="true"]')?.textContent?.startsWith("Posted"))throw Error("Approval notification opened the wrong report tab");
  await click("QA admin posts");await wait(()=>document.body.textContent?.includes(row.item_name));
  if(notices.length!==1||reviews!==1)throw Error("Review or notification duplicated");
  const completion=notificationTarget({...notices[0],notification_type:"claim_collected"});if(completion?.options?.reportsTab!=="completed")throw Error("Legacy completion notification regressed");
 }else if(mode.startsWith("tag")){
  await wait(()=>document.body.textContent?.includes("Visit reference:"));
  if(records!==0||visits.size!==1||tagViews<1||gpsCalls!==0)throw Error("Tag page depends on a separate log request, duplicate visits or GPS");
  if(!document.body.textContent?.includes("Visible owner"))throw Error("Basic recovery information hidden");
  (document.querySelector("summary") as HTMLElement).click();await pause(50);
  (document.querySelector('input[type="checkbox"]') as HTMLInputElement).click();await pause(50);
  const venue=document.querySelector<HTMLSelectElement>('select[aria-label="Scan area"]')!;
  venue.value="Gymnasium";venue.dispatchEvent(new Event("change",{bubbles:true}));await pause(50);
  await click("Share location");await wait(()=>document.body.textContent?.includes("Location shared only"));
  await click("Withdraw and remove shared location");await wait(()=>document.body.textContent?.includes("Shared location removed"));
 }else if(mode.startsWith("scan")){
  await wait(()=>document.body.textContent?.includes("Visit reference:"));
  if(records!==1||gpsCalls!==0)throw Error("Automatic logging or GPS consent failure");
  (document.querySelector("summary") as HTMLElement).click();await pause(50);
  const boxes=Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
  if(boxes.some(box=>box.checked))throw Error("Preselected consent");
  boxes[0].click();await pause(50);await click("Choose my current GPS point");
  await wait(()=>document.body.textContent?.includes("GPS was declined"));
  const venue=document.querySelector<HTMLSelectElement>('select[aria-label="Scan area"]')!;
  venue.value="Gymnasium";venue.dispatchEvent(new Event("change",{bubbles:true}));await pause(50);
  await click("Share location");await wait(()=>document.body.textContent?.includes("Location shared only"));
  if(shares!==1||gpsCalls!==1)throw Error("Unexpected sharing attempts");
  await click("Withdraw and remove shared location");await wait(()=>document.body.textContent?.includes("Shared location removed"));
 }else if(mode.startsWith("review")){
  await click("Review");await wait(()=>document.querySelector('[role="dialog"]'));
  if(!document.body.textContent?.includes("in_custody"))throw Error("Custody context missing");
  await click("Save review");await wait(()=>document.body.textContent?.includes("No reports match"));
  if(reviews!==1)throw Error("Repeated review");
 }else{
  await click("Smart Tag scans");await wait(()=>document.body.textContent?.includes("14.50000"));
  if(!document.body.textContent?.includes("Owner: No opt-in"))throw Error("Recipient consent missing");
  const mapLink=document.querySelector<HTMLAnchorElement>('a[href^="https://www.google.com/maps/"]');
  if(!mapLink||new URL(mapLink.href).searchParams.get("query")!=="14.5,121"||mapLink.target!=="_blank"||!mapLink.rel.includes("noreferrer"))throw Error("Missing or unsafe admin map link");
  await click("Resolve / remove location");await wait(()=>!document.body.textContent?.includes("14.50000"));
  if(document.body.textContent?.includes("14.50000"))throw Error("Resolved location still visible");
  if(document.querySelector('a[href^="https://www.google.com/maps/"]'))throw Error("Resolved map link remains accessible");
  newArrival=true;
  document.dispatchEvent(new Event("visibilitychange"));
  await wait(()=>document.body.textContent?.includes("ZXCVBNMASD23"));
 }
 if(document.documentElement.scrollWidth>innerWidth+2)throw Error("Page overflow");
 for(const region of document.querySelectorAll<HTMLElement>('[role="region"]'))if(getComputedStyle(region).overflowX!=="auto")throw Error("Missing table scrolling");
 document.body.dataset.qa="pass";
})().catch(error=>{document.body.dataset.qa="fail";document.getElementById("qa")!.textContent=error.message;});
