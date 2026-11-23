import { useEffect, useState } from "react";
import { tagsApi, type RecoveryReport } from "@/app/utils/tags";
import { CX } from "@/app/utils/clay";

export default function RecoveryHistory({ tag, openClaim }: { tag: string; openClaim?: (reference: string, returned: boolean) => void }) {
  const [reports, setReports] = useState<RecoveryReport[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10000);
    return () => window.clearInterval(timer);
  }, []);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setError(""); setLoaded(false);
    tagsApi.history(tag, offset).then(r => { if (active) { setReports(r.reports); setLoaded(true); } })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [tag, refresh, offset]);
  async function flag(id: string) {
    try { await tagsApi.flag(tag, id); setRefresh(n => n + 1); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to flag this report."); }
  }
  return <section className="space-y-3 rounded-2xl border border-line p-4 text-ink">
    <div className="flex items-center justify-between"><h3 className={CX.label}>Private recovery activity</h3>
    <button className={CX.btnGhost} type="button" onClick={() => setRefresh(n => n + 1)}>Refresh</button></div>
    {error && <p role="alert">{error}</p>}
    {!error && !loaded && <p>Loading reports…</p>}
    {loaded && !reports.length && <p>No finder reports yet.</p>}
    {loaded && !error && reports.map(r => <article key={r.report_id} className="space-y-1 border-t border-line pt-3 text-sm">
      <strong>Finder reported · {new Date(r.created_at).toLocaleString()}</strong>
      <p>{r.venue || "No campus location provided"}</p>
      {r.note && <p className="whitespace-pre-wrap break-words">{r.note}</p>}
      {r.contact && <p className="break-words">Finder contact · {r.contact}</p>}
      {r.point && Date.parse(r.point.expires_at) > now && <div>Finder's device · {r.point.latitude.toFixed(5)}, {r.point.longitude.toFixed(5)} · ±{Math.round(r.point.accuracy)} m · {new Date(r.point.captured_at).toLocaleString()}
        <p><a className="underline" href={`https://www.google.com/maps/search/?api=1&query=${r.point.latitude},${r.point.longitude}`} target="_blank" rel="noopener noreferrer">Open in Google Maps</a> (shares this point with Google)</p></div>}
      <p>{r.received_at ? "Office received · " + new Date(r.received_at).toLocaleString() : "Finder report awaiting office confirmation"}</p>
      {r.returned_at && <p>Verified return · {new Date(r.returned_at).toLocaleString()}</p>}
      {r.reference && <p>Office reference · {r.reference} {openClaim && <button className="underline" type="button" onClick={() => openClaim(r.reference!, !!r.returned_at)}>{r.returned_at ? "View my receipts" : "Open claim form"}</button>}</p>}
      {r.review === "clear" ? <button type="button" className="underline" onClick={() => void flag(r.report_id)}>Flag suspicious report</button> : <p>{r.review === "flagged" ? "Flagged for staff review" : "Reviewed by staff"}</p>}
    </article>)}
    {(offset > 0 || reports.length === 50) && <div>
      <button type="button" className={CX.btnGhost} disabled={!offset} onClick={() => setOffset(n => n-50)}>Previous</button>
      <button type="button" className={CX.btnGhost} disabled={reports.length < 50} onClick={() => setOffset(n => n+50)}>Next</button>
    </div>}
  </section>;
}
