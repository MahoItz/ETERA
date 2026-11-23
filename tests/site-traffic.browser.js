// Run against local Vite via playwright-cli run-code. All backend calls are mocked.
async page => {
  const origin = new URL(page.url()).origin;
  const events = [], periods = [], errors = [];
  const check = (value, message) => { if (!value) throw Error(message); };
  let mode = 'guest', missing = false;
  const user = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', aud: 'authenticated', role: 'authenticated', email: 'admin@example.test', app_metadata: {}, user_metadata: {} };
  const part = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ sub: user.id, role: 'authenticated', exp: Math.floor(Date.now()/1000)+3600 })}.test`;
  const session = { access_token: token, refresh_token: 'test', expires_in: 3600, expires_at: Math.floor(Date.now()/1000)+3600, token_type: 'bearer', user };
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    const name = url.pathname.split('/').pop();
    const json = value => route.fulfill({ json: value });
    if (name === 'record_site_pageview') { events.push(route.request().postDataJSON()); return json(true); }
    if (name === 'admin_site_traffic') {
      const period = route.request().postDataJSON().period_days;
      periods.push(period);
      if (missing) return route.fulfill({ status: 404, json: { code: 'PGRST202' } });
      return json({ visitors: 123, visits: 150, pageviews: 430, started_at: '2026-11-23T00:00:00Z',
        days: Array.from({ length: period }, (_, i) => ({ date: new Date(Date.UTC(2026, 10, 23 - period + i + 1)).toISOString().slice(0,10), visitors: i%7, visits: i%8, pageviews: i%15 })) });
    }
    if (name === 'admin_dashboard') return json({ total_users: 3, new_users: 1, total_favorites: 0, period_favorites: 0, favorited_works: 0, users_with_favorites: 0, total_works: 0, published_works: 0, draft_works: 0, archived_works: 0, popular_works: [], generated_at: new Date().toISOString() });
    if (name === 'user') return json(user);
    if (name === 'token') return json(session);
    if (name === 'profiles') return json(mode === 'admin' ? { id: user.id } : null);
    if (name === 'site_settings') return json({ name: 'Этера', hero_mode: 'standard', hero_work_ids: [] });
    if (name === 'category_list_state') return json({ revision: 1 });
    if (name === 'chat_inbox') return json({ threads: [], unread_count: 0, has_more: false });
    if (name === 'favorite_counts') return json({});
    return json([]);
  });
  await page.evaluate(() => localStorage.clear());
  await page.goto(origin);
  await page.waitForFunction(() => !!localStorage.getItem('etera:traffic:v1:visitor'));
  await page.waitForTimeout(300);
  check(events.length === 1, 'Guest initial view duplicated');
  check(Object.keys(events[0]).sort().join() === 'event_id,session_id,visitor_id', 'Sensitive data in event');
  await page.evaluate(() => { history.pushState({}, '', '?work=one'); dispatchEvent(new PopStateEvent('popstate')); });
  await page.waitForTimeout(200);
  check(events.length === 2, 'SPA work not counted');
  await page.evaluate(() => { history.pushState({}, '', '?work=one&variant=small'); dispatchEvent(new PopStateEvent('popstate')); });
  await page.waitForTimeout(200);
  check(events.length === 2, 'Variant incorrectly counted as a page');
  mode = 'admin';
  await page.evaluate(session => {
    const key = Object.keys(localStorage).find(key => key.startsWith('sb-') && key.endsWith('-auth-token'));
    if (key) localStorage.removeItem(key);
    localStorage.setItem('sb-bznkcwgklcodoseeqaet-auth-token', JSON.stringify(session));
  }, session);
  await page.goto(`${origin}/?account=admin`);
  await page.getByRole('heading', { name: 'Посещаемость сайта', exact: true }).waitFor();
  await page.locator('.account-traffic-metrics').getByText('123', { exact: true }).waitFor();
  check(events.length === 2, 'Admin counted');
  await page.getByLabel('Период', { exact: true }).selectOption('7');
  await page.waitForFunction(() => document.querySelectorAll('.account-traffic-chart > div').length === 7);
  await page.getByText('Данные по дням', { exact: true }).click();
  check(await page.locator('.account-traffic-table tbody tr').count() === 7, 'Daily table missing');
  await page.setViewportSize({ width: 390, height: 844 });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile horizontal overflow');
  await page.screenshot({ path: '.playwright-cli/site-traffic-mobile.png' });
  missing = true;
  await page.getByRole('button', { name: 'Обновить статистику' }).click();
  await page.getByRole('alert').filter({ hasText: 'Учёт посещений ещё не подключён' }).waitFor();
  check(await page.getByRole('heading', { name: 'Популярные работы' }).count() === 1, 'Traffic error broke existing stats');
  check(errors.length === 0, `Browser errors: ${errors.join(', ')}`);
  return { guestViews: events.length, periods, mobile: 'passed', missingMigration: 'passed', errors };
}
