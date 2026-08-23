const { chromium } = require('playwright');
const H = require('./harness');
const TILE = H.TILE;
(async () => {
  const b = await chromium.launch(H.LAUNCH);
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await ctx.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith('http://127.0.0.1')) return r.continue();
    if (u.includes('arcgisonline')) return r.fulfill({ contentType: 'image/png', body: TILE });
    return r.abort();
  });
  const out = []; const ck = (n, ok, x) => out.push(`${ok?'PASS':'FAIL'}  ${n}${x?' — '+x:''}`);

  await p.goto(H.served('index.html'));
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(400);

  ck('on by default', await p.evaluate(() => CMG.mapview.autoFitEnabled()) === true);
  ck('toolbar toggle reads active',
     (await p.locator('#btnAutoFit').getAttribute('class')).includes('is-active'));

  // adding pins should frame them without anyone asking
  await p.evaluate(() => {
    const S = CMG.store;
    S.setLocation(S.state.subjects[0].id, 39.93, -104.80, null, true);
    const c = S.addComp('c1'); S.setLocation(c.id, 39.71, -104.72, null, true);
  });
  await p.waitForTimeout(900);
  ck('new pins are framed automatically', await p.evaluate(() => CMG.mapview.allInView()));

  // a comp placed far away should pull the view back out
  await p.evaluate(() => {
    const S = CMG.store;
    const c = S.addComp('far'); S.setLocation(c.id, 38.25, -104.61, null, true);
  });
  await p.waitForTimeout(900);
  ck('a distant comp widens the view', await p.evaluate(() => CMG.mapview.allInView()));

  // navigating off should snap back
  await p.evaluate(() => CMG.mapview.map.setView([40.9, -102.5], 12, { animate: false }));
  await p.waitForTimeout(1400);
  ck('navigating out of frame pulls back', await p.evaluate(() => CMG.mapview.allInView()));

  // a small nudge that keeps everything visible is left alone
  const before = await p.evaluate(() => {
    const c = CMG.mapview.map.getCenter(); return [c.lat, c.lng];
  });
  await p.evaluate(() => CMG.mapview.map.panBy([25, 25], { animate: false }));
  await p.waitForTimeout(1200);
  const after = await p.evaluate(() => { const c = CMG.mapview.map.getCenter(); return [c.lat, c.lng]; });
  ck('a small nudge is respected', Math.abs(after[0]-before[0]) > 1e-9 || Math.abs(after[1]-before[1]) > 1e-9,
     `${before.map(n=>n.toFixed(4))} -> ${after.map(n=>n.toFixed(4))}`);

  // unticking allows free navigation
  await p.click('#btnAutoFit');
  await p.waitForTimeout(300);
  ck('toggle turns it off', await p.evaluate(() => CMG.mapview.autoFitEnabled()) === false);
  await p.evaluate(() => CMG.mapview.map.setView([40.9, -102.5], 12, { animate: false }));
  await p.waitForTimeout(1300);
  ck('free navigation stays put', await p.evaluate(() => !CMG.mapview.allInView()));

  ck('export checkbox mirrors the toolbar',
     await p.evaluate(() => document.getElementById('autoFit').checked) === false);

  // export must not be dragged around by auto-fit
  await p.click('#btnAutoFit');
  await p.waitForTimeout(500);
  await p.click('.tabs .tab[data-tab="export"]');
  const dl = p.waitForEvent('download', { timeout: 90000 });
  await p.click('#exportPng');
  const d = await dl;
  const fs = require('fs'); await d.saveAs('autofit-export.png');
  const buf = fs.readFileSync('autofit-export.png');
  ck('export still renders at full size',
     buf.readUInt32BE(16) === 1950 && buf.readUInt32BE(20) === 1200,
     buf.readUInt32BE(16) + '×' + buf.readUInt32BE(20));
  ck('auto-fit released after export', await p.evaluate(() => CMG.mapview.suspendAutoFit) === false);
  ck('everything still framed after export', await p.evaluate(() => CMG.mapview.allInView()));

  await p.screenshot({ path: 'autofit.png' });
  console.log(out.join('\n'));
  console.log('errors: ' + (errs.length ? errs.slice(0,3).join(' | ') : 'none'));
  const f = out.filter(s => s.startsWith('FAIL')).length;
  console.log(`${out.length - f}/${out.length} checks passed`);
  await b.close(); process.exit(f ? 1 : 0);
})().catch(e => { console.error('HARNESS', e); process.exit(2); });
