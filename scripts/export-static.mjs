// Export a private Site into an unpublished portable static catalogue.
// Read {origin,token} from stdin. Never pass tokens in arguments or persist them.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
let input='';for await(const chunk of process.stdin)input+=chunk;
const {origin,token}=JSON.parse(input);
if(!/^https:\/\/[a-z0-9.-]+\.chatgpt\.site$/.test(origin))throw new Error('Unexpected Site origin');
const headers=token?{'OAI-Sites-Authorization':'Bearer '+token}:{};
async function get(path){const response=await fetch(origin+path,{headers,redirect:'error'});if(!response.ok)throw new Error('Export request failed: '+response.status);return response;}
const catalog=await (await get('/api/backup')).json();
catalog.works=catalog.works.filter(w=>w.status==='published'&&w.availability!=='sold');catalog.initialized=true;
await mkdir('public/images/exported',{recursive:true});
for(const work of catalog.works)for(const photo of work.photos){if(photo.url.startsWith('/api/photos/')){const key=photo.url.split('/').pop();if(!/^[a-f0-9-]+\.webp$/.test(key))throw new Error('Invalid photo path');const bytes=await (await get(photo.url)).arrayBuffer();await writeFile('public/images/exported/'+key,Buffer.from(bytes));photo.url='/images/exported/'+key;}}
await writeFile('public/catalog.json',JSON.stringify(catalog));
const child=spawn(process.execPath,['node_modules/vite/bin/vite.js','build','--config','vite.static.config.ts'],{stdio:['ignore','inherit','inherit']});
const code=await new Promise(resolve=>child.on('exit',resolve));if(code!==0)throw new Error('Static build failed');
process.stdout.write(JSON.stringify({directory:'static-dist',works:catalog.works.length,published:false})+'\n');
