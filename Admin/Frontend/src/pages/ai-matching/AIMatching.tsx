import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Calendar, CheckCircle2, Eye, ImageOff, Layers, MapPin, ScanSearch, Sparkles, Tag, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { fetchAdminAIMatches, confirmAdminAIMatch, rejectAdminAIMatch, type AdminAIMatchRow } from "../../utils/api";
import { AdminCardGridSkeleton } from "../../components/LoadingSkeleton";
import AdminModal from "../../components/ui/AdminModal";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import EmptyState from "../../components/ui/EmptyState";
import { showInfoModal } from "../../components/info-modal/infoModalStore";
import { BTN, PageHeader } from "../../components/ui/primitives";
import { SegmentedFilter, StatusPill, type Tone } from "../../components/ui/management";
import { tr, useT } from "../../utils/preferences";

type Filter = "all" | "High Confidence" | "Needs Review" | "Confirmed" | "Rejected";
const STATUS_TONE: Record<AdminAIMatchRow["status"], Tone> = { "High Confidence": "mint", "Needs Review": "gold", Confirmed: "iris", Rejected: "rose" };
const STATUS_LABEL: Record<AdminAIMatchRow["status"], string> = { "High Confidence": "High confidence", "Needs Review": "Needs review", Confirmed: "Confirmed", Rejected: "Rejected" };

const ringColor = (value: number) => (value >= 80 ? "#2fae8e" : value >= 65 ? "#d1a153" : "#94a3b8");

/** The overall match as a ring: the number is the whole story at a glance, the dialog has the detail. */
function ScoreRing({ value, size = 64 }: { value: number; size?: number }) {
  const radius = size / 2 - 5;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={tr("{0} percent match", { "0": value })}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth="5" className="text-frost-100 dark:text-white/10" />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={ringColor(value)} strokeWidth="5" strokeLinecap="round" strokeDasharray={`${(value / 100) * circumference} ${circumference}`} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-[family-name:var(--font-heading)] font-semibold tabular-nums text-ink" style={{ fontSize: size * 0.3 }}>{value}%</span>
    </div>
  );
}

function Photo({ src, label, onOpen, className = "h-24 w-24" }: { src?: string; label: string; onOpen?: () => void; className?: string }) {
  if (!src) return <span className={`flex ${className} shrink-0 items-center justify-center rounded-2xl border border-dashed border-line-strong bg-frost-50 text-ink-muted dark:bg-white/[0.04]`} aria-label={tr("No photo")}><ImageOff size={20} aria-hidden="true" /></span>;
  return (
    <button type="button" onClick={onOpen} className={`${className} group relative shrink-0 overflow-hidden rounded-2xl border border-line bg-frost-50 dark:bg-white/[0.04]`} aria-label={tr("Open the photo of {0}", { "0": label })}>
      <img decoding="async" src={src} alt={label} className="size-full object-cover transition group-hover:scale-105" />
    </button>
  );
}

function Bar({ label, percent, note }: { label: string; percent: number | null; note?: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-[13.5px]">
        <span className="text-ink-soft">{tr(label)}</span>
        <span className={`font-semibold tabular-nums ${percent === null ? "text-ink-muted" : "text-ink"}`}>{percent === null ? tr("Nothing to compare") : `${percent}%`}</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-frost-100 dark:bg-white/10"><div className="h-full rounded-full transition-[width]" style={{ width: `${percent ?? 0}%`, background: percent === null ? "transparent" : ringColor(percent) }} /></div>
      {note && <p className="mt-0.5 text-[12px] text-ink-muted">{note}</p>}
    </div>
  );
}

function Detail({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return <p className="flex items-start gap-2 text-[13.5px] leading-5 text-ink-soft"><span className="mt-0.5 shrink-0 text-ink-muted" aria-hidden="true">{icon}</span><span className="min-w-0 break-words">{children}</span></p>;
}

function Side({ title, tone, id, name, category, place, date, description, marks, image, onZoom }: { title: string; tone: "rose" | "tide"; id: string; name: string; category: string; place: string; date: string; description: string; marks?: string; image?: string; onZoom: () => void }) {
  return (
    <section className="min-w-0 space-y-3 rounded-2xl border border-line p-4" aria-label={title}>
      <div className="flex items-center justify-between gap-2">
        <h3 className={`text-[13px] font-semibold ${tone === "rose" ? "text-rose-700 dark:text-rose-300" : "text-tide-700 dark:text-tide-300"}`}>{title}</h3>
        <span className="font-mono text-[12.5px] text-ink-muted">{id}</span>
      </div>
      <Photo src={image} label={name} onOpen={onZoom} className="h-44 w-full" />
      <p className="font-[family-name:var(--font-heading)] text-[18px] font-semibold leading-tight text-ink">{name}</p>
      <div className="space-y-1.5">
        {category && <Detail icon={<Tag size={14} />}>{category}</Detail>}
        <Detail icon={<MapPin size={14} />}>{place}</Detail>
        <Detail icon={<Calendar size={14} />}>{date || tr("No date")}</Detail>
        {description && <Detail icon={<Layers size={14} />}>{description}</Detail>}
        {marks && <Detail icon={<Sparkles size={14} />}>{tr("Distinctive marks: {0}", { "0": marks })}</Detail>}
      </div>
    </section>
  );
}

function MatchModal({ match, onClose, onDecide }: { match: AdminAIMatchRow; onClose: () => void; onDecide: (action: "confirm" | "reject") => void }) {
  const [zoom, setZoom] = useState<{ src: string; label: string } | null>(null);
  const open = match.status === "High Confidence" || match.status === "Needs Review";
  return (
    <AdminModal
      title={tr("Compare these two reports")}
      description={tr("Check the details yourself before you decide. Confirming tells both people; it is not undone.")}
      icon={<ScanSearch size={19} />} tone="navy" size="xl" onClose={onClose}
      footer={open ? (
        <>
          <button type="button" onClick={onClose} className={BTN.ghost}>{tr("Close")}</button>
          <button type="button" onClick={() => onDecide("reject")} className={BTN.ghost}><ThumbsDown size={16} aria-hidden="true" />{tr("Not a match")}</button>
          <button type="button" onClick={() => onDecide("confirm")} className={BTN.success}><ThumbsUp size={16} aria-hidden="true" />{tr("Confirm match")}</button>
        </>
      ) : <button type="button" onClick={onClose} className={BTN.ghost}>{tr("Close")}</button>}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-[linear-gradient(135deg,#22366a_0%,#162448_100%)] p-4 text-white">
          <div className="rounded-full bg-white p-0.5"><ScoreRing value={match.matchPercent} size={76} /></div>
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-semibold text-gold-300">{tr("Overall match")}</p>
            <p className="font-[family-name:var(--font-heading)] text-[22px] font-semibold leading-tight">{match.matchPercent >= 80 ? tr("Very likely the same item") : match.matchPercent >= 65 ? tr("Possibly the same item") : tr("Weak match: check carefully")}</p>
            <p className="mt-0.5 text-[13px] text-navy-100">{match.usedImage ? tr("Photos were compared too.") : tr("No photo comparison: one or both reports have no usable photo.")}</p>
          </div>
          <StatusPill tone={STATUS_TONE[match.status]}>{tr(STATUS_LABEL[match.status])}</StatusPill>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Side title={tr("Lost report")} tone="rose" id={match.lostId} name={match.lostItem} category={match.lostCategory} place={match.lostLocation} date={tr("Last seen {0}", { "0": match.lostDate || "?" })} description={match.lostDesc} marks={match.lostMarks} image={match.lostImage} onZoom={() => match.lostImage && setZoom({ src: match.lostImage, label: match.lostItem })} />
          <Side title={tr("Found item")} tone="tide" id={match.foundId} name={match.foundItem} category={match.foundCategory} place={match.foundLocation} date={tr("Found {0}", { "0": match.foundDate || "?" })} description={match.foundDesc} image={match.foundImage} onZoom={() => match.foundImage && setZoom({ src: match.foundImage, label: match.foundItem })} />
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <section className="space-y-3" aria-label={tr("How they compare")}>
            <h3 className="text-[15px] font-semibold text-ink">{tr("How they compare")}</h3>
            {match.breakdown.map((part) => <Bar key={part.key} label={part.label} percent={part.percent} />)}
          </section>
          <section className="space-y-3" aria-label={tr("Why")}>
            {match.reasons.length > 0 && (
              <div>
                <h3 className="mb-1.5 text-[15px] font-semibold text-ink">{tr("What lines up")}</h3>
                <ul className="space-y-1.5">{match.reasons.map((reason) => <li key={reason} className="flex items-start gap-2 text-[13.5px] text-ink-soft"><CheckCircle2 size={15} className="mt-0.5 shrink-0 text-tide-600" aria-hidden="true" />{reason}</li>)}</ul>
              </div>
            )}
            {match.conflicts.length > 0 && (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3.5 dark:border-rose-500/30 dark:bg-rose-500/10">
                <h3 className="mb-1.5 flex items-center gap-1.5 text-[14px] font-semibold text-rose-800 dark:text-rose-200"><AlertTriangle size={15} aria-hidden="true" />{tr("What does not line up")}</h3>
                <ul className="space-y-1">{match.conflicts.map((conflict) => <li key={conflict} className="text-[13.5px] text-rose-800 dark:text-rose-200">{conflict}</li>)}</ul>
              </div>
            )}
            {match.reasons.length === 0 && match.conflicts.length === 0 && <p className="text-[13.5px] text-ink-muted">{tr("There is little to compare yet.")}</p>}
          </section>
        </div>

        {match.alternatives.length > 0 && (
          <section aria-label={tr("Other candidates")}>
            <h3 className="mb-2 text-[15px] font-semibold text-ink">{tr("Other found items for this lost report")}</h3>
            <ul className="grid gap-2 sm:grid-cols-2">
              {match.alternatives.map((alt) => (
                <li key={alt.foundId} className="flex items-center gap-3 rounded-2xl border border-line p-2.5">
                  <Photo src={alt.foundImage} label={alt.foundItem} className="h-12 w-12" onOpen={() => alt.foundImage && setZoom({ src: alt.foundImage, label: alt.foundItem })} />
                  <div className="min-w-0 flex-1"><p className="truncate text-[13.5px] font-semibold text-ink">{alt.foundItem}</p><p className="font-mono text-[12px] text-ink-muted">{alt.foundId}</p></div>
                  <span className="font-semibold tabular-nums text-ink-soft">{alt.matchPercent}%</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      {zoom && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label={zoom.label} onClick={() => setZoom(null)}>
          <div className="relative max-h-[90vh] max-w-4xl overflow-hidden rounded-2xl bg-[var(--surface)] p-3 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <button type="button" onClick={() => setZoom(null)} className="absolute right-4 top-4 z-10 inline-flex size-9 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow-sm" aria-label={tr("Close the photo")}><X size={18} aria-hidden="true" /></button>
            <img decoding="async" src={zoom.src} alt={zoom.label} className="max-h-[80vh] max-w-[80vw] rounded-xl object-contain" />
            <p className="mt-2 text-center text-[13.5px] font-medium text-ink-soft">{zoom.label}</p>
          </div>
        </div>
      )}
    </AdminModal>
  );
}

export default function AIMatching() {
  const t = useT();
  const [matches, setMatches] = useState<AdminAIMatchRow[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState("");
  const [pending, setPending] = useState<"confirm" | "reject" | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetchAdminAIMatches().then((data) => { if (active) setMatches(data); }).catch((failure) => { if (active) setError(failure instanceof Error ? failure.message : tr("Unable to load the matches.")); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const counts = useMemo(() => ({
    all: matches.length,
    "High Confidence": matches.filter((m) => m.status === "High Confidence").length,
    "Needs Review": matches.filter((m) => m.status === "Needs Review").length,
    Confirmed: matches.filter((m) => m.status === "Confirmed").length,
    Rejected: matches.filter((m) => m.status === "Rejected").length,
  }), [matches]);
  const shown = filter === "all" ? matches : matches.filter((m) => m.status === filter);
  const current = matches.find((m) => m.id === openId) ?? null;

  const decide = async () => {
    if (!current || !pending || busy) return;
    setBusy(true);
    try {
      if (pending === "confirm") await confirmAdminAIMatch(current.lostId, current.foundId); else await rejectAdminAIMatch(current.lostId, current.foundId);
      setMatches((list) => list.map((m) => (m.id === current.id ? { ...m, status: pending === "confirm" ? "Confirmed" : "Rejected", timestamp: new Date().toISOString() } : m)));
      setPending(null); setOpenId("");
    } catch (failure) {
      showInfoModal({ variant: "error", title: tr("AI match not updated"), message: failure instanceof Error ? failure.message : tr("Unable to update the AI match."), replaceAuto: true });
      setPending(null);
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <PageHeader
        title={t("page.aiMatching")}
        description={tr("The best found item for each open lost report, compared on category, name and description, photo, place and date. Only items still unclaimed are offered.")}
      />
      <SegmentedFilter
        label="Match status"
        value={filter}
        onChange={setFilter}
        options={[{ value: "all", label: "All", count: counts.all }, { value: "High Confidence", label: "High confidence", count: counts["High Confidence"] }, { value: "Needs Review", label: "Needs review", count: counts["Needs Review"] }, { value: "Confirmed", label: "Confirmed", count: counts.Confirmed }, { value: "Rejected", label: "Rejected", count: counts.Rejected }]}
      />

      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[14px] text-rose-800">{error}</p>}
      {loading ? <AdminCardGridSkeleton count={4} /> : shown.length === 0 && !error ? (
        <EmptyState icon={<ScanSearch size={20} />} title={tr("No matches in this view")}>{tr("When a lost report and a found item look alike, the pair appears here for you to check.")}</EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {shown.map((match) => (
            <article key={match.id} className="glass-panel flex flex-col gap-4 p-4 sm:p-5">
              <header className="flex items-center justify-between gap-3">
                <span className="font-mono text-[12.5px] text-ink-muted">{match.lostId} ↔ {match.foundId}</span>
                <StatusPill tone={STATUS_TONE[match.status]}>{tr(STATUS_LABEL[match.status])}</StatusPill>
              </header>
              <div className="flex items-center gap-3">
                <Photo src={match.lostImage} label={match.lostItem} onOpen={() => setOpenId(match.id)} />
                <ScoreRing value={match.matchPercent} />
                <Photo src={match.foundImage} label={match.foundItem} onOpen={() => setOpenId(match.id)} />
              </div>
              <div className="grid grid-cols-2 gap-3 text-[13.5px]">
                <div className="min-w-0"><p className="text-[12px] font-semibold text-rose-700 dark:text-rose-300">{tr("Lost")}</p><p className="truncate font-semibold text-ink">{match.lostItem}</p><p className="truncate text-ink-muted">{match.lostLocation}</p></div>
                <div className="min-w-0"><p className="text-[12px] font-semibold text-tide-700 dark:text-tide-300">{tr("Found")}</p><p className="truncate font-semibold text-ink">{match.foundItem}</p><p className="truncate text-ink-muted">{match.foundLocation}</p></div>
              </div>
              <ul className="flex flex-wrap gap-1.5" aria-label={tr("Why it matched")}>
                {match.reasons.slice(0, 3).map((reason) => <li key={reason} className="rounded-full bg-tide-50 px-2.5 py-1 text-[12px] font-medium text-tide-700 dark:bg-tide-500/10 dark:text-tide-300">{reason}</li>)}
                {match.conflicts.slice(0, 2).map((conflict) => <li key={conflict} className="rounded-full bg-rose-50 px-2.5 py-1 text-[12px] font-medium text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{conflict}</li>)}
              </ul>
              <button type="button" onClick={() => setOpenId(match.id)} className={`${BTN.primary} mt-auto`}><Eye size={16} aria-hidden="true" />{match.status === "Confirmed" || match.status === "Rejected" ? tr("View comparison") : tr("Compare and decide")}</button>
            </article>
          ))}
        </div>
      )}

      {current && !pending && <MatchModal match={current} onClose={() => setOpenId("")} onDecide={setPending} />}
      {current && pending && <ConfirmActionDialog
        title={pending === "confirm" ? tr("confirm this AI match") : tr("reject this AI match")}
        description={tr("This decision updates the shared match record and may notify users.")}
        confirmLabel={pending === "confirm" ? tr("Confirm match") : tr("Reject match")}
        danger={pending === "reject"}
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={decide}
      />}
    </div>
  );
}
