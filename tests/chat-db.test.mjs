import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase } from './helpers/supabase-test-db.mjs';
import { readFile } from 'node:fs/promises';

let db;
const customer='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', stranger='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const admin='cccccccc-cccc-4ccc-8ccc-cccccccccccc', otherAdmin='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const work='11111111-1111-4111-8111-111111111111', hidden='22222222-2222-4222-8222-222222222222';
const asUser=async id=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');};
const send=async(body,conversation=null,request=crypto.randomUUID(),workId=work)=>(await db.query('select public.chat_send($1,$2,$3,$4) as data',[request,workId,conversation,body])).rows[0].data;
const inbox=async(cursor=null)=>(await db.query('select public.chat_inbox($1,$2) as data',[cursor?.updated_at??null,cursor?.id??null])).rows[0].data;
const read=async(id,seq)=>db.query('select public.chat_mark_read($1,$2)',[id,seq]);
const remove=async(id,latest)=>db.query('select public.chat_delete($1,$2)',[id,latest]);
async function isolated(fn){await db.exec('begin');try{await fn();}finally{await db.exec('rollback');}}
async function denied(fn,code='42501'){await db.exec('savepoint rejected');try{await assert.rejects(fn,e=>e.code===code);}finally{await db.exec('rollback to savepoint rejected; release savepoint rejected');}}
before(async()=>{
 db=await createTestDatabase();
 await db.exec('delete from public.works');
 await db.exec(`insert into auth.users(id,email) values ('${customer}','customer@example.test'),('${stranger}','stranger@example.test'),('${admin}','admin@example.test'),('${otherAdmin}','other-admin@example.test');
 update public.profiles set role='admin' where id in ('${admin}','${otherAdmin}');
 insert into public.works(id,title,status,availability) values ('${work}','Проверочная работа','published','available'),('${hidden}','Скрытая работа','draft','order');`);
});
after(()=>db.close());

test('customer starts a work conversation; master replies; both see the same history and incoming unread counts',()=>isolated(async()=>{
 await asUser(customer);
 const first=await send('  Здравствуйте! Можно заказать?  ');
 assert.equal(first.message.body,'Здравствуйте! Можно заказать?');
 assert.equal(first.message.sender_id,customer);
 assert.equal(first.message.sender_role,'customer');
 assert.equal((await inbox()).unread_count,0);
 await asUser(admin);
 let box=await inbox();
 assert.equal(box.unread_count,1);
 assert.equal(box.threads[0].work_title,'Проверочная работа');
 assert.equal(box.threads[0].participant_label,'customer@example.test');
 await read(first.conversation_id,first.message.seq);
 assert.equal((await inbox()).unread_count,0);
 const reply=await send('Здравствуйте! Да, конечно.',first.conversation_id);
 assert.equal(reply.message.sender_role,'admin');
 await asUser(customer);
 box=await inbox();assert.equal(box.unread_count,1);
 assert.equal(box.threads[0].participant_label,'Мастерская');
 assert.equal((await db.query('select * from public.chat_messages where conversation_id=$1',[first.conversation_id])).rows.length,2);
 await read(first.conversation_id,reply.message.seq);
 assert.equal((await inbox()).unread_count,0);
}));

test('lost-response retries do not duplicate messages or conversations and request IDs cannot be reused',()=>isolated(async()=>{
 await asUser(customer);
 const request=crypto.randomUUID(),first=await send('Вопрос',null,request);
 assert.deepEqual(await send('Вопрос',null,request),first);
 assert.deepEqual(await send('Вопрос',first.conversation_id,request),first);
 await denied(()=>send('Изменённый текст',first.conversation_id,request),'22023');
 await send('Ещё вопрос');
 assert.equal((await inbox()).threads.length,1);
 assert.equal((await db.query('select count(*)::int as n from public.chat_messages')).rows[0].n,2);
}));

test('anon and unrelated customers cannot read, send, acknowledge or forge conversation data',()=>isolated(async()=>{
 await asUser(customer);const first=await send('Личное сообщение');
 await asUser(stranger);
 assert.deepEqual((await inbox()).threads,[]);
 for(const table of ['chat_conversations','chat_messages','chat_reads'])assert.deepEqual((await db.query(`select * from public.${table}`)).rows,[]);
 await denied(()=>send('Подмена',first.conversation_id));
 await denied(()=>read(first.conversation_id,first.message.seq));
 await denied(()=>db.query("insert into public.chat_messages(id,conversation_id,sender_id,sender_role,body) values ($1,$2,$3,'admin','Подмена')",[crypto.randomUUID(),first.conversation_id,stranger]));
 await denied(()=>db.query('update public.chat_conversations set customer_id=$1 where id=$2',[stranger,first.conversation_id]));
 await denied(()=>db.query('delete from public.chat_messages where conversation_id=$1',[first.conversation_id]));
 await db.exec('reset role; set role anon');
 await denied(()=>inbox());await denied(()=>send('Гость'));await denied(()=>db.query('select * from public.chat_messages'));
 await asUser('');await denied(()=>inbox());await denied(()=>send('Без личности'));
}));

test('read receipts are per reader, monotonic and do not swallow a newer incoming message',()=>isolated(async()=>{
 await asUser(customer);const first=await send('Один');
 await asUser(admin);await read(first.conversation_id,first.message.seq);
 await asUser(otherAdmin);assert.equal((await inbox()).unread_count,1);
 await asUser(customer);const second=await send('Два');
 await asUser(admin);await read(first.conversation_id,first.message.seq);
 assert.equal((await inbox()).unread_count,1);
 await read(first.conversation_id,second.message.seq);await read(first.conversation_id,first.message.seq);
 assert.equal((await inbox()).unread_count,0);
 await asUser(otherAdmin);assert.equal((await inbox()).unread_count,2);
}));

test('invalid messages and hidden works fail, existing chats survive sale and work deletion',()=>isolated(async()=>{
 await asUser(customer);
 for(const body of ['', '   ', '\n\t\r', 'а'.repeat(4001),null])await denied(()=>send(body), '22023');
 await denied(()=>send('Вопрос',null,crypto.randomUUID(),hidden));
 const first=await send('Вопрос');
 await db.exec(`reset role; update public.works set availability='sold' where id='${work}';`);
 await asUser(customer);await send('Уточнение',first.conversation_id);
 await db.exec(`reset role; delete from public.works where id='${work}';`);
 await asUser(customer);
 const thread=(await inbox()).threads[0];assert.equal(thread.work_id,null);assert.equal(thread.work_title,'Проверочная работа');
 await send('Ещё уточнение',first.conversation_id);
 await asUser(admin);await send('Ответ',first.conversation_id);
 await db.exec(`reset role; update public.profiles set role='customer' where id='${admin}';`);
 await asUser(admin);assert.deepEqual((await inbox()).threads,[]);await denied(()=>send('Бывший админ',first.conversation_id));
}));

test('inbox pagination is stable and total unread includes conversations beyond the first page',()=>isolated(async()=>{
 await db.exec('reset role');
 for(let i=0;i<55;i++){
  await db.exec('reset role');
  const id=crypto.randomUUID();
  await db.query("insert into public.works(id,title,status) values ($1,$2,'published')",[id,`Работа ${i}`]);
  await asUser(customer);await send(`Сообщение ${i}`,null,crypto.randomUUID(),id);
 }
 await asUser(admin);const page=await inbox();assert.equal(page.threads.length,50);assert.equal(page.has_more,true);assert.equal(page.unread_count,55);
 const next=await inbox(page.threads.at(-1));assert.equal(next.threads.length,5);assert.equal(next.has_more,false);
 assert.equal(new Set([...page.threads,...next.threads].map(t=>t.id)).size,55);
}));

test('customer deletion removes the full chat and receipts while preserving other conversations and the work',()=>isolated(async()=>{
 await asUser(customer);const first=await send('Вопрос');
 await asUser(stranger);const other=await send('Другой покупатель');
 await asUser(admin);await read(first.conversation_id,first.message.seq);const reply=await send('Ответ',first.conversation_id);
 await asUser(customer);await read(first.conversation_id,reply.message.seq);await remove(first.conversation_id,reply.message.id);
 assert.deepEqual((await inbox()).threads,[]);
 await db.exec('reset role');
 for(const table of ['chat_messages','chat_reads'])assert.equal((await db.query(`select count(*)::int as n from public.${table} where conversation_id=$1`,[first.conversation_id])).rows[0].n,0);
 assert.equal((await db.query('select count(*)::int as n from public.works where id=$1',[work])).rows[0].n,1);
 await asUser(admin);const box=await inbox();assert.equal(box.threads.length,1);assert.equal(box.threads[0].id,other.conversation_id);assert.equal(box.unread_count,1);
 await asUser(customer);const fresh=await send('Новая переписка');assert.notEqual(fresh.conversation_id,first.conversation_id);
}));

test('strangers, anon, missing identities and demoted masters cannot delete someone else’s chat',()=>isolated(async()=>{
 await asUser(customer);const first=await send('Личное');
 await asUser(stranger);await denied(()=>remove(first.conversation_id,first.message.id));
 await asUser('');await denied(()=>remove(first.conversation_id,first.message.id));
 await db.exec('reset role; set role anon');await denied(()=>remove(first.conversation_id,first.message.id));
 await db.exec(`reset role; update public.profiles set role='customer' where id='${admin}';`);
 await asUser(admin);await denied(()=>remove(first.conversation_id,first.message.id));
 await asUser(otherAdmin);await remove(first.conversation_id,first.message.id);assert.equal((await inbox()).threads.length,0);
}));

test('a message arriving after confirmation prevents deletion; a fresh confirmation and retries succeed',()=>isolated(async()=>{
 await asUser(customer);const first=await send('Первое');const second=await send('Новое');
 await asUser(admin);await denied(()=>remove(first.conversation_id,first.message.id),'40001');
 assert.equal((await inbox()).unread_count,2);
 assert.equal((await db.query('select count(*)::int as n from public.chat_messages where conversation_id=$1',[first.conversation_id])).rows[0].n,2);
 await remove(first.conversation_id,second.message.id);await remove(first.conversation_id,second.message.id);
 assert.deepEqual((await inbox()).threads,[]);
}));

test('participants cannot bypass the delete RPC or forge a confirmation for a nonempty chat',()=>isolated(async()=>{
 await asUser(customer);const first=await send('Вопрос');
 await denied(()=>db.query('delete from public.chat_conversations where id=$1',[first.conversation_id]));
 await denied(()=>remove(first.conversation_id,null),'40001');
 await denied(()=>remove(first.conversation_id,crypto.randomUUID()),'40001');
 assert.equal((await inbox()).threads.length,1);
}));

test('live verification script rolls back every message, conversation and work',async()=>{
 await db.exec('reset role');
 const snapshot=async()=>(await db.query(`select jsonb_build_object('messages',(select count(*) from public.chat_messages),'conversations',(select count(*) from public.chat_conversations),'works',(select count(*) from public.works)) as data`)).rows[0].data;
 const previous=await snapshot();
 await db.exec(await readFile(new URL('./chat.verify.sql',import.meta.url),'utf8'));
 assert.deepEqual(await snapshot(),previous);
});
