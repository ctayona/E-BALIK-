import { useCallback, useEffect, useState } from "react";
import { Loader2, MessageCircle, Send } from "lucide-react";
import { FieldHint, useFieldHint } from "@/app/shared/forms/FieldHint";
import { textProblem } from "@/app/utils/textGuard";
import { AuctionRequestError, auctionsApi, timeAgo, useNow, type AuctionComment } from "@/app/utils/auctions";

const SHOWN = 3;

/**
 * The latest comments of a lot, right on its card, and a box to add one. Loaded the first time the Comments tab opens.
 * Everyone appears as their Bidder_ alias, as in the lot window; the full thread (and deleting your own) stays in the lot window.
 */
export default function InlineComments({ auctionId, onOpenAll }: { auctionId: string; onOpenAll: () => void }) {
  const [comments, setComments] = useState<AuctionComment[] | null>(null);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const hint = useFieldHint(text, { kind: "comment", required: false });
  const now = useNow(30000);

  const load = useCallback(async () => {
    try {
      setComments((await auctionsApi.detail(auctionId)).comments);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Comments could not be loaded.");
      setComments((current) => current ?? []);
    }
  }, [auctionId]);

  useEffect(() => { void load(); }, [load]);

  const post = async (event: React.FormEvent) => {
    event.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    const problem = textProblem(body, "comment");
    if (problem) { if (!hint.invalid) setError(problem); return; }
    setBusy(true);
    setError("");
    try {
      const result = await auctionsApi.comment(auctionId, body);
      setComments((current) => [...(current ?? []), result.comment]);
      setText("");
    } catch (reason) {
      setError(reason instanceof AuctionRequestError || reason instanceof Error ? reason.message : "The comment could not be posted.");
    } finally {
      setBusy(false);
    }
  };

  const latest = (comments ?? []).slice(-SHOWN);
  const hidden = Math.max(0, (comments ?? []).length - latest.length);

  return (
    <div className="space-y-3">
      {comments === null ? (
        <p className="flex items-center gap-2 text-[13px] text-white/60"><Loader2 size={14} className="animate-spin" aria-hidden="true" />Loading comments…</p>
      ) : latest.length === 0 ? (
        <p className="flex items-center gap-2 text-[13px] text-white/60"><MessageCircle size={14} aria-hidden="true" />No comments yet. Ask about the item's condition or pickup.</p>
      ) : (
        <ul className="space-y-2">
          {hidden > 0 && <li><button type="button" onClick={onOpenAll} className="min-h-[36px] text-[13px] font-semibold text-gold-300 hover:underline">View all {comments.length} comments</button></li>}
          {latest.map((comment) => (
            <li key={comment.id} className={`rounded-2xl px-3.5 py-2.5 ring-1 ${comment.is_mine ? "bg-gold-500/10 ring-gold-400/30" : "bg-white/[0.06] ring-white/10"}`}>
              <p className="flex items-center gap-2 text-[12.5px]"><span className="font-semibold text-white">{comment.is_mine ? "You" : comment.author}</span><span className="text-white/50">{timeAgo(comment.created_at, now)}</span></p>
              <p className="mt-0.5 whitespace-pre-line break-words text-[14px] leading-5 text-white/80">{comment.body}</p>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={post} className="relative">
        <label htmlFor={`comment-${auctionId}`} className="sr-only">Write a comment</label>
        <input
          id={`comment-${auctionId}`}
          value={text}
          onChange={(event) => { setText(event.target.value.slice(0, 500)); if (error) setError(""); }}
          onBlur={hint.onBlur}
          aria-invalid={hint.invalid}
          aria-describedby={hint.invalid ? `comment-${auctionId}-hint` : undefined}
          placeholder="Write a comment…"
          autoComplete="off"
          enterKeyHint="send"
          className={`h-12 w-full rounded-full border bg-white/[0.07] pl-4 pr-14 text-[16px] text-white outline-none transition-[border-color,box-shadow] placeholder:text-white/40 focus:border-gold-400 focus:shadow-[0_0_0_4px_rgba(209,161,83,0.22)] sm:text-[14.5px] ${hint.invalid ? "border-rose-400" : "border-white/15"}`}
        />
        <button type="submit" disabled={busy || !text.trim()} aria-label="Post comment" className="absolute right-1 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-[linear-gradient(160deg,#f3dcab,#d1a153)] text-navy-950 transition-[opacity,transform] active:scale-90 disabled:opacity-40">
          {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
        </button>
      </form>
      <div className="[&_p]:!text-rose-300"><FieldHint id={`comment-${auctionId}-hint`} message={hint.message} /></div>
      {error && <p role="alert" className="text-[13px] leading-5 text-rose-300">{error}</p>}
    </div>
  );
}
