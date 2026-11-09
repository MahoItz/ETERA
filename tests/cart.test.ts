import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cartItemState, cartVariantId, selectionPath, type CartItem } from '../lib/cart.ts';
import type { Work } from '../lib/model.ts';

const work: Work = { id:'work',title:'Фея',description:'',category:'',material:'',dimensions:'',price:100,availability:'available',status:'published',featured:false,photos:[],variants:[],revision:1,updatedAt:'' };
const item: CartItem = { id:'item',user_id:'user',created_at:'',snapshot:{work_id:'work',variant_id:null,work_slug:null,variant_slug:null,title:'Фея',variant_name:null,image_url:null,price:100,sold_as_set:false} };
test('deleted and sold selections retain their label and cannot be sent',()=>{
  assert.equal(cartItemState(item,[]).available,false);
  assert.equal(cartItemState(item,[{...work,availability:'sold'}]).available,false);
  assert.equal(cartItemState(item,[]).selection.title,'Фея');
});
test('whole sets and their exact variants remain separate selections',()=>{
  assert.equal(cartVariantId({...work,soldAsSet:true},'variant'),'variant');
  assert.equal(cartVariantId({...work,soldAsSet:true},null),null);
  const collection={...work,variants:[{id:'variant',name:'Синяя',price:200,imageUrl:null,availability:'available' as const,position:0}]};
  assert.equal(cartItemState(item,[collection]).available,false);
  const selected={...item,snapshot:{...item.snapshot,variant_id:'variant'}};
  assert.equal(cartItemState(selected,[collection]).selection.variant_name,'Синяя');
  const set={...collection,soldAsSet:true};
  const whole=cartItemState(item,[set]);
  assert.equal(whole.available,true);
  assert.equal(whole.selection.variant_id,null);
  assert.equal(whole.selection.price,100);
  assert.equal(whole.selection.sold_as_set,true);
  const single=cartItemState(selected,[set]);
  assert.equal(single.available,true);
  assert.equal(single.selection.variant_id,'variant');
  assert.equal(single.selection.variant_name,'Синяя');
  assert.equal(single.selection.price,200);
  assert.equal(single.selection.sold_as_set,false);
  const path=new URL(selectionPath(single.selection),'https://example.test');
  assert.equal(path.searchParams.get('variant'),'variant');
  assert.equal(cartItemState(selected,[{...set,variants:[]}]).available,false);
  assert.equal(cartItemState(selected,[{...set,variants:[{...set.variants[0],availability:'sold'}]}]).available,false);
});
test('fresh server availability and price take precedence over a stale catalogue',()=>{
  assert.equal(cartItemState({...item,available:false,current:null},[work]).available,false);
  assert.equal(cartItemState({...item,available:true,current:{...item.snapshot,price:150}},[work]).selection.price,150);
});
test('selection links preserve deployment base and encode catalogue slugs',()=>{
  const path=selectionPath({...item.snapshot,work_slug:'фея & ёлка',variant_id:'v',variant_slug:'синяя'},'/Gips/');
  const url=new URL(path,'https://example.test');
  assert.equal(url.pathname,'/Gips/');assert.equal(url.searchParams.get('work'),'фея & ёлка');assert.equal(url.searchParams.get('variant'),'синяя');
});
