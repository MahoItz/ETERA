import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalogPrice, seed, workVariantCount } from '../lib/model.ts';
import { mergeCatalogWorks } from '../lib/catalog-cache.ts';
import { imagePreview } from '../lib/image-preview.ts';
test('summary price and variant count do not depend on downloading variants',()=>{
  const summary={...seed[0],detailsLoaded:false,variants:[],variantCount:12,catalogPrice:0};
  assert.equal(catalogPrice(summary),0); assert.equal(workVariantCount(summary),12);
  assert.equal(catalogPrice({...summary,catalogPrice:null}),null);
});
test('summary merges preserve a loaded gallery only at the same revision',()=>{
  const full={...seed[0],detailsLoaded:true};
  const summary={...full,photos:[],description:'',detailsLoaded:false};
  assert.equal(mergeCatalogWorks([full],[summary])[0],full);
  assert.equal(mergeCatalogWorks([full],[{...summary,revision:full.revision+1}])[0].detailsLoaded,false);
  assert.equal(mergeCatalogWorks([summary],[full])[0],full);
});
test('responsive URLs transform only public catalogue storage photos and preserve the original input',()=>{
  const source='https://test.supabase.co/storage/v1/object/public/work-photos/works/photo.webp';
  const url=new URL(imagePreview(source,320)!);
  assert.equal(url.pathname,'/storage/v1/render/image/public/work-photos/works/photo.webp');
  assert.equal(url.searchParams.get('width'),'320'); assert.equal(url.searchParams.get('quality'),'75');
  for(const other of ['/images/logo.webp','blob:https://elveria.ru/id','data:image/webp,test','https://other.example/photo.webp']) assert.equal(imagePreview(other,320),null);
});
