/* The environment model: the fields exist, they survive a round trip, and the
   subject address is never stripped from the author's own file. */
const { chromium } = require('playwright');
const H = require('./harness');
(async () => {
  const b = await chromium.launch(H.LAUNCH);
  const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(H.file('index.html'));
  await p.evaluate(() => localStorage.clear());
  await p.reload();
  await p.waitForTimeout(900);

  const out = []; const ck = (n, ok, x) => out.push(`${ok?'PASS':'FAIL'}  ${n}${x?' — '+x:''}`);

  const blank = await p.evaluate(() => {
    const s = CMG.store.state;
    return { hasEnv: 'environmentId' in s, hasBy: 'createdBy' in s,
             env: s.environmentId, by: s.createdBy };
  });
  ck('a job carries an environment field', blank.hasEnv && blank.hasBy, JSON.stringify(blank));
  ck('unset until a server enforces it', blank.env === null && blank.by === null);

  // the author's own address is kept in full — never redacted on save
  const kept = await p.evaluate(() => {
    const S = CMG.store;
    S.update(S.state.subjects[0].id, { address: '22600 Interstate 76, Brighton, CO' });
    S.setLocation(S.state.subjects[0].id, 39.9205, -104.8060, null, true);
    const saved = JSON.parse(S.serialise());
    return { address: saved.subjects[0].address, lat: saved.subjects[0].lat,
             profile: saved.subjects[0].profile };
  });
  ck('the author keeps the exact address in their own file',
     kept.address === '22600 Interstate 76, Brighton, CO' && kept.lat === 39.9205,
     JSON.stringify(kept));
  ck('the profile object is there to carry what may cross a boundary',
     kept.profile && typeof kept.profile === 'object');

  // the split is a field allow-list, not a restructuring
  const projection = await p.evaluate(() => {
    const s = JSON.parse(CMG.store.serialise());
    const ALLOWED = ['id', 'role', 'number', 'profile'];
    const outside = s.subjects.map(sub => {
      const o = {};
      ALLOWED.forEach(k => { if (k in sub) o[k] = sub[k]; });
      return o;
    });
    return { keys: Object.keys(outside[0]).sort().join(','),
             leaksAddress: JSON.stringify(outside).includes('Interstate') };
  });
  ck('an outside-environment projection is a field allow-list',
     projection.keys === 'id,number,profile,role', projection.keys);
  ck('and it carries no address', projection.leaksAddress === false);

  // an environment id set by hand survives save and reload
  const round = await p.evaluate(() => {
    const S = CMG.store;
    S.state.environmentId = 'env_adams_assessor';
    S.state.createdBy = 'user_17';
    const text = S.serialise();
    S.fromFile(text);
    return { env: S.state.environmentId, by: S.state.createdBy };
  });
  ck('environment survives a save and reload',
     round.env === 'env_adams_assessor' && round.by === 'user_17', JSON.stringify(round));

  // a file from before the field existed still opens
  const legacy = await p.evaluate(() => {
    CMG.store.fromFile(JSON.stringify({
      version: 1, id: 'map_old', title: 'Old job',
      subject: { role: 'subject', address: '1 Old Way, Denver, CO', lat: 39.7, lng: -104.99 },
      comps: []
    }));
    const s = CMG.store.state;
    return { env: s.environmentId, subjects: s.subjects.length, addr: s.subjects[0].address };
  });
  ck('a pre-environment file opens with the field null',
     legacy.env === null && legacy.subjects === 1 && legacy.addr === '1 Old Way, Denver, CO',
     JSON.stringify(legacy));

  console.log(out.join('\n'));
  console.log('errors:', errs.length ? errs : 'none');
  const pass = out.filter(l => l.startsWith('PASS')).length;
  console.log(`${pass}/${out.length} checks passed`);
  await b.close();
  process.exit(pass === out.length ? 0 : 1);
})();
