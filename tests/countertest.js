const { chromium } = require('playwright');
const H = require('./harness');
const TILE = H.TILE;
(async () => {
  const b = await chromium.launch(H.LAUNCH);
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const outbound = [];
  await ctx.route('**/*', r => {
    const u = r.request().url();
    if (u.includes('arcgisonline')) return r.fulfill({ contentType: 'image/png', body: TILE });
    if (u.startsWith('http://127.0.0.1')) return r.continue();
    outbound.push(u);
    return r.abort();
  });

  const out = []; const ck = (n, ok, x) => out.push(`${ok?'PASS':'FAIL'}  ${n}${x?' — '+x:''}`);

  await p.goto(H.served('index.html'));
  await p.evaluate(() => { localStorage.clear(); });
  await p.reload({ waitUntil: 'networkidle' });

  ck('counter hidden before any map', await p.locator('#mapCounter').isHidden());
  ck('counter sits outside the exported frame',
     await p.evaluate(() => !document.getElementById('mapFrame')
       .contains(document.getElementById('mapCounter'))));

  await p.evaluate(() => {
    const S = CMG.store;
    S.setLocation(S.state.subjects[0].id, 39.74, -104.99, null, true);
    const c = S.addComp('x'); S.setLocation(c.id, 39.75, -104.97, null, true);
  });
  await p.waitForTimeout(400);

  // first export = first map
  await p.click('.tabs .tab[data-tab="export"]');
  let dl = p.waitForEvent('download', { timeout: 90000 });
  await p.click('#exportPng'); await dl;
  await p.waitForTimeout(400);
  let stats = await p.evaluate(() => CMG.counter.read());
  ck('first export counts one map', stats.maps === 1 && stats.renders === 1,
     `maps=${stats.maps} renders=${stats.renders}`);
  ck('counter now visible', await p.locator('#mapCounter').isVisible());
  ck('counter shows the number', (await p.locator('#mapCounter').innerText()).includes('1'),
     await p.locator('#mapCounter').innerText());

  // re-exporting the same project is the same map
  dl = p.waitForEvent('download', { timeout: 90000 });
  await p.click('#exportJpg'); await dl;
  await p.waitForTimeout(400);
  stats = await p.evaluate(() => CMG.counter.read());
  ck('re-export does not inflate the map count', stats.maps === 1 && stats.renders === 2,
     `maps=${stats.maps} renders=${stats.renders}`);

  // a new project is a new map
  await p.evaluate(() => { CMG.store.reset(); });
  await p.evaluate(() => {
    const S = CMG.store;
    S.setLocation(S.state.subjects[0].id, 39.70, -104.95, null, true);
  });
  await p.waitForTimeout(400);
  // reset returns to the opening screen, so the export tab has to be reopened
  await p.click('.tabs .tab[data-tab="export"]');
  dl = p.waitForEvent('download', { timeout: 90000 });
  await p.click('#exportPng'); await dl;
  await p.waitForTimeout(400);
  stats = await p.evaluate(() => CMG.counter.read());
  ck('a new project counts as a new map', stats.maps === 2, `maps=${stats.maps}`);

  // survives reload
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  ck('count survives reload', (await p.evaluate(() => CMG.counter.read())).maps === 2,
     await p.locator('#mapCounter').innerText());

  // never in the exported image
  const inFrame = await p.evaluate(() => {
    const f = document.getElementById('mapFrame');
    return f.innerHTML.includes('mapCounter');
  });
  ck('counter never rendered into the map frame', !inFrame);

  // nothing phoned home
  ck('no outbound request without an endpoint', outbound.length === 0,
     outbound.slice(0,3).join(', ') || 'none attempted');
  ck('endpoint is empty by default',
     await p.evaluate(() => CMG.COUNTER_ENDPOINT) === '');

  await p.screenshot({ path: 'counter.png' });
  console.log(out.join('\n'));
  console.log('errors: ' + (errs.length ? errs.slice(0,3).join(' | ') : 'none'));
  const f = out.filter(s => s.startsWith('FAIL')).length;
  console.log(`${out.length - f}/${out.length} checks passed`);
  await b.close(); process.exit(f ? 1 : 0);
})().catch(e => { console.error('HARNESS', e); process.exit(2); });
