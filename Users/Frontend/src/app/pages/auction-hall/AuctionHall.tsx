import { useDeferredValue, useState } from "react";
import { BellRing, Clock3, Gavel, Heart, Search, ShieldCheck, Sparkles } from "lucide-react";
import imgBottle from "@/imports/OverlaidContent/b49e29d1e878a675879b971b78c0f6b7bf360de5.png";
import imgPhone from "@/imports/OverlaidContent/0823e4e53b38a443f5851ca353f8f6bbe20f42de.png";
import imgKeys from "@/imports/OverlaidContent/d17f656f410a0a4ef6102c44406b2f313dd1390d.png";
import imgUmbrella from "@/imports/OverlaidContent/ef6e46632c1113bdd39677d9964345eb79582284.png";
import { CX } from "@/app/utils/clay";

const previewLots = [
  { lot: "LOT 01", name: "Hydro Flask", category: "Accessories", location: "Main Building", image: imgBottle, opening: "₱350", description: "Insulated bottle · 32 oz · slate blue" },
  { lot: "LOT 02", name: "iPhone 13 Pro", category: "Electronics", location: "Admin Lobby", image: imgPhone, opening: "₱4,500", description: "Graphite finish · protective case included" },
  { lot: "LOT 03", name: "Lanyard with Keys", category: "Personal Effects", location: "Athletic Field", image: imgKeys, opening: "₱100", description: "Three keys · navy university lanyard" },
  { lot: "LOT 04", name: "Black Umbrella", category: "Accessories", location: "Library", image: imgUmbrella, opening: "₱180", description: "Compact folding umbrella · carry sleeve" },
];
const categories = ["All Lots", "Electronics", "Accessories", "Personal Effects"];

export default function AuctionHall() {
  const [category, setCategory] = useState("All Lots");
  const [search, setSearch] = useState("");
  const [savedLots, setSavedLots] = useState<string[]>([]);
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const lots = previewLots.filter((lot) => {
    const matchesCategory = category === "All Lots" || lot.category === category;
    const matchesSearch = !deferredSearch || `${lot.name} ${lot.category} ${lot.lot}`.toLowerCase().includes(deferredSearch);
    return matchesCategory && matchesSearch;
  });

  const toggleSaved = (lot: string) => {
    setSavedLots((current) => current.includes(lot) ? current.filter((saved) => saved !== lot) : [...current, lot]);
  };

  return (
    <main className={CX.page}>
      <div className={CX.inner}>
        <section className="relative overflow-hidden rounded-[26px] border border-white/15 bg-[#162448] p-6 text-white sm:p-8 lg:p-10">
          <div className="absolute -right-12 -top-16 size-64 rounded-full border border-gold-400/15" aria-hidden="true" />
          <div className="absolute -right-2 -top-6 size-44 rounded-full border border-gold-400/10" aria-hidden="true" />
          <div className="relative grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-end">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full border border-gold-400/35 bg-gold-500/10 px-3 py-1 text-[12px] font-bold uppercase tracking-wide text-gold-300"><Gavel size={13} /> Auction Hall</span>
                <span className="rounded-full border border-white/20 px-3 py-1 text-[12px] font-semibold text-white/75">Design preview</span>
              </div>
              <h1 className="mt-4 text-3xl font-semibold leading-tight sm:text-4xl" style={{ fontFamily: "var(--font-heading)" }}>Unclaimed items, a second chance.</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/70">A preview of the university auction experience. These sample lots are not live listings and cannot be bid on.</p>
            </div>
            <div className="grid grid-cols-2 gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
              <div><p className="text-[12px] font-bold uppercase tracking-wide text-white/50">Preview lots</p><p className="mt-1 text-2xl font-semibold text-white">04</p></div>
              <div><p className="text-[12px] font-bold uppercase tracking-wide text-white/50">Live auctions</p><p className="mt-1 text-2xl font-semibold text-gold-300">0</p></div>
              <div className="col-span-2 flex items-center gap-2 border-t border-white/10 pt-3 text-xs text-white/65"><Clock3 size={14} className="text-gold-300" /> Auction dates will appear here when enabled.</div>
            </div>
          </div>
        </section>

        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
          <section className="min-w-0">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-gold-700">Preview catalog</p>
                <h2 className="mt-1 text-xl font-semibold text-navy-800">Featured lots</h2>
              </div>
              <label className="relative block w-full sm:max-w-xs">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search preview lots" className={`${CX.input} h-11 w-full pl-10`} />
              </label>
            </div>

            <div className="mb-5 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Preview lot categories">
              {categories.map((item) => <button key={item} type="button" role="tab" aria-selected={category === item} onClick={() => setCategory(item)} className={`shrink-0 rounded-full border px-4 py-2 text-xs font-bold transition ${category === item ? "border-[#1f3160] bg-navy-800 text-white" : "border-[#dbe2ee] bg-white text-ink-soft hover:border-[#b8893e]"}`}>{item}</button>)}
            </div>

            {lots.length ? <div className="grid gap-4 sm:grid-cols-2">
              {lots.map((lot) => {
                const saved = savedLots.includes(lot.lot);
                return <article key={lot.lot} className={`${CX.cardSm} overflow-hidden`}>
                  <div className="relative aspect-[16/10] overflow-hidden bg-[#e9edf4]">
                    <img src={lot.image} alt={lot.name} className="size-full object-cover" loading="lazy" />
                    <span className="absolute left-3 top-3 rounded-full bg-navy-800/90 px-3 py-1 text-[12px] font-bold text-white">{lot.lot}</span>
                    <button type="button" onClick={() => toggleSaved(lot.lot)} aria-label={saved ? `Remove ${lot.name} from saved lots` : `Save ${lot.name}`} aria-pressed={saved} className="absolute right-3 top-3 flex size-9 items-center justify-center rounded-full border border-white/60 bg-white/90 text-navy-800 shadow-sm hover:bg-white">
                      <Heart size={16} fill={saved ? "#dc2626" : "none"} color={saved ? "#dc2626" : "currentColor"} />
                    </button>
                    <span className="absolute bottom-3 left-3 rounded-full bg-gold-500 px-3 py-1 text-[12px] font-bold uppercase text-navy-800">Sample lot</span>
                  </div>
                  <div className="p-4 sm:p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[12px] font-bold uppercase tracking-wide text-gold-700">{lot.category}</span>
                      <span className="text-[12px] font-semibold text-ink-muted">{lot.location}</span>
                    </div>
                    <h3 className="mt-2 text-lg font-semibold text-navy-800">{lot.name}</h3>
                    <p className="mt-1 min-h-10 text-xs leading-5 text-ink-muted">{lot.description}</p>
                    <div className="mt-4 flex items-end justify-between gap-3 border-t border-[#e8edf4] pt-3">
                      <div><p className="text-[12px] font-bold uppercase tracking-wide text-slate-500">Sample opening offer</p><p className="mt-0.5 text-xl font-semibold text-navy-800">{lot.opening}</p></div>
                      <button type="button" disabled title="Bidding is not enabled" className={`${CX.btnNavy} cursor-not-allowed px-4 py-2.5 text-xs opacity-50`}>Bidding soon</button>
                    </div>
                  </div>
                </article>;
              })}
            </div> : <div className={`${CX.card} p-10 text-center text-sm text-ink-muted`}>No preview lots match this search.</div>}
          </section>

          <aside className="space-y-4">
            <section className={`${CX.cardNavy} p-5 text-white`}>
              <div className="flex items-center gap-2 text-gold-300"><ShieldCheck size={18} /><h2 className="text-sm font-semibold">Before bidding</h2></div>
              <ol className="mt-4 space-y-3 text-xs leading-5 text-white/75">
                <li className="flex gap-3"><span className="font-bold text-gold-300">01</span><span>Confirm your account and contact details.</span></li>
                <li className="flex gap-3"><span className="font-bold text-gold-300">02</span><span>Review item condition and collection requirements.</span></li>
                <li className="flex gap-3"><span className="font-bold text-gold-300">03</span><span>Attend the announced in-person auction to participate.</span></li>
              </ol>
            </section>
            <section className={`${CX.cardSm} p-5`}>
              <div className="flex items-center gap-2 text-navy-800"><BellRing size={17} className="text-gold-700" /><h2 className="text-sm font-semibold">Auction notices</h2></div>
              <p className="mt-2 text-xs leading-5 text-ink-muted">When auctions launch, schedule and eligibility notices will be posted here.</p>
              <div className="mt-4 flex items-center gap-2 border-t border-[#e8edf4] pt-3 text-xs font-semibold text-ink-muted"><Sparkles size={14} className="text-gold-700" /> Preview mode · no bids are being accepted</div>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
