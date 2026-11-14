// playwright-cli open http://127.0.0.1:5173
// playwright-cli run-code --filename=tests/readability.browser.js
// External requests are mocked. No accounts are created and no emails are sent.
async page => {
  const origin = new URL(page.url()).origin;
  const check = (value, message) => { if (!value) throw new Error(message); };
  let mode = 'standard';
  const errors = [], results = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    const table = url.pathname.split('/').pop();
    const data = {
      works: Array.from({ length: 5 }, (_, i) => ({
        id: `11111111-1111-4111-8111-11111111111${i}`, title: 'Украшение ручной работы',
        description: 'Описание работы', material: 'Гипс', dimensions: '', price: 500,
        availability: 'available', status: 'published', featured: true, revision: 1,
        updated_at: '2026-11-12', category: { name: 'Декор' },
        photos: [{ url: '/images/Master.webp', alt: 'Фигурка', position: 0 }], variants: [],
      })),
      site_settings: { name: 'Тестовая мастерская', hero_mode: mode, contact: '' },
      categories: [{ name: 'Декор' }], category_list_state: { revision: 1 }, tree_ornaments: [],
    };
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
  try {
    for (mode of ['standard', 'new-year']) {
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.goto(origin);
        await page.locator('.work-card').first().waitFor();
        await page.locator(mode === 'standard' ? '.standard-hero' : '.winter-hero').waitFor();
        await page.evaluate(() => document.fonts.ready);
        const metrics = await page.evaluate(() => {
          const luminance = rgb => rgb.map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4)
            .reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
          const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
          const rgb = color => color.match(/[\d.]+/g).slice(0, 3).map(Number);
          const strip = document.querySelector('.winter-values');
          const captions = [...strip.querySelectorAll('span, small')].map(el => {
            const style = getComputedStyle(el), rect = el.getBoundingClientRect();
            return { text: el.textContent, size: parseFloat(style.fontSize), tracking: parseFloat(style.letterSpacing),
              contrast: contrast(rgb(style.color), rgb(getComputedStyle(strip).backgroundColor)),
              visible: rect.width > 0 && rect.height > 0,
              fits: el.scrollWidth <= el.clientWidth + 1 && rect.left >= 0 && rect.right <= innerWidth };
          });
          const eyebrow = document.querySelector('.winter-eyebrow');
          const cards = [...document.querySelectorAll('.standard-card-caption')].map(el => parseFloat(getComputedStyle(el).fontSize));
          return { documentFits: document.documentElement.scrollWidth <= innerWidth,
            stripFits: strip.scrollWidth <= strip.clientWidth, captions, cards,
            eyebrow: eyebrow ? { size: parseFloat(getComputedStyle(eyebrow).fontSize), fits: eyebrow.scrollWidth <= eyebrow.clientWidth } : null };
        });
        check(metrics.documentFits && metrics.stripFits, `${mode}/${width}: horizontal overflow`);
        check(metrics.captions.length === 6, 'Missing benefit captions');
        for (const caption of metrics.captions) {
          check(caption.visible && caption.fits && caption.size >= 12 && caption.tracking <= 1 && caption.contrast >= 4.5,
            `${mode}/${width}: unreadable caption ${JSON.stringify(caption)}`);
        }
        check(metrics.cards.every(size => size >= 12), 'Small carousel caption');
        if (metrics.eyebrow) check(metrics.eyebrow.size >= 12 && metrics.eyebrow.fits, 'Small or clipped winter eyebrow');
        await page.screenshot({ path: `.local/f03-readability/${mode}-${width}.png`, animations: 'disabled' });
        const forms = [];
        await page.getByRole('button', { name: 'Войти', exact: true }).click();
        for (const form of ['login', 'registration', 'recovery']) {
          if (form === 'registration') await page.locator('.auth-switch').click();
          if (form === 'recovery') {
            await page.locator('.auth-switch').click();
            await page.locator('.auth-forgot').click();
          }
          const inputs = page.locator('.auth-form input');
          await inputs.first().waitFor();
          await inputs.first().fill('readability@example.test');
          const fields = await inputs.evaluateAll(elements => elements.map(el => {
            const rect = el.getBoundingClientRect(), dialog = el.closest('[role="dialog"], dialog');
            return { size: parseFloat(getComputedStyle(el).fontSize), height: rect.height,
              fits: rect.left >= 0 && rect.right <= innerWidth && dialog.scrollWidth <= dialog.clientWidth + 1 };
          }));
          check(fields.length > 0 && fields.every(field => field.size >= 16 && field.height >= 44 && field.fits),
            `${mode}/${width}/${form}: unreadable or overflowing input`);
          forms.push({ form, fields });
          if (form === 'login') await page.screenshot({ path: `.local/f03-readability/${mode}-login-${width}.png`, animations: 'disabled' });
        }
        await page.getByRole('button', { name: 'Отмена', exact: true }).click();
        results.push({ mode, width, ...metrics, forms });
      }
    }
    check(errors.length === 0, `JavaScript errors: ${errors.join(', ')}`);
    return { passed: true, results, errors };
  } finally {
    await page.unroute('**/*');
  }
}
