-- Move one published portfolio image to an explicit position. This preserves
-- the individual position field in the editor while making insertion
-- semantics deterministic: the moved image takes precedence and every image
-- at or after that position is bumped into the next sequential slot.
create or replace function public.move_media_catalog_item_to_position(
    p_website_id uuid,
    p_item_id bigint,
    p_target_position integer
)
returns setof public.media_catalog_items
language plpgsql
security invoker
set search_path = public
as $$
declare
    remaining_ids bigint[];
    final_ids bigint[];
    portfolio_count integer;
    target_position integer;
begin
    if p_target_position < 1 then
        raise exception 'Portfolio position must be at least 1.'
            using errcode = '22023';
    end if;

    perform id
    from public.media_catalog_items
    where website_id = p_website_id
      and library = 'portfolio'
      and status = 'published'
    order by sort_order, id
    for update;

    if not exists (
        select 1
        from public.media_catalog_items
        where website_id = p_website_id
          and id = p_item_id
          and library = 'portfolio'
          and status = 'published'
    ) then
        raise exception 'The moved image must be a published portfolio image for this website.'
            using errcode = '22023';
    end if;

    select coalesce(array_agg(id order by sort_order, id), '{}'::bigint[])
    into remaining_ids
    from public.media_catalog_items
    where website_id = p_website_id
      and library = 'portfolio'
      and status = 'published'
      and id <> p_item_id;

    portfolio_count := coalesce(array_length(remaining_ids, 1), 0) + 1;
    target_position := least(p_target_position, portfolio_count);
    final_ids :=
        coalesce(remaining_ids[1:target_position - 1], '{}'::bigint[])
        || array[p_item_id]
        || coalesce(
            remaining_ids[target_position:portfolio_count - 1],
            '{}'::bigint[]
        );

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

revoke all on function public.move_media_catalog_item_to_position(uuid, bigint, integer) from public;
revoke all on function public.move_media_catalog_item_to_position(uuid, bigint, integer) from anon;
revoke all on function public.move_media_catalog_item_to_position(uuid, bigint, integer) from authenticated;
grant execute on function public.move_media_catalog_item_to_position(uuid, bigint, integer) to service_role;
