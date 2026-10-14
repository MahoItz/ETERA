import {guard,handled,json,readCatalog} from '../../../lib/server';
export const dynamic='force-dynamic';
export async function GET(req:Request){return handled(async()=>{guard(req);return json(await readCatalog());});}
