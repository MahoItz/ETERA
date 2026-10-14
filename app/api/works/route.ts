import {guard,handled,json,checkPhotos,env} from '../../../lib/server';
import {validateWork} from '../../../lib/model';
export async function POST(req:Request){return handled(async()=>{guard(req);const data=validateWork(await req.json());await checkPhotos(data.photos);const id=crypto.randomUUID(),updatedAt=new Date().toISOString();await env.DB!.prepare('INSERT INTO works (id,data,revision,updated_at) VALUES (?,?,1,?)').bind(id,JSON.stringify(data),updatedAt).run();return json({...data,id,revision:1,updatedAt},201);});}
