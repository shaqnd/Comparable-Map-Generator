#!/usr/bin/env node
/* Assembles the self-contained demo build.

   Takes the real application, inlines every stylesheet and script, and appends
   the demo-mode overrides that replace tiles, geocoding and parcels with
   offline stand-ins. The output is one HTML file with no external requests, so
   it can be opened straight from disk or published anywhere.

   Usage:  node tools/build-demo.js [outfile]
   Default outfile: demo/comparable-map-demo.html
*/
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(ROOT, process.argv[2] || 'demo/comparable-map-demo.html');

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/* Script tags in load order — the demo overrides sit between the application
   modules and app.js, which is what boots everything. */
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

/** Pull the markup out of index.html, dropping the script tags. */
function extractBody() {
  const html = read('index.html');
  const body = html.slice(html.indexOf('<body>') + '<body>'.length, html.lastIndexOf('</body>'));
  return body.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/\n{3,}/g, '\n\n').trim();
}

/** A closing script tag inside a string literal would end the inline block. */
function guard(js) {
  return js.replace(/<\/script>/gi, '<\\/script>');
}

const BANNER = `
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

const PREVIEW = `
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

const BOOT = `
(function (CMG) {
  'use strict';
  // Only fill the viewport when this page owns the window. Embedded in a host
  // that sizes its frame to the content, viewport-relative heights collapse.
  if (window === window.top) document.documentElement.classList.add('cmg-standalone');
  // Seed the sample project the first time, but never overwrite real work.
  var origInit = CMG.store.init;
  CMG.store.init = function () {
    var state = origInit.apply(this, arguments);
    if (!CMG.store.located().length && !CMG.store.state.comps.length) CMG.demoSeed();
    return CMG.store.state;
  };

  // Some hosts sandbox the page and silently suppress native dialogs, which
  // would leave "New" and "Save as preset" looking broken. The demo has nothing
  // precious to protect — "Reset demo" restores the sample project.
  window.confirm = function () { return true; };
  window.prompt = function (msg, def) { return def || 'Saved parcel service'; };

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

const parts = [];
parts.push('<title>Comparable Sales Map Generator — demo</title>');
parts.push('<style>\n' + read('assets/vendor/leaflet/leaflet.css') + '\n</style>');
parts.push('<style>\n' + read('assets/css/app.css') + '\n</style>');
parts.push('<style>\n' + read('demo/demo.css') + '\n</style>');
parts.push(BANNER);
parts.push(extractBody());
parts.push(PREVIEW);
parts.push('<script>\n' + guard(read('assets/vendor/leaflet/leaflet.js')) + '\n</script>');
parts.push('<script>\n' + guard(read('assets/vendor/html2canvas/html2canvas.min.js')) + '\n</script>');
APP_SCRIPTS.forEach((f) => parts.push('<script>\n' + guard(read(f)) + '\n</script>'));
parts.push('<script>\n' + guard(read('demo/demo-mode.js')) + '\n</script>');
parts.push('<script>\n' + BOOT + '\n</script>');
parts.push('<script>\n' + guard(read('assets/js/app.js')) + '\n</script>');

const output = parts.join('\n\n');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, output);

console.log('wrote ' + path.relative(ROOT, OUT) +
            '  (' + (output.length / 1024).toFixed(0) + ' KB, no external requests)');
