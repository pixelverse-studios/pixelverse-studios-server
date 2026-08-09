\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (id,email) VALUES
('b1000000-0000-4000-8000-000000000001','editor@example.com'),
('b1000000-0000-4000-8000-000000000002','admin@example.com');
INSERT INTO public.dashboard_user_roles(user_id,role) VALUES
('b1000000-0000-4000-8000-000000000001','editor'),
('b1000000-0000-4000-8000-000000000002','admin');

CREATE OR REPLACE FUNCTION pg_temp.dev1042_fail_outbox()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF current_setting('dev1042.fail_outbox',true)='on' THEN RAISE EXCEPTION 'DEV1042_TEST_OUTBOX_FAILURE'; END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER dev1042_test_outbox_failure
BEFORE INSERT ON public.release_cache_invalidation_jobs
FOR EACH ROW EXECUTE FUNCTION pg_temp.dev1042_fail_outbox();

DO $$
DECLARE
    editor_id constant uuid := 'b1000000-0000-4000-8000-000000000001';
    admin_id constant uuid := 'b1000000-0000-4000-8000-000000000002';
    v_release_id uuid;
    note_id uuid;
    note2_id uuid;
    result jsonb;
    audit_before integer;
    claimed_job uuid;
    claimed_attempt integer;
    approval_release_id uuid;
    approval_source_id uuid;
    approval_run_id uuid;
    approval_note_id uuid;
    cancel_release_id uuid;
BEGIN
    result := public.mutate_admin_domani_release(
        'release.create',NULL,NULL,
        '{"version":"1.2","slug":"calm-planning","title":"Calm planning","releaseType":"minor","publicSummary":"A calmer planning experience."}',
        editor_id,'editor@example.com','editor','req-create');
    v_release_id := (result#>>'{data,release,id}')::uuid;
    IF result#>>'{data,release,lifecycleStatus}' <> 'draft' OR result#>>'{data,release,visibility}' <> 'private' OR (result->>'releaseRowVersion')::int <> 1 THEN
        RAISE EXCEPTION 'create contract failed: %', result;
    END IF;

    result := public.mutate_admin_domani_release(
        'note.create',v_release_id,1,
        '{"noteType":"feature","publicTitle":"Guided plan","publicBody":"A **safe** body with [help](https://example.com).","platforms":["ios","android"],"isPublic":true}',
        editor_id,'editor@example.com','editor','req-note-create');
    note_id := (result#>>'{data,note,id}')::uuid;
    IF (result->>'releaseRowVersion')::int <> 2 OR (result->>'primaryRowVersion')::int <> 1 THEN RAISE EXCEPTION 'note create versions failed'; END IF;

    result := public.mutate_admin_domani_release(
        'release.update',v_release_id,2,'{"lifecycleStatus":"planned"}',
        editor_id,'editor@example.com','editor','req-plan');
    IF result#>>'{data,release,lifecycleStatus}' <> 'planned' OR (result->>'releaseRowVersion')::int <> 3 THEN RAISE EXCEPTION 'release update failed'; END IF;

    result := public.mutate_admin_domani_release(
        'release.publish_preview',v_release_id,3,'{}',
        editor_id,'editor@example.com','editor','req-preview');
    IF result#>>'{data,release,visibility}' <> 'public_preview' OR result#>>'{cacheInvalidation,status}' <> 'pending' THEN RAISE EXCEPTION 'preview/outbox failed: %',result; END IF;

    result := public.mutate_admin_domani_release(
        'release.return_private',v_release_id,4,'{}',
        editor_id,'editor@example.com','editor','req-return-private');
    IF result#>>'{data,release,visibility}' <> 'private' OR (result->>'releaseRowVersion')::int <> 5 THEN RAISE EXCEPTION 'return-to-private failed'; END IF;
    result := public.mutate_admin_domani_release(
        'release.update',v_release_id,5,'{"lifecycleStatus":"in_progress"}',
        editor_id,'editor@example.com','editor','req-in-progress');
    result := public.mutate_admin_domani_release(
        'release.update',v_release_id,6,'{"lifecycleStatus":"released","releasedAt":"2026-08-09T16:00:00.000Z"}',
        editor_id,'editor@example.com','editor','req-released-private');

    result := public.mutate_admin_domani_release(
        'release.publish',v_release_id,7,'{}',
        admin_id,'admin@example.com','admin','req-publish');
    IF result#>>'{data,release,lifecycleStatus}' <> 'released' OR result#>>'{data,release,visibility}' <> 'published' THEN RAISE EXCEPTION 'publish failed'; END IF;
    IF jsonb_array_length(result#>'{cacheInvalidation,targets}') <> 2 THEN RAISE EXCEPTION 'publish must invalidate changelog targets'; END IF;

    BEGIN
        PERFORM public.mutate_admin_domani_release(
            'note.update',v_release_id,1,jsonb_build_object('noteId',note_id,'releaseRowVersion',8,'publicTitle','Editor bypass'),
            editor_id,'editor@example.com','editor','req-editor-denied');
        RAISE EXCEPTION 'published editor mutation unexpectedly succeeded';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'DEV1042_PUBLISHED_ADMIN_REQUIRED' THEN RAISE; END IF;
    END;

    result := public.mutate_admin_domani_release(
        'note.update',v_release_id,1,jsonb_build_object('noteId',note_id,'releaseRowVersion',8,'publicTitle','Admin reviewed'),
        admin_id,'admin@example.com','admin','req-admin-note');
    IF result#>>'{data,note,publicTitle}' <> 'Admin reviewed' OR (result->>'releaseRowVersion')::int <> 9 THEN RAISE EXCEPTION 'admin published edit failed'; END IF;

    audit_before := (SELECT count(*) FROM public.release_audit_events e WHERE e.release_id=v_release_id);
    PERFORM set_config('dev1042.fail_outbox','on',true);
    BEGIN
        PERFORM public.mutate_admin_domani_release('note.create',v_release_id,9,'{"noteType":"fix","publicTitle":"Must roll back","publicBody":"Outbox failure","platforms":["ios"],"isPublic":true}',admin_id,'admin@example.com','admin','req-outbox-failure');
        RAISE EXCEPTION 'outbox failure mutation unexpectedly succeeded';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'DEV1042_TEST_OUTBOX_FAILURE' THEN RAISE; END IF;
    END;
    PERFORM set_config('dev1042.fail_outbox','off',true);
    IF (SELECT row_version FROM public.releases WHERE id=v_release_id)<>9 OR (SELECT count(*) FROM public.release_notes WHERE release_id=v_release_id)<>1 OR (SELECT count(*) FROM public.release_audit_events e WHERE e.release_id=v_release_id)<>audit_before THEN RAISE EXCEPTION 'outbox failure did not roll back business and audit writes'; END IF;

    BEGIN
        PERFORM public.mutate_admin_domani_release('release.update',v_release_id,9,'{"lifecycleStatus":"planned"}',admin_id,'admin@example.com','admin','req-invalid-transition');
        RAISE EXCEPTION 'invalid lifecycle transition unexpectedly succeeded';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'DEV1042_INVALID_STATE' THEN RAISE; END IF;
    END;

    audit_before := (SELECT count(*) FROM public.release_audit_events e WHERE e.release_id=v_release_id);
    BEGIN
        PERFORM public.mutate_admin_domani_release(
            'note.update',v_release_id,2,jsonb_build_object('noteId',note_id,'releaseRowVersion',9,'isPublic',false),
            admin_id,'admin@example.com','admin','req-remove-last-public');
        RAISE EXCEPTION 'last public note removal unexpectedly succeeded';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'DEV1042_PUBLIC_NOTE_REQUIRED' THEN RAISE; END IF;
    END;
    IF (SELECT row_version FROM public.release_notes WHERE id=note_id)<>2 OR (SELECT count(*) FROM public.release_audit_events e WHERE e.release_id=v_release_id)<>audit_before THEN RAISE EXCEPTION 'public-note invariant did not roll back'; END IF;

    SELECT count(*) INTO audit_before FROM public.release_audit_events e WHERE e.release_id=v_release_id;
    BEGIN
        PERFORM public.mutate_admin_domani_release(
            'release.update',v_release_id,8,'{"title":"Stale write"}',
            admin_id,'admin@example.com','admin','req-stale');
        RAISE EXCEPTION 'stale mutation unexpectedly succeeded';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'DEV1042_VERSION_CONFLICT' THEN RAISE; END IF;
    END;
    IF (SELECT row_version FROM public.releases WHERE id=v_release_id) <> 9 OR (SELECT count(*) FROM public.release_audit_events e WHERE e.release_id=v_release_id) <> audit_before THEN
        RAISE EXCEPTION 'stale mutation did not roll back fully';
    END IF;

    result := public.mutate_admin_domani_release(
        'note.create',v_release_id,9,
        '{"noteType":"fix","publicTitle":"Recovery","publicBody":"Restores the plan.","platforms":["ios"],"isPublic":true}',
        admin_id,'admin@example.com','admin','req-note2');
    note2_id := (result#>>'{data,note,id}')::uuid;
    result := public.mutate_admin_domani_release(
        'note.reorder',v_release_id,10,
        jsonb_build_object('notes',jsonb_build_array(jsonb_build_object('id',note2_id,'rowVersion',1),jsonb_build_object('id',note_id,'rowVersion',2))),
        admin_id,'admin@example.com','admin','req-reorder');
    IF result#>>'{data,notes,0,id}' <> note2_id::text OR (result#>>'{data,notes,1,rowVersion}')::int <> 3 OR (result->>'releaseRowVersion')::int <> 11 THEN
        RAISE EXCEPTION 'atomic reorder failed: %',result;
    END IF;

    audit_before := (SELECT count(*) FROM public.release_audit_events e WHERE e.release_id=v_release_id);
    BEGIN
        PERFORM public.mutate_admin_domani_release(
            'note.reorder',v_release_id,11,
            jsonb_build_object('notes',jsonb_build_array(jsonb_build_object('id',note_id,'rowVersion',3),jsonb_build_object('id',note_id,'rowVersion',3))),
            admin_id,'admin@example.com','admin','req-bad-reorder');
        RAISE EXCEPTION 'invalid reorder unexpectedly succeeded';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'DEV1042_NOTE_SET_INVALID' THEN RAISE; END IF;
    END;
    IF (SELECT count(*) FROM public.release_audit_events e WHERE e.release_id=v_release_id) <> audit_before THEN RAISE EXCEPTION 'invalid reorder wrote audit'; END IF;

    result := public.get_admin_domani_release(v_release_id,false,'editor');
    IF result->'allowedActions' <> '[]'::jsonb THEN RAISE EXCEPTION 'editor received published actions: %',result->'allowedActions'; END IF;
    result := public.get_admin_domani_release(v_release_id,false,'admin');
    IF NOT result->'allowedActions' ? 'unpublish' THEN RAISE EXCEPTION 'admin missing unpublish action'; END IF;

    result := public.list_admin_domani_releases('{"lifecycle":null,"visibility":null,"releaseType":null,"platform":"android","version":null,"archived":false}',20,NULL);
    IF jsonb_array_length(result->'releases') <> 1 THEN RAISE EXCEPTION 'platform list filter failed'; END IF;
    result := public.list_admin_domani_release_audit(v_release_id,'{"action":"note.reordered","entityType":"release"}',20,NULL);
    IF jsonb_array_length(result->'events') <> 1 OR result#>>'{events,0,action}' <> 'note.reordered' THEN RAISE EXCEPTION 'audit filter failed'; END IF;
    IF EXISTS (SELECT 1 FROM public.release_audit_events e WHERE e.release_id=v_release_id AND (before_data ? 'rawMarkdown' OR after_data ? 'rawMarkdown')) THEN RAISE EXCEPTION 'audit leaked raw markdown'; END IF;
    IF (SELECT count(*) FROM public.release_cache_invalidation_jobs j WHERE j.release_id=v_release_id) < 4 THEN RAISE EXCEPTION 'expected durable invalidation jobs'; END IF;
    SELECT c.id,c.attempt_count INTO claimed_job,claimed_attempt FROM public.claim_release_cache_invalidation_jobs(1) c;
    IF claimed_job IS NULL OR claimed_attempt <> 1 THEN RAISE EXCEPTION 'dispatcher claim failed'; END IF;
    PERFORM public.fail_release_cache_invalidation_job(claimed_job,'receiver unavailable');
    IF NOT EXISTS (SELECT 1 FROM public.release_cache_invalidation_jobs WHERE id=claimed_job AND status='failed' AND next_attempt_at>now()) THEN RAISE EXCEPTION 'dispatcher retry schedule failed'; END IF;
    UPDATE public.release_cache_invalidation_jobs SET status='pending',next_attempt_at=now() WHERE id=claimed_job;
    PERFORM public.complete_release_cache_invalidation_job(claimed_job);
    IF NOT EXISTS (SELECT 1 FROM public.release_cache_invalidation_jobs WHERE id=claimed_job AND status='delivered' AND delivered_at IS NOT NULL) THEN RAISE EXCEPTION 'dispatcher completion failed'; END IF;

    result:=public.mutate_admin_domani_release('note.archive',v_release_id,2,jsonb_build_object('noteId',note2_id,'releaseRowVersion',11),admin_id,'admin@example.com','admin','req-note-archive');
    IF result#>>'{data,note,archivedAt}' IS NULL OR (result->>'releaseRowVersion')::int<>12 THEN RAISE EXCEPTION 'note archive failed'; END IF;
    result:=public.mutate_admin_domani_release('release.unpublish',v_release_id,12,'{}',admin_id,'admin@example.com','admin','req-unpublish');
    IF result#>>'{data,release,visibility}'<>'private' OR result#>>'{data,release,lifecycleStatus}'<>'released' THEN RAISE EXCEPTION 'unpublish failed'; END IF;
    result:=public.mutate_admin_domani_release('release.publish',v_release_id,13,'{}',admin_id,'admin@example.com','admin','req-republish');
    result:=public.mutate_admin_domani_release('release.archive',v_release_id,14,'{}',admin_id,'admin@example.com','admin','req-archive');
    IF result#>>'{data,release,visibility}'<>'private' OR result#>>'{data,release,archivedAt}' IS NULL THEN RAISE EXCEPTION 'release archive failed'; END IF;
    result:=public.get_admin_domani_release(v_release_id,true,'admin');
    IF (result->>'rowVersion')::int<>15 THEN RAISE EXCEPTION 'archived admin detail failed'; END IF;

    result:=public.mutate_admin_domani_release('release.create',NULL,NULL,'{"version":"3.0","slug":"cancel-release","title":"Cancel release","releaseType":"major"}',editor_id,'editor@example.com','editor','req-cancel-create');
    cancel_release_id:=(result#>>'{data,release,id}')::uuid;
    result:=public.mutate_admin_domani_release('release.update',cancel_release_id,1,'{"lifecycleStatus":"canceled"}',editor_id,'editor@example.com','editor','req-cancel');
    IF result#>>'{data,release,lifecycleStatus}'<>'canceled' THEN RAISE EXCEPTION 'cancel transition failed'; END IF;

    INSERT INTO public.releases(version,slug,title,release_type,created_by,updated_by)
    VALUES('2.0','approval-release','Approval release','major',admin_id,admin_id) RETURNING id INTO approval_release_id;
    INSERT INTO public.release_prds(release_id,raw_markdown,source_type,source_reference,source_content_sha256,intended_surface,created_by,updated_by)
    VALUES(approval_release_id,'## Feature\n\nDraft','manual','approval-source',repeat('a',64),'changelog',admin_id,admin_id) RETURNING id INTO approval_source_id;
    INSERT INTO public.release_conversion_runs(release_id,prd_id,source_content_sha256,converter_version,status,created_by,completed_at)
    VALUES(approval_release_id,approval_source_id,repeat('a',64),'domani-markdown-v1','succeeded',admin_id,now()) RETURNING id INTO approval_run_id;
    UPDATE public.release_prds SET conversion_status='needs_review',latest_conversion_run_id=approval_run_id WHERE id=approval_source_id;
    INSERT INTO public.release_notes(release_id,note_type,public_title,public_body,platforms,sort_order,source_prd_id,source_conversion_run_id,created_by,updated_by)
    VALUES(approval_release_id,'feature','Approval draft','Review me',ARRAY['ios']::public.release_platform[],0,approval_source_id,approval_run_id,admin_id,admin_id) RETURNING id INTO approval_note_id;
    result:=public.mutate_admin_domani_release('source.approve',approval_release_id,1,jsonb_build_object('sourceId',approval_source_id,'releaseRowVersion',1,'noteRowVersions',jsonb_build_array(jsonb_build_object('id',approval_note_id,'rowVersion',1))),editor_id,'editor@example.com','editor','req-approve');
    IF result#>>'{data,source,conversionStatus}'<>'approved' OR (result->>'releaseRowVersion')::int<>2 THEN RAISE EXCEPTION 'source approval failed'; END IF;
    IF EXISTS(SELECT 1 FROM public.release_audit_events WHERE release_id=approval_release_id AND (before_data?'rawMarkdown' OR after_data?'rawMarkdown')) THEN RAISE EXCEPTION 'source approval audit leaked raw markdown'; END IF;
END
$$;

ROLLBACK;
