-- READ-ONLY. Run in the Supabase SQL Editor, then download the result as CSV (or copy it).
-- It lists everything the Auction Hall depends on exactly as it exists in your live database: every auction_* function
-- (including auction_finalize), the constraints, the columns and the indexes of the auctions table.
-- It contains no passwords, keys or user data. Used to rebuild the missing "awaiting admin" migration in the repo.

SELECT 'FUNCTION' AS kind, p.proname::text AS name, pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname LIKE 'auction%'
UNION ALL
SELECT 'CONSTRAINT', conname::text, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.auctions'::regclass
UNION ALL
SELECT 'COLUMN', column_name::text,
       data_type || COALESCE(' default ' || column_default, '') || CASE WHEN is_nullable = 'NO' THEN ' not null' ELSE '' END
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'auctions'
UNION ALL
SELECT 'INDEX', indexname::text, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'auctions'
ORDER BY 1, 2;
