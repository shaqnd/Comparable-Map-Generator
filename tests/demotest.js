const { chromium } = require('playwright');
const H = require('./harness');
const path = require('path');
(async () => {
  const b = await chromium.launch(H.LAUNCH);
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 } });
  const p = await ctx.newPage();
  const external = [], errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type()==='error') errs.push('console: '+m.text()); });
  // Fail loudly on ANY request that is not the local file itself.
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith('file://') || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
    external.push(u);
    return route.abort();
  });

  const step = [];
  const check = (n, ok, x) => step.push(`${ok?'PASS':'FAIL'}  ${n}${x?' — '+x:''}`);

  await p.goto('file://' + require('path').join(H.ROOT, 'demo/comparable-map-demo.html'));
  // Wait for the seed to finish rather than guessing at how long it takes —
  // starting early makes every later pin count off by one.
  await p.waitForFunction(() => document.querySelectorAll('.cmg-pin').length === 4,
                          null, { timeout: 30000 });
  await p.waitForTimeout(800);

  check('no external requests', external.length === 0, external.slice(0,4).join(', ') || '0 attempted');
  check('banner present', await p.locator('#demoBanner .demo-label').innerText() === 'Demo build');
  check('sample project seeded', await p.locator('#compCount').innerText() === '3');
  check('pins on map', await p.locator('.cmg-pin').count() === 4, String(await p.locator('.cmg-pin').count()));
  check('synthetic tiles drawn', await p.locator('#map canvas.leaflet-tile').count() > 0,
        String(await p.locator('#map canvas.leaflet-tile').count()));
  check('labels rendered', await p.locator('.cmg-label').count() === 4);
  check('radius rings present', await p.evaluate(() => CMG.mapview._rings.length) > 0);

  // tiles actually have pixels (not blank)
  const nonBlank = await p.evaluate(() => {
    const c = document.querySelector('#map canvas.leaflet-tile');
    const d = c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    const seen = new Set();
    for (let i=0;i<d.length;i+=4*997) seen.add(d[i]+','+d[i+1]+','+d[i+2]);
    return seen.size;
  });
  check('basemap has real detail', nonBlank > 3, nonBlank + ' distinct colours sampled');

  // Geocode a known address.
  //
  // Adding a comparable rebuilds the whole card list, so the new card is
  // targeted by its own id — ":last-child" can be swapped out between the fill
  // and the keypress, which loses the typed address and geocodes nothing.
  const cardsBefore = await p.locator('#compList .prop-card').count();
  await p.click('#addComp');
  await p.waitForFunction(n => document.querySelectorAll('#compList .prop-card').length === n + 1,
                          cardsBefore, { timeout: 10000 });

  const newId = await p.evaluate(() => {
    const c = CMG.store.state.comps;
    return c[c.length - 1].id;
  });
  const field = `#compList .prop-card[data-id="${newId}"] .prop-address`;

  await p.fill(field, '3000 Larimer St, Denver, CO');
  await p.waitForFunction(id => (CMG.store.find(id) || {}).address?.includes('Larimer'),
                          newId, { timeout: 5000 });
  await p.press(field, 'Enter');

  // The demo geocoder answers with a simulated delay — wait on the result
  // rather than guessing how long it takes.
  await p.waitForFunction(id => (CMG.store.find(id) || {}).lat != null,
                          newId, { timeout: 20000 }).catch(() => {});
  check('offline geocoder locates address', await p.locator('.cmg-pin').count() === 5,
        String(await p.locator('.cmg-pin').count()));

  // parcel selection
  await p.click('#subjectCard .prop-card');
  await p.click('#modeParcel');
  const pin = await p.locator('.cmg-pin').first().boundingBox();
  await p.mouse.click(pin.x + pin.width/2, pin.y + pin.height - 3);
  await p.waitForTimeout(1200);
  check('parcel lookup works offline', await p.evaluate(() => !!CMG.store.state.subjects[0].parcel),
        await p.evaluate(() => (CMG.store.state.subjects[0].parcel||{}).apn || 'none'));

  // the county picker is the real 23-county list, only the services behind it stub
  await p.click('.tabs .tab[data-tab="map"]');
  const counties = await p.locator('#parcelPreset option').count();
  check('real county list in the demo', counties >= 24, counties + ' options');
  check('seeded project selects a real county',
        await p.locator('#parcelPreset').inputValue() === 'denver',
        await p.locator('#parcelPreset').inputValue());
  check('county picker grouped', await p.locator('#parcelPreset optgroup').count() === 4);

  const detected = await p.evaluate(() => CMG.parcels.countyAt(39.74, -104.99));
  check('offline county lookup works', detected === 'Denver', String(detected));

  await p.click('#countyRegistry > summary');
  await p.click('#testAllCounties');
  await p.waitForFunction(() => document.querySelectorAll('#registryResults .reg-row').length === 23,
    null, { timeout: 60000 });
  check('county coverage panel runs offline',
        await p.locator('#registryResults .reg-row').count() === 23);
  check('coverage rows say simulated',
        (await p.locator('#registryResults').innerText()).includes('simulated'));

  // themes reached the demo too
  await p.click('.tabs .tab[data-tab="theme"]');
  check('theme tab present in the demo', await p.locator('#tokenGroups .panel').count() >= 6);

  // basemap switch
  await p.click('.tabs .tab[data-tab="map"]');
  await p.click('.tabs .tab[data-tab="map"]');
  await p.click('.choice[data-id="street"]');
  await p.waitForTimeout(900);
  check('basemap switching works', await p.evaluate(() => CMG.store.state.view.basemap) === 'street');
  await p.click('.choice[data-id="aerial"]');
  await p.waitForTimeout(900);

  await p.screenshot({ path: 'demo-app.png' });

  // export
  await p.click('.tabs .tab[data-tab="export"]');
  await p.click('#exportPng');
  await p.waitForSelector('#cmgPreview:not([hidden])', { timeout: 90000 });
  const meta = await p.locator('#cmgPreviewMeta').innerText();
  check('export preview opens', meta.includes('1950 × 1200'), meta.slice(0,60));
  const imgOk = await p.evaluate(() => {
    const i = document.getElementById('cmgPreviewImg');
    return i.naturalWidth + 'x' + i.naturalHeight;
  });
  check('exported image is full resolution', imgOk === '1950x1200', imgOk);

  // Save must work both ways: anchor when standalone, host handoff when embedded.
  const standaloneSave = await p.evaluate(() => new Promise(res => {
    const orig = HTMLAnchorElement.prototype.click;
    let name = null;
    HTMLAnchorElement.prototype.click = function () { name = this.download; };
    document.getElementById('cmgPreviewSave').click();
    setTimeout(() => { HTMLAnchorElement.prototype.click = orig; res(name); }, 900);
  }));
  check('standalone save uses an anchor download', /\.png$/.test(standaloneSave || ''),
        String(standaloneSave));

  const hostSave = await p.evaluate(() => new Promise(res => {
    let got = null;
    window.claude = { use: n => Promise.resolve(n === 'downloads'
      ? { save: req => { got = req.filename + ':' + (req.data && req.data.size > 0); 
                         return Promise.resolve({ status: 'saved' }); } } : null) };
    document.getElementById('cmgPreviewSave').click();
    setTimeout(() => { delete window.claude; res(got); }, 900);
  }));
  check('embedded save hands the file to the host', /\.png:true$/.test(hostSave || ''),
        String(hostSave));
  await p.screenshot({ path: 'demo-export.png' });

  check('still no external requests', external.length === 0, external.slice(0,3).join(', ') || '0 attempted');
  console.log('\n' + step.join('\n'));
  console.log('\nerrors: ' + (errs.length ? errs.slice(0,5).join(' | ') : 'none'));
  const f = step.filter(s=>s.startsWith('FAIL')).length;
  console.log(`\n${step.length-f}/${step.length} checks passed`);
  await b.close();
  process.exit(f?1:0);
})().catch(e => { console.error('HARNESS', e); process.exit(2); });
