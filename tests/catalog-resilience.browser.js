// Run against the local dev server:
// playwright-cli open http://127.0.0.1:5173
// playwright-cli run-code --filename=tests/catalog-resilience.browser.js
// All external requests are mocked; no production data is read or written.
async page => {
  const origin = new URL(page.url()).origin;
  const check = (value, message) => { if (!value) throw new Error(message); };
  const user = { id: '33333333-3333-4333-8333-333333333333', aud: 'authenticated', role: 'authenticated', email: 'resilience@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-11-12T00:00:00Z' };
  const part = value => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const token = `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ sub: user.id, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.test`;
  const work = { id: '11111111-1111-4111-8111-111111111111', slug: 'resilient', title: 'Проверочная фигурка', description: 'Описание фигурки', material: 'Гипс', dimensions: '', price: 500, availability: 'available', status: 'published', featured: false, revision: 1, updated_at: '2026-11-12', category: { name: 'Декор' }, photos: [{ url: '/images/Master.webp', alt: 'Фигурка', position: 0 }], variants: [] };
  let failedTable = null, networkFailure = false, administrator = false;
  const writes = [], errors = [], scenarios = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), table = url.pathname.split('/').pop();
    if (url.origin === origin) return route.continue();
    if (table === failedTable || (table === 'catalog_cards' && failedTable === 'works')) {
      if (networkFailure) return route.abort('failed');
      return route.fulfill({ status: 503, json: { message: 'SECRET_INTERNAL_FAILURE', code: 'XX000' } });
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && !url.pathname.includes('/auth/')) writes.push(table);
    const json = data => route.fulfill({ json: data });
    if (url.pathname.includes('/auth/v1/token')) return json({ access_token: token, refresh_token: 'mock-refresh', expires_in: 3600, token_type: 'bearer', user });
    if (table === 'user') return json(user);
    if (table === 'profiles') return json(administrator ? { id: user.id } : null);
    if (table === 'catalog_cards') {
      const result = await page.evaluate(async ({ works, href }) => (await import('/tests/helpers/catalog-fixture.js')).catalogFixture(works, href), { works: [work, { ...work, id: '11111111-1111-4111-8111-111111111112', slug: 'draft', title: 'Скрытый черновик', status: 'draft' }], href: url.href });
      return route.fulfill({ json: result.rows, headers: { 'content-range': `*/${result.total}`, 'access-control-expose-headers': 'Content-Range' } });
    }
    if (table === 'works') {
      const key = (url.searchParams.get('id') || url.searchParams.get('slug'))?.slice(3);
      return route.fulfill({ json: ([work, { ...work, id: '11111111-1111-4111-8111-111111111112', slug: 'draft', title: 'Скрытый черновик', status: 'draft' }]).find(work => work.id === key || work.slug === key) ?? null });
    }

    if (table === 'site_settings') return json({ name: 'Тестовая мастерская', hero_mode: 'standard', contact: '' });
    if (table === 'categories') return json([{ name: 'Декор' }]);
    if (table === 'category_list_state') return json({ revision: 7 });
    if (table === 'favorite_counts') return json({});
    if (table === 'favorites') return json([{ work_id: work.id }]);
    if (table === 'tree_ornaments') return json([]);
    if (table === 'chat_inbox') return json({ threads: [], unread_count: 0, has_more: false });
    if (table === 'cart_list') return json([]);
    return route.abort();
  });
  await page.goto(origin);
  await page.evaluate(() => localStorage.clear());
  const cards = page.locator('.work-card');
  const retry = () => page.getByRole('button', { name: /Попробовать снова|Повторить загрузку|Повторить/ }).first();
  const assertCatalog = async () => {
    await cards.first().waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.work-card').length === 1 && document.querySelector('#catalog')?.getAttribute('aria-busy') === 'false');
    check(!(await page.locator('body').innerText()).includes('SECRET_INTERNAL_FAILURE'), 'Raw server error exposed');
  };
  for (const table of ['category_list_state', 'categories', 'site_settings', 'tree_ornaments']) {
    failedTable = table;
    await page.goto(origin);
    await assertCatalog();
    await retry().waitFor();
    await cards.first().locator('.title-button').click();
    await page.locator('.detail-copy').waitFor();
    await page.goto(origin);
    await assertCatalog();
    failedTable = null;
    await retry().click();
    await page.getByRole('button', { name: /Попробовать снова|Повторить загрузку|Повторить/ }).waitFor({ state: 'hidden' });
    await assertCatalog();
    scenarios.push(`${table}: 503, product view, retry`);
  }
  failedTable = 'category_list_state'; networkFailure = true;
  await page.goto(origin); await assertCatalog(); await retry().waitFor();
  scenarios.push('metadata network failure');
  networkFailure = false; failedTable = 'works';
  await page.goto(origin);
  await page.getByRole('heading', { name: 'Не удалось загрузить работы' }).waitFor();
  check(await cards.count() === 0, 'Failed initial works request showed invented products');
  check(!(await page.locator('body').innerText()).includes('SECRET_INTERNAL_FAILURE'), 'Raw fatal error exposed');
  failedTable = null; await retry().click(); await assertCatalog();
  scenarios.push('works: fatal error and retry');
  // A real UI login with mocked Auth lets favorites fail for an authenticated visitor.
  failedTable = 'favorites';
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Пароль', { exact: true }).fill('mock-password');
  await page.getByRole('dialog').getByRole('button', { name: 'Войти', exact: true }).click();
  await assertCatalog();
  await retry().waitFor();
  check(await cards.first().locator('.favorite-toggle').isDisabled(), 'Unknown favorites can be mutated');
  failedTable = null; await retry().click();
  await page.waitForFunction(() => document.querySelector('.favorite-toggle')?.getAttribute('aria-pressed') === 'true');
  scenarios.push('favorites failure after login and retry');
  administrator = true; failedTable = 'category_list_state';
  await page.goto(origin); await assertCatalog(); await retry().waitFor();
  check(await page.getByRole('button', { name: 'Добавить работу', exact: true }).count() === 0, 'Editor available with fallback metadata');
  await page.goto(`${origin}/?account=admin&section=settings`);
  await retry().waitFor();
  check(await page.locator('#site-name').count() === 0, 'Embedded settings editor can save fallback values');
  check(!writes.includes('site_settings') && !writes.includes('save_categories'), 'Fallback metadata was written');
  scenarios.push('admin metadata guards, including embedded settings');
  failedTable = 'profiles';
  await page.goto(origin); await assertCatalog(); await retry().waitFor();
  check(await page.getByRole('button', { name: 'Добавить работу', exact: true }).count() === 0, 'Failed role check retained admin privileges');
  scenarios.push('role failure preserves public catalog and fails closed');
  check(errors.length === 0, `Browser errors: ${errors.join(', ')}`);
  await page.unroute('**/*');
  return { passed: true, scenarios, browserErrors: errors };
}
