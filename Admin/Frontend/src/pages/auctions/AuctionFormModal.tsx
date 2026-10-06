import { useEffect, useMemo, useState } from "react";
import { Gavel, ImagePlus, Pencil, Search, ShieldCheck, X } from "lucide-react";
import AdminModal from "../../components/ui/AdminModal";
import { BTN, Field, TextArea, TextInput } from "../../components/ui/primitives";
import { createAdminAuction, fetchEligibleAuctionItems, peso, updateAdminAuction, type AdminAuction, type AuctionForm, type EligibleItem } from "../../utils/auctionApi";
import { formatDateTime, toLocalInput } from "../../utils/countdown";
import { tr } from "../../utils/preferences";

const LENGTHS = [
  { label: "1 day", minutes: 1440 },
  { label: "3 days", minutes: 4320 },
  { label: "7 days", minutes: 10080 },
  { label: "14 days", minutes: 20160 },
];
const INCREMENTS = [25, 50, 100, 250];
const MAX_EXTRA_PHOTOS = 4;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

type Props =
  | { mode: "create"; onClose: () => void; onSaved: () => void }
  | { mode: "edit"; auction: AdminAuction; onClose: () => void; onSaved: () => void };

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={tr(label)} onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors ${checked ? "border-gold-500 bg-gold-500" : "border-line-strong bg-frost-100"}`}>
      <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-[left] ${checked ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

/** The bold element: a live preview of the lot as bidders will see it. */
function LotTicket({ photo, reference, title, price, closes, rule }: { photo: string; reference: string; title: string; price: number; closes: string; rule: string }) {
  return (
    <aside className="grid grid-cols-[112px_minmax(0,1fr)] overflow-hidden rounded-[22px] border border-gold-300/60 bg-[linear-gradient(160deg,#22366a_0%,#162448_60%,#0e1830_100%)] text-white shadow-raised lg:sticky lg:top-0 lg:block" aria-label={tr("Lot preview")}>
      <div className="relative aspect-square bg-navy-900 lg:aspect-[4/3]">
        {photo ? <img decoding="async" src={photo} alt="" className="size-full object-cover" /> : <div className="flex size-full items-center justify-center p-2 text-center text-[12px] text-navy-200 lg:text-[13px]">{tr("Choose an item to preview the lot")}</div>}
        {reference && <span className="absolute left-2 top-2 rounded-full bg-navy-950/70 px-2.5 py-0.5 text-[12px] font-semibold tabular-nums text-gold-200 backdrop-blur lg:left-3 lg:top-3 lg:px-3 lg:py-1 lg:text-[12.5px]">{reference}</span>}
      </div>
      <div className="min-w-0 space-y-3 p-4 lg:space-y-4 lg:p-5">
        <h3 className="line-clamp-2 font-[family-name:var(--font-heading)] text-[19px] font-semibold leading-snug">{title || tr("Untitled lot")}</h3>
        <div className="flex items-end justify-between gap-3 border-t border-white/10 pt-4">
          <div>
            <p className="text-[12.5px] text-navy-200">{tr("Starting bid")}</p>
            <p className="font-[family-name:var(--font-heading)] text-[26px] font-semibold leading-none tabular-nums text-gold-300 lg:text-[32px]">{peso(price)}</p>
          </div>
          <p className="max-w-[140px] text-right text-[12.5px] leading-5 text-navy-100">{tr("Closes")}<br />{closes}</p>
        </div>
        <p className="hidden gap-2 rounded-xl bg-white/[0.06] px-3 py-2.5 text-[12.5px] leading-5 text-navy-100 lg:flex"><ShieldCheck size={15} className="mt-0.5 shrink-0 text-gold-300" aria-hidden="true" />{rule}</p>
      </div>
    </aside>
  );
}

export default function AuctionFormModal(props: Props) {
  const editing = props.mode === "edit";
  const auction = props.mode === "edit" ? props.auction : null;
  const hasBids = Boolean(auction && auction.bid_count > 0);
  const scheduled = auction?.status === "scheduled";

  const [items, setItems] = useState<EligibleItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(!editing);
  const [itemsError, setItemsError] = useState("");
  const [query, setQuery] = useState("");
  const [item, setItem] = useState<EligibleItem | null>(null);

  const [title, setTitle] = useState(auction?.title ?? "");
  const [description, setDescription] = useState(auction?.description ?? "");
  const [startingPrice, setStartingPrice] = useState(auction ? String(auction.starting_price) : "");
  const [increment, setIncrement] = useState(auction ? String(auction.bid_increment) : "50");
  const [buyout, setBuyout] = useState(auction?.buyout_price ? String(auction.buyout_price) : "");
  const [lengthMinutes, setLengthMinutes] = useState<number | "custom">(1440);
  const [customHours, setCustomHours] = useState("48");
  const [startMode, setStartMode] = useState<"now" | "later">(scheduled ? "later" : "now");
  const [startsAt, setStartsAt] = useState(auction && scheduled ? toLocalInput(auction.starts_at) : "");
  const [endsAt, setEndsAt] = useState(auction ? toLocalInput(auction.ends_at) : "");
  const [snipe, setSnipe] = useState(auction?.anti_snipe_enabled ?? true);
  const [windowMinutes, setWindowMinutes] = useState(String(Math.round((auction?.anti_snipe_window_seconds ?? 300) / 60)));
  const [extensionMinutes, setExtensionMinutes] = useState(String(Math.round((auction?.anti_snipe_extension_seconds ?? 300) / 60)));
  const [maxExtensions, setMaxExtensions] = useState(String(auction?.max_extensions ?? 10));
  const [extraPhotos, setExtraPhotos] = useState<string[]>(auction ? auction.gallery.filter((url) => url !== auction.image_url) : []);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (editing) return;
    let active = true;
    fetchEligibleAuctionItems()
      .then((data) => { if (active) setItems(data.items); })
      .catch((reason) => { if (active) setItemsError(reason instanceof Error ? reason.message : tr("Unable to load items.")); })
      .finally(() => { if (active) setItemsLoading(false); });
    return () => { active = false; };
  }, [editing]);

  const visibleItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((entry) => !q || `${entry.name} ${entry.reference} ${entry.category} ${entry.location}`.toLowerCase().includes(q));
  }, [items, query]);

  const chooseItem = (entry: EligibleItem) => {
    setItem(entry);
    setTitle(entry.name);
    setDescription(entry.description === "No description" ? "" : entry.description);
    setError("");
  };

  const minutes = lengthMinutes === "custom" ? Math.round(Number(customHours) * 60) : lengthMinutes;
  const start = startMode === "later" && startsAt ? new Date(startsAt) : new Date();
  const previewEnd = editing && endsAt ? new Date(endsAt) : new Date(start.getTime() + (Number.isFinite(minutes) ? minutes : 0) * 60000);
  const windowSeconds = Math.round(Number(windowMinutes) * 60);
  const extensionSeconds = Math.round(Number(extensionMinutes) * 60);
  const rule = snipe
    ? tr("A bid in the last {0} min adds {1} min, up to {2} times.", { "0": windowMinutes || "?", "1": extensionMinutes || "?", "2": maxExtensions || "?" })
    : tr("Anti-snipe is off. The auction closes exactly on time.");

  const addPhotos = (files: FileList | null) => {
    if (!files) return;
    const room = MAX_EXTRA_PHOTOS - extraPhotos.length;
    Array.from(files).slice(0, room).forEach((file) => {
      if (!["image/png", "image/jpeg"].includes(file.type)) { setError(tr("Use PNG or JPG photos.")); return; }
      if (file.size > MAX_PHOTO_BYTES) { setError(tr("Each photo must be 5 MB or smaller.")); return; }
      const reader = new FileReader();
      reader.onload = () => setExtraPhotos((current) => current.length < MAX_EXTRA_PHOTOS ? [...current, String(reader.result)] : current);
      reader.readAsDataURL(file);
    });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing && !item) { setError(tr("Choose the item to auction.")); return; }
    if (!title.trim()) { setError(tr("Give the auction a title.")); return; }
    const price = Number(startingPrice);
    const step = Number(increment);
    if (!hasBids && (!(price > 0) || !(step > 0))) { setError(tr("Enter a starting bid and bid increment above zero.")); return; }
    const buyoutAmount = buyout.trim() === "" ? null : Number(buyout);
    if (!hasBids && buyoutAmount !== null && (!(buyoutAmount > price) || !Number.isFinite(buyoutAmount))) { setError(tr("The Buy Now price must be higher than the starting bid.")); return; }
    if (!editing && (!Number.isFinite(minutes) || minutes < 15)) { setError(tr("The auction must run at least 15 minutes.")); return; }
    if (startMode === "later" && !startsAt) { setError(tr("Pick when the auction opens.")); return; }
    if (editing && (!endsAt || previewEnd.getTime() <= Date.now() + 14 * 60000)) { setError(tr("The end time must be at least 15 minutes from now.")); return; }
    if (snipe && (!(windowSeconds >= 30) || !(extensionSeconds >= 30) || windowSeconds > 3600 || extensionSeconds > 3600)) { setError(tr("Anti-snipe times must be between 1 and 60 minutes.")); return; }
    setError("");
    setBusy(true);
    const shared: AuctionForm = {
      title: title.trim(), description: description.trim(), anti_snipe_enabled: snipe,
      anti_snipe_window_seconds: windowSeconds || 300, anti_snipe_extension_seconds: extensionSeconds || 300,
      max_extensions: Math.max(0, Math.min(50, Math.round(Number(maxExtensions) || 0))), gallery: extraPhotos,
    };
    try {
      if (props.mode === "edit" && auction) {
        const body: AuctionForm = { ...shared, ends_at: new Date(endsAt).toISOString() };
        if (!hasBids) { body.starting_price = startingPrice; body.bid_increment = increment; body.buyout_price = buyout.trim(); }
        if (scheduled && !hasBids && startsAt) body.starts_at = new Date(startsAt).toISOString();
        await updateAdminAuction(auction.id, body);
      } else if (item) {
        await createAdminAuction({
          ...shared, found_item_reference: item.reference, starting_price: startingPrice, bid_increment: increment, duration_minutes: minutes,
          ...(buyout.trim() ? { buyout_price: buyout.trim() } : {}),
          ...(startMode === "later" ? { starts_at: new Date(startsAt).toISOString() } : {}),
        });
      }
      props.onSaved();
      props.onClose();
    } catch {
      // The API helper already reported the server's reason in the global result modal; keep the form open.
    } finally {
      setBusy(false);
    }
  };

  const photo = auction?.image_url ?? item?.photo ?? "";

  return (
    <AdminModal
      title={editing ? tr("Edit {0}", { "0": auction?.reference || tr("auction") }) : tr("New auction")}
      description={editing ? tr("Change the schedule, rules and photos. Prices lock once bidding starts.") : tr("Items unclaimed for over a month can go to auction. Set the opening price, how long it runs, and the anti-snipe rule.")}
      icon={editing ? <Pencil size={19} /> : <Gavel size={20} />}
      tone={editing ? "navy" : "gold"}
      size="xl"
      busy={busy}
      onClose={props.onClose}
      footer={<>
        <button type="button" onClick={props.onClose} disabled={busy} className={BTN.ghost}>{tr("Cancel")}</button>
        <button type="submit" form="auction-form" disabled={busy || (!editing && !item)} className={editing ? BTN.primary : BTN.gold}>{editing ? tr("Save changes") : tr("Start auction")}</button>
      </>}
    >
      <form id="auction-form" onSubmit={submit} className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]" noValidate>
        <LotTicket photo={photo} reference={auction?.reference ?? item?.reference ?? ""} title={title} price={Number(startingPrice) || 0}
          closes={Number.isFinite(previewEnd.getTime()) && (editing || item) ? formatDateTime(previewEnd.toISOString()) : "—"} rule={rule} />

        <div className="min-w-0 space-y-6">
          {!editing && (
            <section aria-labelledby="auction-item-heading">
              <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                <h3 id="auction-item-heading" className="font-[family-name:var(--font-heading)] text-[16px] font-semibold text-ink">{tr("1. Choose the item")}</h3>
                {item && <button type="button" onClick={() => setItem(null)} className="text-[13px] font-semibold text-iris-700 hover:underline">{tr("Change item")}</button>}
              </div>
              {item ? (
                <div className="flex items-center gap-3 rounded-2xl border border-gold-300/60 bg-gold-50 p-3">
                  {item.photo ? <img decoding="async" src={item.photo} alt="" className="size-14 rounded-xl object-cover" /> : <span className="size-14 rounded-xl bg-frost-100" />}
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-ink">{item.name}</p>
                    <p className="text-[13px] text-ink-muted">{tr("{0}, in custody {1} days", { "0": item.reference, "1": item.days_in_custody })}</p>
                  </div>
                </div>
              ) : itemsLoading ? (
                <p className="rounded-2xl border border-line p-4 text-[14px] text-ink-muted">{tr("Loading eligible items…")}</p>
              ) : itemsError ? (
                <p role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-[14px] text-rose-800">{itemsError}</p>
              ) : items.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-line-strong p-5 text-center text-[14px] leading-6 text-ink-muted">{tr("No items are ready yet. An item becomes eligible after 30 days in custody with no ownership claim.")}</p>
              ) : (
                <>
                  <label className="relative mb-2 block">
                    <span className="sr-only">{tr("Search eligible items")}</span>
                    <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
                    <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr("Search eligible items")} className="min-h-[42px] w-full rounded-xl border border-line-strong bg-[var(--surface)] pl-10 pr-3 text-[15px] text-ink outline-none focus:border-iris-500" />
                  </label>
                  <ul className="max-h-[220px] space-y-1.5 overflow-y-auto pr-1">
                    {visibleItems.map((entry) => (
                      <li key={entry.id}>
                        <button type="button" onClick={() => chooseItem(entry)} className="flex w-full items-center gap-3 rounded-xl border border-line p-2.5 text-left transition-colors hover:border-gold-400 hover:bg-gold-50">
                          {entry.photo ? <img decoding="async" src={entry.photo} alt="" loading="lazy" className="size-12 rounded-lg object-cover" /> : <span className="size-12 rounded-lg bg-frost-100" />}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14.5px] font-semibold text-ink">{entry.name}</span>
                            <span className="block truncate text-[12.5px] text-ink-muted">{entry.reference} · {entry.category || tr("Uncategorized")}</span>
                          </span>
                          <span className="shrink-0 rounded-full bg-frost-100 px-2.5 py-1 text-[12px] font-semibold tabular-nums text-ink-soft">{tr("{0} days", { "0": entry.days_in_custody })}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}

          <section className="grid gap-4 sm:grid-cols-2" aria-labelledby="auction-price-heading">
            <h3 id="auction-price-heading" className="font-[family-name:var(--font-heading)] text-[16px] font-semibold text-ink sm:col-span-2">{editing ? tr("Pricing") : tr("2. Set the price")}</h3>
            <Field label="Starting bid (₱)" required hint={hasBids ? "Locked because bids have been placed." : undefined}>
              {(id) => <TextInput id={id} inputMode="decimal" value={startingPrice} onChange={(e) => setStartingPrice(e.target.value)} disabled={hasBids} placeholder="350" />}
            </Field>
            <Field label="Bid increment (₱)" required hint="The smallest raise allowed on the current price.">
              {(id) => (
                <>
                  <TextInput id={id} inputMode="decimal" value={increment} onChange={(e) => setIncrement(e.target.value)} disabled={hasBids} />
                  {!hasBids && <div className="mt-2 flex flex-wrap gap-1.5">{INCREMENTS.map((value) => (
                    <button key={value} type="button" onClick={() => setIncrement(String(value))} className={`rounded-full border px-3 py-1 text-[12.5px] font-semibold tabular-nums transition-colors ${Number(increment) === value ? "border-gold-500 bg-gold-50 text-gold-800" : "border-line text-ink-soft hover:border-gold-400"}`}>₱{value}</button>
                  ))}</div>}
                </>
              )}
            </Field>
            <div className="sm:col-span-2">
              <Field label="Buy Now price (₱), optional" hint={hasBids ? "Locked because bids have been placed." : "Leave empty for a normal auction. A bidder who pays this price wins at once and the auction ends."}>
                {(id) => <TextInput id={id} inputMode="decimal" value={buyout} onChange={(e) => setBuyout(e.target.value)} disabled={hasBids} placeholder={tr("No Buy Now price")} />}
              </Field>
            </div>
          </section>

          <section className="space-y-4" aria-labelledby="auction-time-heading">
            <h3 id="auction-time-heading" className="font-[family-name:var(--font-heading)] text-[16px] font-semibold text-ink">{editing ? tr("Schedule") : tr("3. Set the timer")}</h3>
            {editing ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {scheduled && !hasBids && <Field label="Opens at">{(id) => <TextInput id={id} type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />}</Field>}
                <Field label="Closes at" required hint={hasBids ? "Once bidding has started the end time can only move later." : undefined}>
                  {(id) => <TextInput id={id} type="datetime-local" value={endsAt} min={toLocalInput(new Date())} onChange={(e) => setEndsAt(e.target.value)} />}
                </Field>
              </div>
            ) : (
              <>
                <div role="radiogroup" aria-label={tr("Auction length")} className="flex flex-wrap gap-2">
                  {LENGTHS.map((option) => (
                    <button key={option.minutes} type="button" role="radio" aria-checked={lengthMinutes === option.minutes} onClick={() => setLengthMinutes(option.minutes)}
                      className={`min-h-[42px] rounded-xl border px-4 text-[14px] font-semibold transition-colors ${lengthMinutes === option.minutes ? "border-gold-500 bg-gold-50 text-gold-800" : "border-line text-ink-soft hover:border-gold-400"}`}>{tr(option.label)}</button>
                  ))}
                  <button type="button" role="radio" aria-checked={lengthMinutes === "custom"} onClick={() => setLengthMinutes("custom")}
                    className={`min-h-[42px] rounded-xl border px-4 text-[14px] font-semibold transition-colors ${lengthMinutes === "custom" ? "border-gold-500 bg-gold-50 text-gold-800" : "border-line text-ink-soft hover:border-gold-400"}`}>{tr("Custom")}</button>
                </div>
                {lengthMinutes === "custom" && (
                  <Field label="Length in hours" hint="Between 1 and 1,440 hours (60 days).">{(id) => <TextInput id={id} inputMode="numeric" value={customHours} onChange={(e) => setCustomHours(e.target.value)} />}</Field>
                )}
                <div role="radiogroup" aria-label={tr("When it opens")} className="flex flex-wrap items-center gap-2">
                  {(["now", "later"] as const).map((mode) => (
                    <button key={mode} type="button" role="radio" aria-checked={startMode === mode} onClick={() => setStartMode(mode)}
                      className={`min-h-[42px] rounded-xl border px-4 text-[14px] font-semibold transition-colors ${startMode === mode ? "border-navy-700 bg-navy-800 text-white dark:border-gold-400 dark:bg-gold-500 dark:text-navy-950" : "border-line text-ink-soft hover:border-navy-300"}`}>{mode === "now" ? tr("Open right away") : tr("Schedule it")}</button>
                  ))}
                  {startMode === "later" && <TextInput type="datetime-local" aria-label={tr("Opens at")} value={startsAt} min={toLocalInput(new Date())} onChange={(e) => setStartsAt(e.target.value)} className="!w-auto" />}
                </div>
              </>
            )}
          </section>

          <section className="space-y-4" aria-labelledby="auction-snipe-heading">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 id="auction-snipe-heading" className="font-[family-name:var(--font-heading)] text-[16px] font-semibold text-ink">{tr("Anti-snipe")}</h3>
                <p className="mt-1 max-w-[52ch] text-[13.5px] leading-5 text-ink-muted">{tr("Stops last-second wins. A late bid extends the timer so others can respond.")}</p>
              </div>
              <Switch checked={snipe} onChange={setSnipe} label="Anti-snipe" />
            </div>
            {snipe && (
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Trigger window (min)" hint="Bids this close to the end extend it.">{(id) => <TextInput id={id} inputMode="numeric" value={windowMinutes} onChange={(e) => setWindowMinutes(e.target.value)} />}</Field>
                <Field label="Extension (min)" hint="Time added per trigger.">{(id) => <TextInput id={id} inputMode="numeric" value={extensionMinutes} onChange={(e) => setExtensionMinutes(e.target.value)} />}</Field>
                <Field label="Max extensions" hint="Caps how long it can run on.">{(id) => <TextInput id={id} inputMode="numeric" value={maxExtensions} onChange={(e) => setMaxExtensions(e.target.value)} />}</Field>
              </div>
            )}
          </section>

          <section className="space-y-4" aria-labelledby="auction-details-heading">
            <h3 id="auction-details-heading" className="font-[family-name:var(--font-heading)] text-[16px] font-semibold text-ink">{tr("Listing")}</h3>
            <Field label="Title" required>{(id) => <TextInput id={id} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={255} />}</Field>
            <Field label="Description" hint="Shown publicly. Keep out details only the owner would know.">{(id) => <TextArea id={id} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />}</Field>
            <div>
              <span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("Extra photos")} <span className="font-normal text-ink-muted">({extraPhotos.length}/{MAX_EXTRA_PHOTOS})</span></span>
              <div className="flex flex-wrap gap-2.5">
                {extraPhotos.map((url, index) => (
                  <div key={`${index}-${url.slice(-12)}`} className="group relative size-[72px] overflow-hidden rounded-xl ring-1 ring-line">
                    <img decoding="async" src={url} alt={tr("Extra photo {0}", { "0": index + 1 })} className="size-full object-cover" />
                    <button type="button" onClick={() => setExtraPhotos((current) => current.filter((_, i) => i !== index))} aria-label={tr("Remove photo {0}", { "0": index + 1 })} className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-navy-950/75 text-white"><X size={13} aria-hidden="true" /></button>
                  </div>
                ))}
                {extraPhotos.length < MAX_EXTRA_PHOTOS && (
                  <label className="flex size-[72px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line-strong text-ink-muted transition-colors hover:border-gold-400 hover:text-gold-700">
                    <ImagePlus size={20} aria-hidden="true" />
                    <span className="text-[11.5px] font-medium">{tr("Add")}</span>
                    <input type="file" accept="image/png,image/jpeg" multiple className="sr-only" onChange={(e) => { addPhotos(e.target.files); e.target.value = ""; }} />
                  </label>
                )}
              </div>
              <p className="mt-1.5 text-[13px] text-ink-muted">{tr("The item's own photo is always the first image. PNG or JPG, up to 5 MB each.")}</p>
            </div>
          </section>

          {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[14px] text-rose-800">{error}</p>}
        </div>
      </form>
    </AdminModal>
  );
}
