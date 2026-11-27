// Local only: playwright-cli run-code --filename=tests/diagnostics.browser.js
// Every Supabase request is mocked. No production data is read or written.
async page => {
  const origin = 'http://127.0.0.1:5178';
  const base = 'https://bznkcwgklcodoseeqaet.supabase.co';
  const check = (value, message) => { if (!value) throw new Error(message); };
  let accept = false, catalogFailure = false, admin = false, adminReaderStalled = false;
  const reports = [], runtimeErrors = [];
  const user = { id: '33333333-3333-4333-8333-333333333333', aud: 'authenticated', role: 'authenticated', email: 'diagnostics@example.test', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
  const part = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ sub: user.id, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.mock`;
  page.on('pageerror', error => runtimeErrors.push(error.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    if (url.origin !== base) return route.abort();
    const name = url.pathname.split('/').pop();
    const json = data => route.fulfill({ json: data });
    if (name === 'record_site_diagnostic') {
      if (!accept) return route.fulfill({ status: 503, json: { message: 'unavailable' } });
      const event = route.request().postDataJSON().event;
      if (!reports.some(d => d.id === event.id)) reports.push({ ...event, received_at: new Date().toISOString() });
      return json(true);
    }
    if (name === 'admin_site_diagnostics') { if (adminReaderStalled) return; return json(reports); }
    if (name === 'catalog_cards') return catalogFailure ? route.fulfill({ status: 400, json: { code: 'mock', message: 'PRIVATE_MESSAGE' } }) : route.fulfill({ json: [], headers: { 'content-range': '*/0' } });
    if (name === 'site_settings') return json({ name: 'Тестовая мастерская', hero_mode: 'standard', hero_work_ids: [] });
    if (name === 'category_list_state') return json({ revision: 1 });
    if (name === 'profiles') return json(admin ? { id: user.id, role: 'admin' } : null);
    if (name === 'user') return json(user);
    if (name === 'token') return json({ access_token: token, refresh_token: 'mock-refresh', expires_in: 3600, token_type: 'bearer', user });
    if (name === 'chat_inbox') return json({ threads: [], unread_count: 0, has_more: false });
    if (name === 'favorite_counts') return json({});
    if (name === 'record_site_pageview') return json(true);
    return json([]);
  });
  await page.goto(origin);
  await page.waitForFunction(() => document.querySelector('#catalog')?.getAttribute('aria-busy') === 'false');
  await page.evaluate(() => localStorage.removeItem('elveria:diagnostics:v1'));

  const observation = await page.evaluate(async base => {
    const module = await import('/src/diagnostics.ts');
    const url = `${base}/rest/v1/catalog_cards?token=SUPER_SECRET`;
    const ignore = async operation => { try { await operation(); } catch {} };
    await ignore(() => module.diagnosticFetch(base, async () => { throw new TypeError('SUPER_SECRET'); })(url));
    await ignore(() => module.diagnosticFetch(base, async () => new Response(new ReadableStream({ start(c) { c.error(new Error('SUPER_SECRET')); } })))(url));
    const pendingRead = (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
    await ignore(() => module.diagnosticFetch(base, pendingRead, 25)(url));
    let writes = 0;
    const response = await module.diagnosticFetch(base, async () => { writes++; await new Promise(resolve => setTimeout(resolve, 50)); return new Response('{}'); }, 20)(`${base}/rest/v1/works`, { method: 'POST', body: '{}' });
    await module.diagnosticFetch(base, async () => new Response('{"message":"SUPER_SECRET"}', { status: 403 }))(url);
    const before = JSON.parse(localStorage.getItem('elveria:diagnostics:v1') || '[]').length;
    const controller = new AbortController(); controller.abort();
    await ignore(() => module.diagnosticFetch(base, async () => { throw new DOMException('Aborted', 'AbortError'); })(url, { signal: controller.signal }));
    const queue = JSON.parse(localStorage.getItem('elveria:diagnostics:v1') || '[]');
    return { queue, writes, writeStatus: response.status, cancellationIgnored: queue.length === before, containsSecret: JSON.stringify(queue).includes('SUPER_SECRET') };
  }, base);
  check(observation.queue.some(d => d.kind === 'network'), 'Network failure was not captured');
  check(observation.queue.some(d => d.kind === 'body'), 'Body failure was not captured');
  check(observation.queue.some(d => d.kind === 'slow' && d.method === 'GET'), 'Stalled read was not captured');
  check(observation.queue.some(d => d.kind === 'http' && d.status === 403), 'HTTP error was not captured');
  check(observation.writes === 1 && observation.writeStatus === 200, 'A slow write was aborted or retried');
  check(observation.cancellationIgnored && !observation.containsSecret, 'Cancellation or privacy check failed');
  const preservedId = observation.queue[0].id;
  accept = true;
  await page.reload();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('elveria:diagnostics:v1') || '[]').length === 0);
  check(reports.some(d => d.id === preservedId), 'Failed outbox was not replayed on next visit');

  // Fatal catalogue errors offer a downloadable report without requiring login.
  accept = false; catalogFailure = true;
  await page.reload();
  await page.getByRole('heading', { name: 'Не удалось загрузить работы' }).waitFor();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать отчёт об ошибке' }).first().click();
  const download = await downloadPromise;
  check(download.suggestedFilename() === 'elveria-diagnostics.json', 'Diagnostic export not offered');
  const stream = await download.createReadStream();
  const buffers = []; for await (const chunk of stream) buffers.push(chunk);
  const exported = JSON.parse(Buffer.concat(buffers).toString());
  check(exported.version === 1 && exported.events.some(d => d.kind === 'catalog'), 'Export has no catalogue failure');
  check(!JSON.stringify(exported).includes('PRIVATE_MESSAGE'), 'Raw server message leaked');

  // Admin entry and import use the existing account permissions and navigation.
  accept = true; catalogFailure = false; admin = true;
  await page.evaluate(({ token, user }) => localStorage.setItem('sb-bznkcwgklcodoseeqaet-auth-token', JSON.stringify({ access_token: token, refresh_token: 'mock-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user })), { token, user });
  await page.goto(`${origin}/?account=admin&section=diagnostics`);
  await page.getByRole('heading', { name: 'Ошибки загрузки', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Обновить журнал' }).waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('.site-diagnostics')?.getAttribute('aria-busy') === 'false');
  check(await page.locator('.diagnostic-reports article').count() > 0, 'Admin report list is empty');
  await page.getByLabel('Импорт отчёта посетителя').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{') });
  await page.getByText('Не удалось прочитать JSON-файл отчёта.').waitFor();
  await page.waitForFunction(() => document.querySelector('.site-diagnostics')?.getAttribute('aria-busy') === 'false');
  await page.getByLabel('Импорт отчёта посетителя').setInputFiles({ name: 'report.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) });
  await page.getByText(/Отчёт сохранён:/).waitFor();
  await page.waitForFunction(() => document.querySelector('.site-diagnostics')?.getAttribute('aria-busy') === 'false');
  await page.setViewportSize({ width: 390, height: 844 });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Mobile diagnostics overflow');
  await page.screenshot({ path: '.local/diagnostics-admin-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: '.local/diagnostics-admin-desktop.png', fullPage: true });
  adminReaderStalled = true;
  await page.clock.install();
  await page.getByRole('button', { name: 'Обновить журнал' }).click();
  await page.clock.fastForward(11000);
  await page.getByText('Не удалось загрузить журнал. Повторите попытку.').waitFor();
  check(await page.getByRole('button', { name: 'Обновить журнал' }).isEnabled(), 'Admin reader remained stuck after timeout');
  check(runtimeErrors.length === 0, `Runtime errors: ${runtimeErrors.join(', ')}`);
  return { passed: ['network failure', 'body failure', 'read timeout', 'HTTP error', 'write preservation', 'caller cancellation', 'privacy', 'offline outbox replay', 'guest export', 'admin list', 'invalid and valid import', 'mobile layout', 'admin reader timeout'], receivedReports: reports.length };
}
