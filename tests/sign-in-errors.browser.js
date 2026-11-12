// playwright-cli -s=sign-in open http://127.0.0.1:5173
// playwright-cli -s=sign-in run-code --filename=tests/sign-in-errors.browser.js
// All external requests are mocked; no real login, email or production writes.
async page => {
  const origin = new URL(page.url()).origin;
  const check = (value, message) => { if (!value) throw new Error(message); };
  const errors = [], scenarios = [];
  const user = { id: '33333333-3333-4333-8333-333333333333', aud: 'authenticated', role: 'authenticated', email: 'login@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-11-12T00:00:00Z' };
  const part = value => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const token = `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ sub: user.id, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.test`;
  let failure = { code: 'invalid_credentials', status: 400 };
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    const table = url.pathname.split('/').pop();
    const json = data => route.fulfill({ json: data });
    if (url.pathname.includes('/auth/v1/token')) {
      if (failure?.network) return route.abort('failed');
      if (failure) return route.fulfill({ status: failure.status, headers: {
        'x-supabase-api-version': '2024-01-01',
        'access-control-expose-headers': 'X-Supabase-Api-Version',
      }, json: { code: failure.code, message: 'SECRET_INTERNAL_FAILURE' } });
      return json({ access_token: token, refresh_token: 'mock-refresh', expires_in: 3600, token_type: 'bearer', user });
    }
    if (table === 'user') return json(user);
    if (table === 'profiles') return json(null);
    if (table === 'site_settings') return json({ name: 'Тестовая мастерская', hero_mode: 'standard', contact: '' });
    if (table === 'category_list_state') return json({ revision: 1 });
    if (table === 'chat_inbox') return json({ threads: [], unread_count: 0, has_more: false });
    if (['works', 'categories', 'tree_ornaments', 'favorites', 'cart_list'].includes(table)) return json([]);
    return route.abort();
  });
  try {
    await page.goto(origin);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Email', { exact: true }).fill(user.email);
    await dialog.getByLabel('Пароль', { exact: true }).fill('mock-password');
    for (const [response, expected] of [
      [{ code: 'invalid_credentials', status: 400 }, 'Неверный email или пароль'],
      [{ code: 'email_not_confirmed', status: 400 }, 'Почта не подтверждена'],
      [{ code: 'over_request_rate_limit', status: 429 }, 'Слишком много попыток'],
      [{ code: 'future_error', status: 429 }, 'Слишком много попыток'],
      [{ code: 'future_error', status: 400 }, 'Не удалось войти'],
      [{ network: true }, 'Проверьте соединение с интернетом'],
    ]) {
      failure = response;
      await dialog.getByRole('button', { name: 'Войти', exact: true }).click();
      await dialog.getByRole('alert').filter({ hasText: expected }).waitFor();
      check(await dialog.getByRole('button', { name: 'Войти', exact: true }).isEnabled(), 'Retry is blocked after failure');
      check(await dialog.getByLabel('Email', { exact: true }).inputValue() === user.email, 'Email lost after failure');
      check(!(await dialog.innerText()).includes('SECRET_INTERNAL_FAILURE'), 'Raw server error exposed');
      scenarios.push(expected);
    }
    await dialog.getByRole('button', { name: 'Забыли пароль?', exact: true }).click();
    check(await dialog.getByRole('alert').count() === 0, 'Login error retained in recovery form');
    await dialog.getByRole('button', { name: 'Вернуться ко входу', exact: true }).click();
    await dialog.getByLabel('Пароль', { exact: true }).fill('mock-password');
    failure = null;
    await dialog.getByRole('button', { name: 'Войти', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Войти', exact: true }).waitFor({ state: 'hidden' });
    check(errors.length === 0, `Browser errors: ${errors.join(', ')}`);
    return { passed: true, scenarios: [...scenarios, 'recovery clears error', 'successful retry'], browserErrors: errors };
  } finally {
    await page.unroute('**/*');
    await page.evaluate(() => localStorage.clear());
  }
}
