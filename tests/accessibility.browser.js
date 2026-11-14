// playwright-cli open http://127.0.0.1:5173
// playwright-cli run-code --filename=tests/accessibility.browser.js
// All external requests are mocked; no production data is read or changed.
async page => {
  const origin = new URL(page.url()).origin;
  const check = (value, message) => { if (!value) throw new Error(message); };
  const errors = [], results = [];
  let mode = 'standard';
  const alts = ['file_000123.png', '99b0f80b-96df-46a6-b409-56108c730596', 'IMG_1234', '', 'Белая фигурка с золотым бантом'];
  const titles = alts.map((_, i) => `Украшение ${i + 1}`);
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    const data = {
      works: alts.map((alt, i) => ({
        id: `11111111-1111-4111-8111-11111111111${i}`, title: titles[i],
        description: 'Описание работы', material: 'Гипс', dimensions: '', price: 500,
        availability: 'available', status: 'published', featured: true, revision: 1,
        updated_at: '2026-11-14', category: { name: i === 4 ? 'Подарки' : 'Декор' },
        photos: [{ url: '/images/Master.webp', alt, position: 0 },
          { url: '/images/Main_logo.webp', alt: 'Вид с обратной стороны', position: 1 }], variants: [],
      })),
      site_settings: { name: 'Тестовая мастерская', hero_mode: mode, contact: '' },
      categories: [{ name: 'Декор' }, { name: 'Подарки' }], category_list_state: { revision: 1 }, tree_ornaments: [], favorite_counts: [],
    };
    const table = url.pathname.split('/').pop();
    if (table === 'catalog_cards') {
      const result = await page.evaluate(async ({ works, href }) => (await import('/tests/helpers/catalog-fixture.js')).catalogFixture(works, href), { works: data.works, href: url.href });
      return route.fulfill({ json: result.rows, headers: { 'content-range': `*/${result.total}`, 'access-control-expose-headers': 'Content-Range' } });
    }
    if (table === 'works') {
      const key = (url.searchParams.get('id') || url.searchParams.get('slug'))?.slice(3);
      return route.fulfill({ json: (data.works).find(work => work.id === key || work.slug === key) ?? null });
    }
    if (Object.hasOwn(data, table)) return route.fulfill({ json: data[table] });
    return route.abort();
  });
  const assertAlt = async (selector, expected) => check(await page.locator(selector).getAttribute('alt') === expected, `${selector}: incorrect alt`);
  try {
    for (mode of ['standard', 'new-year']) {
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.goto(origin);
        await page.locator('.work-card').first().waitFor();
        await page.keyboard.press('Tab');
        const skip = page.getByRole('link', { name: 'Перейти к каталогу' });
        check(await skip.evaluate(el => el === document.activeElement), `${mode}/${width}: skip link must receive first focus`);
        const box = await skip.boundingBox();
        check(box && box.y >= 0 && box.x >= 0 && box.x + box.width <= width, 'Focused skip link must be on screen');
        await page.keyboard.press('Enter');
        check(await page.locator('#catalog').evaluate(el => el === document.activeElement), 'Skip link must focus main');
        await page.keyboard.press('Tab');
        const group = page.getByRole('group', { name: 'Фильтр по категориям' });
        const all = group.getByRole('button', { name: 'Все работы', exact: true });
        check(await all.evaluate(el => el === document.activeElement), 'Tab must continue inside catalog');
        check(await all.getAttribute('aria-pressed') === 'true', 'All works initially selected');
        await page.keyboard.press('Tab');
        await page.keyboard.press('Enter');
        check(await group.getByRole('button', { name: 'Декор', exact: true }).getAttribute('aria-pressed') === 'true', 'Keyboard category selection');
        check(await all.getAttribute('aria-pressed') === 'false', 'Previous category must be deselected');
        await page.waitForFunction(() => document.querySelectorAll('.work-card').length === 4);
        check(await page.locator('.work-card').count() === 4, 'Selected category must filter works');
        await all.focus();
        await page.keyboard.press('Space');
        await page.waitForFunction(() => document.querySelectorAll('.work-card').length === 5);
        check(await page.locator('.work-card').count() === 5, 'Reset must show all works');
        check(await group.locator('[aria-pressed="true"]').count() === 1, 'Exactly one selected category');
        for (let i = 0; i < alts.length; i++) {
          await assertAlt(`.work-card:nth-child(${i + 1}) .card-photo img`, i === 4 ? alts[i] : titles[i]);
        }
        const badges = page.locator('.featured-icon');
        check(await badges.count() === 5, 'Missing featured badges');
        check(await badges.evaluateAll(elements => elements.every(el =>
          !el.hasAttribute('aria-label') && el.querySelector('.sr-only')?.textContent === 'Выбор мастера' &&
          el.querySelector('svg')?.getAttribute('aria-hidden') === 'true')), 'Badge must expose text and hide decorative SVG');
        if (mode === 'standard') {
          check(await page.locator('.standard-card-photo img').evaluateAll(elements => elements.every(el =>
            /^Украшение \d$/.test(el.alt) || el.alt === 'Белая фигурка с золотым бантом')), 'Hero must use meaningful alt');
        }
        await page.addScriptTag({ url: `${origin}/node_modules/axe-core/axe.min.js` });
        const axe = await page.evaluate(async () => {
          const result = await window.axe.run(document.querySelector('#catalog'), {
            runOnly: { type: 'rule', values: ['aria-prohibited-attr', 'aria-allowed-attr', 'aria-valid-attr-value', 'image-alt'] },
          });
          return { version: window.axe.version, violations: result.violations.map(item => ({ id: item.id, nodes: item.nodes.length })) };
        });
        check(axe.violations.length === 0, `axe: ${JSON.stringify(axe.violations)}`);
        await page.getByRole('button', { name: `Рассмотреть ${titles[0]}`, exact: true }).click();
        await assertAlt('.product-gallery-expand img', titles[0]);
        await page.getByRole('button', { name: 'Следующее фото', exact: true }).click();
        await assertAlt('.product-gallery-expand img', 'Вид с обратной стороны');
        await page.getByRole('button', { name: 'Предыдущее фото', exact: true }).click();
        await page.getByRole('button', { name: 'Открыть фото на весь экран' }).click();
        await page.locator('.photo-lightbox-stage img').waitFor();
        await assertAlt('.photo-lightbox-stage img', titles[0]);
        await page.keyboard.press('ArrowRight');
        await assertAlt('.photo-lightbox-stage img', 'Вид с обратной стороны');
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');
        check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Horizontal overflow');
        results.push({ mode, width, axe, keyboard: true, alt: true });
      }
    }
    check(errors.length === 0, `JavaScript errors: ${errors.join(', ')}`);
    return { passed: true, results, errors };
  } finally {
    await page.unroute('**/*');
  }
}
