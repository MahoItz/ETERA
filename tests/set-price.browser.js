// Start the dev server, then run:
// playwright-cli open http://127.0.0.1:5173 --browser chrome
// playwright-cli run-code --filename=tests/set-price.browser.js
// All external requests are mocked; no production data is written.
async page => {
  const origin = new URL(page.url()).origin;
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const normalize = text => text.replace(/\s+/g, ' ').trim();
  const user = { id: '33333333-3333-4333-8333-333333333333', aud: 'authenticated', role: 'authenticated', email: 'cart@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-11-09T00:00:00Z' };
  const part = value => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const token = `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ sub: user.id, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.test`;
  const variant = { id: '22222222-2222-4222-8222-222222222222', slug: 'girl', name: 'Девочка с ёлочкой', price: 300, image_url: '/images/Master.webp', availability: 'available', position: 0, description: 'Описание выбранной фигурки' };
  const soldVariant = { ...variant, id: '22222222-2222-4222-8222-222222222223', slug: 'sold', name: 'Проданная фигурка', availability: 'sold', position: 1 };
  const unpricedVariant = { ...variant, id: '22222222-2222-4222-8222-222222222224', slug: 'unpriced', name: 'Фигурка без цены', price: null, position: 2 };
  const base = { id: '11111111-1111-4111-8111-111111111111', slug: 'set', title: 'Новогодние конфетки', description: 'Описание набора', material: 'Гипс', dimensions: '', price: 1100, sold_as_set: true, availability: 'available', status: 'published', featured: false, revision: 1, updated_at: '2026-11-09', category: { name: 'Декор' }, photos: [{ url: '/images/Master.webp', alt: 'Набор', position: 0 }], variants: [variant, soldVariant, unpricedVariant] };
  const works = [base, { ...base, id: '11111111-1111-4111-8111-111111111112', slug: 'collection', title: 'Отдельные фигурки', sold_as_set: false }, { ...base, id: '11111111-1111-4111-8111-111111111113', slug: 'unknown', title: 'Набор без цены', price: null }];
  const items = [], additions = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), table = url.pathname.split('/').pop();
    if (url.origin === origin) return route.continue();
    const json = data => route.fulfill({ json: data });
    if (url.pathname.includes('/auth/v1/token')) return json({ access_token: token, refresh_token: 'mock-refresh', expires_in: 3600, token_type: 'bearer', user });
    if (table === 'user') return json(user);
    if (table === 'profiles') return json(null);
    if (table === 'works') return json(works);
    if (table === 'site_settings') return json({ name: 'Etera', contact: '' });
    if (table === 'categories') return json([{ name: 'Декор' }]);
    if (table === 'category_list_state') return json({ revision: 1 });
    if (['favorites', 'tree_ornaments'].includes(table)) return json([]);
    if (table === 'chat_inbox') return json({ threads: [], unread_count: 0, has_more: false });
    if (table === 'cart_list') return json(items);
    if (table === 'cart_add') {
      const input = request.postDataJSON();
      additions.push(input);
      const work = works.find(work => work.id === input.target_work_id);
      const chosen = work.variants.find(variant => variant.id === input.target_variant_id);
      const snapshot = { work_id: work.id, variant_id: chosen?.id ?? null, work_slug: work.slug, variant_slug: chosen?.slug ?? null, title: work.title, variant_name: chosen?.name ?? null, image_url: chosen?.image_url ?? work.photos[0].url, price: chosen ? chosen.price : work.price, sold_as_set: work.sold_as_set && !chosen };
      const existing = items.find(item => item.snapshot.work_id === work.id && item.snapshot.variant_id === snapshot.variant_id);
      if (existing) return json(existing);
      const item = { id: crypto.randomUUID(), user_id: user.id, created_at: '2026-11-09T00:00:00Z', snapshot, current: snapshot, available: true };
      items.push(item);
      return json(item);
    }
    return route.abort();
  });
  const price = page.locator('.detail-copy > .price');
  const option = page.locator('.variant-options button').nth(1);
  const setOption = page.locator('.variant-options button').first();
  const button = page.locator('.cart-product-button');
  const assertPrice = async expected => {
    check(normalize(await price.textContent()) === expected, `Wrong price: ${await price.textContent()}`);
    check(normalize(await page.locator('.product-mobile-action > strong').textContent()) === expected, 'Mobile price differs');
  };
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`${origin}/?work=set`);
    await price.waitFor();
    await assertPrice('1 100 ₽ за набор');
    check((await setOption.textContent()).includes('Набор целиком'), 'Whole set is not clearly labelled');
    check((await setOption.getAttribute('class')).includes('variant-set-option'), 'Whole set has no distinct tile style');
    check(await setOption.getAttribute('aria-pressed') === 'true', 'Whole set is not selected');
    check(normalize(await button.textContent()) === 'Добавить набор в корзину', 'Set action label differs');
    await option.click();
    await page.locator('.detail-copy h2').filter({ hasText: variant.name }).waitFor();
    await assertPrice('300 ₽ за штуку');
    check((await option.textContent()).includes('300'), 'Individual option price missing');
    check(normalize(await button.textContent()) === 'Добавить в корзину', 'Figurine action label differs');
    check(await setOption.getAttribute('aria-pressed') === 'false', 'Whole set selection did not clear');
    check((await page.locator('.product-description').textContent()) === variant.description, 'Variant description lost');
    check((await page.locator('.product-gallery-expand img').getAttribute('alt')) === variant.name, 'Variant photo lost');
    await setOption.click();
    await page.locator('.detail-copy h2').filter({ hasText: base.title }).waitFor();
    await assertPrice('1 100 ₽ за набор');
    check(normalize(await button.textContent()) === 'Добавить набор в корзину', 'Set action not restored');
    // Direct variant links and history must preserve the individual purchase.
    await page.goto(`${origin}/?work=set&variant=girl`);
    await price.waitFor();
    await assertPrice('300 ₽ за штуку');
    await setOption.click();
    await page.goBack();
    await page.locator('.detail-copy h2').filter({ hasText: variant.name }).waitFor();
    await assertPrice('300 ₽ за штуку');
    await page.goto(`${origin}/?work=unknown`);
    await price.waitFor();
    await assertPrice('Цена по запросу за набор');
    await page.goto(`${origin}/?work=unknown&variant=girl`);
    await price.waitFor();
    await assertPrice('300 ₽ за штуку');
    await page.goto(`${origin}/?work=set&variant=unpriced`);
    await price.waitFor();
    await assertPrice('Цена по запросу за штуку');
    await page.goto(`${origin}/?work=set&variant=sold`);
    await price.waitFor();
    check(await button.isDisabled(), 'Sold set figurine can be added');
    await page.goto(`${origin}/?work=collection`);
    await price.waitFor();
    check(normalize(await price.textContent()) === 'от 300 ₽', 'Collection starting price changed');
    check(await page.locator('.cart-product-button').isDisabled(), 'Collection requires a variant');
    await option.click();
    await page.locator('.detail-copy h2').filter({ hasText: variant.name }).waitFor();
    await assertPrice('300 ₽ за штуку');
    check(await button.isEnabled(), 'Available individual figurine cannot be added');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Horizontal page overflow');
  }
  // Guest selection survives login and adds the exact figurine, then the whole set.
  await page.goto(`${origin}/?work=set&variant=girl`);
  await page.getByRole('button', { name: 'Добавить в корзину', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Пароль', { exact: true }).fill('mock-password');
  const added = page.waitForResponse(response => response.url().endsWith('/rpc/cart_add'));
  await page.getByRole('dialog').last().getByRole('button', { name: 'Войти', exact: true }).click();
  await added;
  check(additions.length === 1 && additions[0].target_work_id === base.id && additions[0].target_variant_id === variant.id, 'Guest selection must add the exact figurine once');
  await button.filter({ hasText: 'Уже в корзине' }).waitFor();
  await setOption.click();
  const setAdded = page.waitForResponse(response => response.url().endsWith('/rpc/cart_add'));
  await page.getByRole('button', { name: 'Добавить набор в корзину', exact: true }).click();
  await setAdded;
  check(additions.length === 2 && additions[1].target_variant_id === null, 'Whole set must have its own cart position');
  await button.filter({ hasText: 'Уже в корзине' }).waitFor();
  await page.locator('.cart-floating:visible').first().click();
  const drawer = page.getByRole('dialog', { name: 'Корзина', exact: true });
  await drawer.waitFor();
  check((await drawer.textContent()).includes(base.title), 'Cart set title missing');
  check(normalize(await drawer.textContent()).includes('1 100 ₽'), 'Cart set price missing');
  const rows = drawer.locator('.cart-list > li');
  check(await rows.count() === 2, 'Set and figurine must coexist in cart');
  const figurineRow = rows.filter({ hasText: variant.name });
  check(normalize(await figurineRow.textContent()).includes('300 ₽'), 'Cart figurine price differs');
  check(!(await figurineRow.textContent()).includes('Набор целиком'), 'Figurine incorrectly labelled as whole set');
  check(await drawer.getByText('Набор целиком', { exact: true }).count() === 1, 'Whole set label must appear once');
  check(errors.length === 0, `Browser errors: ${errors.join(', ')}`);
  return { passed: true, widths: [1440, 390, 320], cartAdd: additions, browserErrors: errors };
}
