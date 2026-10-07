-- 20261016: Archive for finished records, and exact bid steps.
-- Run in the Supabase SQL Editor AFTER 20261015_report_lifecycle_and_guard_handover.sql. Additive and safe to re-run; no rows are deleted.
--
-- 1. archived_at / archived_by on missing_items, found_items, claims and auctions. Archiving hides a FINISHED record from the admin working
--    lists (it moves to the page's Archived tab) and keeps everything. It is not the recycle bin: nothing is removed.
-- 2. auction_place_bid now enforces exact bid steps. With a starting bid of 100 and an increment of 100 the valid bids are 100, 200, 300 and
--    so on; 150 is refused ("bid_not_on_step") with the next valid amount. The Buy Now price is always allowed.

BEGIN;

DO $$
BEGIN
    IF to_regclass('public.auctions') IS NULL OR to_regclass('public.claims') IS NULL OR to_regclass('public.found_items') IS NULL OR to_regclass('public.missing_items') IS NULL THEN
        RAISE EXCEPTION 'A required table is missing. Run the earlier migrations first.';
    END IF;
END $$;

-- ------------------------------------------------------------------------------------------------ 1. archive
ALTER TABLE public.missing_items ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP WITH TIME ZONE, ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL;
ALTER TABLE public.found_items   ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP WITH TIME ZONE, ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL;
ALTER TABLE public.claims        ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP WITH TIME ZONE, ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL;
ALTER TABLE public.auctions      ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP WITH TIME ZONE, ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_missing_items_archived ON public.missing_items (archived_at) WHERE archived_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_found_items_archived   ON public.found_items   (archived_at) WHERE archived_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_claims_archived        ON public.claims        (archived_at) WHERE archived_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_auctions_archived      ON public.auctions      (archived_at) WHERE archived_at IS NOT NULL;

-- ------------------------------------------------------------------------------------------------ 2. exact bid steps
CREATE OR REPLACE FUNCTION public.auction_place_bid(
    p_auction_id UUID,
    p_bidder_id UUID,
    p_amount NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    a public.auctions%ROWTYPE;
    bidder_active BOOLEAN;
    item_status TEXT;
    v_amount NUMERIC(12, 2);
    min_bid NUMERIC(12, 2);
    remaining_seconds NUMERIC;
    extended BOOLEAN := false;
    is_buyout BOOLEAN := false;
    new_ends_at TIMESTAMP WITH TIME ZONE;
    new_extension_count INTEGER;
    previous_bidder UUID;
    previous_price NUMERIC(12, 2);
    new_bid_id UUID;
BEGIN
    IF coalesce(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Service role required';
    END IF;

    SELECT is_active INTO bidder_active FROM public.user_profiles WHERE account_id = p_bidder_id;
    IF NOT FOUND OR coalesce(bidder_active, false) = false THEN
        RETURN jsonb_build_object('ok', false, 'error', 'account_inactive');
    END IF;

    SELECT * INTO a FROM public.auctions WHERE auction_id = p_auction_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'not_found');
    END IF;

    IF a.status NOT IN ('scheduled', 'active') OR now() >= a.ends_at THEN
        RETURN jsonb_build_object('ok', false, 'error', 'auction_closed');
    END IF;
    IF now() < a.starts_at THEN
        RETURN jsonb_build_object('ok', false, 'error', 'not_started');
    END IF;

    IF a.found_item_id IS NOT NULL THEN
        SELECT status INTO item_status FROM public.found_items WHERE item_id = a.found_item_id;
        IF coalesce(item_status, '') <> 'unclaimed' THEN
            RETURN jsonb_build_object('ok', false, 'error', 'item_unavailable');
        END IF;
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
    END IF;
    IF p_amount > 10000000 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'bid_too_high');
    END IF;
    v_amount := round(p_amount, 2);

    is_buyout := a.buyout_price IS NOT NULL AND v_amount >= a.buyout_price;
    IF is_buyout THEN
        v_amount := a.buyout_price;  -- the winner pays the Buy Now price even if they typed a higher number
    END IF;

    -- The current leader cannot out-bid themselves, but they may still buy the item out.
    IF a.highest_bidder_id = p_bidder_id AND NOT is_buyout THEN
        RETURN jsonb_build_object('ok', false, 'error', 'already_highest');
    END IF;

    -- Bids sit on a ladder: the starting bid plus whole increments (start 100, step 100 means 100, 200, 300; never 150).
    -- The minimum is the first rung at or above "current price + increment", so old off-ladder bids cannot trap the auction.
    min_bid := CASE WHEN a.bid_count = 0 THEN a.starting_price ELSE a.current_price + a.bid_increment END;
    IF a.bid_increment > 0 AND min_bid > a.starting_price THEN
        min_bid := a.starting_price + ceil((min_bid - a.starting_price) / a.bid_increment) * a.bid_increment;
    END IF;
    IF NOT is_buyout AND v_amount < min_bid THEN
        RETURN jsonb_build_object('ok', false, 'error', 'bid_too_low', 'min_bid', min_bid);
    END IF;
    IF NOT is_buyout AND a.bid_increment > 0 AND mod(v_amount - a.starting_price, a.bid_increment) <> 0 THEN
        RETURN jsonb_build_object(
            'ok', false, 'error', 'bid_not_on_step', 'min_bid', min_bid, 'step', a.bid_increment,
            'suggested', a.starting_price + ceil((v_amount - a.starting_price) / a.bid_increment) * a.bid_increment
        );
    END IF;

    previous_bidder := a.highest_bidder_id;
    previous_price := a.current_price;

    INSERT INTO public.auction_bids (auction_id, bidder_account_id, amount)
    VALUES (a.auction_id, p_bidder_id, v_amount)
    RETURNING bid_id INTO new_bid_id;

    IF is_buyout THEN
        UPDATE public.auctions
        SET current_price = v_amount,
            bid_count = bid_count + 1,
            highest_bidder_id = p_bidder_id,
            winner_account_id = p_bidder_id,
            winning_amount = v_amount,
            bought_out = true,
            ends_at = GREATEST(now(), starts_at + interval '1 second'),
            ended_at = now(),
            leader_notified_at = now(),   -- the buyer gets their own "you bought it" notice, not the generic bidding-closed one
            status = 'awaiting_admin',
            updated_at = now()
        WHERE auction_id = a.auction_id
        RETURNING * INTO a;

        RETURN jsonb_build_object(
            'ok', true,
            'bid_id', new_bid_id,
            'extended', false,
            'bought_out', true,
            'previous_bidder_id', previous_bidder,
            'previous_price', previous_price,
            'auction', to_jsonb(a)
        );
    END IF;

    -- Anti-snipe: a bid inside the closing window pushes the end time out, up to max_extensions times.
    new_ends_at := a.ends_at;
    new_extension_count := a.extension_count;
    remaining_seconds := EXTRACT(EPOCH FROM (a.ends_at - now()));
    IF a.anti_snipe_enabled
       AND remaining_seconds <= a.anti_snipe_window_seconds
       AND a.extension_count < a.max_extensions THEN
        new_ends_at := a.ends_at + make_interval(secs => a.anti_snipe_extension_seconds);
        new_extension_count := a.extension_count + 1;
        extended := true;
    END IF;

    UPDATE public.auctions
    SET current_price = v_amount,
        bid_count = bid_count + 1,
        highest_bidder_id = p_bidder_id,
        ends_at = new_ends_at,
        extension_count = new_extension_count,
        status = 'active',
        updated_at = now()
    WHERE auction_id = a.auction_id
    RETURNING * INTO a;

    RETURN jsonb_build_object(
        'ok', true,
        'bid_id', new_bid_id,
        'extended', extended,
        'bought_out', false,
        'previous_bidder_id', previous_bidder,
        'previous_price', previous_price,
        'auction', to_jsonb(a)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.auction_place_bid(UUID, UUID, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auction_place_bid(UUID, UUID, NUMERIC) TO service_role;

COMMIT;

-- Verify after running:
--   SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'archived_at'
--     AND table_name IN ('missing_items', 'found_items', 'claims', 'auctions');                                       -- 4 rows
--   SELECT pg_get_functiondef('public.auction_place_bid(uuid,uuid,numeric)'::regprocedure) LIKE '%bid_not_on_step%';   -- true
--
-- Rollback (only if needed): drop the archived_* columns, then re-run the auction_place_bid block of 20261009_tag_expiry_and_auction_buyout.sql.
