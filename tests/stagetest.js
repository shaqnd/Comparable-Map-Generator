/* Progressive disclosure: the opening screen is bare, and the controls that
   customise a map arrive with the first pin. */
const { chromium } = require('playwright');
const H = require('./harness');
const TILE = H.TILE;

(async () => {
  const b = await chromium.launch(H.LAUNCH);
  const ctx = await b.newContext({ viewport: { width: 1560, height: 980 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));

  await ctx.route('**/arcgisonline.com/**', r => r.fulfill({ contentType: 'image/png', body: TILE }));
  await ctx.route('**/geocode.arcgis.com/**', r => r.fulfill({
    contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify({ candidates: [{ address: '1600 Broadway, Denver, CO 80202',
      location: { x: -104.9873, y: 39.7439 }, score: 100,
      attributes: { Addr_type: 'PointAddress' } }] }) }));
  await ctx.route('**/geocoding.geo.census.gov/**', r => r.fulfill({
    contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify({ result: { addressMatches: [] } }) }));
  await ctx.route('**/nominatim**', r => r.fulfill({ contentType: 'application/json', body: '[]' }));

  const out = []; const ck = (n, ok, x) => out.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' — ' + x : ''}`);

  await p.goto(H.file('index.html'));
  await p.evaluate(() => localStorage.clear());
  await p.reload();
  await p.waitForTimeout(900);
  await p.click('#firstRunDismiss');
  await p.waitForTimeout(250);

  const vis = s => p.locator(s).isVisible();

  // ---- stage 1: an address field and little else
  ck('tab bar hidden before any pin', !(await vis('.tabs')));
  ck('mode tools hidden before any pin', !(await vis('#modePan')));
  ck('framing tools hidden before any pin', !(await vis('#btnFitAll')));
  ck('project panel hidden before any pin', !(await vis('#mapTitle')));
  ck('lead line explains the missing tools', await vis('#toolbarLead'));
  ck('subject field is there from the start', await vis('#subjectCard .prop-address'));
  ck('add comparable is there from the start', await vis('#addComp'));
  ck('locate-all hidden with nothing to locate', !(await vis('#locateAll')));
  const buttons1 = await p.locator('#sidebar button:visible, #toolbar button:visible').count();
  ck('opening screen is under ten buttons', buttons1 < 10, buttons1 + ' visible');
  await p.screenshot({ path: 'stage1.png' });

  // an address typed but not yet located brings back the locate-all button
  await p.fill('#subjectCard .prop-address', '1600 Broadway, Denver, CO');
  await p.waitForTimeout(250);
  ck('locate-all appears once an address is waiting', await vis('#locateAll'));

  // ---- stage 2: the first pin reveals the rest
  await p.press('#subjectCard .prop-address', 'Enter');
  await p.waitForFunction(() => document.querySelectorAll('.cmg-pin').length === 1,
                          null, { timeout: 20000 });
  await p.waitForTimeout(700);

  ck('tab bar revealed', await vis('.tabs'));
  ck('mode tools revealed', await vis('#modePan'));
  ck('framing tools revealed', await vis('#btnFitAll'));
  ck('project panel revealed', await vis('#mapTitle'));
  ck('lead line stands down', !(await vis('#toolbarLead')));
  ck('locate-all hidden again once located', !(await vis('#locateAll')));
  await p.screenshot({ path: 'stage2.png' });

  // ---- the reveal does not flap when a comparable is added and removed
  await p.click('#addComp');
  await p.waitForTimeout(250);
  ck('tabs stay put while a blank comparable sits there', await vis('.tabs'));

  // ---- other tabs are reachable once revealed
  await p.click('.tab[data-tab="export"]');
  await p.waitForTimeout(200);
  ck('export tab opens', await vis('#exportPng'));

  // ---- starting a new map returns to the bare screen
  await p.click('.tab[data-tab="properties"]');
  await p.waitForTimeout(200);
  p.once('dialog', d => d.accept());
  await p.click('#newProject');
  await p.waitForTimeout(800);
  ck('new map hides the tab bar again', !(await vis('.tabs')));
  ck('new map returns to the properties panel', await vis('#addComp'));
  ck('new map hides the export controls', !(await vis('#exportPng')));

  console.log(out.join('\n'));
  console.log('errors:', errs.length ? errs : 'none');
  const pass = out.filter(l => l.startsWith('PASS')).length;
  console.log(`${pass}/${out.length} checks passed`);
  await b.close();
  process.exit(pass === out.length ? 0 : 1);
})();
