import { test } from 'node:test';
import assert from 'node:assert/strict';
import { variantPhotos } from '../lib/variant-gallery.ts';
import { catalogPrice, filterWorks, type Variant, type Work } from '../lib/model.ts';
const variant: Variant = { id: 'part', name: 'Фигурка', imageUrl: 'old.webp', price: null, availability: 'available', position: 0 };
test('gallery is independent, including an explicitly empty gallery and old covers', () => {
 assert.deepEqual(variantPhotos(variant), [{ url: 'old.webp', alt: 'Фигурка' }]);
 assert.deepEqual(variantPhotos({ ...variant, photos: [] }), []);
 assert.deepEqual(variantPhotos({ ...variant, photos: [{ url: 'new.webp', alt: 'Новая' }] }), [{ url: 'new.webp', alt: 'Новая' }]);
});
test('collection price and sorting use individual figures instead of the unrelated set price', () => {
 const work = { id: 'collection', price: 9999, variants: [variant, { ...variant, id: 'priced', price: 400 }, { ...variant, id: 'sold', availability: 'sold', price: 10 }] } as Work;
 assert.equal(catalogPrice(work), 400);
 assert.equal(catalogPrice({ ...work, soldAsSet: true }), 9999);
 assert.equal(catalogPrice({ ...work, variants: [variant] }), null);
 assert.equal(catalogPrice({ ...work, variants: [{ ...variant, price: 0 }] }), 0);
 const standalone = { ...work, id: 'single', price: 500, variants: [] };
 assert.equal(filterWorks([standalone, work], '', '', 'price')[0].id, 'collection');
});
