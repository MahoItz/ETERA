import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contactLinks, normalizeContacts } from '../lib/contacts.ts';

const empty = { contact: '', vk: '', telegram: '', phone: '' };

test('contact links preserve optional channels and turn formatted phone numbers into callable links', () => {
  const settings = normalizeContacts({ contact: ' https://instagram.com/etera ', vk: 'https://vk.com/etera', telegram: 'https://t.me/etera', phone: ' +7 (999) 123-45-67 ' });
  assert.equal(settings.contact, 'https://instagram.com/etera');
  assert.equal(settings.phone, '+7 (999) 123-45-67');
  const links = contactLinks(settings);
  assert.deepEqual(links.map(link => link.label), ['Instagram', 'ВКонтакте', 'Telegram', '+7 (999) 123-45-67']);
  assert.equal(links.at(-1)?.href, 'tel:+79991234567');
  assert.deepEqual(contactLinks(empty), []);
  assert.equal(contactLinks({ ...empty, telegram: settings.telegram })[0].href, settings.telegram);
  assert.equal(contactLinks({ ...empty, phone: settings.phone })[0].href, 'tel:+79991234567');
});

test('unsafe link schemes and malformed phone numbers cannot become public contact links', () => {
  for (const contact of ['javascript:alert(1)', 'data:text/html,bad', 'ftp://example.com', 'not a url']) {
    assert.throws(() => normalizeContacts({ ...empty, contact }), /Instagram/);
    assert.deepEqual(contactLinks({ ...empty, contact }), []);
  }
  for (const phone of ['123', '+1234567890123456', 'call me', '++79991234567', 'tel:+79991234567']) {
    assert.throws(() => normalizeContacts({ ...empty, phone }), /номер телефона/);
    assert.deepEqual(contactLinks({ ...empty, phone }), []);
  }
  assert.throws(() => normalizeContacts({ ...empty, vk: 'https://vk.com/' + 'a'.repeat(300) }), /ВКонтакте/);
});
