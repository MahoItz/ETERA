// npm run build && npm run security:headers
// node tests/security-headers-server.mjs
// playwright-cli open http://127.0.0.1:4188
// playwright-cli run-code --filename=tests/security-headers.browser.js
// Production bundle with real HTTP CSP; external API requests are mocked.
async page => {
  const origin = 'http://127.0.0.1:4188';
  const check = (value, message) => { if (!value) throw new Error(message); };
  let mode = 'standard';
  const results = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    window.policyViolations = [];
    document.addEventListener('securitypolicyviolation', event => window.policyViolations.push({
      directive: event.effectiveDirective, blocked: event.blockedURI,
    }));
  });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['http://127.0.0.1:4188', 'http://127.0.0.1:4189'].includes(url.origin)) return route.continue();
    const work = { id: '11111111-1111-4111-8111-111111111110', title: 'Тестовая фигурка',
      description: 'Декор', material: 'Гипс', dimensions: '', price: 500, availability: 'available',
      status: 'published', featured: true, revision: 1, updated_at: '2026-11-14', category: { name: 'Декор' },
      photos: [{ url: '/images/Master.webp', alt: 'Фигурка', position: 0 }, { url: '/images/Main_logo.webp', alt: 'Второе фото', position: 1 }], variants: [] };
    const table = url.pathname.split('/').pop();
    const data = { works: [work], site_settings: { name: 'Мастерская', hero_mode: mode, contact: '' },
      categories: [{ name: 'Декор' }], category_list_state: { revision: 1 }, tree_ornaments: [], favorite_counts: [] };
    return Object.hasOwn(data, table) ? route.fulfill({ json: data[table] }) : route.abort();
  });
  try {
    for (mode of ['standard', 'new-year']) {
      for (const width of [320, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.goto(origin);
        await page.locator('.work-card').first().waitFor();
        check(await page.evaluate(() => document.querySelector('#asset-recovery') !== null), 'Recovery script missing');
        await page.getByRole('button', { name: 'Войти', exact: true }).click();
        await page.getByLabel('Пароль', { exact: true }).fill('mock-password');
        await page.getByRole('button', { name: 'Показать пароль', exact: true }).click();
        await page.locator('.auth-switch').click();
        await page.getByLabel('Никнейм', { exact: true }).fill('Тест');
        await page.locator('.auth-switch').click();
        await page.locator('.auth-forgot').click();
        await page.getByRole('button', { name: 'Отмена', exact: true }).click();
        await page.getByRole('button', { name: 'Рассмотреть Тестовая фигурка', exact: true }).click();
        await page.getByRole('button', { name: 'Следующее фото', exact: true }).click();
        await page.getByRole('button', { name: 'Открыть фото на весь экран' }).click();
        await page.locator('.photo-lightbox-stage img').waitFor();
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');
        const previews = await page.evaluate(async () => {
          const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';
          const blob = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
          try {
            return await Promise.all([blob, `data:image/svg+xml,${encodeURIComponent(svg)}`].map(src => new Promise(resolve => {
              const image = new Image(); image.onload = () => resolve(true); image.onerror = () => resolve(false); image.src = src;
            })));
          } finally { URL.revokeObjectURL(blob); }
        });
        check(previews.every(Boolean), 'Blob/data images blocked');
        check(await page.evaluate(() => window.policyViolations.length === 0), `Unexpected CSP violations: ${JSON.stringify(await page.evaluate(() => window.policyViolations))}`);
        await page.evaluate(() => {
          const script = document.createElement('script');
          script.textContent = 'window.untrustedScriptExecuted = true';
          document.head.append(script);
          const external = document.createElement('script'); external.src = 'https://untrusted.example/script.js'; document.head.append(external);
        });
        await page.waitForFunction(() => window.policyViolations.length >= 2);
        check(await page.evaluate(() => !window.untrustedScriptExecuted), 'Untrusted inline script executed');
        results.push({ mode, width, normalCspViolations: 0, blockedScripts: await page.evaluate(() => window.policyViolations) });
      }
    }
    await page.goto(origin);
    await page.locator('.work-card').first().waitFor();
    await Promise.all([
      page.waitForURL(url => url.searchParams.has('_etera_reload')),
      page.evaluate(() => {
        const event = new Event('vite:preloadError', { cancelable: true });
        event.payload = new Error('Failed to fetch dynamically imported module: /assets/old.js');
        window.dispatchEvent(event);
      }),
    ]);
    await page.locator('.work-card').first().waitFor();
    results.push({ inlineRecoveryExecuted: true });
    for (const parent of [origin, 'http://127.0.0.1:4189']) {
      const messages = [];
      const listener = message => messages.push(message.text());
      page.on('console', listener);
      await page.goto(`${parent}/embed-test.html`);
      await page.waitForFunction(() => document.querySelector('iframe') !== null);
      await page.waitForTimeout(300);
      check(!page.frames().some(frame => frame !== page.mainFrame() && frame.url() === `${origin}/`), 'Embedded app loaded');
      check(messages.some(message => /frame-ancestors|X-Frame-Options/.test(message)), 'Missing browser framing refusal');
      page.off('console', listener);
      results.push({ parent, embeddingBlocked: true });
    }
    check(errors.length === 0, errors.join('; '));
    return { passed: true, results, errors };
  } finally { await page.unroute('**/*'); }
}
