/* CompCarto — small helpers.
   Loaded first; everything else hangs off the CMG namespace. */
window.CMG = window.CMG || {};

(function (CMG) {
  'use strict';

  var U = {};

  U.$ = function (sel, root) { return (root || document).querySelector(sel); };
  U.$$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  U.uid = function (prefix) {
    return (prefix || 'id') + '-' + Math.random().toString(36).slice(2, 9);
  };

  U.clamp = function (n, lo, hi) { return Math.min(hi, Math.max(lo, n)); };

  U.escapeHtml = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  U.debounce = function (fn, ms) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms || 200);
    };
  };

  /* ---------- geometry ---------- */

  var R_MILES = 3958.7613;

  /** Great-circle distance in statute miles. */
  U.distanceMiles = function (a, b) {
    if (!a || !b) return null;
    var toRad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * toRad;
    var dLng = (b.lng - a.lng) * toRad;
    var lat1 = a.lat * toRad, lat2 = b.lat * toRad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
    return 2 * R_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
  };

  /** Compass bearing subject -> comp, as an 8-point abbreviation (N, NE, …). */
  U.bearingLabel = function (a, b) {
    if (!a || !b) return '';
    var toRad = Math.PI / 180;
    var y = Math.sin((b.lng - a.lng) * toRad) * Math.cos(b.lat * toRad);
    var x = Math.cos(a.lat * toRad) * Math.sin(b.lat * toRad) -
            Math.sin(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.cos((b.lng - a.lng) * toRad);
    var deg = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    var names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return names[Math.round(deg / 45) % 8];
  };

  /**
   * Area-weighted centroid of a GeoJSON Polygon/MultiPolygon, computed on the
   * largest ring. Falls back to the bounding-box centre for degenerate rings.
   * Bounding-box centres can land outside an L-shaped parcel, which is why the
   * true centroid is worth the extra few lines here.
   */
  U.polygonCentroid = function (geometry) {
    var rings = U.outerRings(geometry);
    if (!rings.length) return null;

    var best = null, bestArea = -1;
    rings.forEach(function (ring) {
      var a = Math.abs(U.ringSignedArea(ring));
      if (a > bestArea) { bestArea = a; best = ring; }
    });
    if (!best) return null;

    var area = U.ringSignedArea(best);
    if (Math.abs(area) < 1e-12) {
      var lats = best.map(function (p) { return p[1]; });
      var lngs = best.map(function (p) { return p[0]; });
      return {
        lat: (Math.min.apply(null, lats) + Math.max.apply(null, lats)) / 2,
        lng: (Math.min.apply(null, lngs) + Math.max.apply(null, lngs)) / 2
      };
    }
    var cx = 0, cy = 0;
    for (var i = 0, n = best.length - 1; i < n; i++) {
      var x0 = best[i][0], y0 = best[i][1], x1 = best[i + 1][0], y1 = best[i + 1][1];
      var f = x0 * y1 - x1 * y0;
      cx += (x0 + x1) * f;
      cy += (y0 + y1) * f;
    }
    return { lat: cy / (6 * area), lng: cx / (6 * area) };
  };

  U.ringSignedArea = function (ring) {
    var s = 0;
    for (var i = 0, n = ring.length - 1; i < n; i++) {
      s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    }
    return s / 2;
  };

  /** Outer rings of a Polygon or MultiPolygon, closed. */
  U.outerRings = function (geometry) {
    if (!geometry) return [];
    var out = [];
    function close(ring) {
      if (!ring || ring.length < 3) return null;
      var r = ring.slice();
      var a = r[0], b = r[r.length - 1];
      if (a[0] !== b[0] || a[1] !== b[1]) r.push([a[0], a[1]]);
      return r;
    }
    if (geometry.type === 'Polygon') {
      var r0 = close(geometry.coordinates[0]);
      if (r0) out.push(r0);
    } else if (geometry.type === 'MultiPolygon') {
      geometry.coordinates.forEach(function (poly) {
        var r = close(poly[0]);
        if (r) out.push(r);
      });
    }
    return out;
  };

  /* ---------- formatting ---------- */

  U.formatMoney = function (v) {
    if (v == null || v === '') return '';
    var n = Number(String(v).replace(/[^0-9.\-]/g, ''));
    if (!isFinite(n) || n === 0) return String(v);
    return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  };

  /** Accepts 2026-03-14, 3/14/2026, "March 2026" — returns M/D/YYYY where possible. */
  U.formatDate = function (v) {
    if (!v) return '';
    var iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v).trim());
    if (iso) return Number(iso[2]) + '/' + Number(iso[3]) + '/' + iso[1];
    return String(v).trim();
  };

  U.formatDistance = function (mi) {
    if (mi == null) return '';
    if (mi < 0.1) return (mi * 5280).toFixed(0) + ' ft';
    return mi.toFixed(2) + ' mi';
  };

  U.formatLatLng = function (lat, lng) {
    if (lat == null || lng == null) return '';
    return Number(lat).toFixed(6) + ', ' + Number(lng).toFixed(6);
  };

  /** "39.7392, -104.9903" or "39.7392 N 104.9903 W" -> {lat,lng}; null otherwise. */
  U.parseLatLng = function (text) {
    if (!text) return null;
    var m = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(String(text));
    if (!m) return null;
    var lat = parseFloat(m[1]), lng = parseFloat(m[2]);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat: lat, lng: lng };
  };

  /* ---------- misc ---------- */

  U.downloadBlob = function (blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  };

  U.slugify = function (s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '').slice(0, 60) || 'comparable-sales-map';
  };

  /** fetch + JSON with a timeout, so a dead GIS service can't hang the UI. */
  U.fetchJSON = function (url, opts) {
    opts = opts || {};
    var ms = opts.timeout || 20000;
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, ms);
    return fetch(url, { signal: ctrl ? ctrl.signal : undefined, mode: 'cors' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .finally(function () { clearTimeout(timer); });
  };

  U.sleep = function (ms) {
    return new Promise(function (res) { setTimeout(res, ms); });
  };

  CMG.util = U;
})(window.CMG);
