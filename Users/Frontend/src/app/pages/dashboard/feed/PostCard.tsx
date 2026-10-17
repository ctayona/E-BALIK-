import { useEffect, useId, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, BadgeCheck, CalendarDays, Clock3, Loader2, MapPin, MessageCircle, PackageCheck, SearchCheck, Send, Share2, ShieldCheck, Tag, ThumbsUp, Trash2, UserRound } from "lucide-react";
import ItemImage from "@/app/shared/media/ItemImage";
import { feedApi, type FeedComment, type FeedPost } from "@/app/utils/api";
import { shareReport } from "@/app/utils/shareReport";
import { fullTime, timeAgo } from "./time";
import { initialsOf } from "./ComposerCard";
import { FEED_CARD, GOLD_GRADIENT, NAVY_GRADIENT } from "./feedStyle";
import type { User } from "@/app/utils/useAuth";
import { FieldHint, INVALID_FIELD, useFieldHint } from "@/app/shared/forms/FieldHint";
import { textProblem } from "@/app/utils/textGuard";

const MAX_COMMENT = 500;
const LONG_TEXT = 180;

function formatDay(value: string) {
  const day = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(day.getTime()) ? value : day.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

/** "Maria S." becomes "MS". */
function nameInitials(name: string) {
  const parts = name.replace(/[^\p{L}\s]/gu, "").split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "U";
}

const COMMENTER_TONES = [
  "bg-gradient-to-b from-[#ecc787] to-[#d1a153] text-navy-950",
  "bg-[linear-gradient(160deg,#33497f_0%,#1f3160_100%)] text-white",
  "bg-gradient-to-b from-iris-400 to-iris-600 text-white",
  "bg-gradient-to-b from-tide-500 to-tide-700 text-white",
];
/** The same person always gets the same colour. */
const toneFor = (name: string) => COMMENTER_TONES[[...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % COMMENTER_TONES.length];

/** The number on an action button: a small badge on the corner of its icon, so the button never gets wider and its icon is never squeezed. */
function CountBadge({ value, gold = false, label }: { value: number; gold?: boolean; label: string }) {
  return (
    <span
      className={`absolute -right-3.5 -top-2.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none tabular-nums ring-2 ring-white ${gold ? "bg-gold-500 text-navy-950" : "bg-navy-800 text-white"}`}
      aria-label={`${value} ${label}`}
    >
      {value > 99 ? "99+" : value}
    </span>
  );
}

/**
 * One report as a post, laid out like a social post: who posted and when, a status badge, the item and its photo, then a bar with Helpful,
 * Comment and Share and the one action that fits the report (claim it, say you found it, or see your matches), and the comments.
 * The poster is never named: found items are posted by the Custody Desk, missing reports by a verified member (you see "You" on your own).
 * Reactions and comments update at once and are put back if the server says no.
 */
export default function PostCard({ post, user, mine, ensureVerified, onOpenImage, onPrimary }: {
  post: FeedPost;
  user: User | null;
  /** This is the viewer's own missing report. */
  mine: boolean;
  /** Returns false (and shows the verification pop-up) when the account may not comment or react yet. */
  ensureVerified: () => boolean;
  onOpenImage: () => void;
  onPrimary: () => void;
}) {
  const found = post.kind === "found";
  const headingId = useId();
  const reduced = useReducedMotion();
  const inputRef = useRef<HTMLInputElement>(null);
  const [social, setSocial] = useState({ comment_count: post.comment_count, helpful_count: post.helpful_count, reacted: post.reacted });
  const [comments, setComments] = useState<FeedComment[]>(post.comments);
  const [threadLoaded, setThreadLoaded] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const [open, setOpen] = useState(post.comments.length > 0);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [reacting, setReacting] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // The list refreshes on its own every so often; keep the counts honest when a fresh copy of this post arrives.
  useEffect(() => {
    setSocial({ comment_count: post.comment_count, helpful_count: post.helpful_count, reacted: post.reacted });
    if (!threadLoaded) setComments(post.comments);
  }, [post.comment_count, post.helpful_count, post.reacted, post.comments, threadLoaded]);

  async function toggleHelpful() {
    if (reacting || !ensureVerified()) return;
    setReacting(true);
    setError("");
    const before = social;
    const next = !social.reacted;
    setSocial({ ...social, reacted: next, helpful_count: Math.max(0, social.helpful_count + (next ? 1 : -1)) });
    const response = await feedApi.react(post.kind, post.reference, next);
    if (response.error || !response.data) {
      setSocial(before);
      setError(response.error || "Could not save your reaction.");
    } else {
      setSocial({ comment_count: response.data.comment_count, helpful_count: response.data.helpful_count, reacted: response.data.reacted });
    }
    setReacting(false);
  }

  function openComments() {
    setOpen(true);
    window.setTimeout(() => inputRef.current?.focus(), 30);
  }

  async function loadThread() {
    if (loadingThread) return;
    setLoadingThread(true);
    setError("");
    const response = await feedApi.comments(post.kind, post.reference);
    if (response.error || !response.data) setError(response.error || "Could not load the comments.");
    else { setComments(response.data.comments); setThreadLoaded(true); }
    setLoadingThread(false);
    setOpen(true);
  }

  const commentHint = useFieldHint(draft, { kind: "comment", required: false });

  async function submitComment(event: React.FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || posting || !ensureVerified()) return;
    const problem = textProblem(body, "comment");
    if (problem) {
      if (!commentHint.invalid) setError(problem);
      return;
    }
    setPosting(true);
    setError("");
    const response = await feedApi.addComment(post.kind, post.reference, body);
    if (response.error || !response.data) {
      setError(response.error || "Could not post your comment.");
    } else {
      setComments((current) => [...current, response.data!.comment]);
      setSocial((current) => ({ ...current, comment_count: response.data!.comment_count }));
      setDraft("");
    }
    setPosting(false);
  }

  async function removeComment(id: string) {
    setConfirmDelete(null);
    const response = await feedApi.deleteComment(id);
    if (response.error) { setError(response.error); return; }
    setComments((current) => current.filter((comment) => comment.id !== id));
    setSocial((current) => ({ ...current, comment_count: Math.max(0, current.comment_count - 1) }));
  }

  const hiddenCount = Math.max(0, social.comment_count - comments.length);
  const longText = post.description.length > LONG_TEXT;
  const primary = found
    ? { label: "This is mine", hint: "Start a claim", gold: true }
    : mine ? { label: "See matches", hint: "Possible found items", gold: false } : { label: "I found this", hint: "Tell the owner", gold: false };
  const poster = found ? "Custody Desk" : mine ? "You" : "Verified member";
  const status = found
    ? { label: "In custody", icon: PackageCheck, tone: "bg-tide-50 text-tide-700 ring-tide-200" }
    : { label: "Still missing", icon: SearchCheck, tone: "bg-iris-50 text-iris-700 ring-iris-200" };
  const StatusIcon = status.icon;
  const action = "group relative flex min-h-[46px] items-center justify-center gap-2 rounded-xl text-[14px] font-semibold transition-[background-color,color,box-shadow,transform] duration-200 active:scale-[0.97]";

  return (
    <article aria-labelledby={headingId} className={`${FEED_CARD} overflow-hidden`}>
      <header className="flex items-start gap-3 px-4 pt-4 sm:px-5">
        <span
          className={`flex size-11 shrink-0 items-center justify-center rounded-full text-[15px] font-bold shadow-[0_6px_16px_-8px_rgba(31,49,96,0.7)] ring-2 ring-white ${
            found ? `${NAVY_GRADIENT} text-gold-300` : mine ? `${GOLD_GRADIENT} text-navy-950` : `${NAVY_GRADIENT} text-white`
          }`}
          aria-hidden="true"
        >
          {found ? <ShieldCheck size={21} /> : mine ? initialsOf(user) : <UserRound size={20} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[15px] font-semibold leading-5 text-ink">
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              {poster}
              {!mine && <BadgeCheck size={16} className="shrink-0 text-iris-600" aria-label="Verified" />}
            </span>
            {mine && <span className="rounded-full bg-gold-50 px-2 py-px text-[11.5px] font-semibold text-gold-800 ring-1 ring-gold-200">Your report</span>}
          </p>
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12.5px] leading-5 text-ink-muted">
            <Clock3 size={12} className="shrink-0" aria-hidden="true" />
            <time className="shrink-0" dateTime={post.created_at} title={fullTime(post.created_at)}>{timeAgo(post.created_at)}</time>
            <span aria-hidden="true">·</span>
            <span className="truncate">{found ? "Lost and Found Office" : "Campus feed"}</span>
          </p>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold ring-1 ${status.tone}`}>
          <StatusIcon size={13} aria-hidden="true" />{status.label}
        </span>
      </header>

      <div className="px-4 pb-3 pt-3.5 sm:px-5">
        <h3 id={headingId} className="font-[family-name:var(--font-heading)] text-[20px] font-semibold leading-tight tracking-[-0.01em] text-ink">{post.item_name}</h3>
        {post.description && (
          <p className={`mt-1.5 whitespace-pre-line break-words text-[15px] leading-6 text-ink-soft ${expanded || !longText ? "" : "line-clamp-3"}`}>{post.description}</p>
        )}
        {longText && <button type="button" onClick={() => setExpanded((value) => !value)} className="mt-0.5 min-h-[32px] text-[13.5px] font-semibold text-iris-700 hover:underline">{expanded ? "See less" : "See more"}</button>}
        <ul className="mt-3 flex flex-wrap gap-1.5 text-[12.5px] text-ink-soft">
          {post.location && <li className="inline-flex items-center gap-1.5 rounded-full bg-frost-100/80 px-2.5 py-1"><MapPin size={13} className="text-gold-700" aria-hidden="true" />{found ? "Found at" : "Last seen at"} {post.location}</li>}
          {post.date && <li className="inline-flex items-center gap-1.5 rounded-full bg-frost-100/80 px-2.5 py-1"><CalendarDays size={13} className="text-gold-700" aria-hidden="true" />{formatDay(post.date)}</li>}
          {post.category && <li className="inline-flex items-center gap-1.5 rounded-full bg-frost-100/80 px-2.5 py-1"><Tag size={13} className="text-gold-700" aria-hidden="true" />{post.category}</li>}
          <li className="inline-flex items-center rounded-full bg-frost-100/80 px-2.5 py-1 font-mono text-[12px] text-ink-muted">{post.reference}</li>
        </ul>
      </div>

      <button type="button" onClick={onOpenImage} aria-label={`Open the photo of ${post.item_name}`} className="group block w-full overflow-hidden bg-navy-950">
        <ItemImage item={{ image: post.image_url || undefined, title: post.item_name, category: post.category }} size="lg" className="aspect-[16/10] max-h-[460px] w-full" imgClassName="object-cover transition-transform duration-500 group-hover:scale-[1.02]" />
      </button>

      <div className="mx-4 mt-1 sm:mx-5">
        <div className="grid grid-cols-3 gap-1 border-b border-line/70 py-1.5">
          <button
            type="button"
            onClick={() => void toggleHelpful()}
            aria-pressed={social.reacted}
            disabled={reacting}
            className={`${action} disabled:opacity-70 ${
              social.reacted
                ? "bg-gold-50 text-gold-800 shadow-[0_0_0_1px_rgba(209,161,83,0.5),0_8px_24px_-8px_rgba(209,161,83,0.7)]"
                : "text-ink-soft hover:bg-frost-100"
            }`}
          >
            <motion.span
              key={String(social.reacted)}
              initial={reduced || !social.reacted ? false : { scale: 0.5, rotate: -18 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 600, damping: 14 }}
              className="relative flex"
            >
              <ThumbsUp size={18} className={social.reacted ? "fill-[#d1a153]/40" : ""} aria-hidden="true" />
              {social.helpful_count > 0 && <CountBadge value={social.helpful_count} gold={social.reacted} label="helpful" />}
            </motion.span>
            Helpful
          </button>
          <button type="button" onClick={openComments} className={`${action} text-ink-soft hover:bg-frost-100`}>
            <span className="relative flex">
              <MessageCircle size={18} aria-hidden="true" />
              {social.comment_count > 0 && <CountBadge value={social.comment_count} label={social.comment_count === 1 ? "comment" : "comments"} />}
            </span>
            Comment
          </button>
          <button type="button" onClick={() => void shareReport(post.reference)} className={`${action} text-ink-soft hover:bg-frost-100`} title="Copy a link to this report">
            <Share2 size={18} aria-hidden="true" />Share
          </button>
        </div>
        <button
          type="button"
          onClick={onPrimary}
          title={primary.hint}
          className={`group my-2.5 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl px-4 text-[14.5px] font-semibold transition-[transform,box-shadow,filter] duration-200 hover:-translate-y-px active:scale-[0.99] ${
            primary.gold
              ? `${GOLD_GRADIENT} text-navy-950 shadow-[0_1px_0_rgba(255,255,255,0.5)_inset,0_10px_22px_-12px_rgba(209,161,83,0.9)] hover:brightness-105`
              : `${NAVY_GRADIENT} text-white shadow-[0_10px_22px_-12px_rgba(31,49,96,0.9)] hover:brightness-110`
          }`}
        >
          {primary.label}<span className="text-[13px] font-medium opacity-75">· {primary.hint}</span>
          <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </button>
      </div>

      {error && <p role="alert" className="mx-4 mb-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] leading-5 text-rose-800 sm:mx-5">{error}</p>}

      {(open || comments.length > 0) && (
        <div className="space-y-3 border-t border-line/70 bg-frost-50/50 px-4 pb-4 pt-3 sm:px-5">
          {hiddenCount > 0 && !threadLoaded && (
            <button type="button" onClick={() => void loadThread()} disabled={loadingThread} className="inline-flex min-h-[40px] items-center gap-1.5 text-[13.5px] font-semibold text-ink-soft hover:underline disabled:opacity-60">
              {loadingThread && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}View all {social.comment_count} comments
            </button>
          )}
          <ul className="space-y-3">
            {comments.map((comment) => (
              <motion.li
                key={comment.id}
                initial={reduced ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 32 }}
                className="flex items-start gap-2.5"
              >
                <span className={`flex size-9 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ring-2 ring-white ${toneFor(comment.author)}`} aria-hidden="true">{nameInitials(comment.author)}</span>
                <div className="min-w-0 flex-1">
                  <div className={`inline-block max-w-full rounded-[18px] rounded-tl-md px-3.5 py-2 ${comment.is_mine ? "bg-gold-50 ring-1 ring-gold-200/80" : "bg-white ring-1 ring-line"}`}>
                    <p className="flex flex-wrap items-center gap-x-1.5 text-[13px] font-semibold leading-5 text-ink">
                      {comment.author}
                      {comment.is_mine && <span className="rounded-full bg-gold-500/15 px-1.5 text-[11px] font-semibold text-gold-800">You</span>}
                    </p>
                    <p className="whitespace-pre-line break-words text-[14.5px] leading-5 text-ink-soft">{comment.body}</p>
                  </div>
                  <p className="mt-0.5 flex items-center gap-3 px-2 text-[12px] text-ink-muted">
                    <time dateTime={comment.created_at} title={fullTime(comment.created_at)}>{timeAgo(comment.created_at)}</time>
                    {comment.is_mine && (confirmDelete === comment.id
                      ? <span className="flex items-center gap-2"><button type="button" onClick={() => void removeComment(comment.id)} className="-my-2 min-h-[44px] px-1 text-[12.5px] font-semibold text-rose-700 hover:underline">Delete</button><button type="button" onClick={() => setConfirmDelete(null)} className="-my-2 min-h-[44px] px-1 text-[12.5px] hover:underline">Keep</button></span>
                      : <button type="button" onClick={() => setConfirmDelete(comment.id)} className="-my-2 inline-flex min-h-[44px] items-center gap-1 px-1 text-[12.5px] hover:text-rose-700" aria-label="Delete your comment"><Trash2 size={12} aria-hidden="true" />Delete</button>)}
                  </p>
                </div>
              </motion.li>
            ))}
          </ul>
          <form onSubmit={submitComment} className="flex items-center gap-2.5">
            <span className={`flex size-9 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-navy-950 ring-2 ring-white ${GOLD_GRADIENT}`} aria-hidden="true">{initialsOf(user)}</span>
            <label htmlFor={`${headingId}-comment`} className="sr-only">Write a comment on {post.item_name}</label>
            <div className="relative min-w-0 flex-1">
              <input
                id={`${headingId}-comment`}
                ref={inputRef}
                value={draft}
                onChange={(event) => { setDraft(event.target.value); if (error) setError(""); }}
                onBlur={commentHint.onBlur}
                aria-invalid={commentHint.invalid}
                aria-describedby={commentHint.invalid ? `${headingId}-comment-hint` : undefined}
                maxLength={MAX_COMMENT}
                placeholder="Write a comment…"
                autoComplete="off"
                enterKeyHint="send"
                className={`min-h-[46px] w-full rounded-full border border-line bg-white py-2 pl-4 pr-14 text-[16px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-slate-400 focus:border-iris-500 focus:shadow-[0_0_0_4px_rgba(110,142,240,0.18)] sm:text-[14.5px] ${commentHint.invalid ? INVALID_FIELD : ""}`}
              />
              <button type="submit" disabled={posting || !draft.trim()} aria-label="Post comment" className="absolute right-1 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-[#1f3160] text-white transition-[opacity,transform] hover:opacity-90 active:scale-90 disabled:opacity-35">
                {posting ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
              </button>
            </div>
          </form>
          <FieldHint id={`${headingId}-comment-hint`} message={commentHint.message} />
          {draft.length > 400 && <p className="px-1 text-right text-[12px] text-ink-muted">{MAX_COMMENT - draft.length} characters left</p>}
          <p className="px-1 text-[12px] leading-4 text-ink-muted">Please keep phone numbers and emails out of comments. To reach the owner, file a claim or scan their Smart Tag.</p>
        </div>
      )}
    </article>
  );
}
