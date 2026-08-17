BEGIN;

DO $$
DECLARE
    actor_id uuid := '42000000-0000-4000-8000-000000000001';
    month_release_id uuid;
    date_release_id uuid;
    result jsonb;
    base_payload jsonb := jsonb_build_object(
        'version','4.1.0',
        'slug','historical-release',
        'releaseType','minor',
        'title','Historical release',
        'status','draft',
        'platforms',jsonb_build_array('ios','android'),
        'publicOverview',jsonb_build_object('type','doc','content',jsonb_build_array(jsonb_build_object('type','paragraph'))),
        'internalSummary',NULL,
        'highlights','[]'::jsonb
    );
BEGIN
    INSERT INTO public.releases(
        version,slug,title,release_type,lifecycle_status,visibility,target_month,
        platforms,created_by,updated_by
    ) VALUES (
        '4.1.0','historical-month','Historical month','minor','draft','private',date_trunc('month',CURRENT_DATE)::date,
        ARRAY['ios','android']::public.release_platform[],actor_id,actor_id
    ) RETURNING id INTO month_release_id;
    ALTER TABLE public.releases DISABLE TRIGGER USER;
    UPDATE public.releases SET target_month='2000-01-01' WHERE id=month_release_id;
    ALTER TABLE public.releases ENABLE TRIGGER USER;

    result := public.save_admin_domani_release_editor(
        month_release_id,1,
        base_payload || jsonb_build_object(
            'title','Historical month edited',
            'timing',jsonb_build_object('kind','month','value','2000-01')
        ),
        actor_id,'admin@example.com','admin','historical-month-same'
    );
    IF result#>>'{data,release,title}' <> 'Historical month edited' THEN
        RAISE EXCEPTION 'unchanged historical month blocked unrelated edit';
    END IF;

    BEGIN
        PERFORM public.save_admin_domani_release_editor(
            month_release_id,2,
            base_payload || jsonb_build_object(
                'title','Invalid month edit',
                'timing',jsonb_build_object('kind','month','value','1999-01')
            ),
            actor_id,'admin@example.com','admin','historical-month-new'
        );
        RAISE EXCEPTION 'new historical month unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'DEV1042_TARGET_MONTH_PAST' THEN RAISE; END IF;
    END;

    INSERT INTO public.releases(
        version,slug,title,release_type,lifecycle_status,visibility,confirmed_date,
        platforms,created_by,updated_by
    ) VALUES (
        '4.1.1','historical-date','Historical date','patch','draft','private',CURRENT_DATE,
        ARRAY['ios','android']::public.release_platform[],actor_id,actor_id
    ) RETURNING id INTO date_release_id;
    ALTER TABLE public.releases DISABLE TRIGGER USER;
    UPDATE public.releases SET confirmed_date='2000-01-15' WHERE id=date_release_id;
    ALTER TABLE public.releases ENABLE TRIGGER USER;

    result := public.save_admin_domani_release_editor(
        date_release_id,1,
        base_payload || jsonb_build_object(
            'version','4.1.1','releaseType','patch','title','Historical date edited',
            'timing',jsonb_build_object('kind','date','value','2000-01-15')
        ),
        actor_id,'admin@example.com','admin','historical-date-same'
    );
    IF result#>>'{data,release,title}' <> 'Historical date edited' THEN
        RAISE EXCEPTION 'unchanged historical date blocked unrelated edit';
    END IF;

    BEGIN
        PERFORM public.save_admin_domani_release_editor(
            date_release_id,2,
            base_payload || jsonb_build_object(
                'version','4.1.1','releaseType','patch','title','Invalid date edit',
                'timing',jsonb_build_object('kind','date','value','1999-01-15')
            ),
            actor_id,'admin@example.com','admin','historical-date-new'
        );
        RAISE EXCEPTION 'new historical date unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'DEV1042_TARGET_DATE_PAST' THEN RAISE; END IF;
    END;
END
$$;

ROLLBACK;
