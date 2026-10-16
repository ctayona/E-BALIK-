import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, CalendarDays, Loader2, MapPin, MessageCircle, PackageSearch, Send, ThumbsUp, Trash2 } from "lucide-react";
import ItemImage, { categoryIcon } from "@/app/shared/media/ItemImage";
import { feedApi, type FeedComment, type FeedPost } from "@/app/utils/api";
import { fullTime, timeAgo } from "./time";
import { initialsOf } from "./ComposerCard";
import type { User } from "@/app/utils/useAuth";

const MAX_COMMENT = 500;
const LONG_TEXT = 180;

function formatDay(value: string) {
  const day = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(day.getTime()) ? value : day.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * One report as a post: who and where, the photo, a "Helpful" reaction, comments, and the one action that fits the report
 * (claim it, say you found it, or see your matches). Reactions and comments update at once and are put back if the server says no.
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
  const Icon = found ? categoryIcon(post.category) : PackageSearch;

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

  async function submitComment(event: React.FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || posting || !ensureVerified()) return;
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
  const primary = found ? { label: "This is mine", hint: "Start a claim" } : mine ? { label: "See matches", hint: "Possible found items" } : { label: "I found this", hint: "Tell the owner" };

  return (
    <article aria-labelledby={headingId} className="overflow-hidden rounded-[20px] border border-white/80 bg-white/90 shadow-card">
      <header className="flex items-start gap-3 px-4 pt-4 sm:px-5">
        <span className={`flex size-11 shrink-0 items-center justify-center rounded-full text-white ring-[3px] ${found ? "bg-[#1f3160] ring-[#d1a153]" : "bg-[#1f3160] ring-[#6e8ef0]"}`} aria-hidden="true"><Icon size={19} /></span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[15px] font-semibold text-ink">
            {found ? "Found item" : "Missing report"}
            <span className="rounded-md bg-frost-100 px-1.5 py-px font-mono text-[12px] font-medium text-ink-soft">{post.reference}</span>
            {mine && <span className="rounded-full bg-gold-50 px-2 py-px text-[11.5px] font-semibold text-gold-800 ring-1 ring-gold-200">Your report</span>}
          </p>
          <p className="text-[13px] text-ink-muted">
            <time dateTime={post.created_at} title={fullTime(post.created_at)}>{timeAgo(post.created_at)}</time>
            {post.location && <span> · {post.location}</span>}
          </p>
        </div>
        {post.category && <span className="hidden shrink-0 rounded-full border border-line bg-frost-50 px-2.5 py-1 text-[12px] font-medium text-ink-soft sm:inline">{post.category}</span>}
      </header>

      <div className="px-4 pb-3 pt-3 sm:px-5">
        <h3 id={headingId} className="font-[family-name:var(--font-heading)] text-[19px] font-semibold leading-tight text-ink">{post.item_name}</h3>
        {post.description && (
          <p className={`mt-1.5 whitespace-pre-line break-words text-[15px] leading-6 text-ink-soft ${expanded || !longText ? "" : "line-clamp-3"}`}>{post.description}</p>
        )}
        {longText && <button type="button" onClick={() => setExpanded((value) => !value)} className="mt-0.5 text-[13.5px] font-semibold text-iris-700 hover:underline">{expanded ? "See less" : "See more"}</button>}
        <p className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-muted">
          {post.location && <span className="inline-flex items-center gap-1.5"><MapPin size={14} aria-hidden="true" />{found ? "Found at" : "Last seen at"} {post.location}</span>}
          {post.date && <span className="inline-flex items-center gap-1.5"><CalendarDays size={14} aria-hidden="true" />{formatDay(post.date)}</span>}
        </p>
      </div>

      <button type="button" onClick={onOpenImage} aria-label={`Open the photo of ${post.item_name}`} className="group block w-full overflow-hidden bg-navy-950">
        <ItemImage item={{ image: post.image_url || undefined, title: post.item_name, category: post.category }} size="lg" className="aspect-[16/10] max-h-[460px] w-full" imgClassName="object-cover transition-transform duration-500 group-hover:scale-[1.02]" />
      </button>

      {(social.helpful_count > 0 || social.comment_count > 0) && (
        <div className="flex items-center justify-between px-4 pt-2.5 text-[13px] text-ink-muted sm:px-5">
          <span className="inline-flex items-center gap-1.5">
            {social.helpful_count > 0 && <><span className="flex size-5 items-center justify-center rounded-full bg-gradient-to-b from-[#e6be76] to-[#d1a153] text-navy-950" aria-hidden="true"><ThumbsUp size={11} /></span>{social.helpful_count} found this helpful</>}
          </span>
          {social.comment_count > 0 && <button type="button" onClick={() => (threadLoaded || hiddenCount === 0 ? setOpen(true) : void loadThread())} className="hover:underline">{social.comment_count} comment{social.comment_count === 1 ? "" : "s"}</button>}
        </div>
      )}

      <div className="mx-4 mt-2.5 grid grid-cols-3 gap-1 border-t border-line py-1 sm:mx-5">
        <button type="button" onClick={() => void toggleHelpful()} aria-pressed={social.reacted} disabled={reacting} className={`flex min-h-[44px] items-center justify-center gap-2 rounded-xl text-[14px] font-semibold transition-colors hover:bg-frost-100 disabled:opacity-70 ${social.reacted ? "text-gold-700" : "text-ink-soft"}`}>
          <ThumbsUp size={18} className={social.reacted ? "fill-[#d1a153]/30" : ""} aria-hidden="true" />Helpful
        </button>
        <button type="button" onClick={openComments} className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl text-[14px] font-semibold text-ink-soft transition-colors hover:bg-frost-100">
          <MessageCircle size={18} aria-hidden="true" />Comment
        </button>
        <button type="button" onClick={onPrimary} className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl text-[14px] font-semibold text-navy-800 transition-colors hover:bg-frost-100" title={primary.hint}>
          {primary.label}<ArrowRight size={15} aria-hidden="true" />
        </button>
      </div>

      {error && <p role="alert" className="mx-4 mb-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] leading-5 text-rose-800 sm:mx-5">{error}</p>}

      {(open || comments.length > 0) && (
        <div className="space-y-3 border-t border-line px-4 pb-4 pt-3 sm:px-5">
          {hiddenCount > 0 && !threadLoaded && (
            <button type="button" onClick={() => void loadThread()} disabled={loadingThread} className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-ink-soft hover:underline disabled:opacity-60">
              {loadingThread && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}View all {social.comment_count} comments
            </button>
          )}
          <ul className="space-y-2.5">
            {comments.map((comment) => (
              <li key={comment.id} className="flex items-start gap-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-frost-200 text-[12px] font-bold text-navy-800" aria-hidden="true">{comment.author.slice(0, 1).toUpperCase()}</span>
                <div className="min-w-0">
                  <div className="inline-block max-w-full rounded-2xl bg-frost-100 px-3.5 py-2">
                    <p className="text-[13px] font-semibold text-ink">{comment.author}{comment.is_mine && <span className="ml-1.5 font-normal text-ink-muted">(you)</span>}</p>
                    <p className="whitespace-pre-line break-words text-[14.5px] leading-5 text-ink-soft">{comment.body}</p>
                  </div>
                  <p className="mt-0.5 flex items-center gap-3 px-2 text-[12px] text-ink-muted">
                    <time dateTime={comment.created_at} title={fullTime(comment.created_at)}>{timeAgo(comment.created_at)}</time>
                    {comment.is_mine && (confirmDelete === comment.id
                      ? <span className="flex items-center gap-2"><button type="button" onClick={() => void removeComment(comment.id)} className="font-semibold text-rose-700 hover:underline">Delete</button><button type="button" onClick={() => setConfirmDelete(null)} className="hover:underline">Keep</button></span>
                      : <button type="button" onClick={() => setConfirmDelete(comment.id)} className="inline-flex items-center gap-1 hover:text-rose-700" aria-label="Delete your comment"><Trash2 size={12} aria-hidden="true" />Delete</button>)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          <form onSubmit={submitComment} className="flex items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-[#e6be76] to-[#d1a153] text-[12px] font-bold text-navy-950" aria-hidden="true">{initialsOf(user)}</span>
            <label htmlFor={`${headingId}-comment`} className="sr-only">Write a comment on {post.item_name}</label>
            <input
              id={`${headingId}-comment`}
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={MAX_COMMENT}
              placeholder="Write a comment…"
              autoComplete="off"
              enterKeyHint="send"
              className="min-h-[40px] min-w-0 flex-1 rounded-full border border-line bg-frost-50 px-4 text-[16px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-slate-400 focus:border-iris-500 focus:shadow-[0_0_0_4px_rgba(110,142,240,0.18)] sm:text-[14.5px]"
            />
            <button type="submit" disabled={posting || !draft.trim()} aria-label="Post comment" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#1f3160] text-white transition-opacity hover:opacity-90 disabled:opacity-40">
              {posting ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
            </button>
          </form>
          {draft.length > 400 && <p className="px-1 text-right text-[12px] text-ink-muted">{MAX_COMMENT - draft.length} characters left</p>}
          <p className="px-1 text-[12px] leading-4 text-ink-muted">Please keep phone numbers and emails out of comments. To reach the owner, file a claim or scan their Smart Tag.</p>
        </div>
      )}
    </article>
  );
}
