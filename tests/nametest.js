/* The product name is undecided: it must live in one constant, and a rename
   must reach the title, the header and the badge with no other edit. */
const { chromium } = require('playwright');
const H = require('./harness');
const fs = require('fs');
(async () => {
  const b = await chromium.launch(H.LAUNCH);
  const out = []; const ck = (n, ok, x) => out.push(`${ok?'PASS':'FAIL'}  ${n}${x?' — '+x:''}`);

  const read = async (name) => {
    const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
    const p = await ctx.newPage();
    if (name) {
      // simulate the rename by overriding the one constant before boot
      await p.addInitScript(n => {
        Object.defineProperty(window, '__forceName', { value: n });
        document.addEventListener('DOMContentLoaded', () => {}, true);
      }, name);
    }
    await p.goto(H.file('index.html'));
    await p.waitForTimeout(900);
    if (name) {
      await p.evaluate(n => { CMG.PRODUCT_NAME = n; }, name);
      await p.reload();
      await p.waitForTimeout(300);
    }
    const r = await p.evaluate(() => ({
      constant: CMG.PRODUCT_NAME,
      title: document.title,
      header: document.querySelector('.brand-text strong').textContent,
      mark: document.querySelector('.brand-mark').textContent,
      schema: CMG.SCHEMA_ID
    }));
    await ctx.close();
    return r;
  };

  const now = await read(null);
  ck('one constant holds the name', now.constant === 'CompCarto', now.constant);
  ck('window title follows it', now.title === 'CompCarto', now.title);
  ck('sidebar header follows it', now.header === 'CompCarto', now.header);
  ck('badge initials derive from capitals', now.mark === 'CC', now.mark);
  ck('schema id carries no product name',
     now.schema === 'comparable-sales-map/1' && !/assess/i.test(now.schema), now.schema);

  // a rename is one edit: patch config.js on disk, rebuild nothing, reload
  const cfgPath = require('path').join(H.ROOT, 'assets/js/config.js');
  const original = fs.readFileSync(cfgPath, 'utf8');
  try {
    fs.writeFileSync(cfgPath, original.replace("CMG.PRODUCT_NAME = 'CompCarto'",
                                               "CMG.PRODUCT_NAME = 'AssessorTrax'"));
    const renamed = await read(null);
    ck('renaming the constant renames the title', renamed.title === 'AssessorTrax', renamed.title);
    ck('and the header', renamed.header === 'AssessorTrax', renamed.header);
    ck('and the badge', renamed.mark === 'AT', renamed.mark);
    ck('while the schema id is untouched', renamed.schema === 'comparable-sales-map/1', renamed.schema);
  } finally {
    fs.writeFileSync(cfgPath, original);
  }

  // no stray hard-coded product name in source
  const src = ['index.html', 'assets/js/app.js', 'assets/js/ui.js', 'assets/js/store.js',
               'assets/js/mapview.js', 'assets/js/exporter.js']
    .map(f => fs.readFileSync(H.ROOT + '/' + f, 'utf8'));
  const strays = src.filter(t => /CompCarto|AssessMapper|AssessorTrax|AssessorView/.test(t)).length;
  ck('no hard-coded name in markup or modules', strays === 0, strays + ' file(s) contain one');

  console.log(out.join('\n'));
  const pass = out.filter(l => l.startsWith('PASS')).length;
  console.log(`${pass}/${out.length} checks passed`);
  await b.close();
  process.exit(pass === out.length ? 0 : 1);
})();
