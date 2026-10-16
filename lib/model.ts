export type Photo = {url:string; alt:string};
export type Work = {id:string; title:string; description:string; category:string; material:string; dimensions:string; price:number|null; availability:'available'|'order'|'sold'; status:'published'|'draft'|'archived'; featured:boolean; treeImage?:string|null; showOnTree?:boolean; photos:Photo[]; revision:number; updatedAt:string};
export type Settings = {name:string; contact:string; categories:string[]};
export const defaults:Settings={name:'Etera',contact:'',categories:['Феи и балерины','Барашки','Декор для дома']};
export const seed:Work[]=[
{id:'fairies',title:'Феи-балерины',description:'Подвесные фигурки из гипса с ручной росписью. Разные цвета, маленькие детали и праздничное настроение. На фотографии — коллекция работ; цвет и исполнение можно обсудить с мастером.',category:'Феи и балерины',material:'Гипс',dimensions:'',price:null,availability:'order',status:'published',featured:true,photos:[{url:'/images/fairies.jpg',alt:'Коллекция расписанных фей-балерин'}],revision:1,updatedAt:'2026-10-13T10:00:00Z'},
{id:'lambs',title:'Барашки с золотым бантом',description:'Декоративные подвески из гипса с ручной росписью. Мягкие оттенки, фактурная шерстка и золотые акценты. На фотографии — два варианта работы.',category:'Барашки',material:'Гипс',dimensions:'',price:null,availability:'order',status:'published',featured:false,photos:[{url:'/images/lambs.jpg',alt:'Две подвески с белыми барашками и золотыми бантами'}],revision:1,updatedAt:'2026-10-12T10:00:00Z'}
];
export function validateWork(input:unknown): Omit<Work,'id'|'revision'|'updatedAt'> {
 if(!input||typeof input!=='object')throw new Error('Некорректная карточка');
 const x=input as Record<string,unknown>;
 const str=(k:string,max:number,required=false)=>{if(typeof x[k]!=='string'||(required&&!String(x[k]).trim())||String(x[k]).length>max)throw new Error('Проверьте поле: '+k);return String(x[k]).trim();};
 const title=str('title',120,true), description=str('description',4000), category=str('category',80,true),material=str('material',100),dimensions=str('dimensions',150);
 if(!['published','draft','archived'].includes(String(x.status)))throw new Error('Неверный статус публикации');
 if(!['available','order','sold'].includes(String(x.availability)))throw new Error('Неверный статус наличия');
 if(x.price!==null&&(typeof x.price!=='number'||!Number.isFinite(x.price)||x.price<0||x.price>10000000))throw new Error('Некорректная цена');
 if(!Array.isArray(x.photos)||x.photos.length>8||(x.status==='published'&&x.photos.length===0))throw new Error('Для показа нужна фотография. Максимум — 8.');
 const photos=x.photos.map((p:unknown)=>{if(!p||typeof p!=='object')throw new Error('Некорректная фотография');const q=p as Photo;
 if(typeof q.url!=='string'||!/^\/(?:images\/[a-zA-Z0-9._-]+|api\/photos\/[a-f0-9-]+\.webp)$/.test(q.url))throw new Error('Недопустимый адрес фотографии');
 return {url:q.url,alt:typeof q.alt==='string'?q.alt.slice(0,200):title};});
 return {title,description,category,material,dimensions,price:x.price as number|null,availability:x.availability as Work['availability'],status:x.status as Work['status'],featured:!!x.featured,photos};
}
export function visibleWorks(works:Work[]){return works.filter(w=>w.status==='published'&&w.availability!=='sold');}
export function filterWorks(works:Work[],q:string,category:string,sort:string){
 const search=q.trim().toLocaleLowerCase('ru');
 return works.filter(w=>(!category||w.category===category)&&(!search||[w.title,w.description,w.material].join(' ').toLocaleLowerCase('ru').includes(search))).sort((a,b)=>{
 if(sort==='name')return a.title.localeCompare(b.title,'ru');
 if(sort==='price')return (a.price??Infinity)-(b.price??Infinity);
 return Number(b.featured)-Number(a.featured)||b.updatedAt.localeCompare(a.updatedAt);
 });
}
