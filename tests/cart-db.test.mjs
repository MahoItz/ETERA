import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase } from './helpers/supabase-test-db.mjs';
import { readFile } from 'node:fs/promises';
import { selectionPath } from '../lib/cart.ts';

let db;
const customer='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', stranger='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const admin='cccccccc-cccc-4ccc-8ccc-cccccccccccc', anonymous='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const work='11111111-1111-4111-8111-111111111111', collection='22222222-2222-4222-8222-222222222222';
const variant='33333333-3333-4333-8333-333333333333', set='44444444-4444-4444-8444-444444444444';
const setVariant='55555555-5555-4555-8555-555555555555';
const asUser=async id=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');};
const add=async(w=work,v=null)=>(await db.query('select public.cart_add($1,$2) as data',[w,v])).rows[0].data;
const list=async()=>(await db.query('select public.cart_list() as data')).rows[0].data;
const submit=async(ids,body='',request=crypto.randomUUID())=>(await db.query('select public.cart_submit($1,$2,$3) as data',[request,ids,body])).rows[0].data;
async function isolated(fn){await db.exec('begin');try{await fn();}finally{await db.exec('rollback');}}
async function denied(fn,code='42501'){await db.exec('savepoint rejected');try{await assert.rejects(fn,e=>e.code===code);}finally{await db.exec('rollback to savepoint rejected; release savepoint rejected');}}

before(async()=>{
  db=await createTestDatabase();
  await db.exec(`delete from public.works;
    insert into auth.users(id,email,is_anonymous) values ('${customer}','customer@example.test',false),('${stranger}','stranger@example.test',false),('${admin}','admin@example.test',false),('${anonymous}',null,true);
    update public.profiles set role='admin' where id='${admin}';
    insert into public.works(id,title,status,availability,price,sold_as_set) values
      ('${work}','Фея','published','available',1200,false),('${collection}','Барашки','published','order',null,false),('${set}','Набор','published','available',3000,true);
    insert into public.variants(id,work_id,name,availability,price) values ('${variant}','${collection}','Синий барашек','available',900),('${setVariant}','${set}','Деталь набора','available',500);`);
});
after(()=>db.close());

test('cart stores individual works, exact variants and whole sets without duplicates',()=>isolated(async()=>{
  await asUser(customer);
  const first=await add();
  assert.equal((await add()).id,first.id);
  const second=await add(collection,variant);
  assert.equal(second.snapshot.variant_id,variant);
  assert.equal(second.snapshot.variant_name,'Синий барашек');
  assert.equal(second.snapshot.price,900);
  const whole=await add(set), single=await add(set,setVariant);
  assert.equal(whole.snapshot.sold_as_set,true);
  assert.equal(whole.snapshot.variant_id,null);
  assert.equal(whole.snapshot.price,3000);
  assert.notEqual(single.id,whole.id);
  assert.equal(single.snapshot.variant_id,setVariant);
  assert.equal(single.snapshot.variant_name,'Деталь набора');
  assert.equal(single.snapshot.price,500);
  assert.equal(single.snapshot.sold_as_set,false);
  assert.equal((await add(set)).id,whole.id);
  assert.equal((await add(set,setVariant)).id,single.id);
  assert.equal((await list()).length,4);
  assert.deepEqual((await db.query('select * from public.chat_conversations')).rows,[]);
  await denied(()=>add(collection),'P0002');
  await denied(()=>add(work,variant),'P0002');
  await denied(()=>add(set,variant),'P0002');
  await denied(()=>add(collection,setVariant),'P0002');
}));

test('set and variant use exact current names, prices and links while submitted snapshots remain immutable',()=>isolated(async()=>{
  await db.exec(`reset role; update public.works set slug='whole-set' where id='${set}';
    update public.variants set slug='set-detail', image_url='https://example.test/detail.jpg' where id='${setVariant}';`);
  await asUser(customer);
  const whole=await add(set), single=await add(set,setVariant);
  const first=await submit([whole.id,single.id]);
  const historical=first.message.selection;
  const selected=historical.find(x=>x.variant_id===setVariant);
  assert.equal(selected.sold_as_set,false);
  assert.equal(selected.image_url,'https://example.test/detail.jpg');
  const exactLink=new URL(selectionPath(selected,'/Gips/'),'https://example.test');
  assert.equal(exactLink.searchParams.get('work'),'whole-set');
  assert.equal(exactLink.searchParams.get('variant'),'set-detail');
  assert.equal(new URL(selectionPath(historical.find(x=>x.variant_id===null)),'https://example.test').searchParams.has('variant'),false);
  await db.exec(`reset role; update public.works set price=3500 where id='${set}';
    update public.variants set price=650, name='Обновленная деталь' where id='${setVariant}';`);
  await asUser(customer);
  const rows=await list();
  const currentWhole=rows.find(x=>x.id===whole.id), currentSingle=rows.find(x=>x.id===single.id);
  assert.equal(currentWhole.snapshot.price,3000);assert.equal(currentWhole.current.price,3500);
  assert.equal(currentWhole.current.sold_as_set,true);
  assert.equal(currentSingle.snapshot.price,500);assert.equal(currentSingle.current.price,650);
  assert.equal(currentSingle.current.variant_name,'Обновленная деталь');
  assert.equal(currentSingle.current.variant_id,setVariant);assert.equal(currentSingle.current.sold_as_set,false);
  const next=await submit([whole.id,single.id]);
  assert.equal(next.message.selection.find(x=>x.variant_id===setVariant).price,650);
  assert.equal(next.message.selection.find(x=>x.variant_id===null).price,3500);
  assert.deepEqual((await db.query('select selection from public.chat_messages where id=$1',[first.message.id])).rows[0].selection,historical);
}));

test('set variants reject unavailable, deleted and moved selections without partial submission',()=>isolated(async()=>{
  await asUser(customer);const whole=await add(set), single=await add(set,setVariant);
  for(const change of [
    `update public.variants set availability='sold' where id='${setVariant}'`,
    `update public.variants set availability='available', work_id='${collection}' where id='${setVariant}'`,
    `delete from public.variants where id='${setVariant}'`,
  ]){
    await db.exec(`reset role; ${change};`);await asUser(customer);
    await denied(()=>add(set,setVariant),'P0002');
    const rows=await list();
    assert.equal(rows.find(x=>x.id===whole.id).available,true);
    const stale=rows.find(x=>x.id===single.id);
    assert.equal(stale.available,false);assert.equal(stale.current,null);
    assert.equal(stale.snapshot.variant_id,setVariant);assert.equal(stale.snapshot.sold_as_set,false);
    await denied(()=>submit([whole.id,single.id]),'P0002');
    assert.deepEqual((await db.query('select * from public.chat_messages')).rows,[]);
    assert.deepEqual((await db.query('select * from public.chat_conversations')).rows,[]);
  }
  await db.exec(`reset role; update public.works set availability='sold' where id='${set}';`);await asUser(customer);
  assert.ok((await list()).every(x=>!x.available));
  await denied(()=>add(set),'P0002');await denied(()=>add(set,setVariant),'P0002');
}));

test('selection migration preserves historical data and private invoker privileges',()=>isolated(async()=>{
  await asUser(customer);const item=await add(set);const sent=await submit([item.id]);
  await db.exec('reset role');
  const functionState=async()=>(await db.query(`select prosecdef, proconfig, proacl::text from pg_proc where oid='private.cart_selection(uuid,uuid)'::regprocedure`)).rows[0];
  const before=await functionState();
  assert.equal(before.prosecdef,false);assert.deepEqual(before.proconfig,['search_path=""']);
  await db.exec(await readFile(new URL('../supabase/migrations/20261109165743_allow_set_variant_cart_selection.sql',import.meta.url),'utf8'));
  assert.deepEqual(await functionState(),before);
  await asUser(customer);
  assert.deepEqual((await list())[0].snapshot,item.snapshot);
  assert.deepEqual((await db.query('select selection from public.chat_messages where id=$1',[sent.message.id])).rows[0].selection,sent.message.selection);
  await denied(()=>db.query('select private.cart_selection($1,$2)',[set,setVariant]));
}));

test('cart is private including from master; writes cannot be forged, own items can be removed',()=>isolated(async()=>{
  await asUser(customer);const item=await add();
  for(const id of [stranger,admin]){
    await asUser(id);
    assert.deepEqual((await db.query('select * from public.cart_items')).rows,[]);
    assert.deepEqual(await list(),[]);
    await db.query('delete from public.cart_items where id=$1',[item.id]);
    await denied(()=>submit([item.id]),id===admin?'42501':'PT409');
  }
  await asUser(customer);
  await denied(()=>db.query('insert into public.cart_items(user_id,snapshot) values ($1,$2)',[customer,{title:'Fake',price:1}]));
  await denied(()=>db.query('update public.cart_items set user_id=$1 where id=$2',[stranger,item.id]));
  await db.query('delete from public.cart_items where id=$1',[item.id]);
  assert.deepEqual(await list(),[]);
}));

test('anon, anonymous auth users, missing identity and admins cannot add or submit',()=>isolated(async()=>{
  for(const id of [anonymous,'',admin]){await asUser(id);await denied(()=>add());await denied(()=>submit([crypto.randomUUID()]));}
  await db.exec('reset role; set role anon');
  await denied(()=>add());await denied(()=>list());await denied(()=>submit([crypto.randomUUID()]));
  await denied(()=>db.query('select * from public.cart_items'));
  await asUser(customer);await denied(()=>db.query('select private.cart_selection($1,null)',[work]));
}));

test('submission attaches server snapshots to one cart chat, master sees them and can reply',()=>isolated(async()=>{
  await asUser(customer);const first=await add(),second=await add(collection,variant);
  const sent=await submit([first.id,second.id],'  Нужны к празднику  ');
  assert.equal(sent.message.body,'Нужны к празднику');
  assert.equal(sent.message.selection.length,2);
  assert.equal(sent.message.selection.find(x=>x.variant_id===variant).price,900);
  assert.equal((await list()).length,2);
  const next=await submit([second.id]);assert.equal(next.conversation_id,sent.conversation_id);
  await asUser(admin);
  const inbox=(await db.query('select public.chat_inbox() as data')).rows[0].data;
  assert.equal(inbox.unread_count,2);assert.equal(inbox.threads[0].kind,'cart');
  assert.equal(inbox.threads[0].participant_label,'customer@example.test');
  assert.equal((await db.query('select selection from public.chat_messages where id=$1',[sent.message.id])).rows[0].selection.length,2);
  await db.query('select public.chat_send($1,null,$2,$3)',[crypto.randomUUID(),sent.conversation_id,'Да, обсудим!']);
  await asUser(stranger);assert.deepEqual((await db.query('select * from public.chat_messages')).rows,[]);
  await asUser(customer);assert.equal((await db.query('select public.chat_inbox() as data')).rows[0].data.unread_count,1);
}));

test('lost-response retry survives later cart deletion and catalogue changes, request reuse is rejected',()=>isolated(async()=>{
  await asUser(customer);const item=await add();const request=crypto.randomUUID();
  const sent=await submit([item.id],'',request);
  await db.query('delete from public.cart_items where id=$1',[item.id]);
  await db.exec(`reset role; update public.works set title='Новое имя', price=9999, availability='sold' where id='${work}';`);
  await asUser(customer);
  assert.deepEqual(await submit([item.id],'',request),sent);
  assert.equal(sent.message.selection[0].title,'Фея');assert.equal(sent.message.selection[0].price,1200);
  await denied(()=>submit([item.id],'Другой текст',request),'22023');
  await denied(()=>submit([crypto.randomUUID()],'',request),'22023');
  await asUser(stranger);await denied(()=>submit([item.id],'',request),'22023');
}));

test('sold, deleted, hidden and changed selections stay visible but cannot be submitted',()=>isolated(async()=>{
  await asUser(customer);const first=await add(),second=await add(collection,variant);
  await db.exec(`reset role; update public.works set availability='sold' where id='${work}'; delete from public.variants where id='${variant}';`);
  await asUser(customer);
  const rows=await list();assert.equal(rows.length,2);assert.ok(rows.every(x=>!x.available));
  assert.equal(rows.find(x=>x.id===second.id).snapshot.variant_name,'Синий барашек');
  await denied(()=>submit([first.id,second.id]),'P0002');
  assert.deepEqual((await db.query('select * from public.chat_messages')).rows,[]);
  await db.exec(`reset role; delete from public.works where id='${work}';`);
  await asUser(customer);assert.equal((await list()).length,2);
  await db.query('delete from public.cart_items where id=$1',[first.id]);
  await db.exec(`reset role; update public.works set status='draft' where id='${set}';`);
  await asUser(customer);await denied(()=>add(set),'P0002');
}));

test('cart list and submission use current server price, not the old add snapshot',()=>isolated(async()=>{
  await asUser(customer);const item=await add();
  await db.exec(`reset role; update public.works set price=1500 where id='${work}';`);
  await asUser(customer);
  const current=(await list())[0];assert.equal(current.snapshot.price,1200);assert.equal(current.current.price,1500);
  assert.equal((await submit([item.id])).message.selection[0].price,1500);
}));

test('invalid and stale requests fail atomically; new items in another tab are not submitted silently',()=>isolated(async()=>{
  await asUser(customer);const item=await add();const second=await add(collection,variant);
  for(const ids of [[],[item.id,item.id],Array(51).fill(item.id),[null]]) await denied(()=>submit(ids),'22023');
  await denied(()=>submit([item.id],'x'.repeat(2001)),'22023');
  await denied(()=>submit([item.id,crypto.randomUUID()]),'PT409');
  const sent=await submit([item.id]);assert.equal(sent.message.selection.length,1);
  assert.equal((await list()).some(x=>x.id===second.id),true);
}));

test('cart is limited to 50 unique positions; adding an existing position at capacity is safe',()=>isolated(async()=>{
  await db.exec(`reset role; insert into public.works(id,title,status,availability)
    select gen_random_uuid(), 'Позиция ' || n, 'published', 'available' from generate_series(1,51) n;`);
  const works=(await db.query("select id from public.works where title like 'Позиция %' order by title")).rows;
  await asUser(customer);
  for(const row of works.slice(0,50))await add(row.id);
  assert.equal((await list()).length,50);
  await add(works[0].id);
  await denied(()=>add(works[50].id),'P0001');
}));

test('chat deletion removes submitted attachments and a subsequent submission starts a new chat',()=>isolated(async()=>{
  await asUser(customer);const item=await add();const sent=await submit([item.id]);
  await db.query('select public.chat_delete($1,$2)',[sent.conversation_id,sent.message.id]);
  assert.deepEqual((await db.query('select selection from public.chat_messages')).rows,[]);
  const next=await submit([item.id]);assert.notEqual(next.conversation_id,sent.conversation_id);
}));

test('live verification script rolls back all fixtures and leaves existing data intact',async()=>{
  await db.exec('reset role');
  const before=(await db.query('select count(*)::int as count from public.works')).rows[0].count;
  await db.exec(await readFile(new URL('./cart.verify.sql',import.meta.url),'utf8'));
  assert.equal((await db.query('select count(*)::int as count from public.works')).rows[0].count,before);
  assert.equal((await db.query('select count(*)::int as count from public.cart_items')).rows[0].count,0);
  assert.equal((await db.query('select count(*)::int as count from public.chat_messages')).rows[0].count,0);
});
