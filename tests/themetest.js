const { chromium } = require('playwright');
const H = require('./harness');
const TILE = H.TILE;
(async () => {
  const b = await chromium.launch(H.LAUNCH);
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type()==='error' && !/ERR_|Failed to load/.test(m.text())) errs.push(m.text()); });
  await ctx.route('**/arcgisonline.com/**', r => r.fulfill({contentType:'image/png', body:TILE}));
  await ctx.route('**/geocod*/**', r => r.abort());
  await ctx.route('**/nominatim**', r => r.abort());

  const out = []; const ck = (n, ok, x) => out.push(`${ok?'PASS':'FAIL'}  ${n}${x?' — '+x:''}`);

  await p.goto(H.served('index.html'));
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });

  // four comps placed by coordinate, no geocoder needed
  await p.evaluate(() => {
    const S = CMG.store;
    S.setLocation(S.state.subjects[0].id, 39.90, -104.80, null, true);
    S.state.subjects[0].address = '22600 Interstate 76, Brighton, CO';
    [[39.86,-104.79],[39.85,-104.80],[39.75,-104.72],[39.74,-104.71]].forEach((c,i) => {
      const comp = S.addComp('Comp ' + (i+1));
      S.setLocation(comp.id, c[0], c[1], null, true);
    });
    CMG.mapview.fitAll();
  });
  await p.waitForTimeout(700);

  await p.click('.tabs .tab[data-tab="theme"]');
  ck('theme tab renders token groups', await p.locator('#tokenGroups .panel').count() >= 6,
     (await p.locator('#tokenGroups .panel').count()) + ' groups');
  ck('every token has a control',
     await p.locator('#tokenGroups [data-token]').count() === await p.evaluate(() => CMG.THEME_TOKENS.length),
     await p.locator('#tokenGroups [data-token]').count() + ' of ' + await p.evaluate(() => CMG.THEME_TOKENS.length));

  // comps cycle the palette
  const cycle = await p.evaluate(() => CMG.store.state.comps.map(c => CMG.theme.colorFor(c)));
  const pal = await p.evaluate(() => CMG.store.state.theme.palette);
  ck('comps cycle the palette', cycle[0] === pal[0] && cycle[1] === pal[1] && cycle[3] === pal[3],
     cycle.join(' '));

  // switch preset -> pins actually change colour
  const before = await p.locator('.cmg-pin').first().locator('.pin-inner').getAttribute('style');
  await p.selectOption('#themePreset', 'atlas');
  await p.waitForTimeout(500);
  const after = await p.locator('.cmg-pin').first().locator('.pin-inner').getAttribute('style');
  ck('preset repaints the map', before !== after, `${before} -> ${after}`);
  ck('subject took the Atlas green',
     (await p.evaluate(() => CMG.theme.colorFor(CMG.store.state.subjects[0]))) === '#0f5c46');

  // edit one token -> CSS var updates
  await p.evaluate(() => CMG.store.setToken('labelBg', '#ffee00'));
  await p.waitForTimeout(300);
  const labelBg = await p.evaluate(() =>
    getComputedStyle(document.getElementById('mapFrame')).getPropertyValue('--t-labelBg').trim());
  ck('token edit reaches the CSS variable', labelBg === '#ffee00', labelBg);

  // per-comp override
  await p.evaluate(() => CMG.store.update(CMG.store.state.comps[0].id, { color: '#ff0000' }));
  await p.waitForTimeout(300);
  ck('per-comp override wins over palette',
     await p.evaluate(() => CMG.theme.colorFor(CMG.store.state.comps[0])) === '#ff0000');

  // save, switch away, come back
  await p.fill('#themeName', 'Carter house style');
  await p.click('#themeSave');
  await p.waitForTimeout(400);
  ck('saving a built-in forks a new id',
     await p.evaluate(() => CMG.store.state.theme.id) !== 'atlas',
     await p.evaluate(() => CMG.store.state.theme.id));
  const savedId = await p.evaluate(() => CMG.store.state.theme.id);
  await p.selectOption('#themePreset', 'mono');
  await p.waitForTimeout(300);
  await p.selectOption('#themePreset', savedId);
  await p.waitForTimeout(300);
  ck('saved theme reloads from the library',
     await p.evaluate(() => CMG.store.state.theme.name) === 'Carter house style' &&
     await p.evaluate(() => CMG.store.state.theme.tokens.labelBg) === '#ffee00');

  // theme survives a reload with the project
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  ck('theme persists across reload',
     await p.evaluate(() => CMG.store.state.theme.name) === 'Carter house style',
     await p.evaluate(() => CMG.store.state.theme.name));

  // 'auto' tokens resolve
  ck('auto leader inherits the item colour',
     await p.evaluate(() => CMG.theme.resolve('leader', CMG.store.state.theme, '#123456')) === '#123456');

  // transparent pin centre
  await p.evaluate(() => CMG.store.setToken('pinDisc', 'transparent'));
  await p.waitForTimeout(400);
  ck('transparent pin centre drops the disc',
     await p.locator('.cmg-pin .pin-core').count() === 0,
     await p.locator('.cmg-pin .pin-core').count() + ' circles');
  ck('pin number flips to white on a transparent centre',
     await p.evaluate(() => CMG.theme.pinNumberColor(CMG.store.state.subjects[0])) === '#ffffff');

  await p.click('.tabs .tab[data-tab="theme"]');
  await p.screenshot({ path: 'theme-panel.png' });

  console.log(out.join('\n'));
  console.log('errors: ' + (errs.length ? errs.slice(0,4).join(' | ') : 'none'));
  const f = out.filter(s => s.startsWith('FAIL')).length;
  console.log(`${out.length - f}/${out.length} checks passed`);
  await b.close(); process.exit(f ? 1 : 0);
})().catch(e => { console.error('HARNESS', e); process.exit(2); });
