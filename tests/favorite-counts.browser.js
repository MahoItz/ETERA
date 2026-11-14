// playwright-cli run-code --filename=tests/favorite-counts.browser.js
// Uses mocked API responses; never modifies production data.
async page => {
  const origin = new URL(page.url()).origin;
  const id = '11111111-1111-4111-8111-111111111111';
  let total = 12;
  const work = { id, title: 'Проверка лайков', description: '', material: 'Гипс', dimensions: '', price: 500, availability: 'available', status: 'published', featured: false, revision: 1, updated_at: '2026-11-14', photos: [], variants: [] };
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    const table = url.pathname.split('/').pop();
    const data = {
      works: [work], site_settings: { name: 'Тест', hero_mode: 'standard' },
      categories: [], category_list_state: { revision: 1 }, tree_ornaments: [],
      favorite_counts: total > 0 ? { [id]: total } : {},
    };
    if (table in data) return route.fulfill({ json: data[table] });
    return route.abort();
  });
  await page.goto(origin);
  await page.evaluate(() => localStorage.clear());
  for (const count of [12, 0]) {
    total = count;
    await page.goto(origin);
    const card = page.locator('.favorite-toggle');
    await card.waitFor();
    await page.waitForFunction(() => !document.querySelector('.favorite-toggle')?.disabled);
    const cardNumbers = card.locator('.favorite-count');
    if (count ? await cardNumbers.textContent() !== String(count) : await cardNumbers.count() !== 0) {
      throw new Error(`Incorrect card count for ${count}`);
    }
    await page.locator('.title-button').click();
    const detail = page.locator('.product-favorite');
    await detail.waitFor();
    const numbers = detail.locator('.favorite-count');
    if (count ? await numbers.textContent() !== String(count) : await numbers.count() !== 0) {
      throw new Error(`Incorrect detail count for ${count}`);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  total = 1234;
  await page.goto(origin);
  await page.locator('.favorite-count').waitFor();
  const fits = await page.locator('.favorite-toggle').evaluate(button => {
    const rect = button.getBoundingClientRect();
    return rect.right <= window.innerWidth && button.scrollWidth <= button.clientWidth;
  });
  if (!fits) throw new Error('Mobile count overflows');
  return { passed: ['catalog: 12 and zero', 'product: 12 and zero', 'mobile: four digits fit'] };
}
