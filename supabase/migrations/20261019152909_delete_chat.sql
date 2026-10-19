-- Keep raw DELETE privileges closed. Only a participant can remove a chat,
-- and a newer message invalidates the confirmation snapshot.
create function private.chat_delete(target_conversation_id uuid, expected_last_message_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); customer uuid; latest uuid;
begin
  if actor is null or not exists (select 1 from auth.users where id=actor and not coalesce(is_anonymous,false)) then
    raise exception 'Sign in to delete a conversation' using errcode = '42501';
  end if;
  select customer_id into customer from public.chat_conversations where id=target_conversation_id for update;
  -- Retrying an acknowledged or lost-response deletion is harmless.
  if not found then return; end if;
  if customer<>actor and not private.is_admin() then
    raise exception 'Conversation not available' using errcode = '42501';
  end if;
  select id into latest from public.chat_messages where conversation_id=target_conversation_id order by seq desc limit 1;
  if latest is distinct from expected_last_message_id then
    raise exception 'Conversation changed since confirmation' using errcode = '40001';
  end if;
  delete from public.chat_conversations where id=target_conversation_id;
end;
$$;
revoke all on function private.chat_delete(uuid,uuid) from public,anon,authenticated;
grant execute on function private.chat_delete(uuid,uuid) to authenticated;

create function public.chat_delete(target_conversation_id uuid, expected_last_message_id uuid)
returns void language sql security invoker set search_path = '' as $$ select private.chat_delete(target_conversation_id,expected_last_message_id); $$;
revoke all on function public.chat_delete(uuid,uuid) from public,anon,authenticated;
grant execute on function public.chat_delete(uuid,uuid) to authenticated;
