import { useState } from "react";
import { flaggedReports, resolveReport, type FlaggedReport } from "../../utils/smartTagsApi";

export default function RecoveryReview() {
  const [rows, setRows] = useState<FlaggedReport[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  async function load() {
    setError("");
    try { setRows(await flaggedReports()); setLoaded(true); }
    catch (e) { setError(e instanceof Error ? e.message : "Review queue unavailable."); }
  }
  async function review(id: string) {
    try { await resolveReport(id); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Review failed."); }
  }
  return <section className="glass-panel space-y-3 p-4 text-ink"><button type="button" className="font-semibold underline" onClick={() => void load()}>Review flagged finder reports</button>
    {loaded && !rows.length && <p>No reports awaiting review.</p>}
    {error && <p role="alert">{error}</p>}
    {rows.map(r => <article key={r.report_id} className="border-t border-line py-2"><strong>{r.tag_id}</strong> · {new Date(r.created_at).toLocaleString()}
      <p className="break-words">{r.note || "No finder message"}</p>
      <button type="button" className="underline" onClick={() => void review(r.report_id)}>Mark reviewed</button>
    </article>)}</section>;
}
