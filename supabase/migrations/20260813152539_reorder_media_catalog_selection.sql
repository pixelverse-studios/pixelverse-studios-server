-- Reorder a selected set of published portfolio images while preserving the
-- current slots occupied by that selection. Every published portfolio image
-- is normalized to a unique, sequential sort_order in the same transaction.

create or replace function public.reorder_media_catalog_selection(
    p_website_id uuid,
    p_ordered_ids bigint[]
)
returns setof public.media_catalog_items
language plpgsql
security invoker
set search_path = public
as $$
declare
    current_ids bigint[];
    selected_positions integer[];
    final_ids bigint[];
    selected_count integer;
    matching_count integer;
    selected_index integer;
begin
    selected_count := coalesce(array_length(p_ordered_ids, 1), 0);

    if selected_count < 2 or selected_count > 50 then
        raise exception 'Select between 2 and 50 portfolio images to reorder.'
            using errcode = '22023';
    end if;

    if (
        select count(distinct selected_id)
        from unnest(p_ordered_ids) as selected_id
    ) <> selected_count then
        raise exception 'Portfolio reorder IDs must be unique.'
            using errcode = '22023';
    end if;

    perform id
    from public.media_catalog_items
    where website_id = p_website_id
      and library = 'portfolio'
      and status = 'published'
    order by sort_order, id
    for update;

    select array_agg(id order by sort_order, id)
    into current_ids
    from public.media_catalog_items
    where website_id = p_website_id
      and library = 'portfolio'
      and status = 'published';

    select count(*)
    into matching_count
    from public.media_catalog_items
    where website_id = p_website_id
      and library = 'portfolio'
      and status = 'published'
      and id = any(p_ordered_ids);

    if matching_count <> selected_count then
        raise exception 'Every reordered image must be a published portfolio image for this website.'
            using errcode = '22023';
    end if;

    select array_agg(position::integer order by position)
    into selected_positions
    from unnest(current_ids) with ordinality as current_item(id, position)
    where current_item.id = any(p_ordered_ids);

    final_ids := current_ids;
    for selected_index in 1..selected_count loop
        final_ids[selected_positions[selected_index]] := p_ordered_ids[selected_index];
    end loop;

    update public.media_catalog_items as item
    set sort_order = final_order.position::integer
    from unnest(final_ids) with ordinality as final_order(id, position)
    where item.website_id = p_website_id
      and item.id = final_order.id
      and item.sort_order is distinct from final_order.position;

    return query
    select item.*
    from public.media_catalog_items as item
    where item.website_id = p_website_id
      and item.library = 'portfolio'
      and item.status = 'published'
    order by item.sort_order, item.id;
end;
$$;

revoke all on function public.reorder_media_catalog_selection(uuid, bigint[]) from public;
revoke all on function public.reorder_media_catalog_selection(uuid, bigint[]) from anon;
revoke all on function public.reorder_media_catalog_selection(uuid, bigint[]) from authenticated;
grant execute on function public.reorder_media_catalog_selection(uuid, bigint[]) to service_role;
