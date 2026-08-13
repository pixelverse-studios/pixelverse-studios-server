\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
    v_actor uuid := 'a1000000-0000-4000-8000-000000000001';
    v_release_id uuid;
    v_row_version bigint;
    v_result jsonb;
    v_overview jsonb := '{
      "type":"doc",
      "content":[
        {"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"What changed"}]},
        {"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Clearer mornings","marks":[{"type":"bold"}]}]}]}]}
      ]
    }'::jsonb;
BEGIN
    IF NOT public.release_overview_is_valid(v_overview) THEN
        RAISE EXCEPTION 'valid overview was rejected';
    END IF;
    IF public.release_overview_is_valid('{"type":"doc","content":[{"type":"image","attrs":{"src":"https://example.com/a.png"}}]}'::jsonb) THEN
        RAISE EXCEPTION 'media overview was accepted';
    END IF;

    v_result := public.mutate_admin_domani_release_v2(
        'release.create', NULL, NULL,
        jsonb_build_object(
            'version','1.2.1','slug','client-value-is-ignored','title','Fix morning focus',
            'releaseType','patch','publicOverview',v_overview,
            'publicSummary',public.release_overview_text(v_overview),
            'targetDate',(CURRENT_DATE + 1)::text
        ),
        v_actor,'editor@example.com','editor','overview-create'
    );
    v_release_id := (v_result #>> '{data,release,id}')::uuid;
    v_row_version := (v_result #>> '{releaseRowVersion}')::bigint;

    IF (SELECT slug FROM public.releases WHERE id=v_release_id) <> '1-2-1-fix-morning-focus' THEN
        RAISE EXCEPTION 'slug was not derived';
    END IF;
    IF (SELECT public_summary FROM public.releases WHERE id=v_release_id) <> 'What changed Clearer mornings' THEN
        RAISE EXCEPTION 'plain-text summary was not derived';
    END IF;

    v_result := public.mutate_admin_domani_release_v2(
        'release.update',v_release_id,v_row_version,
        '{"title":"A renamed release","lifecycleStatus":"planned"}'::jsonb,
        v_actor,'editor@example.com','editor','overview-update'
    );
    v_row_version := (v_result #>> '{releaseRowVersion}')::bigint;
    IF (SELECT slug FROM public.releases WHERE id=v_release_id) <> '1-2-1-fix-morning-focus' THEN
        RAISE EXCEPTION 'slug changed after creation';
    END IF;

    v_result := public.mutate_admin_domani_release_v2(
        'release.mark_released',v_release_id,v_row_version,
        jsonb_build_object('releasedAt', CURRENT_DATE::text || 'T12:00:00.000Z'),
        v_actor,'editor@example.com','editor','overview-release'
    );
    IF v_result #>> '{data,release,lifecycleStatus}' <> 'released' THEN
        RAISE EXCEPTION 'mark released action failed';
    END IF;

    BEGIN
        INSERT INTO public.releases(version,slug,title,release_type,target_date,created_by,updated_by)
        VALUES('2.0.0','ignored','Past target','major',CURRENT_DATE-1,v_actor,v_actor);
        RAISE EXCEPTION 'past target date was accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM = 'past target date was accepted' THEN RAISE; END IF;
        IF position('DEV1042_TARGET_DATE_PAST' IN SQLERRM) = 0 THEN RAISE; END IF;
    END;
END;
$$;

ROLLBACK;
