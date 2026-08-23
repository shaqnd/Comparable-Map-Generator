#!/usr/bin/env node
/* Runs every browser suite.
 *
 *   node tests/run.js              # all suites
 *   node tests/run.js smoke stage  # only suites whose name contains these
 *
 * Everything the suites need is set up here: the two static servers, the
 * single-file builds and the seeded fixture. Nothing has to be running first.
 *
 * The only external dependency is Playwright's Chromium. If Playwright cannot
 * find a browser, set CHROME_PATH to one you already have.
 */
const { spawn, spawnSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const H = require('./harness');

const SUITES = [
  'nametest', 'envtest', 'portfoliotest', 'stagetest', 'autofittest', 'bugtest',
  'designtest', 'regiontest', 'themetest', 'countertest', 'seedtest', 'demotest',
  'embedtest', 'filetest', 'livecheck', 'pagestest', 'smoke'
];

const filter = process.argv.slice(2);
const chosen = filter.length
  ? SUITES.filter(s => filter.some(f => s.includes(f)))
  : SUITES;

/* ------------------------------------------------------------- static files */

function serve(root, port) {
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
                  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    let file = path.join(root, rel);
    if (rel.endsWith('/')) file = path.join(file, 'index.html');
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    });
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}

/* ------------------------------------------------------------- build inputs */

function build(args, label) {
  const r = spawnSync(process.execPath, [path.join(H.ROOT, 'tools/build.js'), ...args],
                      { cwd: H.ROOT, encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`build failed (${label}):\n${r.stderr || r.stdout}`);
    process.exit(1);
  }
}

function prepare() {
  build(['--mode=live'], 'live');
  build(['--mode=demo'], 'demo');

  // seedtest opens a build with a project baked in and autorun enabled
  const fixture = path.join(__dirname, 'fixtures', 'R0195554.cmap.json');
  if (fs.existsSync(fixture)) {
    build(['--mode=live', '--autorun', `--project=${fixture}`,
           `--out=${path.join(__dirname, 'comparable-map-R0195554.html')}`], 'seeded');
  }

  // pagestest checks the app served from a project subpath, as GitHub Pages does
  const mirror = path.join(__dirname, '.pages', 'Comparable-Map-Generator');
  fs.rmSync(path.join(__dirname, '.pages'), { recursive: true, force: true });
  fs.mkdirSync(mirror, { recursive: true });
  fs.copyFileSync(path.join(H.ROOT, 'index.html'), path.join(mirror, 'index.html'));
  fs.cpSync(path.join(H.ROOT, 'assets'), path.join(mirror, 'assets'), { recursive: true });
}

/* ------------------------------------------------------------------ running */

function runSuite(name) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(__dirname, name + '.js')],
                        { cwd: __dirname, env: process.env });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.on('close', code => resolve({ name, code, out }));
  });
}

(async () => {
  prepare();
  const servers = [
    await serve(H.ROOT, H.PORT),
    await serve(path.join(__dirname, '.pages'), H.PAGES_PORT)
  ];

  let failed = 0, total = 0, passed = 0;
  for (const name of chosen) {
    const r = await runSuite(name);
    const line = (r.out.match(/^\d+\/\d+ checks passed$/m) || [])[0] || '';
    const m = line.match(/^(\d+)\/(\d+)/);
    if (m) { passed += +m[1]; total += +m[2]; }
    const ok = r.code === 0;
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(15)}${line}`);
    if (!ok) console.log(r.out.split('\n').filter(l => /^FAIL|Error|error/.test(l)).slice(0, 8)
                          .map(l => '        ' + l).join('\n'));
  }

  servers.forEach(s => s.close());
  console.log(`\n${chosen.length - failed}/${chosen.length} suites, ${passed}/${total} checks`);
  process.exit(failed ? 1 : 0);
})();
