import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const {build}=createRequire(import.meta.resolve('wrangler/package.json'))('esbuild');
const db=new DatabaseSync(':memory:');
db.exec(await readFile(new URL('../drizzle/0000_chilly_blizzard.sql',import.meta.url),'utf8'));
const photos=new Map();
function prepare(sql){let values=[];const result={bind(...v){values=v;return result;},async first(){return db.prepare(sql).get(...values)||null;},async all(){return {results:db.prepare(sql).all(...values)};},async run(){const r=db.prepare(sql).run(...values);return {meta:{changes:Number(r.changes)}};}};return result;}
globalThis.__TEST_ENV__={DB:{prepare,async batch(items){db.exec('BEGIN');try{const results=[];for(const item of items)results.push(await item.run());db.exec('COMMIT');return results;}catch(e){db.exec('ROLLBACK');throw e;}}},BUCKET:{async put(key,bytes){photos.set(key,new Uint8Array(bytes));},async get(key){const bytes=photos.get(key);return bytes?{body:bytes}:null;},async delete(key){photos.delete(key);}}};
async function route(path){const output=await build({entryPoints:[new URL('../app/api/'+path+'/route.ts',import.meta.url).pathname],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'env',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const env=globalThis.__TEST_ENV__',loader:'js'}));}}]});return import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));}
const bootstrap=await route('bootstrap'),catalog=await route('catalog'),works=await route('works'),work=await route('works/[id]'),upload=await route('photos'),photo=await route('photos/[key]'),settings=await route('settings');
const origin='https://example.chatgpt.site';
function req(path,method='GET',body,headers={}){return new Request(origin+path,{method,headers:body?{'Content-Type':'application/json',...headers}:headers,body:body?JSON.stringify(body):undefined});}
test('Actual API creates seeds idempotently, persists edits and rejects stale saves',async()=>{
 assert.equal((await bootstrap.POST(req('/api/bootstrap','POST'))).status,200);
 await bootstrap.POST(req('/api/bootstrap','POST'));
 let data=await (await catalog.GET(req('/api/catalog'))).json();assert.equal(data.works.length,2);
 const body={...data.works[0],title:'Тестовая работа',status:'draft'};
 let response=await works.POST(req('/api/works','POST',body));assert.equal(response.status,201);const created=await response.json();
 response=await work.PUT(req('/api/works/'+created.id,'PUT',{...created,title:'Изменённая работа'}),{params:Promise.resolve({id:created.id})});assert.equal(response.status,200);
 const updated=await response.json();assert.equal(updated.revision,2);
 response=await work.PUT(req('/api/works/'+created.id,'PUT',created),{params:Promise.resolve({id:created.id})});assert.equal(response.status,409);
 data=await (await catalog.GET(req('/api/catalog'))).json();assert.equal(data.works.find(w=>w.id===created.id).title,'Изменённая работа');
});
test('Actual API validates uploads and returns the saved bytes',async()=>{
 let response=await upload.POST(new Request(origin+'/api/photos',{method:'POST',headers:{'Content-Type':'image/png'},body:'invalid'}));assert.equal(response.status,400);
 const bytes=new Uint8Array(24);bytes.set(new TextEncoder().encode('RIFF'),0);bytes.set(new TextEncoder().encode('WEBP'),8);
 response=await upload.POST(new Request(origin+'/api/photos',{method:'POST',headers:{'Content-Type':'image/webp'},body:bytes}));assert.equal(response.status,201);
 const uploaded=await response.json();const key=uploaded.url.split('/').pop();
 response=await photo.GET(req(uploaded.url),{params:Promise.resolve({key})});assert.equal(response.status,200);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);
});
test('Actual API rejects cross-origin writes and dangerous contact links',async()=>{
 const response=await bootstrap.POST(req('/api/bootstrap','POST',{}, {Origin:'https://evil.example'}));assert.equal(response.status,403);
 let r=await settings.PUT(req('/api/settings','PUT',{name:'Мастерская',contact:'javascript:alert(1)',categories:[]}));assert.equal(r.status,400);
 r=await settings.PUT(req('/api/settings','PUT',{name:'Мастерская',contact:'https://t.me/master',categories:['Феи','Феи']}));assert.equal(r.status,200);assert.deepEqual((await r.json()).categories,['Феи']);
});
