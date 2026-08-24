/* The app served from a subpath, exactly as GitHub Pages serves a project
   repo: https://user.github.io/Repo-Name/ */
const { chromium } = require('playwright');
const H = require('./harness');
const TILE = H.TILE;
(async () => {
  const b = await chromium.launch(H.LAUNCH);
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 } });
  await ctx.route('**/arcgisonline.com/**', r => r.fulfill({contentType:'image/png', body:TILE}));
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const missing = [];
  p.on('response', r => { if (r.status() >= 400 && r.url().startsWith('http://127.0.0.1')) missing.push(r.status()+' '+r.url()); });

  await p.goto(`http://127.0.0.1:${H.PAGES_PORT}/Comparable-Map-Generator/`);
  await p.waitForTimeout(2000);

  const out = []; const ck = (n, ok, x) => out.push(`${ok?'PASS':'FAIL'}  ${n}${x?' — '+x:''}`);
  ck('title', await p.title() === 'CompCarto', await p.title());
  ck('no 404s on assets', missing.length === 0, missing.slice(0,3).join(' | '));
  ck('scripts all ran', await p.evaluate(() => !!(window.CMG && CMG.store && CMG.mapview && CMG.ui)));
  ck('leaflet + html2canvas served',
     await p.evaluate(() => typeof L === 'object' && typeof html2canvas === 'function'));
  ck('map has area', await p.evaluate(() => document.getElementById('map').offsetWidth > 300));
  await p.evaluate(() => {
    const S = CMG.store;
    S.update(S.state.subjects[0].id, { address: '22600 Interstate 76, Brighton, CO' });
    S.setLocation(S.state.subjects[0].id, 39.9205, -104.8060, null, true);
    const c = S.addComp('1701 Wynkoop St, Denver, CO');
    S.setLocation(c.id, 39.7530, -105.0002, null, true);
  });
  await p.waitForTimeout(1000);
  ck('pins render', await p.locator('.cmg-pin').count() === 2);
  const dims = await p.evaluate(async () => {
    CMG.store.state.exportCfg.dpi = 150;
    const c = await CMG.exporter.renderCanvas(()=>{});
    return c.width + 'x' + c.height;
  });
  ck('export works over http', dims === '975x600', dims);
  ck('no page errors', errs.length === 0, errs.join(' | '));

  console.log(out.join('\n'));
  const pass = out.filter(l => l.startsWith('PASS')).length;
  console.log(`${pass}/${out.length} checks passed`);
  await b.close();
  process.exit(pass === out.length ? 0 : 1);
})();
