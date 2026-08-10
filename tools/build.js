#!/usr/bin/env node
/* Assembles single-file builds of the tool.

   Every stylesheet and script is inlined, so the result is one HTML file that
   can be emailed, dropped on a shared drive, or opened straight from disk.

   Two modes:
     live  — the real tool: Esri imagery, three geocoders, county parcel layers.
     demo  — tiles, geocoding and parcels replaced with offline stand-ins, so
             the page makes no network requests at all.

   A project can be baked in, so the file opens with the subject and
   comparables already entered. Any addresses without coordinates are looked up
   on first open (live mode only — the demo has no real geocoder to call).

   Usage:
     node tools/build.js                                   # demo build
     node tools/build.js --mode=live --out=dist/tool.html
     node tools/build.js --mode=live --project=job.cmap.json --out=dist/job.html
*/
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const args = {};
process.argv.slice(2).forEach((a) => {
  const m = /^--([\w-]+)(?:=(.*))?$/.exec(a);
  if (m) args[m[1]] = m[2] === undefined ? true : m[2];
});

const MODE = args.mode === 'live' ? 'live' : 'demo';
const OUT = path.resolve(ROOT, args.out ||
  (MODE === 'live' ? 'dist/comparable-map-standalone.html' : 'demo/comparable-map-demo.html'));

const read = (p) => fs.readFileSync(path.isAbsolute(p) ? p : path.join(ROOT, p), 'utf8');

/* Load order — overrides sit between the modules and app.js, which boots. */
const APP_SCRIPTS = [
  'assets/js/util.js',
  'assets/js/config.js',
  'assets/js/store.js',
  'assets/js/geocode.js',
  'assets/js/parcels.js',
  'assets/js/mapview.js',
  'assets/js/exporter.js',
  'assets/js/ui.js'
];

/** Markup from index.html, minus its script tags. */
function extractBody() {
  const html = read('index.html');
  const body = html.slice(html.indexOf('<body>') + '<body>'.length, html.lastIndexOf('</body>'));
  return body.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/\n{3,}/g, '\n\n').trim();
}

/** A closing script tag inside a string literal would end the inline block. */
function guard(js) {
  return js.replace(/<\/script>/gi, '<\\/script>');
}

const DEMO_BANNER = `
<div id="demoBanner">
  <span class="demo-label">Demo build</span>
  <span class="demo-note">Everything is interactive, but the aerial imagery,
    address lookup and parcel service are <b>simulated</b> so the page needs no
    network. The real tool uses live Esri imagery, three geocoders and your
    county's parcel layer.</span>
  <span class="demo-actions">
    <button class="demo-btn" id="demoReset" type="button">Reset demo</button>
  </span>
</div>`;

const DEMO_PREVIEW = `
<div id="demoPreview" hidden>
  <div class="demo-preview-card" role="dialog" aria-modal="true" aria-label="Exported image">
    <div class="demo-preview-head">
      <strong>Exported image</strong>
      <span id="demoPreviewMeta"></span>
    </div>
    <div class="demo-preview-body"><img id="demoPreviewImg" alt="Exported comparable sales map"></div>
    <div class="demo-preview-foot">
      <span class="grow">In the real tool this downloads straight to your Downloads
        folder, or copies to the clipboard for pasting into Word.</span>
      <a class="demo-primary" id="demoPreviewSave" href="#" download>Save image</a>
      <button class="demo-ghost" id="demoPreviewClose" type="button">Close</button>
    </div>
  </div>
</div>`;

const DEMO_BOOT = `
(function (CMG) {
  'use strict';
  // Only fill the viewport when this page owns the window. Embedded in a host
  // that sizes its frame to the content, viewport-relative heights collapse.
  if (window === window.top) document.documentElement.classList.add('cmg-standalone');

  // Some hosts sandbox the page and silently suppress native dialogs, which
  // would leave "New" and "Save as preset" looking broken. The demo has nothing
  // precious to protect — "Reset demo" restores the sample project.
  window.confirm = function () { return true; };
  window.prompt = function (msg, def) { return def || 'Saved parcel service'; };

  var origInit = CMG.store.init;
  CMG.store.init = function () {
    var state = origInit.apply(this, arguments);
    if (!CMG.store.located().length && !CMG.store.state.comps.length) CMG.demoSeed();
    return CMG.store.state;
  };

  document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('demoReset').addEventListener('click', function () {
      try { localStorage.removeItem(CMG.STORAGE_KEY); } catch (e) { /* sandboxed */ }
      location.reload();
    });
    var preview = document.getElementById('demoPreview');
    document.getElementById('demoPreviewClose').addEventListener('click', function () {
      preview.hidden = true;
    });
    preview.addEventListener('click', function (ev) {
      if (ev.target === preview) preview.hidden = true;
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && !preview.hidden) preview.hidden = true;
    });
  });
})(window.CMG);`;

/** Live builds get the baked-in project, if one was supplied. */
function seedBoot(project) {
  if (!project) return '';
  return `
(function (CMG) {
  'use strict';
  var SEED = ${JSON.stringify(project)};

  // Load the supplied project the first time only; a returning user's own work,
  // restored from this browser, always wins.
  var origInit = CMG.store.init;
  CMG.store.init = function () {
    var restored = origInit.apply(this, arguments);
    var empty = !CMG.store.located().length && !CMG.store.state.comps.length &&
                !(CMG.store.state.subject.address || '').trim();
    if (empty) {
      CMG.store.state = CMG.store.migrate(JSON.parse(JSON.stringify(SEED)));
      CMG.store.renumber();
    }
    return CMG.store.state;
  };

  // Addresses arrive without coordinates on purpose — they are looked up here,
  // in the browser, against the live geocoders, rather than being guessed at
  // build time. Every pin still needs checking against the aerial.
  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(function () {
      var needs = CMG.store.all().some(function (p) {
        return (p.address || '').trim() && p.lat == null;
      });
      if (needs) CMG.ui.locateAllMissing();
    }, 350);
  });
})(window.CMG);`;
}

const LIVE_BOOT = `
(function () {
  'use strict';
  if (window === window.top) document.documentElement.classList.add('cmg-standalone');
})();`;

/* Standalone/embedded height handling lives in demo.css; live builds need the
   same rules without the demo chrome. */
const LIVE_LAYOUT_CSS = `
html, body { height: auto; margin: 0; padding: 0; background: #eef1f5; }
#app { height: 760px; }
.cmg-standalone, .cmg-standalone body { height: 100%; }
.cmg-standalone #app { height: 100vh; }
@supports (height: 100dvh) { .cmg-standalone #app { height: 100dvh; } }`;

let project = null;
if (args.project) {
  project = JSON.parse(read(path.resolve(process.cwd(), args.project)));
}

const title = args.title ||
  (MODE === 'demo' ? 'Comparable Sales Map Generator — demo'
                   : (project && project.title ? project.title + ' — Comparable Sales Map'
                                               : 'Comparable Sales Map Generator'));

const parts = [];
parts.push('<title>' + title + '</title>');
parts.push('<style>\n' + read('assets/vendor/leaflet/leaflet.css') + '\n</style>');
parts.push('<style>\n' + read('assets/css/app.css') + '\n</style>');

if (MODE === 'demo') {
  parts.push('<style>\n' + read('demo/demo.css') + '\n</style>');
  parts.push(DEMO_BANNER);
} else {
  parts.push('<style>' + LIVE_LAYOUT_CSS + '\n</style>');
}

parts.push(extractBody());
if (MODE === 'demo') parts.push(DEMO_PREVIEW);

parts.push('<script>\n' + guard(read('assets/vendor/leaflet/leaflet.js')) + '\n</script>');
parts.push('<script>\n' + guard(read('assets/vendor/html2canvas/html2canvas.min.js')) + '\n</script>');
APP_SCRIPTS.forEach((f) => parts.push('<script>\n' + guard(read(f)) + '\n</script>'));

if (MODE === 'demo') {
  parts.push('<script>\n' + guard(read('demo/demo-mode.js')) + '\n</script>');
  parts.push('<script>\n' + DEMO_BOOT + '\n</script>');
} else {
  parts.push('<script>\n' + LIVE_BOOT + '\n</script>');
  if (project) parts.push('<script>\n' + guard(seedBoot(project)) + '\n</script>');
}

parts.push('<script>\n' + guard(read('assets/js/app.js')) + '\n</script>');

const output = parts.join('\n\n');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, output);

console.log('wrote ' + path.relative(ROOT, OUT) + '  (' + (output.length / 1024).toFixed(0) + ' KB, ' +
  MODE + ' build' + (project ? ', project baked in' : '') + ')');
