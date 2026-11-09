import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const source = html.match(/<script id="asset-recovery">([\s\S]*?)<\/script>/)[1].replaceAll('%BASE_URL%', '/');
const key = 'etera:asset-recovery:v1';
const now = 1_800_000_000_000;

function browser({ href = 'https://elveria.ru/?work=bird&auth=recovery#access_token=secret', storage = new Map(), denied = false, time = now, loading = false } = {}) {
  const listeners = new Map();
  const documentListeners = new Map();
  const navigations = [];
  const root = { children: [], replaceChildren(...children) { this.children = children; } };
  let reloads = 0;
  const window = {
    location: { href, replace(url) { navigations.push(url); }, reload() { reloads++; } },
    addEventListener(name, callback, capture) { listeners.set(name, { callback, capture }); },
    get sessionStorage() {
      if (denied) throw new Error('SecurityError');
      return { getItem: (name) => storage.get(name) ?? null, setItem: (name, value) => storage.set(name, value) };
    },
  };
  const document = {
    readyState: loading ? 'loading' : 'complete',
    getElementById: () => root,
    addEventListener(name, callback) { documentListeners.set(name, callback); },
    createElement(tagName) { return { tagName, setAttribute() {}, append(...children) { this.children = children; } }; },
  };
  runInNewContext(source, { window, document, URL, Date: { now: () => time } });
  return {
    navigations, storage, root, documentListeners,
    get reloads() { return reloads; },
    preload(message = 'Failed to fetch dynamically imported module: https://elveria.ru/assets/PhotoLightbox-old.js') {
      const event = { payload: new Error(message), prevented: false, preventDefault() { this.prevented = true; } };
      listeners.get('vite:preloadError').callback(event);
      return event;
    },
    resource(target) {
      assert.equal(listeners.get('error').capture, true);
      listeners.get('error').callback({ target });
    },
  };
}

test('early inline handler precedes the entry module and busts HTML cache preserving navigation/auth', () => {
  assert.ok(html.indexOf('id="asset-recovery"') < html.indexOf('src="/src/main.tsx"'));
  const page = browser();
  assert.equal(page.preload().prevented, true);
  const target = new URL(page.navigations[0]);
  assert.equal(target.searchParams.get('_etera_reload'), String(now));
  assert.equal(target.searchParams.get('work'), 'bird');
  assert.equal(target.searchParams.get('auth'), 'recovery');
  assert.equal(target.hash, '#access_token=secret');
  assert.equal(page.storage.get(key), String(now));
  page.preload('Unable to preload CSS for /assets/App-old.css');
  assert.equal(page.navigations.length, 1);
});

test('breaker survives navigation, successful mount, and subsequent lazy failures until cooldown', () => {
  const first = browser();
  first.preload();
  const second = browser({ href: first.navigations[0], storage: first.storage, time: now + 1000 });
  assert.equal(second.preload().prevented, false);
  assert.equal(second.navigations.length, 0);
  // A route change may remove the URL marker; the tab storage still protects it.
  assert.equal(browser({ storage: first.storage }).preload().prevented, false);
  const later = browser({ href: first.navigations[0], storage: first.storage, time: now + 600_001 });
  assert.equal(later.preload().prevented, true);
  assert.equal(later.navigations.length, 1);
});

test('URL breaker prevents reload loops when sessionStorage is denied', () => {
  const first = browser({ denied: true });
  first.preload();
  const second = browser({ denied: true, href: first.navigations[0], time: now + 1 });
  assert.equal(second.preload().prevented, false);
  assert.equal(second.navigations.length, 0);
});

test('browser module/CSS preload messages recover but ordinary runtime errors remain visible', () => {
  for (const message of ['error loading dynamically imported module: /assets/App.js', 'Importing a module script failed.', 'Unable to preload CSS for /assets/App.css']) {
    assert.equal(browser().preload(message).prevented, true);
  }
  const page = browser();
  assert.equal(page.preload('Cannot read properties of undefined').prevented, false);
  assert.equal(page.navigations.length, 0);
});

test('initial entry module and stylesheet failures use the same recovery budget', () => {
  for (const target of [
    { tagName: 'SCRIPT', type: 'module', src: 'https://elveria.ru/assets/index-old.js' },
    { tagName: 'LINK', rel: 'stylesheet', href: 'https://elveria.ru/assets/index-old.css' },
    { tagName: 'LINK', rel: 'stylesheet', href: 'https://elveria.ru/assets/App-old.css' },
  ]) {
    const first = browser();
    first.resource(target);
    assert.equal(first.navigations.length, 1);
    const second = browser({ href: first.navigations[0], storage: first.storage, loading: true });
    second.resource(target);
    assert.equal(second.navigations.length, 0);
    second.documentListeners.get('DOMContentLoaded')();
    const fallback = second.root.children[0];
    assert.equal(fallback.children[0].textContent, 'Сайт временно недоступен');
    fallback.children[2].onclick();
    assert.equal(second.reloads, 1);
  }
});

test('images, API/runtime errors, third-party and non-build resources do not trigger recovery', () => {
  const page = browser();
  for (const target of [
    undefined,
    { tagName: 'IMG', src: '/assets/photo.png' },
    { tagName: 'SCRIPT', type: 'module', src: 'https://other.test/assets/index-old.js' },
    { tagName: 'SCRIPT', type: 'module', src: '/api/index.js' },
    { tagName: 'SCRIPT', type: 'text/javascript', src: '/assets/index-old.js' },
    { tagName: 'LINK', rel: 'icon', href: '/assets/favicon.png' },
    { tagName: 'LINK', rel: 'stylesheet', href: '/images/styles.css' },
  ]) page.resource(target);
  assert.equal(page.navigations.length, 0);
  assert.equal(page.root.children.length, 0);
});
