-- SQLSTATE 40001 is reserved for serialization failures. PostgREST 14 retries
-- it indefinitely, so use its explicit HTTP 409 code for expected conflicts.
-- Preserve each deployed function's body, permissions and security settings.
do $$
declare
  item record;
  definition text;
  updated text;
  old_raise text;
  new_raise text;
begin
  for item in select * from (values
    ('public.save_categories(integer,text[],text[])', 'Category list has changed; reload before saving', 2),
    ('public.save_work(uuid,uuid,integer,jsonb)', 'Work has changed; reload before saving', 1),
    ('public.reorder_tree_ornaments(uuid[],uuid[],integer[])', 'Ornament order has changed; reload before retrying', 1),
    ('private.chat_delete(uuid,uuid)', 'Conversation changed since confirmation', 1),
    ('private.cart_submit(uuid,uuid[],text)', 'Cart changed', 1)
  ) as conflicts(signature, message, expected_count)
  loop
    definition := pg_get_functiondef(item.signature::regprocedure);
    old_raise := format('raise exception %L using errcode = %L', item.message, '40001');
    new_raise := format('raise exception %L using errcode = %L', item.message, 'PT409');
    if (length(definition) - length(replace(definition, old_raise, ''))) / length(old_raise) <> item.expected_count then
      raise exception 'Unexpected conflict definition for %', item.signature;
    end if;
    updated := replace(definition, old_raise, new_raise);
    execute updated;
  end loop;
end;
$$;
