CREATE OR REPLACE FUNCTION public.list_public_domani_releases(
    p_collection text,
    p_platform public.release_platform DEFAULT NULL,
    p_page_limit integer DEFAULT 20,
    p_cursor_primary text DEFAULT NULL,
    p_cursor_version_major integer DEFAULT NULL,
    p_cursor_version_minor integer DEFAULT NULL,
    p_cursor_version_patch integer DEFAULT NULL,
    p_cursor_id uuid DEFAULT NULL
)
RETURNS TABLE (
    id uuid,
    version text,
    slug text,
    title text,
    release_type public.release_type,
    lifecycle_status public.release_lifecycle_status,
    public_summary text,
    target_month date,
    target_date date,
    confirmed_date date,
    released_at timestamptz,
    sort_primary text,
    notes jsonb
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
WITH eligible AS (
    SELECT
        release.id,
        release.version,
        release.slug,
        release.title,
        release.release_type,
        release.lifecycle_status,
        release.public_summary,
        release.target_month,
        release.target_date,
        release.confirmed_date,
        release.released_at,
        release.version_major,
        release.version_minor,
        coalesce(release.version_patch, -1) AS version_patch,
        coalesce(
            release.confirmed_date,
            release.target_date,
            release.target_month
        ) AS effective_date
    FROM public.releases AS release
    WHERE release.archived_at IS NULL
      AND (
          (
              p_collection = 'coming-soon'
              AND release.visibility = 'public_preview'
              AND release.lifecycle_status IN ('planned', 'in_progress')
              AND release.release_type IN ('major', 'minor', 'roadmap')
          )
          OR (
              p_collection = 'changelog'
              AND release.visibility = 'published'
              AND release.lifecycle_status = 'released'
              AND release.released_at IS NOT NULL
          )
      )
      AND EXISTS (
          SELECT 1
          FROM public.release_notes AS note
          WHERE note.release_id = release.id
            AND note.is_public = true
            AND note.archived_at IS NULL
            AND (
                p_platform IS NULL
                OR note.platforms @> ARRAY[p_platform]::public.release_platform[]
            )
      )
),
cursor_page AS (
    SELECT eligible.*
    FROM eligible
    WHERE p_cursor_id IS NULL
       OR (
          p_collection = 'coming-soon'
          AND (
              (
                  p_cursor_primary IS NOT NULL
                  AND (
                      eligible.effective_date > p_cursor_primary::date
                      OR eligible.effective_date IS NULL
                      OR (
                          eligible.effective_date = p_cursor_primary::date
                          AND (
                              (eligible.version_major, eligible.version_minor, eligible.version_patch)
                                  > (p_cursor_version_major, p_cursor_version_minor, p_cursor_version_patch)
                              OR (
                                  (eligible.version_major, eligible.version_minor, eligible.version_patch)
                                      = (p_cursor_version_major, p_cursor_version_minor, p_cursor_version_patch)
                                  AND eligible.id > p_cursor_id
                              )
                          )
                      )
                  )
              )
              OR (
                  p_cursor_primary IS NULL
                  AND eligible.effective_date IS NULL
                  AND (
                      (eligible.version_major, eligible.version_minor, eligible.version_patch)
                          > (p_cursor_version_major, p_cursor_version_minor, p_cursor_version_patch)
                      OR (
                          (eligible.version_major, eligible.version_minor, eligible.version_patch)
                              = (p_cursor_version_major, p_cursor_version_minor, p_cursor_version_patch)
                          AND eligible.id > p_cursor_id
                      )
                  )
              )
          )
       )
       OR (
          p_collection = 'changelog'
          AND (
              eligible.released_at < p_cursor_primary::timestamptz
              OR (
                  eligible.released_at = p_cursor_primary::timestamptz
                  AND (
                      (eligible.version_major, eligible.version_minor, eligible.version_patch)
                          < (p_cursor_version_major, p_cursor_version_minor, p_cursor_version_patch)
                      OR (
                          (eligible.version_major, eligible.version_minor, eligible.version_patch)
                              = (p_cursor_version_major, p_cursor_version_minor, p_cursor_version_patch)
                          AND eligible.id > p_cursor_id
                      )
                  )
              )
          )
       )
    ORDER BY
        CASE WHEN p_collection = 'coming-soon' THEN eligible.effective_date END ASC NULLS LAST,
        CASE WHEN p_collection = 'coming-soon' THEN eligible.version_major END ASC,
        CASE WHEN p_collection = 'coming-soon' THEN eligible.version_minor END ASC,
        CASE WHEN p_collection = 'coming-soon' THEN eligible.version_patch END ASC,
        CASE WHEN p_collection = 'changelog' THEN eligible.released_at END DESC,
        CASE WHEN p_collection = 'changelog' THEN eligible.version_major END DESC,
        CASE WHEN p_collection = 'changelog' THEN eligible.version_minor END DESC,
        CASE WHEN p_collection = 'changelog' THEN eligible.version_patch END DESC,
        eligible.id ASC
    LIMIT least(greatest(p_page_limit, 1), 100) + 1
)
SELECT
    page.id,
    page.version,
    page.slug,
    page.title,
    page.release_type,
    page.lifecycle_status,
    page.public_summary,
    page.target_month,
    page.target_date,
    page.confirmed_date,
    page.released_at,
    CASE
        WHEN p_collection = 'changelog' THEN page.released_at::text
        ELSE page.effective_date::text
    END AS sort_primary,
    notes.items
FROM cursor_page AS page
CROSS JOIN LATERAL (
    SELECT jsonb_agg(
        jsonb_build_object(
            'id', ordered_note.id,
            'note_type', ordered_note.note_type,
            'public_title', ordered_note.public_title,
            'public_body', ordered_note.public_body,
            'platforms', ordered_note.platforms,
            'sort_order', ordered_note.sort_order
        )
        ORDER BY ordered_note.sort_order ASC, ordered_note.id ASC
    ) AS items
    FROM public.release_notes AS ordered_note
    WHERE ordered_note.release_id = page.id
      AND ordered_note.is_public = true
      AND ordered_note.archived_at IS NULL
      AND (
          p_platform IS NULL
          OR ordered_note.platforms @> ARRAY[p_platform]::public.release_platform[]
      )
) AS notes
ORDER BY
    CASE WHEN p_collection = 'coming-soon' THEN page.effective_date END ASC NULLS LAST,
    CASE WHEN p_collection = 'coming-soon' THEN page.version_major END ASC,
    CASE WHEN p_collection = 'coming-soon' THEN page.version_minor END ASC,
    CASE WHEN p_collection = 'coming-soon' THEN page.version_patch END ASC,
    CASE WHEN p_collection = 'changelog' THEN page.released_at END DESC,
    CASE WHEN p_collection = 'changelog' THEN page.version_major END DESC,
    CASE WHEN p_collection = 'changelog' THEN page.version_minor END DESC,
    CASE WHEN p_collection = 'changelog' THEN page.version_patch END DESC,
    page.id ASC;
$$;

REVOKE ALL ON FUNCTION public.list_public_domani_releases(
    text,
    public.release_platform,
    integer,
    text,
    integer,
    integer,
    integer,
    uuid
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.list_public_domani_releases(
    text,
    public.release_platform,
    integer,
    text,
    integer,
    integer,
    integer,
    uuid
) TO service_role;

COMMENT ON FUNCTION public.list_public_domani_releases(
    text,
    public.release_platform,
    integer,
    text,
    integer,
    integer,
    integer,
    uuid
) IS 'Service-role-only keyset feed for public Domani release DTOs.';

NOTIFY pgrst, 'reload schema';
