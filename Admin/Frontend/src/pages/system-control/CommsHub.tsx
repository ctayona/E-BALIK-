import { useEffect, useRef, useState } from "react";
import { BellRing, CheckCircle2, Loader2, Mail, MailWarning, Search, Send, UserRound, Users, X } from "lucide-react";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import { BTN, INPUT } from "../../components/ui/primitives";
import { StatusPill } from "../../components/ui/management";
import { searchUsers, sendMessage, type FoundUser, type MessageResult } from "../../utils/missionApi";
import { tr } from "../../utils/preferences";
import { Card, ErrorNote } from "./parts";

const LEVEL_LABEL = { user: "User", admin: "Admin", super_admin: "Super admin" } as const;

function ChannelCard({ checked, onChange, icon, title, hint }: { checked: boolean; onChange: (value: boolean) => void; icon: React.ReactNode; title: string; hint: string }) {
  return (
    <label className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3.5 transition ${checked ? "border-gold-500 bg-gold-50 shadow-[0_0_0_3px_rgba(209,161,83,0.18)] dark:bg-gold-500/10" : "border-line-strong hover:border-iris-300"}`}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-1 size-4 accent-gold-600" />
      <span className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${checked ? "bg-[linear-gradient(145deg,#f3dcab,#d1a153)] text-navy-950" : "bg-frost-100 text-ink-muted"}`} aria-hidden="true">{icon}</span>
      <span className="min-w-0"><span className="block text-[14.5px] font-semibold text-ink">{title}</span><span className="block text-[12.5px] leading-5 text-ink-muted">{hint}</span></span>
    </label>
  );
}

/** Message one user or everyone, by email, as an in-app notification, or both. */
export default function CommsHub() {
  const [audience, setAudience] = useState<"user" | "all">("user");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FoundUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [recipient, setRecipient] = useState<FoundUser | null>(null);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState(false);
  const [inApp, setInApp] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<MessageResult | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    const text = query.trim();
    if (audience !== "user" || recipient || text.length < 2) { setResults([]); setSearching(false); return undefined; }
    const ticket = ++latest.current;
    setSearching(true);
    const timer = window.setTimeout(() => {
      searchUsers(text)
        .then((users) => { if (ticket === latest.current) setResults(users); })
        .catch(() => { if (ticket === latest.current) setResults([]); })
        .finally(() => { if (ticket === latest.current) setSearching(false); });
    }, 280);
    return () => window.clearTimeout(timer);
  }, [query, audience, recipient]);

  const channelOk = email || inApp;
  const textOk = title.trim().length >= 3 && message.trim().length >= 3;
  const whoOk = audience === "all" || Boolean(recipient);
  const ready = channelOk && textOk && whoOk && !busy;

  const send = async () => {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const outcome = await sendMessage({ audience, account_id: recipient?.account_id, title: title.trim(), message: message.trim(), send_email: email, send_in_app: inApp });
      setResult(outcome);
      setTitle("");
      setMessage("");
      if (audience === "user") { setRecipient(null); setQuery(""); }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : tr("Unable to send the message."));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <Card
      icon={<Send size={21} />}
      tone="navy"
      title={tr("User communications hub")}
      description={tr("Send a direct message to one person or to everyone, as an email, an in-app notification, or both. Every send is written to the activity log.")}
    >
      <div className="space-y-5">
        <div role="radiogroup" aria-label={tr("Who should get it")} className="grid grid-cols-2 gap-2 sm:max-w-[420px]">
          {([["user", "One user", <UserRound key="u" size={16} />], ["all", "All users", <Users key="a" size={16} />]] as const).map(([value, label, icon]) => (
            <button key={value} type="button" role="radio" aria-checked={audience === value} onClick={() => { setAudience(value); setResult(null); setError(""); }}
              className={`flex min-h-[44px] items-center justify-center gap-2 rounded-xl border text-[14px] font-semibold transition ${audience === value ? "border-navy-700 bg-navy-800 text-white shadow-md dark:border-gold-400 dark:bg-[linear-gradient(180deg,#ecc787,#d1a153)] dark:text-navy-950" : "border-line-strong text-ink-soft hover:border-iris-300"}`}>
              {icon}{tr(label)}
            </button>
          ))}
        </div>

        {audience === "user" && (
          <div>
            <span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("Recipient")}</span>
            {recipient ? (
              <div className="flex items-center gap-3 rounded-2xl border border-gold-300 bg-gold-50 p-3 dark:bg-gold-500/10">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(145deg,#2b4282,#1f3160)] text-[13px] font-bold text-gold-300">{recipient.name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</span>
                <span className="min-w-0 flex-1"><span className="block truncate text-[14.5px] font-semibold text-ink">{recipient.name}</span><span className="block truncate text-[12.5px] text-ink-muted">{recipient.email} · {recipient.campus_id || "—"}</span></span>
                <button type="button" onClick={() => { setRecipient(null); setQuery(""); }} aria-label={tr("Choose someone else")} className="flex size-10 items-center justify-center rounded-lg text-ink-muted hover:bg-black/5"><X size={17} aria-hidden="true" /></button>
              </div>
            ) : (
              <div className="relative">
                <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tr("Search by name, email or campus ID")} autoComplete="off" className={`${INPUT} pl-10`} aria-label={tr("Search users")} />
                {searching && <Loader2 size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 animate-spin text-ink-muted" aria-hidden="true" />}
                {query.trim().length >= 2 && !searching && results.length === 0 && <p className="mt-2 text-[13px] text-ink-muted">{tr("No one matches that search.")}</p>}
                {results.length > 0 && (
                  <ul className="mt-2 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-[var(--sticky-bg)] shadow-card" role="listbox" aria-label={tr("Matching users")}>
                    {results.map((user) => (
                      <li key={user.account_id}>
                        <button type="button" role="option" aria-selected={false} onClick={() => { setRecipient(user); setResults([]); }} className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition hover:bg-navy-50">
                          <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-semibold text-ink">{user.name}</span><span className="block truncate text-[12.5px] text-ink-muted">{user.email} · {user.campus_id || "—"}</span></span>
                          {user.level !== "user" && <StatusPill tone="iris">{tr(LEVEL_LABEL[user.level])}</StatusPill>}
                          {!user.is_active && <StatusPill tone="rose">{tr("Suspended")}</StatusPill>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
        {audience === "all" && <p className="flex items-start gap-2.5 rounded-2xl border border-gold-300/60 bg-gold-50 px-4 py-3 text-[13.5px] leading-6 text-ink-soft dark:bg-gold-500/10"><Users size={17} className="mt-0.5 shrink-0 text-gold-700 dark:text-gold-300" aria-hidden="true" />{tr("This goes to every active account. Suspended accounts are skipped.")}</p>}

        <label className="block">
          <span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("Title")}</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder={tr("Your item is ready for pickup")} className={INPUT} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("Message")}</span>
          <textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={5} maxLength={1500} placeholder={tr("Write what the person needs to know. Never ask for passwords or codes.")} className={`${INPUT} resize-y py-3 leading-6`} />
          <span className="mt-1 flex justify-between text-[12.5px] text-ink-muted"><span>{tr("Plain text only.")}</span><span className="tabular-nums">{message.length}/1500</span></span>
        </label>

        <fieldset>
          <legend className="mb-1.5 text-[14px] font-semibold text-ink-soft">{tr("Send it as")}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <ChannelCard checked={email} onChange={setEmail} icon={<Mail size={17} />} title={tr("Direct email")} hint={tr("Lands in their inbox, with the E-Balik design.")} />
            <ChannelCard checked={inApp} onChange={setInApp} icon={<BellRing size={17} />} title={tr("In-app notification")} hint={tr("Appears in their Notifications page at once.")} />
          </div>
          {!channelOk && <p className="mt-2 text-[13px] text-rose-700 dark:text-rose-300">{tr("Choose at least one way to send it.")}</p>}
        </fieldset>

        {error && <ErrorNote>{error}</ErrorNote>}
        {result && (
          <div className="rounded-2xl border border-[#bfe8db] bg-[#e6f7f1] p-4 text-[#14594a] dark:border-[#3fbf9f]/30 dark:bg-[#3fbf9f]/10 dark:text-[#9fe0ca]" role="status">
            <p className="flex items-center gap-2 font-semibold"><CheckCircle2 size={18} aria-hidden="true" />{tr("Message sent")}</p>
            <p className="mt-1 text-[13.5px] leading-6">{result.message}</p>
            {result.email_unavailable && <p className="mt-1 flex items-center gap-2 text-[13px] text-gold-800 dark:text-gold-200"><MailWarning size={15} aria-hidden="true" />{tr("The email service is not set up, so only the in-app copy was sent. Use the email test to check it.")}</p>}
          </div>
        )}

        <div>
          <button type="button" disabled={!ready} onClick={() => (audience === "all" ? setConfirming(true) : void send())} className={BTN.primary}>
            {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}{busy ? tr("Sending…") : audience === "all" ? tr("Send to all users") : tr("Send message")}
          </button>
        </div>
      </div>

      {confirming && (
        <ConfirmActionDialog
          title={tr("send this message to all users")}
          description={tr("Everyone with an active account will get it{0}. It cannot be taken back.", { "0": email && inApp ? tr(" by email and in the app") : email ? tr(" by email") : tr(" in the app") })}
          confirmLabel="Send to everyone"
          busy={busy}
          onCancel={() => { if (!busy) setConfirming(false); }}
          onConfirm={() => void send()}
        />
      )}
    </Card>
  );
}
