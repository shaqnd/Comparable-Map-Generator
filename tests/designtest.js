const { chromium } = require('playwright');
const H = require('./harness');
const TILE = H.TILE;
(async () => {
  const b = await chromium.launch(H.LAUNCH);
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 } });
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
  await p.waitForTimeout(500);

  // no font-dependent glyphs left in the toolbar
  const glyphs = await p.evaluate(() => {
    const bad = /[✥▨✎⌖]/;
    return [...document.querySelectorAll('#toolbar')].map(t => t.textContent)
      .filter(t => bad.test(t)).length;
  });
  ck('no tofu-prone glyphs in the toolbar', glyphs === 0);
  ck('every toolbar button carries an SVG icon', await p.evaluate(() => {
    const btns = [...document.querySelectorAll('#toolbar .tool')];
    return btns.length > 0 && btns.every(b => b.querySelector('.tool-ico svg'));
  }), await p.locator('#toolbar .tool').count() + ' buttons');

  // first run
  ck('first-run guide shows on an empty map', await p.locator('#firstRun').isVisible());
  ck('guide names the region',
     (await p.locator('#firstRunRegion').innerText()).includes('23 counties'),
     await p.locator('#firstRunRegion').innerText());
  ck('guide never enters the exported frame',
     await p.evaluate(() => !document.getElementById('mapFrame')
       .contains(document.getElementById('firstRun'))));
  ck('map stays draggable under the guide',
     await p.evaluate(() => getComputedStyle(document.getElementById('firstRun')).pointerEvents) === 'none');

  await p.screenshot({ path: 'design-firstrun.png' });

  await p.click('#firstRunDismiss');
  ck('guide dismisses', await p.locator('#firstRun').isHidden());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  ck('guide stays dismissed after reload', await p.locator('#firstRun').isHidden());

  // it should also not come back once there is work on the map
  await p.evaluate(() => localStorage.removeItem(CMG.FIRSTRUN_KEY));
  await p.evaluate(() => {
    const S = CMG.store;
    S.setLocation(S.state.subjects[0].id, 39.74, -104.99, null, true);
  });
  await p.waitForTimeout(400);
  ck('guide hides once the map has content', await p.locator('#firstRun').isHidden());

  // an empty legend should not float over a blank map
  const emptyLegend = await p.evaluate(() => {
    CMG.store.reset();
    CMG.mapview.render();
    return document.getElementById('ovLegend').hidden;
  });
  ck('empty legend stays hidden', emptyLegend === true);

  // A legend keys one symbol to another, so it needs a comparable to key
  // against the subject — one row alone is just a floating heading.
  const soloLegend = await p.evaluate(() => {
    const S = CMG.store;
    S.setLocation(S.state.subjects[0].id, 39.74, -104.99, null, true);
    S.state.subjects[0].address = '100 Main St, Denver, CO';
    CMG.mapview.render();
    return document.getElementById('ovLegend').hidden;
  });
  ck('legend stays hidden with only the subject', soloLegend === true);

  const filledLegend = await p.evaluate(() => {
    const S = CMG.store;
    const c = S.addComp('200 Main St, Denver, CO');
    S.setLocation(c.id, 39.75, -104.98, null, true);
    CMG.mapview.render();
    return !document.getElementById('ovLegend').hidden;
  });
  ck('legend returns at the first comparable', filledLegend === true);

  // keyboard focus is visible
  const ring = await p.evaluate(() => {
    const btn = document.getElementById('btnFitAll');
    btn.focus();
    const s = getComputedStyle(btn);
    return { w: s.outlineWidth, style: s.outlineStyle };
  });
  ck('keyboard focus draws a visible ring', ring.style !== 'none' && parseFloat(ring.w) >= 2,
     `${ring.style} ${ring.w}`);

  await p.screenshot({ path: 'design-toolbar.png' });
  console.log(out.join('\n'));
  console.log('errors: ' + (errs.length ? errs.slice(0,3).join(' | ') : 'none'));
  const f = out.filter(s => s.startsWith('FAIL')).length;
  console.log(`${out.length - f}/${out.length} checks passed`);
  await b.close(); process.exit(f ? 1 : 0);
})().catch(e => { console.error('HARNESS', e); process.exit(2); });
