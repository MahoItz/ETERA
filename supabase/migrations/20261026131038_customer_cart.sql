-- A private working cart; submitted selections are immutable chat attachments.
create table public.cart_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz not null default clock_timestamp()
);
-- Catalogue IDs live in the snapshot intentionally: deleted works remain removable
-- from the cart and must never silently turn into a different variant or set.
create unique index cart_items_selection_idx on public.cart_items
  (user_id, (snapshot->>'work_id'), (coalesce(snapshot->>'variant_id', '')));
create index cart_items_user_created_idx on public.cart_items(user_id, created_at, id);
alter table public.cart_items enable row level security;
revoke all on public.cart_items from public, anon, authenticated;
grant select, delete on public.cart_items to authenticated;
create policy "customers read own cart" on public.cart_items for select to authenticated
  using (user_id = (select auth.uid()));
create policy "customers remove own cart items" on public.cart_items for delete to authenticated
  using (user_id = (select auth.uid()));

alter table public.chat_conversations add column kind text not null default 'work' check (kind in ('work', 'cart'));
create unique index chat_conversations_customer_cart_idx on public.chat_conversations(customer_id) where kind = 'cart';
alter table public.chat_messages add column selection jsonb;
alter table public.chat_messages add column cart_item_ids uuid[];
alter table public.chat_messages add constraint chat_selection_shape check (
  (selection is null and cart_item_ids is null) or
  (selection is not null and cart_item_ids is not null and jsonb_typeof(selection) = 'array'
    and jsonb_array_length(selection) between 1 and 50
    and cardinality(cart_item_ids) = jsonb_array_length(selection))
);

-- Only called by the checked private entry points, never exposed as an RPC.
create function private.cart_selection(target_work_id uuid, target_variant_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare w public.works; v public.variants; image text;
begin
  select * into w from public.works where id = target_work_id and status = 'published' and availability <> 'sold';
  if w.id is null then raise exception 'Selection unavailable' using errcode = 'P0002'; end if;
  if target_variant_id is not null then
    select * into v from public.variants where id = target_variant_id and work_id = w.id and availability <> 'sold';
    if v.id is null or w.sold_as_set then raise exception 'Variant unavailable' using errcode = 'P0002'; end if;
  elsif not w.sold_as_set and exists (select 1 from public.variants where work_id = w.id) then
    raise exception 'Choose a variant' using errcode = 'P0002';
  end if;
  if v.id is not null then
    select url into image from public.photos where variant_id = v.id order by position, id limit 1;
    image := coalesce(image, v.image_url);
  end if;
  if image is null then
    select url into image from public.photos where work_id = w.id and variant_id is null order by position, id limit 1;
  end if;
  return jsonb_build_object('work_id', w.id, 'variant_id', v.id, 'work_slug', w.slug, 'variant_slug', v.slug,
    'title', w.title, 'variant_name', v.name, 'image_url', image, 'sold_as_set', w.sold_as_set,
    'price', case when v.id is null then w.price else v.price end);
end;
$$;
revoke all on function private.cart_selection(uuid, uuid) from public, anon, authenticated;

create function private.cart_add(target_work_id uuid, target_variant_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); item public.cart_items; chosen jsonb;
begin
  if actor is null or private.is_admin() or not exists (select 1 from auth.users where id = actor and not coalesce(is_anonymous, false)) then
    raise exception 'Sign in as a customer' using errcode = '42501';
  end if;
  -- Serialize adds and submissions for this customer, including the size check.
  perform id from public.profiles where id = actor for update;
  chosen := private.cart_selection(target_work_id, target_variant_id);
  select * into item from public.cart_items where user_id = actor and snapshot->>'work_id' = target_work_id::text
    and coalesce(snapshot->>'variant_id', '') = coalesce(target_variant_id::text, '');
  if item.id is null then
    if (select count(*) from public.cart_items where user_id = actor) >= 50 then
      raise exception 'Cart limit reached' using errcode = 'P0001';
    end if;
    insert into public.cart_items(user_id, snapshot) values (actor, chosen) returning * into item;
  end if;
  return to_jsonb(item) || jsonb_build_object('current', chosen, 'available', true);
end;
$$;

create function private.cart_list()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); item public.cart_items; chosen jsonb; result jsonb := '[]'::jsonb;
begin
  if actor is null or not exists (select 1 from auth.users where id = actor and not coalesce(is_anonymous, false)) then
    raise exception 'Sign in to view cart' using errcode = '42501';
  end if;
  for item in select * from public.cart_items where user_id = actor order by created_at, id limit 50 loop
    begin
      chosen := private.cart_selection((item.snapshot->>'work_id')::uuid, (item.snapshot->>'variant_id')::uuid);
    exception when no_data_found then chosen := null;
    end;
    result := result || jsonb_build_array(to_jsonb(item) || jsonb_build_object('current', chosen, 'available', chosen is not null));
  end loop;
  return result;
end;
$$;

create function private.cart_submit(request_id uuid, item_ids uuid[], message_body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid(); item public.cart_items; msg public.chat_messages; convo public.chat_conversations;
  chosen jsonb := '[]'::jsonb; canonical_ids uuid[]; found_count integer := 0;
  clean_body text := btrim(coalesce(message_body, ''), E' \t\n\r');
begin
  if actor is null or private.is_admin() or not exists (select 1 from auth.users where id = actor and not coalesce(is_anonymous, false)) then
    raise exception 'Sign in as a customer' using errcode = '42501';
  end if;
  if request_id is null or coalesce(cardinality(item_ids), 0) not between 1 and 50 or char_length(clean_body) > 2000
    or array_position(item_ids, null) is not null then
    raise exception 'Invalid cart request' using errcode = '22023';
  end if;
  select array_agg(distinct id order by id) into canonical_ids from unnest(item_ids) id;
  if cardinality(canonical_ids) <> cardinality(item_ids) then raise exception 'Duplicate cart item' using errcode = '22023'; end if;
  if clean_body = '' then clean_body := 'Хочу обсудить выбранные фигурки.'; end if;
  perform id from public.profiles where id = actor for update;
  -- Check receipt before current cart/catalogue: a lost response remains retryable
  -- even if an item was removed or sold after the successful submission.
  select * into msg from public.chat_messages where id = request_id;
  if msg.id is not null then
    if msg.sender_id is distinct from actor or msg.body <> clean_body or msg.selection is null or msg.cart_item_ids is distinct from canonical_ids then
      raise exception 'Request ID reused' using errcode = '22023';
    end if;
    return jsonb_build_object('conversation_id', msg.conversation_id, 'message', to_jsonb(msg));
  end if;
  -- Lock catalogue rows in a fixed order so a sale/edit cannot interleave validation
  -- and snapshot creation. Cart rows have no FK back to the catalogue.
  perform w.id from public.works w where w.id in (
    select (snapshot->>'work_id')::uuid from public.cart_items where user_id = actor and id = any(canonical_ids)
  ) order by w.id for share;
  perform v.id from public.variants v where v.id in (
    select (snapshot->>'variant_id')::uuid from public.cart_items where user_id = actor and id = any(canonical_ids)
  ) order by v.id for share;
  for item in select * from public.cart_items where user_id = actor and id = any(canonical_ids) order by id for update loop
    chosen := chosen || jsonb_build_array(private.cart_selection((item.snapshot->>'work_id')::uuid, (item.snapshot->>'variant_id')::uuid));
    found_count := found_count + 1;
  end loop;
  if found_count <> cardinality(canonical_ids) then raise exception 'Cart changed' using errcode = '40001'; end if;
  insert into public.chat_conversations(customer_id, work_title, kind) values (actor, 'Подборки из корзины', 'cart')
    on conflict (customer_id) where kind = 'cart' do nothing;
  select * into convo from public.chat_conversations where customer_id = actor and kind = 'cart' for update;
  insert into public.chat_messages(id, conversation_id, sender_id, sender_role, body, selection, cart_item_ids)
    values (request_id, convo.id, actor, 'customer', clean_body, chosen, canonical_ids) returning * into msg;
  update public.chat_conversations set updated_at = msg.created_at where id = convo.id;
  return jsonb_build_object('conversation_id', convo.id, 'message', to_jsonb(msg));
end;
$$;

revoke all on function private.cart_add(uuid, uuid), private.cart_list(), private.cart_submit(uuid, uuid[], text) from public, anon, authenticated;
grant execute on function private.cart_add(uuid, uuid), private.cart_list(), private.cart_submit(uuid, uuid[], text) to authenticated;
create function public.cart_add(target_work_id uuid, target_variant_id uuid default null)
returns jsonb language sql security invoker set search_path = '' as $$ select private.cart_add(target_work_id, target_variant_id); $$;
create function public.cart_list()
returns jsonb language sql security invoker set search_path = '' as $$ select private.cart_list(); $$;
create function public.cart_submit(request_id uuid, item_ids uuid[], message_body text default '')
returns jsonb language sql security invoker set search_path = '' as $$ select private.cart_submit(request_id, item_ids, message_body); $$;
revoke all on function public.cart_add(uuid, uuid), public.cart_list(), public.cart_submit(uuid, uuid[], text) from public, anon, authenticated;
grant execute on function public.cart_add(uuid, uuid), public.cart_list(), public.cart_submit(uuid, uuid[], text) to authenticated;
