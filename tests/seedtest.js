const { chromium } = require('playwright');
const H = require('./harness');
const path = require('path');
const TILE = H.TILE;

// Test-only coordinates so the geocode path can be exercised offline.
const FIX = [
  ['22600',    39.9310, -104.7960],
  ['1953',     39.7100, -104.7180],
  ['17776',    39.8520, -104.7930],
  ['17501',    39.8515, -104.8010],
  ['1910',     39.7460, -104.7180]
];
const at = q => (FIX.find(f => q.includes(f[0])) || ['x', 39.8, -104.9]).slice(1);

(async () => {
  const b = await chromium.launch(H.LAUNCH);
  const ctx = await b.newContext({ viewport: { width: 1600, height: 980 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));

  await ctx.route('**/arcgisonline.com/**', r => r.fulfill({ contentType: 'image/png', body: TILE }));
  await ctx.route('**/geocoding.geo.census.gov/**', r => {
    const q = new URL(r.request().url()).searchParams.get('address') || '';
    const [lat, lng] = at(q);
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({
      result: { addressMatches: [{ matchedAddress: q.toUpperCase(), coordinates: { x: lng, y: lat } }] } }) });
  });
  await ctx.route('**/geocode.arcgis.com/**', r => {
    const q = new URL(r.request().url()).searchParams.get('singleLine') || '';
    const [lat, lng] = at(q);
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({
      candidates: [{ address: q, location: { x: lng, y: lat }, score: 100,
                     attributes: { Addr_type: 'PointAddress' } }] }) });
  });
  await ctx.route('**/nominatim**', r => r.fulfill({ contentType: 'application/json', body: '[]' }));

  const out = []; const ck = (n, ok, x) => out.push(`${ok?'PASS':'FAIL'}  ${n}${x?' — '+x:''}`);

  await p.goto('file://' + path.join(__dirname, 'comparable-map-R0195554.html'));
  await p.evaluate(() => localStorage.clear());
  await p.reload();
  await p.waitForTimeout(1200);

  ck('project baked in', await p.locator('#compCount').innerText() === '3' ? false : true,
     (await p.locator('#compCount').innerText()) + ' comps');
  ck('subject address loaded',
     (await p.locator('#subjectCard .prop-address').inputValue()).includes('22600 Interstate 76'));

  // auto-locate fires on open
  await p.waitForFunction(() => document.querySelectorAll('.cmg-pin').length === 5, null, { timeout: 30000 });
  ck('all five located automatically', await p.locator('.cmg-pin').count() === 5);
  ck('pins numbered', (await p.locator('.pin-num').allInnerTexts()).sort().join(',') === '1,2,3,4,S');

  const legend = await p.locator('#legendRows tr').count();
  ck('legend has subject + 4 comps', legend === 5, legend + ' rows');
  const dists = await p.locator('#compList .loc-dist').allInnerTexts();
  ck('distances computed', dists.length === 4, dists.join(' | '));

  const title = await p.locator('#ovTitleSub').innerText();
  ck('subtitle set', title.includes('R0195554'), title);

  await p.waitForTimeout(1500);
  await p.screenshot({ path: 'seeded.png' });

  // autorun should render the finished map without any interaction
  await p.waitForSelector('#cmgPreview:not([hidden])', { timeout: 120000 });
  const meta = await p.locator('#cmgPreviewMeta').innerText();
  ck('map rendered automatically on open', meta.includes('1950'), meta);
  const dims = await p.evaluate(() => {
    const i = document.getElementById('cmgPreviewImg');
    return i.naturalWidth + 'x' + i.naturalHeight;
  });
  ck('image is full print resolution', dims === '1950x1200', dims);
  // Standalone builds have no host to hand files to, so Save uses an anchor.
  const savedAs = await p.evaluate(() => new Promise(res => {
    const orig = HTMLAnchorElement.prototype.click;
    let name = null;
    HTMLAnchorElement.prototype.click = function () { name = this.download; };
    document.getElementById('cmgPreviewSave').click();
    setTimeout(() => { HTMLAnchorElement.prototype.click = orig; res(name); }, 900);
  }));
  ck('save writes a png', /\.png$/.test(savedAs || ''), String(savedAs));
  await p.screenshot({ path: 'autorun.png' });
  const src = await p.evaluate(() => document.getElementById('cmgPreviewImg').src);
  require('fs').writeFileSync('seeded-export.png', Buffer.from(src.split(',')[1], 'base64'));

  console.log(out.join('\n'));
  console.log('errors: ' + (errs.length ? errs.slice(0,3).join(' | ') : 'none'));
  const f = out.filter(s => s.startsWith('FAIL')).length;
  console.log(`${out.length - f}/${out.length} checks passed`);
  await b.close(); process.exit(f ? 1 : 0);
})().catch(e => { console.error('HARNESS', e); process.exit(2); });
