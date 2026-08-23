const { chromium } = require('playwright');
const H = require('./harness');
const TILE = H.TILE;
(async () => {
  const b = await chromium.launch(H.LAUNCH);
  const p = await (await b.newContext({viewport:{width:1400,height:900}})).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/arcgisonline.com/**', r => r.fulfill({contentType:'image/png', body:TILE}));
  // real services send Access-Control-Allow-Origin: * — mirror that here
  await p.route('**/geocode.arcgis.com/**', r => r.fulfill({
    contentType:'application/json', headers:{'access-control-allow-origin':'*'},
    body: JSON.stringify({candidates:[{address:'1600 Broadway, Denver, CO 80202',
      location:{x:-104.9873,y:39.7439}, score:100, attributes:{Addr_type:'PointAddress'}}]})}));
  await p.route('**/geocoding.geo.census.gov/**', r => r.fulfill({
    contentType:'application/json', headers:{'access-control-allow-origin':'*'},
    body: JSON.stringify({result:{addressMatches:[]}})}));
  await p.goto(H.file('index.html'));
  await p.waitForTimeout(800);
  console.log('leaflet loaded :', await p.evaluate(() => typeof L));
  console.log('html2canvas    :', await p.evaluate(() => typeof html2canvas));
  await p.fill('#subjectCard .prop-address', '1600 Broadway, Denver, CO');
  await p.press('#subjectCard .prop-address', 'Enter');
  await p.waitForTimeout(3000);
  console.log('pin from geocode over file:// :', await p.locator('.cmg-pin').count());
  console.log('localStorage works :', await p.evaluate(() => { try { localStorage.setItem('t','1'); return true; } catch(e){ return String(e.name); } }));
  console.log('page errors:', errs.length ? errs : 'none');
  await b.close();
})();
