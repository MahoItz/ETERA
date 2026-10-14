import { env } from 'cloudflare:workers';
import { defaults, seed, type Work, type Settings } from './model';
export class ApiError extends Error {constructor(public status:number,message:string){super(message);}}
export function guard(req:Request){
 const origin=req.headers.get('origin');
 if(origin&&origin!==new URL(req.url).origin)throw new ApiError(403,'Запрос с другого сайта отклонён');
 if(!env.DB||!env.BUCKET)throw new ApiError(503,'Хранилище пока недоступно');
 // This application is intentionally owner-private. The Sites dispatcher enforces
 // owner authentication on EVERY route, including photos and service requests.
 // Before any public migration, replace this boundary with explicit admin auth.
}
export function json(value:unknown,status=200){return Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'}});}
export async function handled(fn:()=>Promise<Response>){try{return await fn();}catch(e){return json({error:e instanceof Error?e.message:'Ошибка сервера'},e instanceof ApiError?e.status:400);}}
export async function readCatalog(){
 const rows=await env.DB!.prepare('SELECT id,data,revision,updated_at FROM works ORDER BY updated_at DESC').all<{id:string;data:string;revision:number;updated_at:string}>();
 const setting=await env.DB!.prepare("SELECT data FROM settings WHERE key='site'").first<{data:string}>();
 const initialized=await env.DB!.prepare("SELECT data FROM settings WHERE key='initialized'").first();
 return {works:rows.results.map(row=>({...JSON.parse(row.data),id:row.id,revision:row.revision,updatedAt:row.updated_at}) as Work),settings:setting?JSON.parse(setting.data) as Settings:defaults,initialized:!!initialized};
}
export async function bootstrap(){
 const initialized=await env.DB!.prepare("SELECT data FROM settings WHERE key='initialized'").first();if(initialized)return;
 await env.DB!.batch([...seed.map(w=>env.DB!.prepare('INSERT OR IGNORE INTO works (id,data,revision,updated_at) VALUES (?,?,?,?)').bind(w.id,JSON.stringify(w),1,w.updatedAt)),env.DB!.prepare("INSERT OR IGNORE INTO settings (key,data) VALUES ('site',?)").bind(JSON.stringify(defaults)),env.DB!.prepare("INSERT OR IGNORE INTO settings (key,data) VALUES ('initialized','true')")]);
}
export async function checkPhotos(photos:Work['photos']){for(const p of photos){if(p.url.startsWith('/api/photos/')){const found=await env.DB!.prepare('SELECT key FROM uploads WHERE key=?').bind(p.url.split('/').pop()).first();if(!found)throw new ApiError(400,'Фотография не найдена. Загрузите её заново.');}}}
export {env};
