ALTER TABLE public.releases
    DROP CONSTRAINT releases_version_format_check,
    DROP CONSTRAINT releases_type_version_shape_check;

ALTER TABLE public.releases
    ADD CONSTRAINT releases_version_format_check CHECK (
        version ~ '^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$'
    ),
    ADD CONSTRAINT releases_type_version_shape_check CHECK (
        release_type = CASE
            WHEN version_patch > 0 THEN 'patch'::public.release_type
            WHEN version_minor > 0 THEN 'minor'::public.release_type
            ELSE 'major'::public.release_type
        END
    );

ALTER TABLE public.releases
    DROP CONSTRAINT releases_visibility_state_check;

ALTER TABLE public.releases
    ADD CONSTRAINT releases_visibility_state_check CHECK (
        visibility = 'private'
        OR (
            visibility = 'public_preview'
            AND lifecycle_status IN ('planned', 'in_progress')
            AND release_type IN ('major', 'minor')
            AND public_summary IS NOT NULL
            AND char_length(btrim(public_summary)) > 0
        )
        OR (
            visibility = 'published'
            AND lifecycle_status = 'released'
            AND released_at IS NOT NULL
            AND public_summary IS NOT NULL
            AND char_length(btrim(public_summary)) > 0
        )
    );
