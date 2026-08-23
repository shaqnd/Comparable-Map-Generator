/* End-to-end smoke test with stubbed tile + geocoder responses. */
const { chromium } = require('playwright');
const H = require('./harness');
const fs = require('fs');
const path = require('path');

const OUT = __dirname;
const BASE = H.served('index.html');

// 1x1 opaque PNG, stretched by Leaflet to fill each tile slot.
const TILE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mM8U/+/ngEIAB0CA/1p8ykAAAAASUVORK5CYII=',
  'base64');

function coordFor(q) {
  let h = 0;
  for (const ch of String(q)) h = (h * 31 + ch.charCodeAt(0)) % 100000;
  return { lat: 39.7392 + ((h % 100) - 50) / 3000, lng: -104.9903 + ((h % 97) - 48) / 3000 };
}

(async () => {
  const errors = [];
  const browser = await chromium.launch(H.LAUNCH);
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, acceptDownloads: true });
  const page = await ctx.newPage();

  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  // ---- stub external services -------------------------------------------
  await page.route('**/arcgisonline.com/**', r => r.fulfill({ contentType: 'image/png', body: TILE_PNG }));
  await page.route('**/tile.openstreetmap.org/**', r => r.fulfill({ contentType: 'image/png', body: TILE_PNG }));

  await page.route('**/geocoding.geo.census.gov/**', r => {
    const q = new URL(r.request().url()).searchParams.get('address') || '';
    const c = coordFor(q);
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({
      result: { addressMatches: [{ matchedAddress: q.toUpperCase(), coordinates: { x: c.lng, y: c.lat } }] }
    })});
  });

  await page.route('**/geocode.arcgis.com/**findAddressCandidates**', r => {
    const q = new URL(r.request().url()).searchParams.get('singleLine') || '';
    const c = coordFor(q);
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({
      candidates: [{ address: q, location: { x: c.lng, y: c.lat }, score: 100,
                     attributes: { Match_addr: q, Addr_type: 'PointAddress' } }]
    })});
  });

  await page.route('**/nominatim.openstreetmap.org/**', r =>
    r.fulfill({ contentType: 'application/json', body: '[]' }));

  // A stand-in county parcel service.
  await page.route('**/parcels.test/**', r => {
    const url = r.request().url();
    if (url.includes('/query')) {
      const g = JSON.parse(new URL(url).searchParams.get('geometry'));
      const d = 0.0006;
      r.fulfill({ contentType: 'application/json', body: JSON.stringify({
        type: 'FeatureCollection',
        features: [{ type: 'Feature',
          properties: { SITUS_ADDRESS: '123 Test St', SCHEDNUM: '0123456789', OWNER: 'Test Owner LLC', ACRES: '0.32' },
          geometry: { type: 'Polygon', coordinates: [[
            [g.x - d, g.y - d], [g.x + d, g.y - d], [g.x + d, g.y + d], [g.x - d, g.y + d], [g.x - d, g.y - d]]] } }]
      })});
    } else {
      r.fulfill({ contentType: 'application/json', body: JSON.stringify({
        name: 'Test Parcels', geometryType: 'esriGeometryPolygon',
        fields: [{ name: 'SITUS_ADDRESS' }, { name: 'SCHEDNUM' }, { name: 'OWNER' }, { name: 'ACRES' }]
      })});
    }
  });

  const step = [];
  const check = (name, ok, extra) => { step.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`); };

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });

  check('page boots', await page.locator('#map .leaflet-tile-pane').count() > 0);

  // ---- subject address ---------------------------------------------------
  await page.fill('#subjectCard .prop-address', '1600 Broadway, Denver, CO 80202');
  await page.press('#subjectCard .prop-address', 'Enter');
  await page.waitForSelector('.cmg-pin', { timeout: 8000 });
  check('subject geocodes and drops a pin', await page.locator('.cmg-pin').count() === 1);
  check('subject label rendered', await page.locator('.cmg-label').count() === 1);
  check('geocode badge shown', /Esri|Census/.test(await page.locator('#subjectCard .loc').first().innerText()));

  // ---- bulk comps --------------------------------------------------------
  await page.click('.tabs .tab[data-tab="properties"]');
  await page.click('details.sub > summary');
  await page.fill('#bulkText', '1001 16th St, Denver, CO\n2000 Larimer St, Denver, CO\n1550 Wewatta St, Denver, CO');
  await page.click('#bulkAdd');
  await page.waitForFunction(() => document.querySelectorAll('.cmg-pin').length === 4, null, { timeout: 20000 });
  check('three comps added and located', await page.locator('#compCount').innerText() === '3');
  check('pins numbered 1-3', (await page.locator('.pin-num').allInnerTexts()).join(',') === 'S,1,2,3');

  // ---- legend + distances ------------------------------------------------
  const legendRows = await page.locator('#legendRows tr').count();
  check('legend lists subject + comps', legendRows === 4, `${legendRows} rows`);
  const dist = await page.locator('#compList .loc-dist').first().innerText();
  check('distance from subject computed', /mi|ft/.test(dist), dist);

  // ---- label editing on the map ------------------------------------------
  // Leaflet orders marker DOM by latitude, so address labels by id, not index.
  const comp1Id = await page.evaluate(() => CMG.store.state.comps[0].id);
  const label = page.locator(`.cmg-label[data-id="${comp1Id}"]`);
  await label.dblclick();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('COMPARABLE 1\n1001 16th Street\n$4,250,000 · 3/2026');
  await page.mouse.click(20, 20);
  await page.waitForTimeout(400);
  const labelTxt = await page.locator(`.cmg-label[data-id="${comp1Id}"]`).innerText();
  check('map label is editable', labelTxt.includes('4,250,000'), JSON.stringify(labelTxt));
  const stored = await page.evaluate(() => CMG.store.state.comps[0]);
  check('label edit committed to the project', stored.labelCustom && stored.labelText.includes('4,250,000'),
        JSON.stringify(stored.labelText));
  const cardVal = await page.locator(`#compList .prop-card[data-id="${comp1Id}"] textarea`).count();
  void cardVal;
  const cardTxt = await page.locator('#compList .prop-card').first().locator('textarea').count();
  void cardTxt;

  // ---- label dragging ----------------------------------------------------
  const before = await page.evaluate(() => CMG.store.state.comps[0].labelOffset);
  const box = await page.locator(`.cmg-label[data-id="${comp1Id}"]`).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 8 });
  await page.mouse.up();
  const after = await page.evaluate(() => CMG.store.state.comps[0].labelOffset);
  check('label drags to a new offset', JSON.stringify(before) !== JSON.stringify(after),
        `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);

  // ---- parcel selection --------------------------------------------------
  await page.click('.tabs .tab[data-tab="map"]');
  await page.selectOption('#parcelPreset', 'custom');
  await page.fill('#parcelUrl', 'https://parcels.test/arcgis/rest/services/Parcels/FeatureServer/0');
  await page.click('#testParcel');
  await page.waitForSelector('#parcelStatus .good', { timeout: 8000 });
  check('parcel service test succeeds',
        (await page.locator('#parcelStatus').innerText()).includes('Test Parcels'));

  await page.click('.tabs .tab[data-tab="properties"]');
  await page.click('#subjectCard .prop-card');
  await page.click('#modeParcel');
  const mapBox = await page.locator('#map').boundingBox();
  const subjPin = await page.locator('.cmg-pin').first().boundingBox();
  await page.mouse.click(subjPin.x + subjPin.width / 2 + 30, subjPin.y + subjPin.height - 4);
  await page.waitForTimeout(1500);
  const hasParcel = await page.evaluate(() => !!CMG.store.state.subjects[0].parcel);
  check('parcel attached to subject', hasParcel,
        await page.evaluate(() => JSON.stringify((CMG.store.state.subjects[0].parcel || {}).apn)));
  void mapBox;

  // ---- hand-drawn boundary ----------------------------------------------
  await page.click('#modeDraw');
  const mb = await page.locator('#map').boundingBox();
  for (const [dx, dy] of [[-160, -90], [-60, -90], [-60, -10], [-160, -10]]) {
    await page.mouse.click(mb.x + mb.width / 2 + dx, mb.y + mb.height / 2 + dy);
    await page.waitForTimeout(90);
  }
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const drawn = await page.evaluate(() =>
    CMG.store.all().filter(p => p.parcel && p.parcel.source === 'drawn').length);
  check('hand-traced boundary saved', drawn === 1, `${drawn} traced`);

  // ---- undo --------------------------------------------------------------
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  const afterUndo = await page.evaluate(() =>
    CMG.store.all().filter(p => p.parcel && p.parcel.source === 'drawn').length);
  check('undo reverts the traced boundary', afterUndo === 0, `${afterUndo} traced`);

  // ---- framing + export --------------------------------------------------
  await page.click('#btnFitAll');
  await page.waitForTimeout(600);
  await page.click('.tabs .tab[data-tab="export"]');
  await page.selectOption('#exportPreset', 'body-half');
  await page.selectOption('#exportDpi', '300');
  const readout = await page.locator('#exportReadout').innerText();
  check('export readout shows pixel size', readout.includes('1950 × 1200 px'), readout.replace(/\n/g, ' | '));

  // Aspect ratio of the on-screen frame must equal the output aspect ratio.
  const fr = await page.locator('#mapFrame').boundingBox();
  const arErr = Math.abs((fr.width / fr.height) - (6.5 / 4.0));
  check('screen frame matches output aspect ratio', arErr < 0.02, `error ${arErr.toFixed(4)}`);

  await page.screenshot({ path: path.join(OUT, 'app.png') });

  const dl = page.waitForEvent('download', { timeout: 90000 });
  await page.click('#exportPng');
  const download = await dl;
  const file = path.join(OUT, 'export.png');
  await download.saveAs(file);
  const size = fs.statSync(file).size;
  check('PNG export downloads', size > 20000, `${(size / 1024).toFixed(0)} KB, ${download.suggestedFilename()}`);

  const dims = await page.evaluate(async () => {
    // decode the exported file dimensions the same way the browser would
    return new Promise(res => {
      const c = document.createElement('canvas');
      void c; res(null);
    });
  });
  void dims;

  // PNG header: width/height are big-endian uint32 at byte 16 and 20.
  const buf = fs.readFileSync(file);
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  check('exported image is 1950 × 1200 px', w === 1950 && h === 1200, `${w} × ${h}`);

  // ---- view restored after export ----------------------------------------
  const frameAfter = await page.locator('#mapFrame').boundingBox();
  check('on-screen frame restored after export',
        Math.abs(frameAfter.width - fr.width) < 2 && Math.abs(frameAfter.height - fr.height) < 2,
        `${frameAfter.width}×${frameAfter.height} vs ${fr.width}×${fr.height}`);
  check('ui scale reset to 1', await page.evaluate(() => CMG.mapview.uiScale) === 1);

  // ---- persistence -------------------------------------------------------
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const restored = await page.evaluate(() => ({
    comps: CMG.store.state.comps.length,
    subj: CMG.store.state.subjects[0].address,
    pins: document.querySelectorAll('.cmg-pin').length
  }));
  check('project restores after reload', restored.comps === 3 && restored.pins === 4,
        JSON.stringify(restored));

  await page.screenshot({ path: path.join(OUT, 'app-final.png') });

  console.log('\n' + step.join('\n'));
  console.log('\nconsole/page errors: ' + (errors.length ? '\n  ' + errors.join('\n  ') : 'none'));
  const failed = step.filter(s => s.startsWith('FAIL')).length;
  console.log(`\n${step.length - failed}/${step.length} checks passed`);
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
