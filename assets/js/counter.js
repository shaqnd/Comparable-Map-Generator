/* How many maps this install has produced.

   A map counts once, the first time it is rendered for output — re-exporting
   the same job at a different size is the same map, so the number stays honest
   enough to put on a wall later.

   Everything is local by default: nothing leaves the machine unless
   CMG.COUNTER_ENDPOINT is set, and even then only a content-free tick is sent.
   No addresses, no client names, no project data — ever. */
(function (CMG) {
  'use strict';

  var U = CMG.util;

  /* Remembering every map id forever would grow without bound; this is far
     more than a working appraiser will produce, and only the tail is dropped. */
  var MAX_REMEMBERED = 4000;

  var C = {};

  C.blank = function () {
    return { maps: 0, renders: 0, firstAt: null, lastAt: null, seen: [], anonId: null };
  };

  C.read = function () {
    try {
      var raw = JSON.parse(localStorage.getItem(CMG.COUNTER_KEY) || 'null');
      if (!raw || typeof raw !== 'object') return C.blank();
      var out = Object.assign(C.blank(), raw);
      if (!Array.isArray(out.seen)) out.seen = [];
      return out;
    } catch (e) {
      return C.blank();
    }
  };

  C.write = function (stats) {
    try { localStorage.setItem(CMG.COUNTER_KEY, JSON.stringify(stats)); }
    catch (e) { /* private browsing or quota — the count is not worth an error */ }
  };

  /**
   * Record that a project was rendered for output.
   * @param   {string} projectId
   * @returns {{maps:number, renders:number, isNew:boolean}}
   */
  C.recordRender = function (projectId) {
    var s = C.read();
    var now = new Date().toISOString();
    var id = String(projectId || '');
    var isNew = !!id && s.seen.indexOf(id) < 0;

    s.renders += 1;
    s.lastAt = now;
    if (!s.firstAt) s.firstAt = now;
    if (!s.anonId) s.anonId = U.uid('install');

    if (isNew) {
      s.maps += 1;
      s.seen.push(id);
      if (s.seen.length > MAX_REMEMBERED) s.seen = s.seen.slice(-MAX_REMEMBERED);
    }

    C.write(s);
    C.render();
    if (isNew) report(s);
    return { maps: s.maps, renders: s.renders, isNew: isNew };
  };

  /**
   * Optional platform tick. Off unless an endpoint is configured, fire and
   * forget, and it can never delay or fail an export.
   */
  function report(stats) {
    var url = CMG.COUNTER_ENDPOINT;
    if (!url) return;
    var body = JSON.stringify({
      event: 'map_created',
      at: stats.lastAt,
      install: stats.anonId,
      mapsOnInstall: stats.maps,
      version: CMG.APP_VERSION
    });
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
      } else {
        fetch(url, {
          method: 'POST', keepalive: true, mode: 'no-cors',
          headers: { 'Content-Type': 'application/json' }, body: body
        }).catch(function () {});
      }
    } catch (e) { /* never let a counter break an export */ }
  }

  C.describe = function () {
    var s = C.read();
    if (!s.maps) return 'No maps made on this machine yet.';
    var since = s.firstAt ? new Date(s.firstAt).toLocaleDateString('en-US',
      { month: 'short', year: 'numeric' }) : '';
    return s.maps + (s.maps === 1 ? ' map' : ' maps') + ' made on this machine' +
           (since ? ' since ' + since : '') +
           ' · ' + s.renders + (s.renders === 1 ? ' render' : ' renders');
  };

  /** Draws the count into the status bar. Deliberately quiet. */
  C.render = function () {
    var el = document.getElementById('mapCounter');
    if (!el) return;
    var s = C.read();
    el.textContent = s.maps ? '◱ ' + s.maps.toLocaleString('en-US') : '';
    el.title = C.describe();
    el.hidden = !s.maps;
  };

  C.wire = function () {
    var el = document.getElementById('mapCounter');
    if (!el) return;
    C.render();
    el.addEventListener('click', function () {
      CMG.ui.status(C.describe());
    });
  };

  CMG.counter = C;
})(window.CMG);
