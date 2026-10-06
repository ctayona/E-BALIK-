-- 20261009: Smart Tag expiry, tag types and batch controls; auction Buy Now (buyout) price.
-- Run in the Supabase SQL Editor AFTER 20261008_smart_tags.sql (and 20261005 to 20261007). Additive and safe to re-run.
-- It adds columns and replaces one function. It deletes nothing and rewrites no existing row, except that it gives
-- tags that already exist a batch_id (one per batch label) so a whole batch can be deactivated at once.

BEGIN;

DO $$
BEGIN
    IF to_regclass('public.smart_tags') IS NULL THEN
        RAISE EXCEPTION 'public.smart_tags does not exist. Run 20261008_smart_tags.sql first.';
    END IF;
    IF to_regclass('public.auctions') IS NULL THEN
        RAISE EXCEPTION 'public.auctions does not exist. Run 20261005_auction_hall.sql first.';
    END IF;
END $$;

-- ---------------------------------------------------------------------------------------------- Smart Tags
ALTER TABLE public.smart_tags
    ADD COLUMN IF NOT EXISTS tag_type VARCHAR(10) NOT NULL DEFAULT 'qr',
    ADD COLUMN IF NOT EXISTS validity_months INTEGER,          -- how long a tag stays valid once its owner registers it (NULL = never expires)
    ADD COLUMN IF NOT EXISTS valid_until TIMESTAMPTZ,          -- set at registration: claimed_at + validity_months
    ADD COLUMN IF NOT EXISTS batch_id UUID,                    -- every tag of one "Generate batch" run shares this id
    ADD COLUMN IF NOT EXISTS scan_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_scanned_at TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'smart_tags_tag_type_check') THEN
        ALTER TABLE public.smart_tags ADD CONSTRAINT smart_tags_tag_type_check CHECK (tag_type IN ('qr', 'rfid', 'nfc'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'smart_tags_validity_months_check') THEN
        ALTER TABLE public.smart_tags ADD CONSTRAINT smart_tags_validity_months_check CHECK (validity_months IS NULL OR validity_months BETWEEN 1 AND 120);
    END IF;
END $$;

-- 'expired' joins blank / active / lost. A tag past valid_until is switched to it the first time anyone looks at it.
ALTER TABLE public.smart_tags DROP CONSTRAINT IF EXISTS smart_tags_status_check;
ALTER TABLE public.smart_tags ADD CONSTRAINT smart_tags_status_check CHECK (status IN ('blank', 'active', 'lost', 'expired'));

-- Existing tags: group them into one batch per label so batch tools work for them too.
WITH labels AS (
    SELECT batch_label, gen_random_uuid() AS new_id
      FROM (SELECT DISTINCT batch_label FROM public.smart_tags WHERE batch_id IS NULL) d
)
UPDATE public.smart_tags t
   SET batch_id = l.new_id
  FROM labels l
 WHERE t.batch_id IS NULL AND t.batch_label IS NOT DISTINCT FROM l.batch_label;

CREATE INDEX IF NOT EXISTS idx_smart_tags_batch_id ON public.smart_tags(batch_id);
CREATE INDEX IF NOT EXISTS idx_smart_tags_valid_until ON public.smart_tags(valid_until) WHERE status IN ('active', 'lost');

-- ---------------------------------------------------------------------------------------------- Auction buyout
ALTER TABLE public.auctions
    ADD COLUMN IF NOT EXISTS buyout_price NUMERIC(12, 2),      -- "Buy Now" price (NULL = no buyout)
    ADD COLUMN IF NOT EXISTS bought_out BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auctions_buyout_price_check') THEN
        ALTER TABLE public.auctions ADD CONSTRAINT auctions_buyout_price_check
            CHECK (buyout_price IS NULL OR (buyout_price > 0 AND buyout_price > starting_price));
    END IF;
END $$;

-- A bid at or above the buyout price ends the auction on the spot: the bidder wins at the buyout price (never more),
-- and the auction moves to awaiting_admin so an administrator confirms pickup. Everything else is unchanged from 20261005.
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

    min_bid := CASE WHEN a.bid_count = 0 THEN a.starting_price ELSE a.current_price + a.bid_increment END;
    IF NOT is_buyout AND v_amount < min_bid THEN
        RETURN jsonb_build_object('ok', false, 'error', 'bid_too_low', 'min_bid', min_bid);
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

-- Verify:
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'smart_tags' AND column_name IN ('tag_type','validity_months','valid_until','batch_id','scan_count','last_scanned_at');
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'auctions' AND column_name IN ('buyout_price','bought_out');
--   SELECT pg_get_functiondef('public.auction_place_bid(uuid,uuid,numeric)'::regprocedure) LIKE '%is_buyout%';
