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
        '{"version":"1.3.0","releaseType":"minor","title":"A renamed release","lifecycleStatus":"planned"}'::jsonb,
        v_actor,'editor@example.com','editor','overview-update'
    );
    v_row_version := (v_result #>> '{releaseRowVersion}')::bigint;
    IF (SELECT version FROM public.releases WHERE id=v_release_id) <> '1.3.0'
       OR (SELECT release_type FROM public.releases WHERE id=v_release_id) <> 'minor' THEN
        RAISE EXCEPTION 'version update did not preserve the derived release type';
    END IF;
    IF (SELECT slug FROM public.releases WHERE id=v_release_id) <> '1-3-0-a-renamed-release' THEN
        RAISE EXCEPTION 'draft slug did not follow the edited identity';
    END IF;

    v_result := public.mutate_admin_domani_release_v2(
        'release.mark_released',v_release_id,v_row_version,
        jsonb_build_object('releasedAt', (CURRENT_DATE - 1)::text || 'T12:00:00.000Z'),
        v_actor,'editor@example.com','editor','overview-release'
    );
    IF v_result #>> '{data,release,lifecycleStatus}' <> 'released' THEN
        RAISE EXCEPTION 'mark released action failed';
    END IF;

    UPDATE public.releases
    SET visibility='published'
    WHERE id=v_release_id;
    UPDATE public.releases
    SET version='1.4.0',release_type='minor',title='Published identity edit'
    WHERE id=v_release_id;
    IF (SELECT slug FROM public.releases WHERE id=v_release_id) <> '1-3-0-a-renamed-release' THEN
        RAISE EXCEPTION 'slug changed after first publication';
    END IF;
    IF (SELECT slug_frozen_at FROM public.releases WHERE id=v_release_id) IS NULL THEN
        RAISE EXCEPTION 'first publication did not freeze the slug';
    END IF;

    BEGIN
        PERFORM public.save_admin_domani_release_editor(
            v_release_id,
            (SELECT row_version FROM public.releases WHERE id=v_release_id),
            jsonb_build_object(
                'highlights',
                jsonb_build_array(
                    jsonb_build_object('id','a1000000-0000-4000-8000-000000000099'),
                    jsonb_build_object('id','a1000000-0000-4000-8000-000000000099')
                )
            ),
            v_actor,
            'editor@example.com',
            'editor',
            'duplicate-highlights'
        );
        RAISE EXCEPTION 'duplicate highlight IDs were accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM = 'duplicate highlight IDs were accepted' THEN RAISE; END IF;
        IF position('DEV1042_NOTE_SET_INVALID' IN SQLERRM) = 0 THEN RAISE; END IF;
    END;

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
