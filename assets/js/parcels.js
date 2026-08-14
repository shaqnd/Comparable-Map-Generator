/* Parcel lookup against any ArcGIS REST polygon layer.
   Counties publish these under a hundred different schemas, so the field names
   are sniffed rather than hard-coded, and the raw attributes are always kept. */
(function (CMG) {
  'use strict';

  var U = CMG.util;

  function normaliseLayerUrl(url) {
    var u = String(url || '').trim().replace(/\/+$/, '');
    if (!u) return '';
    // Tolerate someone pasting the .../query endpoint or a trailing "?f=json".
    u = u.replace(/\?.*$/, '').replace(/\/query$/i, '');
    return u;
  }

  /** Esri JSON polygon rings -> GeoJSON. Clockwise rings are outer, CCW are holes. */
  function ringsToGeoJSON(rings) {
    if (!rings || !rings.length) return null;

    function signedArea(ring) {
      var s = 0;
      for (var i = 0, n = ring.length - 1; i < n; i++) {
        s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
      }
      return s / 2;
    }

    var polys = [];
    rings.forEach(function (ring) {
      if (!ring || ring.length < 4) return;
      if (signedArea(ring) < 0) polys.push([ring]);          // clockwise -> new outer ring
      else if (polys.length) polys[polys.length - 1].push(ring); // hole
      else polys.push([ring.slice().reverse()]);             // stray CCW ring, keep it
    });

    if (!polys.length) return null;
    if (polys.length === 1) return { type: 'Polygon', coordinates: polys[0] };
    return { type: 'MultiPolygon', coordinates: polys };
  }

  function pickField(attributes, hints) {
    if (!attributes) return null;
    var keys = Object.keys(attributes);
    var upper = {};
    keys.forEach(function (k) { upper[k.toUpperCase()] = k; });

    for (var i = 0; i < hints.length; i++) {
      var want = hints[i].toUpperCase();
      if (upper[want] != null) {
        var v = attributes[upper[want]];
        if (v != null && String(v).trim() !== '') return { key: upper[want], value: v };
      }
    }
    // Second pass: a field that merely contains the hint word.
    for (var j = 0; j < hints.length; j++) {
      var frag = hints[j].toUpperCase();
      for (var k2 = 0; k2 < keys.length; k2++) {
        if (keys[k2].toUpperCase().indexOf(frag) >= 0) {
          var val = attributes[keys[k2]];
          if (val != null && String(val).trim() !== '') return { key: keys[k2], value: val };
        }
      }
    }
    return null;
  }

  function summarise(attributes) {
    var H = CMG.PARCEL_FIELD_HINTS;
    var addr = pickField(attributes, H.address);
    var apn = pickField(attributes, H.apn);
    var owner = pickField(attributes, H.owner);
    var area = pickField(attributes, H.area);
    return {
      address: addr ? String(addr.value).trim() : '',
      apn: apn ? String(apn.value).trim() : '',
      owner: owner ? String(owner.value).trim() : '',
      area: area ? String(area.value).trim() : '',
      areaField: area ? area.key : ''
    };
  }

  var Parcels = {

    normaliseLayerUrl: normaliseLayerUrl,
    summarise: summarise,

    /** Service metadata — used by "Test service" and to warn about bad layers. */
    describe: function (url) {
      var layer = normaliseLayerUrl(url);
      if (!layer) return Promise.reject(new Error('No service URL given.'));
      if (!/\/\d+$/.test(layer)) {
        return Promise.reject(new Error(
          'The URL must end with a layer number, e.g. …/FeatureServer/0'));
      }
      return U.fetchJSON(layer + '?f=json', { timeout: 20000 }).then(function (d) {
        if (!d || d.error) {
          throw new Error((d && d.error && d.error.message) || 'Service returned an error.');
        }
        return {
          name: d.name || '(unnamed layer)',
          geometryType: d.geometryType || '',
          fields: (d.fields || []).map(function (f) { return f.name; }),
          maxRecordCount: d.maxRecordCount,
          isPolygon: d.geometryType === 'esriGeometryPolygon'
        };
      });
    },

    /**
     * The parcel containing a point.
     * @returns {Promise<Object|null>} null when the click fell outside coverage.
     */
    queryAtPoint: function (url, lat, lng) {
      var layer = normaliseLayerUrl(url);
      if (!layer) return Promise.reject(new Error('No parcel service selected.'));

      var geom = encodeURIComponent(JSON.stringify({
        x: lng, y: lat, spatialReference: { wkid: 4326 }
      }));
      var common = '/query?geometry=' + geom +
                   '&geometryType=esriGeometryPoint&inSR=4326&outSR=4326' +
                   '&spatialRel=esriSpatialRelIntersects&outFields=*' +
                   '&returnGeometry=true&resultRecordCount=1&where=1%3D1';

      // Ask for GeoJSON first; fall back to Esri JSON for older MapServer layers.
      return U.fetchJSON(layer + common + '&f=geojson', { timeout: 25000 })
        .then(function (d) {
          if (d && d.error) throw new Error(d.error.message || 'geojson unsupported');
          var f = d && d.features && d.features[0];
          if (!f) return null;
          return { geometry: f.geometry, attributes: f.properties || {} };
        })
        .catch(function () {
          return U.fetchJSON(layer + common + '&f=json', { timeout: 25000 }).then(function (d) {
            if (!d || d.error) {
              throw new Error((d && d.error && d.error.message) || 'Parcel query failed.');
            }
            var f = d.features && d.features[0];
            if (!f) return null;
            var g = ringsToGeoJSON(f.geometry && f.geometry.rings);
            if (!g) return null;
            return { geometry: g, attributes: f.attributes || {} };
          });
        })
        .then(function (hit) {
          if (!hit) return null;
          var info = summarise(hit.attributes);
          return {
            geometry: hit.geometry,
            attributes: hit.attributes,
            address: info.address,
            apn: info.apn,
            owner: info.owner,
            area: info.area,
            centroid: U.polygonCentroid(hit.geometry),
            source: layer
          };
        });
    },


    /* ------------------------------------------------- county registry */

    /** Saved corrections, merged over the shipped list. */
    registry: function () {
      var overrides = {};
      try {
        var raw = JSON.parse(localStorage.getItem(CMG.REGISTRY_KEY) || '{}');
        if (raw && typeof raw === 'object') overrides = raw;
      } catch (e) { overrides = {}; }

      return CMG.COUNTIES.map(function (c) {
        var o = overrides[c.id] || {};
        return {
          id: c.id, name: c.name, group: c.group, note: c.note,
          url: o.url != null ? o.url : c.url,
          verified: !!o.verified,
          checkedAt: o.checkedAt || null,
          layerName: o.layerName || '',
          corrected: o.url != null && o.url !== c.url
        };
      });
    },

    county: function (id) {
      return Parcels.registry().filter(function (c) { return c.id === id; })[0] || null;
    },

    setCounty: function (id, patch) {
      var overrides = {};
      try { overrides = JSON.parse(localStorage.getItem(CMG.REGISTRY_KEY) || '{}') || {}; }
      catch (e) { overrides = {}; }
      overrides[id] = Object.assign({}, overrides[id], patch);
      try { localStorage.setItem(CMG.REGISTRY_KEY, JSON.stringify(overrides)); }
      catch (e) { /* quota */ }
      return Parcels.county(id);
    },

    /** Whole registry as a file, so one person's verification serves the office. */
    exportRegistry: function () {
      return new Blob([JSON.stringify({
        kind: 'cmg.county-registry',
        region: CMG.REGION.id,
        savedAt: new Date().toISOString(),
        counties: Parcels.registry().map(function (c) {
          return { id: c.id, name: c.name, url: c.url, verified: c.verified,
                   layerName: c.layerName, checkedAt: c.checkedAt };
        })
      }, null, 2)], { type: 'application/json' });
    },

    importRegistry: function (text) {
      var data = JSON.parse(text);
      var list = (data && data.counties) || [];
      if (!Array.isArray(list) || !list.length) {
        throw new Error('No counties in that file.');
      }
      var overrides = {};
      list.forEach(function (c) {
        if (!c || !c.id) return;
        overrides[c.id] = {
          url: c.url, verified: !!c.verified,
          layerName: c.layerName || '', checkedAt: c.checkedAt || null
        };
      });
      localStorage.setItem(CMG.REGISTRY_KEY, JSON.stringify(overrides));
      return list.length;
    },

    /**
     * Check every county from the browser, a few at a time so a slow county
     * cannot stall the rest. Results are written back into the registry, so a
     * pass here is also a record of what was working and when.
     * @param {function(Object)} onResult called as each county settles
     */
    testAll: function (onResult) {
      var list = Parcels.registry();
      var queue = list.slice();
      var results = [];
      var CONCURRENCY = 4;

      function next() {
        var c = queue.shift();
        if (!c) return Promise.resolve();
        if (!c.url) {
          var none = { id: c.id, name: c.name, ok: false, error: 'No URL set' };
          results.push(none);
          if (onResult) onResult(none);
          return next();
        }
        return Parcels.describe(c.url).then(function (info) {
          var r = {
            id: c.id, name: c.name, ok: info.isPolygon, layerName: info.name,
            fields: info.fields.length,
            error: info.isPolygon ? null : 'Not a polygon layer (' + info.geometryType + ')'
          };
          Parcels.setCounty(c.id, {
            verified: r.ok, layerName: info.name,
            checkedAt: new Date().toISOString()
          });
          results.push(r);
          if (onResult) onResult(r);
        }).catch(function (err) {
          var r = { id: c.id, name: c.name, ok: false, error: err.message };
          Parcels.setCounty(c.id, { verified: false, checkedAt: new Date().toISOString() });
          results.push(r);
          if (onResult) onResult(r);
        }).then(next);
      }

      var runners = [];
      for (var i = 0; i < CONCURRENCY; i++) runners.push(next());
      return Promise.all(runners).then(function () { return results; });
    },

    /**
     * Which county a point falls in, from the Census geography service —
     * authoritative, keyless, and the same source the geocoder uses.
     * Resolves null rather than rejecting; this is a convenience, not a gate.
     */
    countyAt: function (lat, lng) {
      var url = 'https://geocoding.geo.census.gov/geocoder/geographies/coordinates' +
                '?benchmark=Public_AR_Current&vintage=Current_Current' +
                '&layers=Counties&format=json' +
                '&x=' + encodeURIComponent(lng) + '&y=' + encodeURIComponent(lat);
      return U.fetchJSON(url, { timeout: 15000 }).then(function (d) {
        var geos = d && d.result && d.result.geographies;
        var counties = geos && (geos.Counties || geos['Counties']);
        var name = counties && counties[0] && counties[0].NAME;
        if (!name) return null;
        return String(name).replace(/\s+County$/i, '').trim();
      }).catch(function () { return null; });
    },

    /** Registry entry whose name matches a county name, if it is in region. */
    matchCounty: function (countyName) {
      if (!countyName) return null;
      var want = String(countyName).toLowerCase().replace(/\s+county$/i, '').trim();
      return Parcels.registry().filter(function (c) {
        return c.name.toLowerCase() === want;
      })[0] || null;
    },

    /* -------------------------------------------------- saved preset library */

    loadPresets: function () {
      var saved = [];
      try {
        saved = JSON.parse(localStorage.getItem(CMG.PRESET_KEY) || '[]');
        if (!Array.isArray(saved)) saved = [];
      } catch (e) { saved = []; }

      var out = [{ id: 'none', name: '— none —', url: '', group: '' }];
      Parcels.registry().forEach(function (c) {
        out.push({
          id: c.id,
          name: c.name + ' County' + (c.note ? ' (' + c.note + ')' : '') +
                (c.verified ? '  ✓' : ''),
          url: c.url,
          group: c.group,
          verified: c.verified
        });
      });
      saved.forEach(function (p) {
        if (p && p.id) out.push({ id: p.id, name: p.name, url: p.url, group: 'Saved', custom: true });
      });
      out.push({ id: 'custom', name: 'Custom URL…', url: '', group: '' });
      return out;
    },

    savePreset: function (name, url) {
      var saved = [];
      try { saved = JSON.parse(localStorage.getItem(CMG.PRESET_KEY) || '[]'); }
      catch (e) { saved = []; }
      if (!Array.isArray(saved)) saved = [];

      var clean = normaliseLayerUrl(url);
      var existing = saved.filter(function (p) { return p.url === clean; })[0];
      if (existing) {
        existing.name = name;
      } else {
        saved.push({ id: U.uid('preset'), name: name, url: clean, custom: true });
      }
      localStorage.setItem(CMG.PRESET_KEY, JSON.stringify(saved));
      return saved;
    },

    /** Manual boundary tracing, for anywhere without a public parcel service. */
    fromDrawnPoints: function (latlngs) {
      if (!latlngs || latlngs.length < 3) return null;
      var ring = latlngs.map(function (p) { return [p.lng, p.lat]; });
      ring.push([ring[0][0], ring[0][1]]);
      var geometry = { type: 'Polygon', coordinates: [ring] };
      return {
        geometry: geometry,
        attributes: {},
        address: '', apn: '', owner: '', area: '',
        centroid: U.polygonCentroid(geometry),
        source: 'drawn'
      };
    }
  };

  CMG.parcels = Parcels;
})(window.CMG);
