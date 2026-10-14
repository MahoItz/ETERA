import {guard,handled,json,bootstrap} from '../../../lib/server';
export async function POST(req:Request){return handled(async()=>{guard(req);await bootstrap();return json({ok:true});});}
