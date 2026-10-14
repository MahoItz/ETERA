import './sites-env.mjs';
import {spawnSync} from 'node:child_process';
import {mkdir,readFile,writeFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd();
const localDir=path.join(root,'.local');
await mkdir(localDir,{recursive:true});
function run(args){const result=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0)throw new Error('Local setup command failed. See the error above.');}
console.log('Building the application for local development...');
run(['scripts/run-framework.mjs','build']);
const config='dist/server/wrangler.json';
const runtime=JSON.parse(await readFile(config,'utf8'));
const base=['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js'];
let applied=[];
try{applied=JSON.parse(await readFile(path.join(localDir,'migrations.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
for(const file of (await readdir('drizzle')).filter(f=>/^\d+_.*\.sql$/.test(f)).sort()){
 if(applied.includes(file))continue;
 console.log('Applying local database migration: '+file);
 run([...base,'d1','execute','DB','--local','--config',config,'--persist-to','.wrangler/state','--file',path.join('drizzle',file),'--yes']);
 applied.push(file);await writeFile(path.join(localDir,'migrations.json'),JSON.stringify(applied));
}
const catalog=JSON.parse(await readFile('snapshot/catalog.json','utf8'));
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
const statements=[];
for(const work of catalog.works){statements.push('INSERT OR IGNORE INTO works (id,data,revision,updated_at) VALUES ('+[quote(work.id),quote(JSON.stringify(work)),Number(work.revision)||1,quote(work.updatedAt)].join(',')+');');}
statements.push("INSERT OR IGNORE INTO settings (key,data) VALUES ('site',"+quote(JSON.stringify(catalog.settings))+');');
statements.push("INSERT OR IGNORE INTO settings (key,data) VALUES ('initialized','true');");
let photoKeys=[];
try{photoKeys=(await readdir('snapshot/photos')).filter(key=>/^[a-f0-9-]+\.webp$/.test(key));}catch(e){if(e.code!=='ENOENT')throw e;}
const bucket=runtime.r2_buckets?.find(b=>b.binding==='BUCKET')?.bucket_name;
for(const key of photoKeys){
 const file=path.join('snapshot/photos',key),size=(await stat(file)).size;
 run([...base,'r2','object','put',bucket+'/'+key,'--local','--config',config,'--persist-to','.wrangler/state','--file',file,'--content-type','image/webp']);
 statements.push('INSERT OR IGNORE INTO uploads (key,content_type,size,created_at) VALUES ('+[quote(key),quote('image/webp'),size,quote(catalog.exportedAt)].join(',')+');');
}
await writeFile(path.join(localDir,'bootstrap.sql'),statements.join('\n'));
run([...base,'d1','execute','DB','--local','--config',config,'--persist-to','.wrangler/state','--file','.local/bootstrap.sql','--yes']);
console.log('\nLocal setup is ready. Run npm run dev and open http://127.0.0.1:5173');
