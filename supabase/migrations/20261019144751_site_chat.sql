create table public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  work_id uuid references public.works(id) on delete set null,
  work_title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id, work_id)
);
create index chat_conversations_work_idx on public.chat_conversations(work_id);
create index chat_conversations_customer_updated_idx on public.chat_conversations(customer_id, updated_at desc, id desc);
create index chat_conversations_updated_idx on public.chat_conversations(updated_at desc, id desc);

create table public.chat_messages (
  id uuid primary key,
  seq bigint generated always as identity unique,
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  sender_id uuid references auth.users(id) on delete set null,
  sender_role text not null check (sender_role in ('customer', 'admin')),
  body text not null check (char_length(btrim(body, E' \t\n\r')) between 1 and 4000),
  created_at timestamptz not null default clock_timestamp()
);
create index chat_messages_conversation_seq_idx on public.chat_messages(conversation_id, seq desc);
create index chat_messages_sender_idx on public.chat_messages(sender_id);

create table public.chat_reads (
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_seq bigint not null default 0 check (last_read_seq >= 0),
  primary key (conversation_id, user_id)
);
create index chat_reads_user_idx on public.chat_reads(user_id);

alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_reads enable row level security;
revoke all on public.chat_conversations, public.chat_messages, public.chat_reads from public, anon, authenticated;
grant select on public.chat_conversations, public.chat_messages, public.chat_reads to authenticated;
revoke all on sequence public.chat_messages_seq_seq from public, anon, authenticated;

create policy "participants read conversations" on public.chat_conversations for select to authenticated
  using (customer_id = (select auth.uid()) or (select private.is_admin()));
create policy "participants read messages" on public.chat_messages for select to authenticated
  using (exists (select 1 from public.chat_conversations c where c.id = conversation_id));
create policy "participants read own receipts" on public.chat_reads for select to authenticated
  using (user_id = (select auth.uid()) and exists (select 1 from public.chat_conversations c where c.id = conversation_id));

create function private.chat_send(request_id uuid, target_work_id uuid, target_conversation_id uuid, message_body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  master boolean;
  convo public.chat_conversations;
  msg public.chat_messages;
  title text;
  clean_body text := btrim(message_body, E' \t\n\r');
begin
  if actor is null or not exists (select 1 from auth.users where id = actor and not coalesce(is_anonymous, false)) then
    raise exception 'Sign in to send a message' using errcode = '42501';
  end if;
  master := private.is_admin();
  if request_id is null or clean_body is null or char_length(clean_body) not between 1 and 4000 then
    raise exception 'Message must contain 1 to 4000 characters' using errcode = '22023';
  end if;
  if target_conversation_id is not null then
    select * into convo from public.chat_conversations where id = target_conversation_id for update;
    if convo.id is null or (convo.customer_id <> actor and not master) then
      raise exception 'Conversation not available' using errcode = '42501';
    end if;
  else
    if master or target_work_id is null then
      raise exception 'Choose a customer conversation' using errcode = '42501';
    end if;
    select * into convo from public.chat_conversations where customer_id = actor and work_id = target_work_id for update;
    if convo.id is null then
      select w.title into title from public.works w where id = target_work_id and status = 'published' and availability <> 'sold' for share;
      if title is null then raise exception 'Work not available' using errcode = '42501'; end if;
      insert into public.chat_conversations(customer_id, work_id, work_title) values (actor, target_work_id, title)
        on conflict (customer_id, work_id) do nothing;
      select * into convo from public.chat_conversations where customer_id = actor and work_id = target_work_id for update;
    end if;
  end if;
  -- A client-generated ID makes a retry after a lost response safe.
  select * into msg from public.chat_messages where id = request_id;
  if msg.id is not null then
    if msg.sender_id is distinct from actor or msg.conversation_id <> convo.id or msg.body <> clean_body then
      raise exception 'Message request ID reused' using errcode = '22023';
    end if;
  else
    insert into public.chat_messages(id, conversation_id, sender_id, sender_role, body)
      values (request_id, convo.id, actor, case when master then 'admin' else 'customer' end, clean_body) returning * into msg;
    update public.chat_conversations set updated_at = msg.created_at where id = convo.id;
  end if;
  return jsonb_build_object('conversation_id', convo.id, 'message', to_jsonb(msg));
end;
$$;

create function private.chat_mark_read(target_conversation_id uuid, through_seq bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); seen bigint;
begin
  if actor is null or not exists (select 1 from public.chat_conversations where id = target_conversation_id
      and (customer_id = actor or private.is_admin())) then
    raise exception 'Conversation not available' using errcode = '42501';
  end if;
  -- Never acknowledge messages beyond the snapshot actually requested by the client.
  select max(seq) into seen from public.chat_messages where conversation_id = target_conversation_id and seq <= through_seq;
  if seen is not null then
    insert into public.chat_reads(conversation_id, user_id, last_read_seq) values (target_conversation_id, actor, seen)
      on conflict (conversation_id, user_id) do update
      set last_read_seq = greatest(public.chat_reads.last_read_seq, excluded.last_read_seq);
  end if;
end;
$$;

create function private.chat_inbox(before_updated_at timestamptz, before_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := auth.uid(); master boolean; result jsonb;
begin
  if actor is null then raise exception 'Sign in to read messages' using errcode = '42501'; end if;
  master := private.is_admin();
  with accessible as (
    select c.*, case when master then coalesce(nullif(u.email, ''), 'Покупатель · ' || left(c.customer_id::text, 8)) else 'Мастерская' end as participant_label,
      (select count(*) from public.chat_messages m where m.conversation_id = c.id
        and m.sender_role = case when master then 'customer' else 'admin' end
        and m.seq > coalesce(r.last_read_seq, 0)) as unread_count
    from public.chat_conversations c left join public.chat_reads r on r.conversation_id = c.id and r.user_id = actor
      left join auth.users u on u.id = c.customer_id
    where c.customer_id = actor or master
  ), page as (
    select * from accessible where before_updated_at is null or (updated_at, id) < (before_updated_at, before_id)
    order by updated_at desc, id desc limit 51
  ), visible as (
    select p.*, (select left(body, 180) from public.chat_messages m where m.conversation_id = p.id order by seq desc limit 1) as last_message
    from (select * from page order by updated_at desc, id desc limit 50) p
  )
  select jsonb_build_object('threads', coalesce((select jsonb_agg(to_jsonb(v) order by v.updated_at desc, v.id desc) from visible v), '[]'::jsonb),
    'unread_count', coalesce((select sum(unread_count) from accessible), 0), 'has_more', (select count(*) > 50 from page)) into result;
  return result;
end;
$$;

revoke all on function private.chat_send(uuid, uuid, uuid, text), private.chat_mark_read(uuid, bigint), private.chat_inbox(timestamptz, uuid) from public, anon, authenticated;
grant execute on function private.chat_send(uuid, uuid, uuid, text), private.chat_mark_read(uuid, bigint), private.chat_inbox(timestamptz, uuid) to authenticated;

create function public.chat_send(request_id uuid, target_work_id uuid default null, target_conversation_id uuid default null, message_body text default '')
returns jsonb language sql security invoker set search_path = '' as $$ select private.chat_send(request_id, target_work_id, target_conversation_id, message_body); $$;
create function public.chat_mark_read(target_conversation_id uuid, through_seq bigint)
returns void language sql security invoker set search_path = '' as $$ select private.chat_mark_read(target_conversation_id, through_seq); $$;
create function public.chat_inbox(before_updated_at timestamptz default null, before_id uuid default null)
returns jsonb language sql stable security invoker set search_path = '' as $$ select private.chat_inbox(before_updated_at, before_id); $$;

revoke all on function public.chat_send(uuid, uuid, uuid, text), public.chat_mark_read(uuid, bigint), public.chat_inbox(timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.chat_send(uuid, uuid, uuid, text), public.chat_mark_read(uuid, bigint), public.chat_inbox(timestamptz, uuid) to authenticated;

-- The local SQL test database has no Realtime publication.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.chat_messages, public.chat_reads;
  end if;
end $$;
