-- Auction Hall: auctions for found items left unclaimed after a month in custody.
-- Run in the Supabase SQL Editor (the backend uses the service key; there is no migration runner).
-- Additive and idempotent: creates three new tables, three functions and indexes. It does not alter or
-- delete any existing table, column, policy or row. Safe to rerun.
--
-- Foreign keys are chosen so existing flows keep working:
--   * auctions.found_item_id        -> found_items   ON DELETE SET NULL  (deleting an item never fails; bid history survives)
--   * *_account_id to user_profiles -> ON DELETE SET NULL / CASCADE      (the super-admin "delete user" RPC is not blocked)

BEGIN;

-- ---------------------------------------------------------------------------
-- auctions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.auctions (
    auction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    found_item_id UUID REFERENCES public.found_items(item_id) ON DELETE SET NULL,
    -- Snapshot of the item so the public feed never reads private found_items columns.
    item_reference VARCHAR(20),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(100),
    found_location VARCHAR(255),
    image_url TEXT,
    gallery_urls TEXT[] NOT NULL DEFAULT '{}',
    -- Pricing (Philippine peso)
    starting_price NUMERIC(12, 2) NOT NULL CHECK (starting_price > 0),
    bid_increment NUMERIC(12, 2) NOT NULL DEFAULT 50 CHECK (bid_increment > 0),
    current_price NUMERIC(12, 2) NOT NULL CHECK (current_price > 0),
    bid_count INTEGER NOT NULL DEFAULT 0 CHECK (bid_count >= 0),
    highest_bidder_id UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
    -- Timer and anti-snipe rules
    starts_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    ends_at TIMESTAMP WITH TIME ZONE NOT NULL,
    original_ends_at TIMESTAMP WITH TIME ZONE NOT NULL,
    anti_snipe_enabled BOOLEAN NOT NULL DEFAULT true,
    anti_snipe_window_seconds INTEGER NOT NULL DEFAULT 300 CHECK (anti_snipe_window_seconds BETWEEN 30 AND 3600),
    anti_snipe_extension_seconds INTEGER NOT NULL DEFAULT 300 CHECK (anti_snipe_extension_seconds BETWEEN 30 AND 3600),
    max_extensions INTEGER NOT NULL DEFAULT 10 CHECK (max_extensions BETWEEN 0 AND 50),
    extension_count INTEGER NOT NULL DEFAULT 0 CHECK (extension_count >= 0),
    -- Lifecycle
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('scheduled', 'active', 'ended', 'cancelled')),
    winner_account_id UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
    winning_amount NUMERIC(12, 2),
    ended_at TIMESTAMP WITH TIME ZONE,
    cancelled_at TIMESTAMP WITH TIME ZONE,
    cancel_reason TEXT,
    fulfillment_status VARCHAR(20) CHECK (fulfillment_status IN ('awaiting_pickup', 'collected', 'forfeited')),
    fulfillment_updated_at TIMESTAMP WITH TIME ZONE,
    winner_notified_at TIMESTAMP WITH TIME ZONE,
    winner_email_mode VARCHAR(20),
    created_by UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    CONSTRAINT auctions_ends_after_start CHECK (ends_at > starts_at)
);

-- One live (scheduled or active) auction per found item.
CREATE UNIQUE INDEX IF NOT EXISTS uq_auctions_one_live_per_item
    ON public.auctions (found_item_id)
    WHERE found_item_id IS NOT NULL AND status IN ('scheduled', 'active');
CREATE INDEX IF NOT EXISTS idx_auctions_status_ends_at ON public.auctions (status, ends_at);
CREATE INDEX IF NOT EXISTS idx_auctions_found_item_id ON public.auctions (found_item_id);
CREATE INDEX IF NOT EXISTS idx_auctions_created_at ON public.auctions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auctions_highest_bidder ON public.auctions (highest_bidder_id) WHERE highest_bidder_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- auction_bids
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.auction_bids (
    bid_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auction_id UUID NOT NULL REFERENCES public.auctions(auction_id) ON DELETE CASCADE,
    bidder_account_id UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auction_bids_auction_amount ON public.auction_bids (auction_id, amount DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_auction_bids_bidder ON public.auction_bids (bidder_account_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- auction_comments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.auction_comments (
    comment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auction_id UUID NOT NULL REFERENCES public.auctions(auction_id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES public.user_profiles(account_id) ON DELETE CASCADE,
    body TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 500),
    is_hidden BOOLEAN NOT NULL DEFAULT false,
    hidden_by UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
    hidden_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auction_comments_auction ON public.auction_comments (auction_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auction_comments_account ON public.auction_comments (account_id);

-- Row level security: only the backend (service role, which bypasses RLS) reads or writes these tables.
ALTER TABLE public.auctions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auction_bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auction_comments ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- auction_place_bid: atomic bid validation, price update and anti-snipe extension.
-- Returns JSONB: {"ok": true, ...} or {"ok": false, "error": "<code>"} (never raises for business rules).
-- ---------------------------------------------------------------------------
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

    IF a.highest_bidder_id = p_bidder_id THEN
        RETURN jsonb_build_object('ok', false, 'error', 'already_highest');
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
    END IF;
    IF p_amount > 10000000 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'bid_too_high');
    END IF;
    v_amount := round(p_amount, 2);

    min_bid := CASE WHEN a.bid_count = 0 THEN a.starting_price ELSE a.current_price + a.bid_increment END;
    IF v_amount < min_bid THEN
        RETURN jsonb_build_object('ok', false, 'error', 'bid_too_low', 'min_bid', min_bid);
    END IF;

    previous_bidder := a.highest_bidder_id;
    previous_price := a.current_price;

    INSERT INTO public.auction_bids (auction_id, bidder_account_id, amount)
    VALUES (a.auction_id, p_bidder_id, v_amount)
    RETURNING bid_id INTO new_bid_id;

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
        'previous_bidder_id', previous_bidder,
        'previous_price', previous_price,
        'auction', to_jsonb(a)
    );
END;
$$;

-- ---------------------------------------------------------------------------
-- auction_settle_due: starts scheduled auctions, closes finished ones and awards the winner.
-- Idempotent; each finished auction is returned exactly once (the caller sends the winner notice then).
-- An auction is cancelled instead of awarded when the item is no longer unclaimed or an ownership claim is open,
-- so a real owner always takes priority over a sale.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auction_settle_due()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
            SET status = 'ended', ended_at = now(), updated_at = now(),
                winner_account_id = top_bid.bidder_account_id,
                winning_amount = top_bid.amount,
                fulfillment_status = CASE WHEN top_bid.bidder_account_id IS NULL THEN NULL ELSE 'awaiting_pickup' END,
                fulfillment_updated_at = now()
            WHERE auction_id = a.auction_id RETURNING * INTO a;

            IF a.found_item_id IS NOT NULL THEN
                UPDATE public.found_items
                SET status = 'auctioned', custody_status = 'auctioned', updated_at = now()
                WHERE item_id = a.found_item_id;
            END IF;
        END IF;

        results := results || jsonb_build_array(to_jsonb(a));
    END LOOP;

    RETURN results;
END;
$$;

REVOKE ALL ON FUNCTION public.auction_place_bid(UUID, UUID, NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.auction_settle_due() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auction_place_bid(UUID, UUID, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.auction_settle_due() TO service_role;

COMMIT;

-- Verify after running:
--   SELECT to_regclass('public.auctions'), to_regclass('public.auction_bids'), to_regclass('public.auction_comments');
--   SELECT proname FROM pg_proc WHERE proname IN ('auction_place_bid', 'auction_settle_due');
