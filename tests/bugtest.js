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

  // four comps, all placed by coordinate
  await p.evaluate(() => {
    const S = CMG.store;
    S.setLocation(S.state.subjects[0].id, 39.90, -104.80, null, true);
    [[39.86,-104.79],[39.85,-104.80],[39.75,-104.72],[39.74,-104.71]].forEach((c,i) => {
      const comp = S.addComp('Comp ' + (i+1));
      S.setLocation(comp.id, c[0], c[1], null, true);
    });
  });
  await p.waitForTimeout(500);

  /* --- A: an auto parcel outline should wear the property's colour --- */
  const parcelCols = await p.evaluate(() => {
    const S = CMG.store, T = CMG.theme;
    const comp2 = S.state.comps[1];
    return {
      compColour: T.colorFor(comp2),
      autoOutline: T.resolve('parcelStroke', S.state.theme, T.colorFor(comp2)),
      subject: S.state.theme.tokens.subject
    };
  });
  ck('auto parcel outline follows its property, not the subject',
     parcelCols.autoOutline === parcelCols.compColour,
     `outline ${parcelCols.autoOutline}, comp ${parcelCols.compColour}, subject ${parcelCols.subject}`);

  /* --- B: renumbering should carry custom labels with it --- */
  const renum = await p.evaluate(() => {
    const S = CMG.store;
    const c3 = S.state.comps[2];
    c3.labelText = 'COMPARABLE 3\n900 Elm St\nhand written';
    c3.labelCustom = true;
    S.removeComp(S.state.comps[0].id);          // c3 becomes comp 2
    const moved = S.state.comps[1];
    return { number: moved.number, firstLine: moved.labelText.split('\n')[0],
             kept: moved.labelText.includes('hand written') };
  });
  ck('custom label follows renumbering',
     renum.number === 2 && renum.firstLine === 'COMPARABLE 2' && renum.kept,
     `now #${renum.number}, label starts "${renum.firstLine}"`);

  /* --- C: pasting a list should be one undo, not one per line --- */
  const undoCount = await p.evaluate(async () => {
    const S = CMG.store;
    const before = S.state.comps.length;
    document.querySelector('details.sub > summary').click();
    document.getElementById('bulkText').value = 'A St, Denver, CO\nB St, Denver, CO\nC St, Denver, CO';
    document.getElementById('bulkAdd').click();
    await new Promise(r => setTimeout(r, 2500));
    const after = S.state.comps.length;
    S.undo();
    return { before, after, afterUndo: S.state.comps.length };
  });
  ck('one undo removes a whole pasted batch',
     undoCount.after === undoCount.before + 3 && undoCount.afterUndo === undoCount.before,
     `${undoCount.before} -> ${undoCount.after} -> ${undoCount.afterUndo} after one undo`);

  /* --- D: a burst of edits should not redraw the map once per edit --- */
  const renders = await p.evaluate(async () => {
    let n = 0;
    const real = CMG.mapview.render;
    CMG.mapview.render = function () { n++; return real.apply(this, arguments); };
    const id = CMG.store.state.comps[0].id;
    for (let i = 0; i < 12; i++) CMG.store.update(id, { fields: { notes: 'typing ' + i } });
    await new Promise(r => setTimeout(r, 400));
    CMG.mapview.render = real;
    return n;
  });
  ck('bursts of edits coalesce into few redraws', renders <= 3, `${renders} redraws for 12 edits`);

  /* --- E: transient layout state should stay out of saved files --- */
  const saved = await p.evaluate(async () => {
    CMG.mapview.autoPlaceLabels();
    const text = await CMG.store.toFile().text();
    return { hasAuto: text.includes('_autoOffset'), bytes: text.length };
  });
  ck('saved project carries no transient layout state', !saved.hasAuto,
     saved.hasAuto ? '_autoOffset present' : 'clean');

  console.log(out.join('\n'));
  console.log('errors: ' + (errs.length ? errs.slice(0,3).join(' | ') : 'none'));
  const f = out.filter(s => s.startsWith('FAIL')).length;
  console.log(`${out.length - f}/${out.length} checks passed`);
  await b.close(); process.exit(f ? 1 : 0);
})().catch(e => { console.error('HARNESS', e); process.exit(2); });
