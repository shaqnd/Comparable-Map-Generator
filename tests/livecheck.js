/* Does the standalone live build boot from file:// with NO network at all,
   and can a map be built by hand-placing pins? That is the worst case on a
   locked-down office machine. */
const { chromium } = require('playwright');
const H = require('./harness');
(async () => {
  const b = await chromium.launch(H.LAUNCH);
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 } });
  // hard offline: every outbound request fails, like a firewall that blocks all of it
  await ctx.route(/^https?:/, r => r.abort());
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(H.file('dist/comparable-map-standalone.html'));
  await p.waitForTimeout(2000);

  const out = []; const ck = (n, ok, x) => out.push(`${ok?'PASS':'FAIL'}  ${n}${x?' — '+x:''}`);
  ck('page title', await p.title() === 'CompCarto', await p.title());
  ck('brand renamed', (await p.locator('.brand-text strong').innerText()) === 'CompCarto');
  ck('leaflet + html2canvas bundled',
     await p.evaluate(() => typeof L === 'object' && typeof html2canvas === 'function'));
  ck('map has area', await p.evaluate(() => {
     const m = document.getElementById('map'); return m.offsetWidth > 300 && m.offsetHeight > 200; }));

  // build a map entirely by hand — no geocoder, no tiles
  await p.evaluate(() => {
    const S = CMG.store;
    S.update(S.state.subjects[0].id, { address: '22600 Interstate 76, Brighton, CO' });
    S.setLocation(S.state.subjects[0].id, 39.9205, -104.8060, null, true);
    const s2 = S.addSubject('1801 California St, Denver, CO');
    S.setLocation(s2.id, 39.7479, -104.9929, null, true);
    [['1701 Wynkoop St, Denver, CO', 39.7530, -105.0002],
     ['1144 15th St, Denver, CO', 39.7490, -104.9959]].forEach(([a, lat, lng]) => {
      const c = S.addComp(a); S.setLocation(c.id, lat, lng, null, true);
    });
  });
  await p.waitForTimeout(1200);
  ck('pins placed by hand', await p.locator('.cmg-pin').count() === 4,
     String(await p.locator('.cmg-pin').count()));
  ck('portfolio keys drawn',
     (await p.locator('.cmg-pin .pin-num').allInnerTexts()).sort().join(',') === '1,2,S1,S2',
     (await p.locator('.cmg-pin .pin-num').allInnerTexts()).join(','));
  ck('legend built', await p.locator('#legendRows tr').count() === 4);

  // export with no tiles available at all
  const dims = await p.evaluate(async () => {
    CMG.store.state.exportCfg.dpi = 150;
    const c = await CMG.exporter.renderCanvas(() => {});
    return c.width + 'x' + c.height;
  });
  ck('exports an image with no network', dims === '975x600', dims);
  ck('no page errors', errs.length === 0, errs.join(' | '));

  console.log(out.join('\n'));
  const pass = out.filter(l => l.startsWith('PASS')).length;
  console.log(`${pass}/${out.length} checks passed`);
  await b.close();
  process.exit(pass === out.length ? 0 : 1);
})();
