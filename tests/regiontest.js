const { chromium } = require('playwright');
const H = require('./harness');
const TILE = H.TILE;
(async () => {
  const b = await chromium.launch(H.LAUNCH);
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));

  // One dispatcher: Playwright matches the most recently added route first, so
  // a catch-all registered after the specific stubs would shadow all of them.
  const alive = new Set(['zdB7','adcogov','jeffco','gisservices.larimer','boco','summitcountyco','elpasoco']);
  await ctx.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith('http://127.0.0.1')) return r.continue();
    if (u.includes('arcgisonline.com')) return r.fulfill({ contentType: 'image/png', body: TILE });

    if (u.includes('/geocoder/geographies/')) return r.fulfill({ contentType: 'application/json',
      body: JSON.stringify({ result: { geographies: { Counties: [{ NAME: 'Adams County' }] } } }) });
    if (u.includes('/geocoder/locations/')) return r.fulfill({ contentType: 'application/json',
      body: '{"result":{"addressMatches":[]}}' });
    if (u.includes('nominatim')) return r.fulfill({ contentType: 'application/json', body: '[]' });

    if (u.includes('geocode.arcgis.com')) {
      const q = new URL(u).searchParams.get('singleLine') || '';
      // Kansas scores higher on purpose — region ranking must still win.
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ candidates: [
        { address: q + ', Wichita, KS', location: { x: -97.34, y: 37.69 }, score: 100,
          attributes: { Addr_type: 'PointAddress' } },
        { address: q + ', Brighton, CO', location: { x: -104.80, y: 39.93 }, score: 96,
          attributes: { Addr_type: 'PointAddress' } }
      ] }) });
    }

    if ([...alive].some(frag => u.includes(frag))) {
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify({
        name: 'Parcels', geometryType: 'esriGeometryPolygon',
        fields: [{ name: 'SITUS_ADDRESS' }, { name: 'APN' }, { name: 'OWNER' }] }) });
    }
    return r.abort();
  });

  const out = []; const ck = (n, ok, x) => out.push(`${ok?'PASS':'FAIL'}  ${n}${x?' — '+x:''}`);

  await p.goto(H.served('index.html'));
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });

  const centre = await p.evaluate(() => {
    const c = CMG.mapview.map.getCenter();
    return { lat: +c.lat.toFixed(2), lng: +c.lng.toFixed(2), zoom: CMG.mapview.map.getZoom() };
  });
  ck('opens on the Front Range',
     Math.abs(centre.lat - 39.6) < 0.6 && Math.abs(centre.lng + 105.4) < 0.6,
     JSON.stringify(centre));
  ck('23 counties registered', await p.evaluate(() => CMG.COUNTIES.length) === 23);
  ck('county picker is grouped', await p.locator('#parcelPreset optgroup').count() === 4,
     await p.locator('#parcelPreset optgroup').count() + ' groups');

  // region ranking beats raw score
  await p.fill('#subjectCard .prop-address', '22600 Interstate 76, Brighton, CO');
  await p.press('#subjectCard .prop-address', 'Enter');
  await p.waitForTimeout(1500);
  const modal = await p.locator('#modalHost').isVisible();
  if (modal) { await p.locator('.cand').first().click(); await p.waitForTimeout(800); }
  const loc = await p.evaluate(() => ({ lat: CMG.store.state.subjects[0].lat, lng: CMG.store.state.subjects[0].lng }));
  ck('Colorado beats the higher-scoring Kansas match',
     loc.lat > 39 && loc.lat < 40.5 && loc.lng < -104, JSON.stringify(loc));
  ck('in-region check works', await p.evaluate(() => CMG.geocode.inRegion(39.93, -104.80)) === true &&
     await p.evaluate(() => CMG.geocode.inRegion(37.69, -97.34)) === false);

  // county auto-detect
  await p.waitForTimeout(1200);
  ck('county auto-detected from the subject',
     await p.evaluate(() => CMG.store.state.parcelService.presetId) === 'adams',
     await p.evaluate(() => CMG.store.state.parcelService.presetId));

  // bulk verification
  await p.click('.tabs .tab[data-tab="map"]');
  await p.click('#countyRegistry > summary');
  await p.click('#testAllCounties');
  await p.waitForFunction(() => document.querySelectorAll('#registryResults .reg-row').length === 23,
    null, { timeout: 90000 });
  const ok = await p.locator('#registryResults .reg-row.is-ok').count();
  const bad = await p.locator('#registryResults .reg-row.is-bad').count();
  ck('every county reported', ok + bad === 23, `${ok} ok / ${bad} failed`);
  ck('reachable counties detected', ok === 7, `${ok} of 7`);
  ck('failures listed first',
     (await p.locator('#registryResults .reg-row').first().getAttribute('class')).includes('is-bad'));
  ck('verified counties marked in the picker',
     (await p.locator('#parcelPreset').innerHTML()).includes('✓'));

  // registry export/import round trip
  const round = await p.evaluate(async () => {
    const blob = CMG.parcels.exportRegistry();
    const text = await blob.text();
    CMG.parcels.setCounty('denver', { url: 'https://changed.example/0', verified: false });
    const n = CMG.parcels.importRegistry(text);
    return { n, denver: CMG.parcels.county('denver').url };
  });
  ck('registry round-trips', round.n === 23 && round.denver.includes('zdB7'),
     `${round.n} counties`);

  await p.screenshot({ path: 'region.png' });
  console.log(out.join('\n'));
  console.log('errors: ' + (errs.length ? errs.slice(0,3).join(' | ') : 'none'));
  const f = out.filter(s => s.startsWith('FAIL')).length;
  console.log(`${out.length - f}/${out.length} checks passed`);
  await b.close(); process.exit(f ? 1 : 0);
})().catch(e => { console.error('HARNESS', e); process.exit(2); });
