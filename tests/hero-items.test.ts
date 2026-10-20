import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seed, type Work } from '../lib/model.ts';
import { carouselOffset, heroItems } from '../src/hero-items.ts';

test('hero only shows visible works with photos, prioritizing featured then newest without changing the catalog', () => {
  const works: Work[] = [
    { ...seed[0], id: 'old-featured', updatedAt: '2020-01-01' },
    { ...seed[1], id: 'new', updatedAt: '2026-10-20' },
    { ...seed[0], id: 'draft', status: 'draft' },
    { ...seed[0], id: 'archive', status: 'archived' },
    { ...seed[0], id: 'sold', availability: 'sold' },
    { ...seed[0], id: 'no-photo', photos: [] },
    { ...seed[0], id: 'featured', updatedAt: '2026-10-19' },
  ];
  const original = [...works];
  assert.deepEqual(heroItems(works).map((work) => work.id), ['featured', 'old-featured', 'new']);
  assert.deepEqual(works, original);
  assert.deepEqual(heroItems([]), []);
  assert.equal(heroItems(Array.from({ length: 20 }, (_, i) => ({ ...seed[0], id: String(i) }))).length, 10);
});

test('carousel wraps around and keeps small collections free of duplicate cards', () => {
  assert.equal(carouselOffset(0, 4, 5), 1);
  assert.equal(carouselOffset(4, 0, 5), -1);
  assert.equal(carouselOffset(3, 0, 5), -2);
  assert.equal(carouselOffset(0, 0, 0), 0);
  assert.equal(carouselOffset(0, 0, 1), 0);
  for (let count = 2; count <= 10; count++) {
    for (let active = 0; active < count; active++) {
      const offsets = Array.from({ length: count }, (_, index) => carouselOffset(index, active, count));
      assert.equal(new Set(offsets).size, count);
      assert.equal(offsets.filter((value) => value === 0).length, 1);
      assert.ok(offsets.every((value) => Math.abs(value) <= Math.ceil(count / 2)));
    }
  }
});
