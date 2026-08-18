\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
    v_website_id uuid;
    v_client_id uuid;
    v_prefix text := 'media-reorder-test-' || txid_current()::text;
    v_first_id bigint;
    v_second_id bigint;
    v_third_id bigint;
    v_fourth_id bigint;
    v_keys text[];
    v_positions integer[];
BEGIN
    SELECT website.id, website.client_id
    INTO v_website_id, v_client_id
    FROM public.websites AS website
    WHERE website.client_id IS NOT NULL
    ORDER BY website.id
    LIMIT 1;

    IF v_website_id IS NULL OR v_client_id IS NULL THEN
        RAISE EXCEPTION 'A website with a client is required for media reorder tests.';
    END IF;

    -- Keep this transaction independent from any seeded portfolio rows. The
    -- outer rollback restores their original status after the assertions.
    UPDATE public.media_catalog_items
    SET status = 'draft'
    WHERE website_id = v_website_id
      AND library = 'portfolio'
      AND status = 'published';

    INSERT INTO public.media_catalog_items (
        website_id, client_id, key, filename, src, alt, library,
        service, sub_category, aspect_ratio, status, sort_order
    ) VALUES (
        v_website_id, v_client_id, v_prefix || '-first.jpg', 'first.jpg',
        'https://example.test/first.jpg', 'First test image', 'portfolio',
        'Events', 'Baby Shower', 'landscape', 'published', 5
    ) RETURNING id INTO v_first_id;

    INSERT INTO public.media_catalog_items (
        website_id, client_id, key, filename, src, alt, library,
        service, sub_category, aspect_ratio, status, sort_order
    ) VALUES (
        v_website_id, v_client_id, v_prefix || '-second.jpg', 'second.jpg',
        'https://example.test/second.jpg', 'Second test image', 'portfolio',
        'Events', 'Baby Shower', 'landscape', 'published', 5
    ) RETURNING id INTO v_second_id;

    INSERT INTO public.media_catalog_items (
        website_id, client_id, key, filename, src, alt, library,
        service, sub_category, aspect_ratio, status, sort_order
    ) VALUES (
        v_website_id, v_client_id, v_prefix || '-third.jpg', 'third.jpg',
        'https://example.test/third.jpg', 'Third test image', 'portfolio',
        'Events', 'Baby Shower', 'landscape', 'published', 20
    ) RETURNING id INTO v_third_id;

    INSERT INTO public.media_catalog_items (
        website_id, client_id, key, filename, src, alt, library,
        service, sub_category, aspect_ratio, status, sort_order
    ) VALUES (
        v_website_id, v_client_id, v_prefix || '-fourth.jpg', 'fourth.jpg',
        'https://example.test/fourth.jpg', 'Fourth test image', 'portfolio',
        'Events', 'Baby Shower', 'landscape', 'published', 30
    ) RETURNING id INTO v_fourth_id;

    PERFORM public.move_media_catalog_item_to_position(
        v_website_id,
        v_third_id,
        2
    );

    SELECT
        array_agg(item.key ORDER BY item.sort_order, item.id),
        array_agg(item.sort_order ORDER BY item.sort_order, item.id)
    INTO v_keys, v_positions
    FROM public.media_catalog_items AS item
    WHERE item.website_id = v_website_id
      AND item.key LIKE v_prefix || '%';

    IF v_keys <> ARRAY[
        v_prefix || '-first.jpg',
        v_prefix || '-third.jpg',
        v_prefix || '-second.jpg',
        v_prefix || '-fourth.jpg'
    ]::text[] THEN
        RAISE EXCEPTION 'Individual insertion did not bump duplicate positions: %', v_keys;
    END IF;
    IF v_positions <> ARRAY[1, 2, 3, 4]::integer[] THEN
        RAISE EXCEPTION 'Individual insertion did not normalize positions: %', v_positions;
    END IF;

    PERFORM public.move_media_catalog_item_to_position(
        v_website_id,
        v_first_id,
        999
    );

    SELECT
        array_agg(item.key ORDER BY item.sort_order, item.id),
        array_agg(item.sort_order ORDER BY item.sort_order, item.id)
    INTO v_keys, v_positions
    FROM public.media_catalog_items AS item
    WHERE item.website_id = v_website_id
      AND item.key LIKE v_prefix || '%';

    IF v_keys <> ARRAY[
        v_prefix || '-third.jpg',
        v_prefix || '-second.jpg',
        v_prefix || '-fourth.jpg',
        v_prefix || '-first.jpg'
    ]::text[] OR v_positions <> ARRAY[1, 2, 3, 4]::integer[] THEN
        RAISE EXCEPTION 'Out-of-range position was not clamped to the final slot: %, %',
            v_keys, v_positions;
    END IF;

    PERFORM public.reorder_media_catalog_selection(
        v_website_id,
        ARRAY[v_fourth_id, v_third_id]::bigint[]
    );

    SELECT array_agg(item.key ORDER BY item.sort_order, item.id)
    INTO v_keys
    FROM public.media_catalog_items AS item
    WHERE item.website_id = v_website_id
      AND item.key LIKE v_prefix || '%';

    IF v_keys <> ARRAY[
        v_prefix || '-fourth.jpg',
        v_prefix || '-second.jpg',
        v_prefix || '-third.jpg',
        v_prefix || '-first.jpg'
    ]::text[] THEN
        RAISE EXCEPTION 'Selected reorder did not preserve untouched relative order: %', v_keys;
    END IF;

    BEGIN
        PERFORM public.reorder_media_catalog_selection(
            v_website_id,
            ARRAY[v_first_id, v_first_id]::bigint[]
        );
        RAISE EXCEPTION 'Duplicate selected IDs unexpectedly succeeded.';
    EXCEPTION
        WHEN SQLSTATE '22023' THEN NULL;
    END;
END;
$$;

ROLLBACK;
