// Local dev server with VITE_SUPABASE_IMAGE_TRANSFORMS=true:
// playwright-cli open http://127.0.0.1:5193 --browser=chrome
// playwright-cli run-code --filename=tests/catalog-pages.browser.js
// All external requests are mocked; no production accounts or data are changed.
async page => {
  const origin = new URL(page.url()).origin;
  const check = (value, message) => { if (!value) throw new Error(message); };
  const errors = [], requests = [], scenarios = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const user = { id: '33333333-3333-4333-8333-333333333333', aud: 'authenticated', role: 'authenticated', email: 'pages@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-11-14T00:00:00Z' };
  const part = value => btoa(JSON.stringify(value)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const token = `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ sub: user.id, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now()/1000)+3600 })}.test`;
  let administrator = false, failure = '', heroMode = 'standard', slowDetail = false, imageFailure = true;
  const variants = [{ id: '22222222-2222-4222-8222-222222222222', slug: 'small', name: 'Маленькая фигурка', price: 200,
    availability: 'available', position: 0, photos: [{ url: '/images/Master.webp', alt: 'Вариант', position: 0 }] }];
  const works = Array.from({ length: 61 }, (_, i) => ({ id: `11111111-1111-4111-8111-${String(i+1).padStart(12,'0')}`,
    slug: `work-${i+1}`, title: `Работа ${String(i+1).padStart(3,'0')}`, description: i === 59 ? 'Редкий поисковый текст' : 'Описание работы',
    material: 'Гипс', dimensions: '', price: 500+i, sold_as_set: i === 59, availability: 'available', status: 'published',
    featured: false, revision: 1, updated_at: '2026-11-14T00:00:00Z', category: { name: i % 2 ? 'Подарки' : 'Декор' },
    photos: [{ url: '/images/Master.webp', alt: 'Обложка', position: 0 }, { url: '/images/Main_logo.webp', alt: 'Обратная сторона', position: 1 }],
    variants: i === 59 ? variants : [],
  }));
  works[0].photos[0].url = 'https://bznkcwgklcodoseeqaet.supabase.co/storage/v1/object/public/work-photos/works/11111111-1111-4111-8111-000000000001.webp';
  const draft = { ...works[0], id: '11111111-1111-4111-8111-999999999999', slug: 'private-draft', title: 'Закрытый черновик', status: 'draft', variants: [] };
  const photo = await (await page.request.get(`${origin}/images/Master.webp`)).body();
  const snapshot = { work_id: works[59].id, variant_id: variants[0].id, work_slug: works[59].slug, variant_slug: 'small',
    title: works[59].title, variant_name: variants[0].name, image_url: '/images/Master.webp', price: 200, sold_as_set: false };
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), table = url.pathname.split('/').pop();
    if (url.origin === origin) return route.continue();
    const json = data => route.fulfill({ json: data });
    if (url.pathname.includes('/storage/')) {
      requests.push({ type: 'image', path: url.pathname });
      if (url.pathname.includes('/render/') && imageFailure) return route.fulfill({ status: 403, body: 'Transformations disabled' });
      return route.fulfill({ contentType: 'image/webp', body: photo });
    }
    if (url.pathname.includes('/auth/v1/token')) return json({ access_token: token, refresh_token: 'mock-refresh', expires_in: 3600, token_type: 'bearer', user });
    if (table === 'user') return json(user);
    if (table === 'logout') return json({});
    if (table === 'profiles') return json(administrator ? { id: user.id } : null);
    if (table === 'catalog_cards') {
      const p = url.searchParams, offset = Number(p.get('offset') || 0), limit = Number(p.get('limit') || 24);
      requests.push({ type: 'page', offset, limit, select: p.get('select'), query: p.get('search_text'), category: p.get('category_name'), order: p.get('order') });
      check(limit <= 100, 'Unbounded server request');
      check(!/[*(]/.test(p.get('select')), 'List request includes nested/full records');
      if (failure === 'page' && offset > 0) return route.fulfill({ status: 503, json: { message: 'SECRET_FAILURE' } });
      if (failure === 'search' && p.get('search_text')) return route.fulfill({ status: 503, json: { message: 'SECRET_FAILURE' } });
      let rows = [...works, ...(administrator ? [draft] : [])];
      if (p.get('status')) rows = rows.filter(work => work.status === p.get('status').slice(3));
      if (p.get('availability') === 'neq.sold') rows = rows.filter(work => work.availability !== 'sold');
      if (p.get('category_name')) rows = rows.filter(work => work.category.name === p.get('category_name').slice(3));
      if (p.get('id')?.startsWith('in.')) rows = rows.filter(work => p.get('id').includes(work.id));
      if (p.get('search_text')) {
        const query = p.get('search_text').slice(7,-1).replace(/\\([%_\\])/g,'$1').toLowerCase();
        if (query === 'медленный') await new Promise(resolve => setTimeout(resolve, 600));
        rows = rows.filter(work => `${work.title} ${work.description} ${work.material}`.toLowerCase().includes(query));
      }
      rows.sort((a,b) => p.get('order')?.startsWith('catalog_price') ? a.price-b.price : p.get('order')?.startsWith('favorite_count') ? (b.id===works[60].id)-(a.id===works[60].id) : a.title.localeCompare(b.title,'ru') || a.id.localeCompare(b.id));
      const total = rows.length;
      rows = rows.slice(offset,offset+limit).map(work => ({ id: work.id, slug: work.slug, title: work.title, material: work.material,
        dimensions: work.dimensions, measurements: null, sold_as_set: work.sold_as_set, price: work.price, availability: work.availability,
        status: work.status, featured: work.featured, revision: work.revision, updated_at: work.updated_at, category_name: work.category.name,
        cover_url: work.photos[0]?.url, cover_alt: work.photos[0]?.alt, photo_count: work.photos.length, variant_count: work.variants.length,
        catalog_price: work.price,
      }));
      return route.fulfill({ json: rows, headers: { 'content-range': `${offset}-${offset+rows.length-1}/${total}`, 'access-control-expose-headers': 'Content-Range' } });
    }
    if (table === 'works') {
      const key = url.searchParams.get('id') || url.searchParams.get('slug');
      requests.push({ type: 'detail', key });
      check(Boolean(key), 'Full catalogue was downloaded');
      if (slowDetail) await new Promise(resolve => setTimeout(resolve, 600));
      if (failure === 'detail') return route.fulfill({ status: 503, json: { message: 'SECRET_FAILURE' } });
      let work = [...works,draft].find(work => work.id === key?.slice(3) || work.slug === key?.slice(3));
      if (work?.status !== 'published' && (!administrator || url.searchParams.get('status') === 'eq.published')) work = null;
      return json(work ?? null);
    }
    const data = { site_settings: { name: 'Мастерская', hero_mode: heroMode, hero_work_ids: [works[60].id], contact: '' },
      categories: [{name:'Декор'},{name:'Подарки'}], category_list_state: {revision:1},
      tree_ornaments: [{id:'tree-one',title:'Последняя работа',image_url:'/images/Master.webp',work_id:works[60].id,position:0}],
      favorite_counts: {[works[60].id]:10}, favorites: [{work_id:works[59].id}],
      cart_list: [{ id:'44444444-4444-4444-8444-444444444444', user_id:user.id, snapshot, current:snapshot, available:true, created_at:'2026-11-14' }],
      chat_inbox:{threads:[],unread_count:0,has_more:false}, dimension_suggestions:[],
    };
    return Object.hasOwn(data,table) ? json(data[table]) : route.abort();
  });
  const cards = page.locator('.work-card');
  const waitCards = async count => { await page.waitForFunction(count => document.querySelectorAll('.work-card').length === count,count); };
  const search = page.getByRole('textbox',{name:'Поиск работ'});
  try {
    await page.goto(origin);
    await page.evaluate(() => localStorage.clear());
    requests.length=0;
    await page.reload();
    await waitCards(24);
    check(requests.filter(item=>item.type==='page'&&item.limit===24).length===1,'Initial page fetched more than once');
    check(!requests.some(item=>item.type==='detail'),'Galleries loaded before opening a product');
    check((await page.locator('.standard-card-caption').allTextContents()).some(text=>text.includes('Работа 061')),'Manual hero outside first page missing');
    await cards.first().scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector('.card-photo img')?.complete && document.querySelector('.card-photo img')?.naturalWidth>0);
    check(requests.some(item=>item.type==='image'&&item.path.includes('/render/')),'Responsive preview was not requested');
    check(requests.some(item=>item.type==='image'&&item.path.includes('/object/')),'Failed preview did not fall back to original');
    check(await cards.first().locator('.card-photo img').getAttribute('srcset')===null,'Failed preview srcset still active');
    scenarios.push('24 summaries, no galleries, distant hero and responsive fallback');
    failure='page';
    await page.getByRole('button',{name:'Показать ещё 24 работ',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'Не удалось загрузить следующие'}).waitFor();
    check(await cards.count()===24,'Next-page failure removed existing cards');
    failure='';
    await page.getByRole('button',{name:'Повторить загрузку работ',exact:true}).click();
    await waitCards(48);
    await page.getByRole('button',{name:'Показать ещё 13 работ',exact:true}).click();
    await waitCards(61);
    check(requests.some(item=>item.type==='page'&&item.offset===24&&item.limit===24),'Second page not requested separately');
    check(new Set(await cards.locator('.title-button').allTextContents()).size===61,'Duplicate page entries');
    scenarios.push('incremental pages, failure retains cards, retry, final page');
    await search.fill('Редкий поисковый'); await waitCards(1);
    check(await cards.first().locator('.title-button').textContent()===works[59].title,'Search missed distant description');
    await search.fill('медленный');
    await page.waitForTimeout(300);
    await search.fill('Работа 061'); await waitCards(1);
    await page.waitForTimeout(700);
    check((await cards.first().innerText()).includes('Работа 061'),'Stale search overwrote new result');
    failure='search'; await search.fill('Редкий поисковый');
    await page.getByRole('alert').filter({hasText:'Не удалось загрузить работы'}).waitFor();
    check(await page.locator('.loading').count()===0,'Failed filter left a permanent loading screen');
    failure=''; await page.getByRole('button',{name:'Повторить загрузку работ',exact:true}).click();
    await waitCards(1);
    await search.fill(''); await waitCards(24);
    await page.getByRole('button',{name:'Декор',exact:true}).click(); await waitCards(24);
    await page.getByRole('button',{name:'Показать ещё 7 работ',exact:true}).waitFor();
    await page.getByRole('button',{name:'Все работы',exact:true}).click(); await waitCards(24);
    await page.getByLabel('Сортировка',{exact:true}).click();
    await page.getByRole('button',{name:'По популярности',exact:true}).click();
    await page.waitForFunction(() => document.querySelector('.work-card .title-button')?.textContent==='Работа 061');
    scenarios.push('server search/category/sort and stale response cancellation');
    await page.goto(`${origin}/?work=work-60&variant=small`);
    await page.locator('.detail-copy h2').filter({hasText:variants[0].name}).waitFor();
    check((await page.locator('.detail-copy > .price').textContent()).includes('200'),'Direct variant has wrong price');
    await page.keyboard.press('Escape'); await page.locator('.detail-copy').waitFor({state:'hidden'});
    await page.goBack();
    scenarios.push('direct distant work/variant, complete detail and close');
    await page.goto(origin); await waitCards(24);
    failure='detail';
    await cards.first().locator('.title-button').click();
    await page.getByRole('alert').filter({hasText:'Не удалось загрузить работу'}).waitFor();
    check(!(await page.locator('body').innerText()).includes('SECRET_FAILURE'),'Raw detail error exposed');
    failure=''; await page.getByRole('button',{name:'Повторить загрузку работы',exact:true}).click();
    await page.locator('.detail-copy').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.detail-copy').waitFor({state:'hidden'});
    slowDetail=true; await cards.nth(1).locator('.title-button').click();
    await page.getByRole('status').filter({hasText:'Загружаем работу'}).waitFor();
    await page.keyboard.press('Escape'); await page.waitForTimeout(700);
    check(await page.locator('.detail-copy').count()===0,'Closed pending work reopened');
    slowDetail=false;
    scenarios.push('detail failure/retry and close during loading');
    await page.goto(`${origin}/?work=private-draft`);
    await page.getByRole('alert').filter({hasText:'Работа больше недоступна'}).waitFor();
    check(await page.locator('.detail-copy').count()===0,'Guest draft leaked');
    await page.goto(origin); await waitCards(24);
    await page.getByRole('button',{name:'Войти',exact:true}).click();
    await page.getByLabel('Email',{exact:true}).fill(user.email);
    await page.getByLabel('Пароль',{exact:true}).fill('mock-password');
    await page.getByRole('dialog').getByRole('button',{name:'Войти',exact:true}).click();
    await page.getByLabel('Меню аккаунта',{exact:true}).click();
    await page.getByRole('button',{name:'Личный кабинет',exact:true}).click();
    await page.locator('.favorite-list article').waitFor();
    check((await page.locator('.favorite-list').innerText()).includes('Работа 060'),'Distant favorite missing');
    await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'Корзина, фигурок: 1',exact:true}).click();
    await page.getByRole('button',{name:'Посмотреть фигурку',exact:true}).click();
    await page.locator('.detail-copy h2').filter({hasText:variants[0].name}).waitFor();
    scenarios.push('customer favorites and cart open works outside loaded pages');
    administrator=true;
    await page.goto(origin); await waitCards(24);
    await cards.first().getByRole('button',{name:'Редактировать работу'}).click();
    await page.locator('.work-editor').waitFor();
    check(await page.locator('.work-photo-tile').count()===2,'Editor received only a cover');
    await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'Карточки карусели',exact:true}).click();
    await page.locator('.hero-carousel-editor').waitFor();
    check((await page.locator('.hero-carousel-editor').innerText()).includes('Работа 061'),'Admin selector omitted distant work');
    await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'Черновики',exact:true}).click(); await waitCards(1);
    check((await cards.first().innerText()).includes('Закрытый черновик'),'Admin draft scope failed');
    scenarios.push('admin detail editor, complete lazy selector and draft scope');
    imageFailure=false;
    heroMode='new-year';
    for (const width of [320,1440]) {
      await page.setViewportSize({width,height:1000});
      await page.goto(origin); await waitCards(24);
      check(await page.locator('.tree-toy').count()===1,'Tree-linked distant work missing');
      check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Horizontal overflow');
      await cards.first().scrollIntoViewIfNeeded();
      await page.waitForFunction(() => document.querySelector('.card-photo img')?.currentSrc.includes('/render/image/') && document.querySelector('.card-photo img')?.naturalWidth>0);
      check((await cards.first().locator('.card-photo img').getAttribute('srcset')).includes('960w'),'Responsive sources missing');
    }
    scenarios.push('tree-linked distant work and 320/1440 px layout');
    check(errors.length===0,errors.join('; '));
    return {passed:true,scenarios,errors};
  } finally { await page.unroute('**/*'); }
}
