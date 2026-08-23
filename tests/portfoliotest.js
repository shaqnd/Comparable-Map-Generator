/* Portfolio maps: many subjects, many comparables, distances measured to the
   nearest subject. */
const { chromium } = require('playwright');
const H = require('./harness');
const TILE = H.TILE;

(async () => {
  const b = await chromium.launch(H.LAUNCH);
  const ctx = await b.newContext({ viewport: { width: 1560, height: 980 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await ctx.route('**/arcgisonline.com/**', r => r.fulfill({ contentType: 'image/png', body: TILE }));

  const out = []; const ck = (n, ok, x) => out.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' — ' + x : ''}`);

  await p.goto(H.file('index.html'));
  await p.evaluate(() => localStorage.clear());
  await p.reload();
  await p.waitForTimeout(900);

  // ---- one subject: nothing changes from the single-property wording
  await p.evaluate(() => {
    const S = CMG.store;
    S.update(S.state.subjects[0].id, { address: '100 First St, Denver, CO' });
    S.setLocation(S.state.subjects[0].id, 39.700, -104.990, null, true);
  });
  await p.waitForTimeout(400);
  ck('a lone subject is keyed S', await p.locator('.cmg-pin .pin-num').first().innerText() === 'S');
  ck('its label heading is SUBJECT',
     (await p.locator('.cmg-label .lbl-head').first().innerText()).trim() === 'SUBJECT');
  ck('the subject count pill is hidden', !(await p.locator('#subjectCount').isVisible()));

  // ---- add two more subjects and four comparables
  await p.evaluate(() => {
    const S = CMG.store;
    const s2 = S.addSubject('200 Second St, Denver, CO');
    S.setLocation(s2.id, 39.780, -104.930, null, true);
    const s3 = S.addSubject('300 Third St, Denver, CO');
    S.setLocation(s3.id, 39.640, -105.050, null, true);
    [['A', 39.702, -104.988], ['B', 39.782, -104.928],
     ['C', 39.642, -105.052], ['D', 39.705, -104.985]].forEach(([n, lat, lng]) => {
      const c = S.addComp(n + ' Comp Ave, Denver, CO');
      S.setLocation(c.id, lat, lng, null, true);
    });
  });
  await p.waitForTimeout(600);

  const keys = await p.locator('.cmg-pin .pin-num').allInnerTexts();
  ck('every subject and comparable has a pin', keys.length === 7, keys.join(','));
  ck('subjects renumber to S1 S2 S3',
     ['S1', 'S2', 'S3'].every(k => keys.includes(k)), keys.join(','));
  ck('comparables number 1 to 4',
     ['1', '2', '3', '4'].every(k => keys.includes(k)), keys.join(','));

  const heads = await p.locator('.cmg-label .lbl-head').allInnerTexts();
  ck('subject headings gain their number',
     heads.includes('SUBJECT 1') && heads.includes('SUBJECT 3'), heads.join(' | '));

  // ---- distance is measured to the NEAREST subject, and says which
  const nearest = await p.evaluate(() => {
    const S = CMG.store;
    return S.state.comps.map(c => {
      const n = S.nearestSubject(c);
      return { comp: c.number, to: S.keyFor(n.subject), miles: +n.miles.toFixed(2) };
    });
  });
  ck('comp 1 measures to S1', nearest[0].to === 'S1', JSON.stringify(nearest[0]));
  ck('comp 2 measures to S2', nearest[1].to === 'S2', JSON.stringify(nearest[1]));
  ck('comp 3 measures to S3', nearest[2].to === 'S3', JSON.stringify(nearest[2]));
  ck('each distance is the short one', nearest.every(n => n.miles < 1),
     nearest.map(n => n.miles).join(','));

  const dists = await p.locator('#compList .loc-dist').allInnerTexts();
  ck('the card names the subject it measured to',
     dists.every(d => /of S[123]$/.test(d.trim())), dists.join(' | '));

  const legendDists = await p.locator('#legendRows .lg-dist').allInnerTexts();
  ck('the legend names it too',
     legendDists.length === 4 && legendDists.every(d => /of S[123]$/.test(d.trim())),
     legendDists.join(' | '));
  const legendRows = await p.locator('#legendRows tr').count();
  ck('the legend lists every subject and comp', legendRows === 7, legendRows + ' rows');

  // ---- rings are drawn around every subject, connectors go to the nearest one
  const ringCount = await p.evaluate(() => {
    CMG.store.setStyle({ radiusRings: '0.5' });
    CMG.mapview.render();          // setStyle renders on the next frame
    return CMG.mapview._rings.filter(l => l instanceof L.Circle).length;
  });
  ck('a ring around each subject', ringCount === 3, ringCount + ' circles');

  const connectorEnds = await p.evaluate(() => {
    CMG.store.setStyle({ showConnectors: true });
    CMG.mapview.render();
    const S = CMG.store;
    return CMG.mapview._connectors.map(l => {
      const a = l.getLatLngs()[0];
      const hit = S.state.subjects.find(s => Math.abs(s.lat - a.lat) < 1e-9);
      return hit ? S.keyFor(hit) : '?';
    });
  });
  ck('each connector starts at the nearest subject',
     connectorEnds.join(',') === 'S1,S2,S3,S1', connectorEnds.join(','));

  // ---- reordering and removal
  await p.evaluate(() => {
    const S = CMG.store;
    S.state.subjects[0].labelCustom = true;
    S.state.subjects[0].labelText = 'SUBJECT 1\nmy own wording';
    S.moveSubject(S.state.subjects[0].id, 1);
  });
  await p.waitForTimeout(300);
  const moved = await p.evaluate(() => {
    const S = CMG.store;
    const mine = S.state.subjects.find(s => s.labelCustom);
    return { number: mine.number, first: mine.labelText.split('\n')[0],
             second: mine.labelText.split('\n')[1] };
  });
  ck('a moved subject renumbers', moved.number === 2, JSON.stringify(moved));
  ck('its heading follows the new number', moved.first === 'SUBJECT 2', moved.first);
  ck('the rest of a hand-written label is untouched', moved.second === 'my own wording');

  const afterRemove = await p.evaluate(() => {
    const S = CMG.store;
    S.removeSubject(S.state.subjects[2].id);
    return { count: S.state.subjects.length, numbers: S.state.subjects.map(s => s.number) };
  });
  ck('removing a subject renumbers the rest',
     afterRemove.count === 2 && afterRemove.numbers.join(',') === '1,2',
     JSON.stringify(afterRemove));

  const lastOne = await p.evaluate(() => {
    const S = CMG.store;
    S.removeSubject(S.state.subjects[1].id);
    S.removeSubject(S.state.subjects[0].id);   // the last one clears, never vanishes
    return { count: S.state.subjects.length, address: S.state.subjects[0].address,
             key: S.keyFor(S.state.subjects[0]) };
  });
  ck('the last subject clears rather than disappearing',
     lastOne.count === 1 && lastOne.address === '', JSON.stringify(lastOne));
  ck('and goes back to being keyed S', lastOne.key === 'S', lastOne.key);

  // ---- scale: no ceiling on either list
  const big = await p.evaluate(() => {
    const S = CMG.store;
    const before = { s: S.state.subjects.length, c: S.state.comps.length };
    for (let i = 0; i < 30; i++) S.addSubject('S' + i + ' St, Denver, CO', true);
    for (let i = 0; i < 60; i++) S.addComp('C' + i + ' St, Denver, CO', true);
    return {
      added: { s: S.state.subjects.length - before.s, c: S.state.comps.length - before.c },
      subjects: S.state.subjects.length,
      comps: S.state.comps.length,
      lastSubject: S.keyFor(S.state.subjects[30]),
      lastComp: S.keyFor(S.state.comps[S.state.comps.length - 1]),
      colour: CMG.theme.colorFor(S.state.comps[S.state.comps.length - 1])
    };
  });
  ck('30 more subjects and 60 more comparables accepted',
     big.added.s === 30 && big.added.c === 60, JSON.stringify(big));
  ck('numbering keeps going past the palette',
     big.lastSubject === 'S31' && big.lastComp === String(big.comps), JSON.stringify(big));
  ck('colours cycle instead of running out', /^#/.test(big.colour), big.colour);

  // ---- a file written by the single-subject build still opens
  const legacy = await p.evaluate(() => {
    const old = {
      version: 1, id: 'map_legacy', title: 'Old job',
      subject: { id: 'subject_x', role: 'subject', address: '1 Old Way, Denver, CO',
                 lat: 39.7, lng: -104.99, fields: { size: '1 ac' } },
      comps: [{ id: 'comp_x', role: 'comp', number: 1, address: '2 Old Way, Denver, CO',
                lat: 39.71, lng: -104.98, fields: {} }]
    };
    CMG.store.fromFile(JSON.stringify(old));
    const S = CMG.store;
    return { subjects: S.state.subjects.length, addr: S.state.subjects[0].address,
             comps: S.state.comps.length, key: S.keyFor(S.state.subjects[0]),
             schema: S.state.schema, hasOldField: 'subject' in S.state };
  });
  ck('a single-subject file opens as a one-subject portfolio',
     legacy.subjects === 1 && legacy.comps === 1 && legacy.addr === '1 Old Way, Denver, CO',
     JSON.stringify(legacy));
  ck('and reads as plain "S" again', legacy.key === 'S');
  ck('the old top-level subject field is dropped', legacy.hasOldField === false);
  ck('saved jobs name their schema', legacy.schema === 'comparable-sales-map/1', legacy.schema);

  const record = await p.evaluate(() => {
    const c = CMG.store.state.comps[0];
    const s = CMG.store.state.subjects[0];
    return { verifications: Array.isArray(c.verifications),
             profile: !!s.profile && typeof s.profile === 'object',
             roundTrip: JSON.parse(CMG.store.serialise()).subjects.length };
  });
  ck('comparables carry a verification list', record.verifications === true);
  ck('subjects carry a profile object', record.profile === true);
  ck('subjects survive a save/load round trip', record.roundTrip === 1);

  console.log(out.join('\n'));
  console.log('errors:', errs.length ? errs : 'none');
  const pass = out.filter(l => l.startsWith('PASS')).length;
  console.log(`${pass}/${out.length} checks passed`);
  await b.close();
  process.exit(pass === out.length ? 0 : 1);
})();
