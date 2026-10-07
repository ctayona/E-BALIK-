-- 20261005b: Auction "awaiting admin" lifecycle (baseline recovered from the live database on 2026-10-07).
-- This SQL was applied to the live database outside the repo. It is written here so a NEW environment can be built from the repo.
-- Run order: after 20261005_auction_hall.sql and BEFORE 20261006 / 20261009 (20261009 sets status = 'awaiting_admin').
-- Do NOT run it on the live database: it only re-creates what already exists there (it is safe to re-run if you do).
--
-- When a timer ends, an auction with bids no longer closes by itself. It moves to 'awaiting_admin' and an administrator
-- confirms the winner (auction_finalize), which starts the pickup. See PROJECT_CONTEXT.md, "Lifecycle (Awaiting admin)".

BEGIN;

-- Columns used by the lifecycle, re-auctions and winner notices.
ALTER TABLE public.auctions
    ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS finalized_by UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS leader_notified_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS reauctioned_from UUID REFERENCES public.auctions(auction_id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS reauction_reason TEXT;

-- 'awaiting_admin' is now a valid status.
ALTER TABLE public.auctions DROP CONSTRAINT IF EXISTS auctions_status_check;
ALTER TABLE public.auctions
    ADD CONSTRAINT auctions_status_check
    CHECK (status IN ('scheduled', 'active', 'awaiting_admin', 'ended', 'cancelled'));

-- An item that is awaiting the admin's decision is still committed to that auction, so it counts as live.
DROP INDEX IF EXISTS public.uq_auctions_one_live_per_item;
CREATE UNIQUE INDEX uq_auctions_one_live_per_item
    ON public.auctions (found_item_id)
    WHERE found_item_id IS NOT NULL AND status IN ('scheduled', 'active', 'awaiting_admin');

-- Starts scheduled auctions, and moves finished ones to 'awaiting_admin' (or ends / cancels them). Returns the changed rows.
CREATE OR REPLACE FUNCTION public.auction_settle_due()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    a public.auctions%ROWTYPE;
    top_bid public.auction_bids%ROWTYPE;
    item_status TEXT;
    has_open_claim BOOLEAN;
    results JSONB := '[]'::jsonb;
BEGIN
    IF coalesce(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Service role required';
    END IF;

    UPDATE public.auctions
    SET status = 'active', updated_at = now()
    WHERE status = 'scheduled' AND starts_at <= now() AND ends_at > now();

    FOR a IN
        SELECT * FROM public.auctions
        WHERE status IN ('scheduled', 'active') AND ends_at <= now()
        ORDER BY ends_at
        FOR UPDATE SKIP LOCKED
    LOOP
        item_status := NULL;
        has_open_claim := false;
        IF a.found_item_id IS NOT NULL THEN
            SELECT status INTO item_status FROM public.found_items WHERE item_id = a.found_item_id;
            has_open_claim := EXISTS (
                SELECT 1 FROM public.claims c
                WHERE c.found_item_id = a.found_item_id AND c.status IN ('pending', 'approved_for_pickup')
            );
        END IF;

        SELECT * INTO top_bid FROM public.auction_bids
        WHERE auction_id = a.auction_id
        ORDER BY amount DESC, created_at ASC
        LIMIT 1;

        IF a.found_item_id IS NOT NULL AND coalesce(item_status, '') <> 'unclaimed' THEN
            UPDATE public.auctions
            SET status = 'cancelled', cancelled_at = now(), ended_at = now(), updated_at = now(),
                cancel_reason = 'The item is no longer available for auction.'
            WHERE auction_id = a.auction_id RETURNING * INTO a;
        ELSIF has_open_claim THEN
            UPDATE public.auctions
            SET status = 'cancelled', cancelled_at = now(), ended_at = now(), updated_at = now(),
                cancel_reason = 'An ownership claim for this item is under review.'
            WHERE auction_id = a.auction_id RETURNING * INTO a;
        ELSIF top_bid.bid_id IS NULL THEN
            UPDATE public.auctions
            SET status = 'ended', ended_at = now(), updated_at = now()
            WHERE auction_id = a.auction_id RETURNING * INTO a;
        ELSE
            UPDATE public.auctions
            SET status = 'awaiting_admin', ended_at = now(), updated_at = now(),
                winner_account_id = top_bid.bidder_account_id,
                winning_amount = top_bid.amount
            WHERE auction_id = a.auction_id RETURNING * INTO a;
        END IF;

        results := results || jsonb_build_array(to_jsonb(a));
    END LOOP;

    RETURN results;
END;
$function$;

-- An administrator confirms the result of an auction that is awaiting_admin: the winner goes to pickup, or the auction is cancelled.
CREATE OR REPLACE FUNCTION public.auction_finalize(p_auction_id uuid, p_admin_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    a public.auctions%ROWTYPE;
    admin_level TEXT;
    item_status TEXT;
    has_open_claim BOOLEAN := false;
    cancel_text TEXT := NULL;
BEGIN
    IF coalesce(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Service role required';
    END IF;

    SELECT access_level INTO admin_level FROM public.user_profiles WHERE account_id = p_admin_id;
    IF coalesce(admin_level, '') NOT IN ('admin', 'super_admin') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'admin_required');
    END IF;

    SELECT * INTO a FROM public.auctions WHERE auction_id = p_auction_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'not_found');
    END IF;
    IF a.status <> 'awaiting_admin' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'not_awaiting');
    END IF;

    IF a.found_item_id IS NOT NULL THEN
        SELECT status INTO item_status FROM public.found_items WHERE item_id = a.found_item_id;
        has_open_claim := EXISTS (
            SELECT 1 FROM public.claims c
            WHERE c.found_item_id = a.found_item_id AND c.status IN ('pending', 'approved_for_pickup')
        );
        IF coalesce(item_status, '') <> 'unclaimed' THEN
            cancel_text := 'The item is no longer available for auction.';
        ELSIF has_open_claim THEN
            cancel_text := 'An ownership claim for this item is under review.';
        END IF;
    END IF;
    IF cancel_text IS NULL AND a.winner_account_id IS NULL THEN
        cancel_text := 'The winning bidder no longer has an account.';
    END IF;

    IF cancel_text IS NOT NULL THEN
        UPDATE public.auctions
        SET status = 'cancelled', cancelled_at = now(), updated_at = now(), cancel_reason = cancel_text
        WHERE auction_id = a.auction_id RETURNING * INTO a;
        RETURN jsonb_build_object('ok', true, 'outcome', 'cancelled', 'auction', to_jsonb(a));
    END IF;

    UPDATE public.auctions
    SET status = 'ended', finalized_at = now(), finalized_by = p_admin_id,
        fulfillment_status = 'awaiting_pickup', fulfillment_updated_at = now(), updated_at = now()
    WHERE auction_id = a.auction_id RETURNING * INTO a;

    IF a.found_item_id IS NOT NULL THEN
        UPDATE public.found_items
        SET status = 'auctioned', custody_status = 'auctioned', updated_at = now()
        WHERE item_id = a.found_item_id;
    END IF;

    RETURN jsonb_build_object('ok', true, 'outcome', 'finalized', 'auction', to_jsonb(a));
END;
$function$;

-- Only the backend (service role) may call these.
REVOKE ALL ON FUNCTION public.auction_settle_due() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.auction_finalize(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auction_settle_due() TO service_role;
GRANT EXECUTE ON FUNCTION public.auction_finalize(UUID, UUID) TO service_role;

COMMIT;

-- Not repeated here: auction_place_bid. The live definition matches the one already in 20261009_tag_expiry_and_auction_buyout.sql.
