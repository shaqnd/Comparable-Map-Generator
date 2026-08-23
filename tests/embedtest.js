/* Reproduces the artifact host: an iframe whose height is driven by the
   content's scrollHeight, which is exactly what collapsed the map. */
const { chromium } = require('playwright');
const H = require('./harness');
const fs = require('fs');
const path = require('path');

const DEMO = require('path').join(H.ROOT, 'demo/comparable-map-demo.html');
const HOST = path.join(__dirname, 'host.html');
fs.writeFileSync(HOST, `<!doctype html><meta charset=utf8>
<style>html,body{margin:0;background:#faf9f5}iframe{display:block;width:100%;border:0;height:150px}</style>
<iframe id="f" src="file://${DEMO}"></iframe>
<script>
  // Mimic the host: poll the child's scrollHeight and resize the frame to it.
  var f = document.getElementById('f');
  setInterval(function () {
    try {
      var d = f.contentDocument;
      if (!d) return;
      var h = Math.max(d.documentElement.scrollHeight, d.body ? d.body.scrollHeight : 0);
      if (h && Math.abs(parseInt(f.style.height || '150') - h) > 1) f.style.height = h + 'px';
    } catch (e) {}
  }, 120);
</script>`);

(async () => {
  const b = await chromium.launch(H.LAUNCH);
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
  const p = await ctx.newPage();
  const ext = [];
  await ctx.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith('file://') || u.startsWith('data:') || u.startsWith('blob:')) return r.continue();
    ext.push(u); return r.abort();
  });
  await p.goto('file://' + HOST);
  await p.waitForTimeout(2500);

  const frame = p.frames().find(f => f.url().includes('comparable-map-demo'));

  // Chrome blocks cross-document access between file:// frames, so run the
  // host's resize loop from the test: read the child's scrollHeight, apply it
  // to the frame, repeat. If it converges, the real host converges too.
  const trace = [];
  for (let i = 0; i < 6; i++) {
    const h = await frame.evaluate(() => Math.max(
      document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0));
    trace.push(h);
    await p.evaluate((v) => { document.getElementById('f').style.height = v + 'px'; }, h);
    await p.waitForTimeout(400);
  }
  const settled = trace[trace.length - 1];
  const stable = trace.slice(-3).every(v => Math.abs(v - settled) <= 2);
  const m = await frame.evaluate(() => {
    const r = (id) => { const e = document.getElementById(id); const b = e.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; };
    return { app: r('app'), map: r('map'), frame: r('mapFrame'),
             pins: document.querySelectorAll('.cmg-pin').length,
             docH: document.documentElement.scrollHeight };
  });
  const iframeH = await p.evaluate(() => document.getElementById('f').getBoundingClientRect().height);

  const out = [];
  const ck = (n, ok, x) => out.push(`${ok?'PASS':'FAIL'}  ${n}${x?' — '+x:''}`);
  ck('height converges, no shrink loop', stable && settled > 600, 'trace ' + trace.join(' -> '));
  ck('iframe settles at a usable height', iframeH > 600, Math.round(iframeH) + 'px');
  ck('app not collapsed', m.app[1] > 600, m.app.join('×'));
  ck('map has real area', m.map[1] > 400 && m.map[0] > 400, m.map.join('×'));
  ck('map frame sized', m.frame[1] > 300, m.frame.join('×'));
  ck('pins rendered', m.pins === 4, String(m.pins));
  ck('no external requests', ext.length === 0, String(ext.length));

  await p.screenshot({ path: 'embedded.png', fullPage: true });
  console.log(out.join('\n'));
  const f = out.filter(s => s.startsWith('FAIL')).length;
  console.log(`\n${out.length - f}/${out.length} checks passed`);
  await b.close();
  process.exit(f ? 1 : 0);
})().catch(e => { console.error('HARNESS', e); process.exit(2); });
