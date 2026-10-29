import { useCallback, useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { BadgeCheck, Camera, Gavel, ImagePlus, Pencil, Plus, ReceiptText, Store, Undo2, Wallet, X } from "lucide-react";
import Modal from "@/app/shared/modal/Modal";
import { showInfoModal } from "@/app/shared/info-modal/infoModalStore";
import { formatWhen, peso } from "@/app/utils/auctions";
import { CX } from "@/app/utils/clay";
import { textProblem } from "@/app/utils/textGuard";
import { SELL_CATEGORIES, sellerFee, sellingApi, type SellerListing, type SellingOverview, type SellingPhase, type SellingTerms } from "@/app/utils/selling";

const PHASE_CHIP: Record<SellingPhase, { text: string; className: string }> = {
  pending: { text: "Waiting for the office", className: "bg-iris-50 text-iris-700 ring-iris-200" },
  changes_requested: { text: "Changes requested", className: "bg-amber-50 text-amber-800 ring-amber-200" },
  rejected: { text: "Not accepted", className: "bg-rose-50 text-rose-700 ring-rose-200" },
  withdrawn: { text: "Withdrawn", className: "bg-slate-100 text-slate-600 ring-slate-200" },
  returned: { text: "Returned to you", className: "bg-slate-100 text-slate-600 ring-slate-200" },
  listed: { text: "Listed", className: "bg-tide-50 text-tide-700 ring-tide-200" },
  scheduled: { text: "Opens soon", className: "bg-tide-50 text-tide-700 ring-tide-200" },
  live: { text: "Live", className: "bg-tide-600 text-white ring-tide-600" },
  ending: { text: "Confirming result", className: "bg-iris-50 text-iris-700 ring-iris-200" },
  unsold: { text: "Did not sell", className: "bg-slate-100 text-slate-700 ring-slate-200" },
  sold: { text: "Sold, awaiting payment", className: "bg-gold-50 text-gold-800 ring-gold-200" },
  paid: { text: "Buyer paid", className: "bg-gold-50 text-gold-800 ring-gold-200" },
  holding: { text: "Payout on the way", className: "bg-gold-500 text-navy-950 ring-gold-500" },
  paid_out: { text: "Paid to you", className: "bg-emerald-600 text-white ring-emerald-600" },
  cancelled: { text: "Sale reversed", className: "bg-rose-50 text-rose-700 ring-rose-200" },
};

/** The four steps every listing walks through. A real sequence, so it is shown as one. */
const STEPS = ["Sent", "On the Auction Hall", "Buyer paid", "Paid to you"];
const STEP_OF: Partial<Record<SellingPhase, number>> = { pending: 0, changes_requested: 0, listed: 1, scheduled: 1, live: 1, ending: 1, sold: 1, paid: 2, holding: 2, paid_out: 4 };

function Track({ phase }: { phase: SellingPhase }) {
  const at = STEP_OF[phase];
  if (at === undefined) return null;
  return (
    <ol className="mt-4 grid grid-cols-4 gap-1.5" aria-label="Progress">
      {STEPS.map((label, index) => {
        const done = index < at;
        const current = index === at;
        return (
          <li key={label} className="min-w-0">
            <span className={`block h-1.5 rounded-full ${done ? "bg-[linear-gradient(90deg,#d1a153,#e6be76)]" : current ? "bg-[linear-gradient(90deg,#2b4282,#6a84b8)]" : "bg-frost-100"}`} aria-hidden="true" />
            <span className={`mt-1.5 block truncate text-[12px] ${current ? "font-semibold text-navy-800" : done ? "text-gold-800" : "text-ink-muted"}`} aria-current={current ? "step" : undefined}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function ListingCard({ listing, onEdit, onWithdraw, onOpenAuction }: { listing: SellerListing; onEdit: () => void; onWithdraw: () => void; onOpenAuction?: (id: string) => void }) {
  const chip = PHASE_CHIP[listing.phase] ?? PHASE_CHIP.listed;
  const payout = listing.payout;
  const auction = listing.auction;
  const price = auction?.winning_amount ?? (auction && auction.bid_count > 0 ? auction.current_price : listing.starting_price);
  return (
    <article className={`${CX.card} overflow-hidden`}>
      <div className="flex gap-4 p-4 sm:p-5">
        {listing.photos[0] ? <img src={listing.photos[0]} alt="" loading="lazy" decoding="async" className="size-20 shrink-0 rounded-2xl object-cover ring-1 ring-line sm:size-24" />
          : <span className="flex size-20 shrink-0 items-center justify-center rounded-2xl bg-navy-800 text-gold-300 sm:size-24"><Gavel size={22} aria-hidden="true" /></span>}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="min-w-0 font-[family-name:var(--font-heading)] text-[17px] font-semibold leading-snug text-navy-800">{listing.title}</h3>
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold ring-1 ${chip.className}`}>{chip.text}</span>
          </div>
          <p className="mt-1 text-[13px] text-ink-muted">{[listing.category, `Sent ${formatWhen(listing.created_at)}`].filter(Boolean).join(" · ")}</p>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-[13px]">
            <div><dt className="text-ink-muted">{auction?.winning_amount ? "Sold for" : auction && auction.bid_count > 0 ? "Current bid" : "Starting bid"}</dt><dd className="font-semibold tabular-nums text-navy-800">{peso(price)}</dd></div>
            <div><dt className="text-ink-muted">Office fee</dt><dd className="font-semibold tabular-nums text-navy-800">{peso(payout?.commission ?? listing.fee.commission)}</dd></div>
            <div><dt className="text-ink-muted">{payout?.status === "paid" ? "You received" : "You get"}</dt><dd className="font-semibold tabular-nums text-emerald-700">{peso(payout?.payout_amount ?? listing.fee.you_get)}</dd></div>
          </dl>
        </div>
      </div>
      <div className="border-t border-line bg-frost-50/60 px-4 py-3 sm:px-5">
        <Track phase={listing.phase} />
        {listing.next_step && <p className="mt-3 text-[13.5px] leading-6 text-ink-soft">{listing.next_step}{payout?.ready_at && payout.status === "holding" && payout.collected ? ` Expected from ${formatWhen(payout.ready_at)}.` : ""}</p>}
        {listing.review_note && ["changes_requested", "rejected", "returned"].includes(listing.status) && (
          <p className={`mt-3 rounded-xl px-3 py-2 text-[13.5px] leading-6 ${listing.status === "changes_requested" ? "bg-amber-50 text-amber-900" : "bg-slate-100 text-slate-700"}`}><span className="font-semibold">Note from the office: </span>{listing.review_note}</p>
        )}
        {payout?.receipt_no && <p className="mt-3 flex items-center gap-2 text-[13px] font-semibold text-emerald-800"><ReceiptText size={15} aria-hidden="true" /> Payout receipt {payout.receipt_no}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-ink-muted">
          <span className="inline-flex items-center gap-1.5"><Wallet size={14} aria-hidden="true" /> {listing.payout_method_label}{listing.payout_account_number ? ` ${listing.payout_account_number}` : ""}</span>
          <span className="ml-auto flex flex-wrap gap-2">
            {auction && onOpenAuction && ["scheduled", "live", "ending"].includes(listing.phase) && <button type="button" onClick={() => onOpenAuction(auction.id)} className={`${CX.btnGhost} min-h-[38px] px-3 text-[13px]`}><Gavel size={14} aria-hidden="true" /> View auction</button>}
            {listing.can_edit && <button type="button" onClick={onEdit} className={`${CX.btnGhost} min-h-[38px] px-3 text-[13px]`}><Pencil size={14} aria-hidden="true" /> Edit</button>}
            {listing.can_withdraw && <button type="button" onClick={onWithdraw} className={`${CX.btnGhost} min-h-[38px] px-3 text-[13px]`}><Undo2 size={14} aria-hidden="true" /> Withdraw</button>}
          </span>
        </div>
      </div>
    </article>
  );
}

type FormState = {
  title: string; category: string; condition: string; description: string; starting_price: string; buyout_price: string; duration_days: string;
  payout_method: string; payout_account_name: string; payout_account_number: string; accept: boolean;
};

function initialForm(listing?: SellerListing | null): FormState {
  return {
    title: listing?.title ?? "", category: listing?.category ?? SELL_CATEGORIES[0], condition: listing?.condition ?? "used", description: listing?.description ?? "",
    starting_price: listing ? String(listing.starting_price) : "", buyout_price: listing?.buyout_price ? String(listing.buyout_price) : "", duration_days: String(listing?.duration_days ?? 3),
    payout_method: listing?.payout_method ?? "gcash", payout_account_name: listing?.payout_account_name ?? "", payout_account_number: "", accept: false,
  };
}

function SellForm({ open, terms, editing, onClose, onSaved }: { open: boolean; terms: SellingTerms; editing: SellerListing | null; onClose: () => void; onSaved: () => void }) {
  const ids = useId();
  const [form, setForm] = useState<FormState>(() => initialForm(editing));
  const [keep, setKeep] = useState<string[]>(editing?.photos ?? []);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const previews = useMemo(() => files.map((file) => URL.createObjectURL(file)), [files]);
  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews]);
  useEffect(() => { if (open) { setForm(initialForm(editing)); setKeep(editing?.photos ?? []); setFiles([]); setError(""); } }, [open, editing]);

  const set = (key: keyof FormState) => (value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));
  const price = Number(form.starting_price.replace(/,/g, "")) || 0;
  const preview = sellerFee(price, terms);
  const photoCount = keep.length + files.length;
  const needsAccount = form.payout_method !== "cash";

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const picked = Array.from(list).filter((file) => /^image\/(jpeg|png)$/.test(file.type));
    if (picked.length < list.length) setError("Only JPG and PNG photos can be used.");
    setFiles((current) => [...current, ...picked].slice(0, Math.max(0, terms.max_photos - keep.length)));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const problem = textProblem(form.title, "title", "item title") || textProblem(form.description, "description", "description")
      || (price < terms.min_price || price > terms.max_price ? `The starting bid must be between ${peso(terms.min_price)} and ${peso(terms.max_price)}.` : "")
      || (form.buyout_price && Number(form.buyout_price) <= price ? "The buy-now price must be higher than the starting bid (or leave it empty)." : "")
      || (photoCount < 1 ? "Add at least one clear photo of the item." : "")
      || (needsAccount && (!form.payout_account_name.trim() || (!form.payout_account_number.trim() && editing?.payout_method !== form.payout_method)) ? "Enter where the office should send your money." : "")
      || (!form.accept ? "Read and accept the selling rules and the fee first." : "");
    if (problem) { setError(problem); return; }
    const data = new FormData();
    (["title", "category", "condition", "description", "starting_price", "buyout_price", "duration_days", "payout_method", "payout_account_name"] as const).forEach((key) => data.append(key, String(form[key])));
    data.append("payout_account_number", form.payout_account_number);
    data.append("accept_terms", "true");
    files.forEach((file) => data.append("photos", file));
    if (editing) data.append("keep_photos", JSON.stringify(keep));
    setBusy(true);
    setError("");
    try {
      const result = editing ? await sellingApi.update(editing.id, data) : await sellingApi.submit(data);
      showInfoModal({ variant: "success", title: editing ? "Listing sent again" : "Listing sent", message: result.message });
      onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Your listing could not be sent.");
    } finally {
      setBusy(false);
    }
  };

  const capText = terms.cap > 0 ? `, at most ${peso(terms.cap)}` : "";
  return (
    <Modal open={open} onClose={onClose} dismissible={!busy} size="lg" tone="gold" icon={<Store size={20} aria-hidden="true" />}
      title={editing ? "Edit your listing" : "Sell an item"} description="The Lost and Found Office checks your item, holds it and runs the auction. You are paid after the buyer collects it."
      footer={<div className="flex flex-wrap justify-end gap-2"><button type="button" onClick={onClose} disabled={busy} className={CX.btnGhost}>Cancel</button><button type="submit" form={`${ids}-form`} disabled={busy} className={CX.btnGold}>{busy ? "Sending…" : editing ? "Send again" : "Send listing"}</button></div>}>
      <form id={`${ids}-form`} onSubmit={(event) => void submit(event)} className="space-y-5" noValidate>
        <fieldset>
          <legend className={CX.label}>Photos <span className="font-normal text-ink-muted">({photoCount}/{terms.max_photos})</span></legend>
          <div className="grid grid-cols-4 gap-2">
            {keep.map((url) => (
              <div key={url} className="relative aspect-square overflow-hidden rounded-xl ring-1 ring-line">
                <img src={url} alt="" className="size-full object-cover" />
                <button type="button" onClick={() => setKeep((current) => current.filter((u) => u !== url))} aria-label="Remove photo" className="absolute right-1 top-1 flex size-7 items-center justify-center rounded-full bg-navy-950/75 text-white"><X size={14} aria-hidden="true" /></button>
              </div>
            ))}
            {previews.map((url, index) => (
              <div key={url} className="relative aspect-square overflow-hidden rounded-xl ring-1 ring-gold-300">
                <img src={url} alt="" className="size-full object-cover" />
                <button type="button" onClick={() => setFiles((current) => current.filter((_, i) => i !== index))} aria-label="Remove photo" className="absolute right-1 top-1 flex size-7 items-center justify-center rounded-full bg-navy-950/75 text-white"><X size={14} aria-hidden="true" /></button>
              </div>
            ))}
            {photoCount < terms.max_photos && (
              <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-line-strong bg-frost-50 text-[12.5px] font-semibold text-ink-muted transition-colors hover:border-gold-400 hover:text-navy-800">
                <ImagePlus size={20} aria-hidden="true" /> Add photo
                <input type="file" accept="image/jpeg,image/png" multiple className="sr-only" onChange={(event) => { addFiles(event.target.files); event.target.value = ""; }} />
              </label>
            )}
          </div>
          <p className={CX.helper}><Camera size={13} className="mr-1 inline" aria-hidden="true" />Clear photos of the real item, JPG or PNG, up to 5 MB each. The office compares them with the item you bring.</p>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
          <label className="block"><span className={CX.label}>Item title</span><input value={form.title} onChange={(e) => set("title")(e.target.value)} maxLength={120} className={`${CX.input} w-full`} placeholder="Casio fx-991ES Plus calculator" /></label>
          <label className="block"><span className={CX.label}>Category</span>
            <select value={form.category} onChange={(e) => set("category")(e.target.value)} className={`${CX.input} w-full`}>{SELL_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
          </label>
        </div>
        <fieldset>
          <legend className={CX.label}>Condition</legend>
          <div className="flex flex-wrap gap-2">
            {Object.entries(terms.conditions).map(([value, label]) => (
              <label key={value} className={`cursor-pointer rounded-xl px-3.5 py-2 text-[13.5px] font-semibold ring-1 transition-colors ${form.condition === value ? "bg-navy-800 text-white ring-navy-800" : "bg-white text-ink-soft ring-line-strong hover:ring-iris-300"}`}>
                <input type="radio" name={`${ids}-condition`} value={value} checked={form.condition === value} onChange={() => set("condition")(value)} className="sr-only" />{label}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block"><span className={CX.label}>Description</span>
          <textarea value={form.description} onChange={(e) => set("description")(e.target.value)} rows={4} maxLength={1000} className={`${CX.input} w-full py-2.5`} placeholder="What it is, how old it is, what is included, any marks or defects." />
        </label>

        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block"><span className={CX.label}>Starting bid (₱)</span><input inputMode="decimal" value={form.starting_price} onChange={(e) => set("starting_price")(e.target.value.replace(/[^\d.,]/g, ""))} className={`${CX.input} w-full tabular-nums`} placeholder={String(terms.min_price)} /></label>
          <label className="block"><span className={CX.label}>Buy-now price <span className="font-normal text-ink-muted">(optional)</span></span><input inputMode="decimal" value={form.buyout_price} onChange={(e) => set("buyout_price")(e.target.value.replace(/[^\d.,]/g, ""))} className={`${CX.input} w-full tabular-nums`} /></label>
          <label className="block"><span className={CX.label}>Auction length</span>
            <select value={form.duration_days} onChange={(e) => set("duration_days")(e.target.value)} className={`${CX.input} w-full`}>{terms.durations.map((d) => <option key={d} value={d}>{d} {d === 1 ? "day" : "days"}</option>)}</select>
          </label>
        </div>

        <fieldset className="rounded-2xl border border-line bg-frost-50/70 p-4">
          <legend className="px-1 text-[14px] font-semibold text-ink-soft">How you want to be paid</legend>
          <div className="flex flex-wrap gap-2">
            {Object.entries(terms.payout_methods).map(([value, label]) => (
              <label key={value} className={`cursor-pointer rounded-xl px-3.5 py-2 text-[13.5px] font-semibold ring-1 transition-colors ${form.payout_method === value ? "bg-navy-800 text-white ring-navy-800" : "bg-white text-ink-soft ring-line-strong hover:ring-iris-300"}`}>
                <input type="radio" name={`${ids}-payout`} value={value} checked={form.payout_method === value} onChange={() => set("payout_method")(value)} className="sr-only" />{label}
              </label>
            ))}
          </div>
          {needsAccount && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block"><span className={CX.label}>{form.payout_method === "bank" ? "Bank and account name" : "Account name"}</span><input value={form.payout_account_name} onChange={(e) => set("payout_account_name")(e.target.value)} maxLength={100} className={`${CX.input} w-full`} placeholder={form.payout_method === "bank" ? "BPI, Juan Dela Cruz" : "Juan Dela Cruz"} /></label>
              <label className="block"><span className={CX.label}>{form.payout_method === "bank" ? "Account number" : "Mobile number"}</span><input inputMode="numeric" value={form.payout_account_number} onChange={(e) => set("payout_account_number")(e.target.value)} maxLength={24} className={`${CX.input} w-full tabular-nums`} placeholder={editing && editing.payout_method === form.payout_method ? `${editing.payout_account_number} (leave empty to keep)` : form.payout_method === "bank" ? "001234567890" : "09171234567"} /></label>
            </div>
          )}
          <p className={CX.helper}>Only the office sees these details. Buyers never learn who you are.</p>
        </fieldset>

        <section className="rounded-2xl bg-[linear-gradient(135deg,#0e1830,#1f3160)] p-4 text-white" aria-live="polite">
          <p className="text-[13px] text-white/70">If it sells at your starting bid of {peso(price)}</p>
          <div className="mt-2 flex flex-wrap items-end gap-x-6 gap-y-2">
            <p><span className="block text-[12.5px] text-white/60">Office fee</span><span className="text-[20px] font-semibold tabular-nums text-gold-300">{peso(preview.commission)}</span></p>
            <p><span className="block text-[12.5px] text-white/60">You get</span><span className="text-[26px] font-semibold tabular-nums">{peso(preview.youGet)}</span></p>
          </div>
          <p className="mt-2 text-[12.5px] leading-5 text-white/60">The fee is {terms.rate}% of the final price, at least {peso(terms.minimum)}{capText}. You pay nothing if it does not sell.</p>
        </section>

        <label className="flex cursor-pointer gap-3 rounded-2xl border border-line p-4 text-[13.5px] leading-6 text-ink-soft">
          <input type="checkbox" checked={form.accept} onChange={(e) => set("accept")(e.target.checked)} className="mt-1 size-4 shrink-0 accent-[#1f3160]" />
          <span>I own this item and may sell it. It is not found property, a weapon, a vape, alcohol, a drug, exam material, a counterfeit or an animal. I will bring it to the Lost and Found Office for checking, the office keeps it until the buyer collects it, and I accept the {terms.rate}% fee. I am paid {terms.hold_days} {terms.hold_days === 1 ? "day" : "days"} after the buyer collects it.</span>
        </label>
        {error && <p role="alert" className={CX.alertError}>{error}</p>}
      </form>
    </Modal>
  );
}

export default function SellingPanel({ onOpenAuction, onVerify }: { onOpenAuction?: (auctionId: string) => void; onVerify?: () => void }) {
  const [data, setData] = useState<SellingOverview | null>(null);
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SellerListing | null>(null);

  const load = useCallback(async () => {
    try { setData(await sellingApi.mine()); setError(""); } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to load your listings."); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const withdraw = async (listing: SellerListing) => {
    if (!window.confirm(`Withdraw "${listing.title}"? The office will not list it.`)) return;
    try {
      const result = await sellingApi.withdraw(listing.id);
      showInfoModal({ variant: "success", title: "Listing withdrawn", message: result.message });
      void load();
    } catch (failure) {
      showInfoModal({ variant: "error", title: "Could not withdraw", message: failure instanceof Error ? failure.message : "Try again." });
    }
  };

  if (error && !data) return <p role="alert" className={CX.alertError}>{error}</p>;
  if (!data) return <div className={`${CX.card} h-48 animate-pulse`} aria-busy="true" />;
  const { terms, eligibility, totals, listings } = data;
  const verifyFirst = !eligibility.can_sell && /verify/i.test(eligibility.reason);
  return (
    <div className="space-y-4">
      <section className="relative overflow-hidden rounded-[22px] bg-[linear-gradient(135deg,#0e1830_0%,#1f3160_100%)] p-5 text-white ring-1 ring-white/10 sm:p-6">
        <span className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-[radial-gradient(circle,rgba(209,161,83,0.35),transparent_65%)] blur-xl" aria-hidden="true" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-[family-name:var(--font-heading)] text-[22px] font-semibold">Sell your own item</h2>
            <p className="mt-1 max-w-[52ch] text-[14px] leading-6 text-white/70">List it here, bring it to the Lost and Found Office, and we run the auction. You keep {100 - terms.rate}% of the final price{terms.cap > 0 ? ` (our fee is never more than ${peso(terms.cap)})` : ""}.</p>
          </div>
          {eligibility.can_sell ? (
            <button type="button" onClick={() => { setEditing(null); setFormOpen(true); }} className={`${CX.btnGold} shrink-0`}><Plus size={17} aria-hidden="true" /> List an item</button>
          ) : verifyFirst && onVerify ? (
            <button type="button" onClick={onVerify} className={`${CX.btnGold} shrink-0`}><BadgeCheck size={17} aria-hidden="true" /> Verify my ID</button>
          ) : null}
        </div>
        {!eligibility.can_sell && <p className="relative mt-3 rounded-xl bg-white/[0.08] px-3 py-2 text-[13.5px] text-white/85">{eligibility.reason}</p>}
        <dl className="relative mt-5 grid grid-cols-3 gap-3 border-t border-white/10 pt-4">
          <div><dt className="text-[12.5px] text-white/55">In progress</dt><dd className="text-[22px] font-semibold tabular-nums">{totals.active}</dd></div>
          <div><dt className="text-[12.5px] text-white/55">On the way to you</dt><dd className="text-[22px] font-semibold tabular-nums text-gold-300">{peso(totals.owed)}</dd></div>
          <div><dt className="text-[12.5px] text-white/55">Paid to you</dt><dd className="text-[22px] font-semibold tabular-nums">{peso(totals.paid_out)}</dd></div>
        </dl>
      </section>

      {listings.length === 0 ? (
        <div className={`${CX.card} p-8 text-center`}>
          <p className="font-semibold text-navy-800">You have not listed anything yet.</p>
          <p className="mx-auto mt-1 max-w-[46ch] text-[14px] leading-6 text-ink-muted">Old calculators, books, gadgets or uniforms you no longer need can find a new owner on campus.</p>
        </div>
      ) : (
        <div className="space-y-3">{listings.map((listing) => <ListingCard key={listing.id} listing={listing} onOpenAuction={onOpenAuction} onEdit={() => { setEditing(listing); setFormOpen(true); }} onWithdraw={() => void withdraw(listing)} />)}</div>
      )}

      <SellForm open={formOpen} terms={terms} editing={editing} onClose={() => setFormOpen(false)} onSaved={() => { setFormOpen(false); void load(); }} />
    </div>
  );
}
