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
const AUTORUN = !!args.autorun;
const OUT = path.resolve(ROOT, args.out ||
  (MODE === 'live' ? 'dist/comparable-map-standalone.html' : 'demo/comparable-map-demo.html'));

const read = (p) => fs.readFileSync(path.isAbsolute(p) ? p : path.join(ROOT, p), 'utf8');

/* Load order — overrides sit between the modules and app.js, which boots. */
const APP_SCRIPTS = [
  'assets/js/util.js',
  'assets/js/config.js',
  'assets/js/theme.js',
  'assets/js/counter.js',
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


/* Shared export-preview chrome, used by the demo and by one-shot builds. */
const PREVIEW_CSS = `/* ---------------------------------------------------- exported-image preview */

#cmgPreview {
  position: fixed;
  inset: 0;
  z-index: 12000;
  background: rgba(22, 26, 32, .78);
  display: grid;
  place-items: center;
  padding: 24px;
}
#cmgPreview[hidden] { display: none; }

.cmg-preview-card {
  background: #ffffff;
  border-radius: 10px;
  box-shadow: 0 24px 60px rgba(12, 18, 26, .45);
  max-width: min(1100px, 100%);
  max-height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.cmg-preview-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 13px 18px;
  border-bottom: 1px solid #e4e8ee;
  color: #16202c;
  font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
}
.cmg-preview-head strong {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 16px;
  font-weight: 700;
}
.cmg-preview-head span { color: #5a6a7c; }

.cmg-preview-body {
  padding: 16px 18px;
  overflow: auto;
  background: repeating-conic-gradient(#e6eaf0 0% 25%, #eef1f5 0% 50%) 50% / 18px 18px;
}
.cmg-preview-body img {
  display: block;
  max-width: 100%;
  height: auto;
  box-shadow: 0 2px 14px rgba(12, 18, 26, .25);
  background: #fff;
}

.cmg-preview-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 18px;
  border-top: 1px solid #e4e8ee;
  font: 12.5px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
  color: #5a6a7c;
}
.cmg-preview-foot .grow { flex: 1; }

.cmg-primary {
  display: inline-block;
  border: 1px solid #1a56db;
  background: #1a56db;
  color: #fff;
  border-radius: 6px;
  padding: 7px 14px;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
}
.cmg-primary:hover { background: #12409f; border-color: #12409f; }
.cmg-primary:focus-visible { outline: 2px solid #d99a1a; outline-offset: 2px; }

.cmg-ghost {
  border: 1px solid #d8dee7;
  background: #fff;
  color: #16202c;
  border-radius: 6px;
  padding: 7px 14px;
  cursor: pointer;
  font: inherit;
}
.cmg-ghost:hover { background: #f4f7fb; }

`;

function previewMarkup(note) {
  return `
<div id="cmgPreview" hidden>
  <div class="cmg-preview-card" role="dialog" aria-modal="true" aria-label="Comparable sales map">
    <div class="cmg-preview-head">
      <strong>Your comparable sales map</strong>
      <span id="cmgPreviewMeta"></span>
    </div>
    <div class="cmg-preview-body"><img id="cmgPreviewImg" alt="Comparable sales map"></div>
    <div class="cmg-preview-foot">
      <span class="grow">${note}</span>
      <button class="cmg-ghost" id="cmgPreviewCopy" type="button">Copy</button>
      <button class="cmg-primary" id="cmgPreviewSave" type="button">Save PNG</button>
      <button class="cmg-ghost" id="cmgPreviewClose" type="button">Edit the map</button>
    </div>
  </div>
</div>`;
}


const PREVIEW_WIRE = `
(function (CMG) {
  'use strict';

  var current = null;   // the canvas behind whatever the preview is showing

  CMG.showPreview = function (canvas) {
    current = canvas;
    var host = document.getElementById('cmgPreview');
    document.getElementById('cmgPreviewImg').src = canvas.toDataURL('image/png');
    document.getElementById('cmgPreviewMeta').textContent =
      canvas.width + ' \\u00d7 ' + canvas.height + ' px at ' +
      CMG.store.state.exportCfg.dpi + ' DPI \\u2014 ' +
      CMG.store.state.exportCfg.w + ' \\u00d7 ' + CMG.store.state.exportCfg.h + ' in';
    document.getElementById('cmgPreviewSave').textContent = 'Save PNG';
    host.hidden = false;
    return canvas;
  };

  function pngBlob() {
    return new Promise(function (resolve, reject) {
      if (!current) return reject(new Error('Nothing to save.'));
      current.toBlob(function (b) {
        b ? resolve(b) : reject(new Error('Could not encode the image.'));
      }, 'image/png');
    });
  }

  /* Saving a file differs by where this page is running. Opened from disk an
     anchor download works; inside the artifact viewer the frame cannot download
     at all and has to hand the file to the host, which asks the viewer first. */
  function saveImage(btn) {
    var name = CMG.exporter.fileName('png');
    var host = (window.claude && typeof window.claude.use === 'function')
      ? window.claude.use('downloads') : Promise.resolve(null);

    return Promise.resolve(host).then(function (downloads) {
      return pngBlob().then(function (blob) {
        if (!downloads) {
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = name;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
          btn.textContent = 'Saved';
          return;
        }
        return downloads.save({ filename: name, data: blob }).then(function () {
          btn.textContent = 'Saved';
        }, function (err) {
          var code = err && err.code;
          if (code === 'declined') { btn.textContent = 'Save PNG'; return; }
          if (code === 'rate_limited') { btn.textContent = 'Try again'; return; }
          btn.textContent = 'Right-click the image';
        });
      });
    }).catch(function () { btn.textContent = 'Right-click the image'; });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var host = document.getElementById('cmgPreview');

    document.getElementById('cmgPreviewClose').addEventListener('click', function () {
      host.hidden = true;
    });
    host.addEventListener('click', function (ev) { if (ev.target === host) host.hidden = true; });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && !host.hidden) host.hidden = true;
    });

    document.getElementById('cmgPreviewSave').addEventListener('click', function () {
      saveImage(this);
    });

    document.getElementById('cmgPreviewCopy').addEventListener('click', function () {
      var btn = this;
      pngBlob().then(function (blob) {
        return navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      }).then(function () { btn.textContent = 'Copied'; })
        .catch(function () { btn.textContent = 'Use Save PNG'; });
    });
  });
})(window.CMG);`;

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
  });
})(window.CMG);`;

/* One-shot: frame everything and render the finished image without being asked. */
const AUTORUN_TAIL = `located.then(function (r) {
        if (r && r.located === 0 && r.missing > 0) throw new Error('no addresses could be located');
        CMG.mapview.fitAll();
        CMG.ui.status('Drawing the map at full resolution\\u2026');
        return new Promise(function (res) { setTimeout(res, 900); });
      }).then(function () {
        return CMG.exporter.renderCanvas(function (m) { CMG.ui.status(m); });
      }).then(function (canvas) {
        CMG.showPreview(canvas);
        CMG.ui.status('Map ready. Check each pin against the aerial before it goes in the report.', 'ok');
      }).catch(function (err) {
        CMG.ui.status('Could not finish automatically: ' + err.message +
                      ' \\u2014 the map is still here to adjust by hand.', 'warn');
      });`;

/** Live builds get the baked-in project, if one was supplied. */
function seedBoot(project, autorun) {
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
                !CMG.store.all().some(function (p) { return (p.address || '').trim(); });
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
      var located = needs ? CMG.ui.locateAllMissing() : Promise.resolve(null);
      ${autorun ? AUTORUN_TAIL : 'located;'}
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
  (MODE === 'demo' ? 'AssessMapper — demo'
                   : (project && project.title ? project.title + ' — AssessMapper'
                                               : 'AssessMapper'));

const parts = [];
parts.push('<title>' + title + '</title>');
parts.push('<style>\n' + read('assets/vendor/leaflet/leaflet.css') + '\n</style>');
parts.push('<style>\n' + read('assets/css/app.css') + '\n</style>');

if (MODE === 'demo') {
  parts.push('<style>\n' + read('demo/demo.css') + '\n</style>');
} else {
  parts.push('<style>' + LIVE_LAYOUT_CSS + '\n</style>');
}
const wantsPreview = MODE === 'demo' || AUTORUN;
if (wantsPreview) parts.push('<style>\n' + PREVIEW_CSS + '\n</style>');
if (MODE === 'demo') parts.push(DEMO_BANNER);

parts.push(extractBody());
if (wantsPreview) {
  parts.push(previewMarkup(MODE === 'demo'
    ? 'In the real tool this downloads straight to your Downloads folder, or copies ' +
      'to the clipboard for pasting into Word.'
    : 'Paste it into your report, or edit the map and export again.'));
}


parts.push('<script>\n' + guard(read('assets/vendor/leaflet/leaflet.js')) + '\n</script>');
parts.push('<script>\n' + guard(read('assets/vendor/html2canvas/html2canvas.min.js')) + '\n</script>');
APP_SCRIPTS.forEach((f) => parts.push('<script>\n' + guard(read(f)) + '\n</script>'));

if (wantsPreview) parts.push('<script>\n' + PREVIEW_WIRE + '\n</script>');

if (MODE === 'demo') {
  parts.push('<script>\n' + guard(read('demo/demo-mode.js')) + '\n</script>');
  parts.push('<script>\n' + DEMO_BOOT + '\n</script>');
} else {
  parts.push('<script>\n' + LIVE_BOOT + '\n</script>');
  if (project) parts.push('<script>\n' + guard(seedBoot(project, AUTORUN)) + '\n</script>');
}

parts.push('<script>\n' + guard(read('assets/js/app.js')) + '\n</script>');

const output = parts.join('\n\n');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, output);

console.log('wrote ' + path.relative(ROOT, OUT) + '  (' + (output.length / 1024).toFixed(0) + ' KB, ' +
  MODE + ' build' + (project ? ', project baked in' : '') + (AUTORUN ? ', autorun' : '') + ')');
