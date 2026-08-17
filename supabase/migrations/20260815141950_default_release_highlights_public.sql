-- Manually created release highlights are public unless an editor explicitly opts out.
-- Existing rows and the reviewed markdown-import workflow are intentionally unchanged.
ALTER TABLE public.release_notes
    ALTER COLUMN is_public SET DEFAULT true;
