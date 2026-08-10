/* Demo mode.

   Swaps the three services that need the internet — map tiles, geocoding and
   county parcels — for self-contained stand-ins, so the tool can be handed to
   someone as a single file or published somewhere that blocks outbound
   requests. Nothing else about the application changes: the same store, map,
   label, parcel and export code runs underneath.

   Load this AFTER the application scripts and BEFORE app.js. */
(function (CMG) {
  'use strict';

  var U = CMG.util;

  /* ------------------------------------------------------------------ noise */

  /** Deterministic 0..1 from up to four integers. Same tile always draws the same. */
  function rnd(a, b, c, d) {
    var h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b);
    h = Math.imul(h ^ (b | 0) ^ 0xc2b2ae35, 0x27d4eb2f);
    h = Math.imul(h ^ (c | 0), 0x165667b1);
    h = Math.imul(h ^ ((d | 0) + 0x6b43a9b5), 0x9e3779b1);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }

  /* ------------------------------------------------------- synthetic basemap */

  var PALETTES = {
    aerial: {
      ground: '#474a40', block: '#585a4d', building: '#8f8a7c',
      shadow: 'rgba(0,0,0,.30)', road: '#74736a', roadMajor: '#848177',
      park: '#3f5c33', casing: null, ink: '#f2efe6'
    },
    street: {
      ground: '#e9e6df', block: '#f7f5f0', building: '#e3dfd5',
      shadow: null, road: '#ffffff', roadMajor: '#ffffff',
      park: '#d2e5c6', casing: '#d8d4ca', ink: '#5d6b53'
    },
    osm: {
      ground: '#e8e2d8', block: '#f4efe4', building: '#dcd3c3',
      shadow: null, road: '#ffffff', roadMajor: '#fbe9a5',
      park: '#c9e2b4', casing: '#cfc7b6', ink: '#6b6250'
    },
    topo: {
      ground: '#e6e5d6', block: '#eeeddf', building: '#d8d5c2',
      shadow: null, road: '#ffffff', roadMajor: '#f3dfa8',
      park: '#c6dcae', casing: '#cbc8b2', ink: '#6c6a52'
    },
    light: {
      ground: '#eef0f1', block: '#f7f8f9', building: '#e3e6e8',
      shadow: null, road: '#ffffff', roadMajor: '#ffffff',
      park: '#e2ebe0', casing: '#dcdfe2', ink: '#7c848b'
    }
  };

  var STREETS = [
    'Broadway', 'Lincoln St', 'Sherman St', 'Grant St', 'Logan St', 'Pearl St',
    'Larimer St', 'Wazee St', 'Blake St', 'Market St', 'Wynkoop St', 'Champa St',
    'Curtis St', 'Arapahoe St', 'Lawrence St', 'Stout St', 'California St',
    'Welton St', 'Glenarm Pl', 'Tremont Pl', 'Colfax Ave', 'Speer Blvd',
    '17th St', '16th St', '15th St', '18th St', '20th St', 'Park Ave'
  ];

  /** Block pitch in world pixels, kept legible at every zoom. */
  function blockPitch(z) {
    var s = 128 * Math.pow(2, z - 17);   // ~120 m blocks at street zooms
    while (s < 22) s *= 2;
    return s;
  }

  /** Nudge a hex colour by a signed amount per channel. */
  function shade(hex, delta) {
    var n = parseInt(hex.slice(1), 16);
    var r = U.clamp(((n >> 16) & 255) + delta, 0, 255);
    var g = U.clamp(((n >> 8) & 255) + delta, 0, 255);
    var b = U.clamp((n & 255) + delta, 0, 255);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  function drawBase(ctx, coords, pal, ts) {
    var z = coords.z;
    var pitch = blockPitch(z);
    var ox = coords.x * ts, oy = coords.y * ts;

    ctx.fillStyle = pal.ground;
    ctx.fillRect(0, 0, ts, ts);

    var bx0 = Math.floor(ox / pitch), by0 = Math.floor(oy / pitch);
    var span = Math.ceil(ts / pitch) + 1;
    var inset = Math.max(1, pitch * 0.055);

    for (var i = 0; i <= span; i++) {
      for (var j = 0; j <= span; j++) {
        var bx = bx0 + i, by = by0 + j;
        var x = bx * pitch - ox, y = by * pitch - oy;
        var bw = pitch - inset * 2;

        if (rnd(bx, by, z, 3) > 0.91) {
          ctx.fillStyle = pal.park;
          ctx.fillRect(x + inset, y + inset, bw, bw);
          continue;
        }
        // Per-block tint so the grid reads as built-up ground rather than a
        // flat lattice, which matters most at the zoomed-out framing.
        ctx.fillStyle = shade(pal.block, Math.round((rnd(bx, by, z, 8) - 0.5) * 26));
        ctx.fillRect(x + inset, y + inset, bw, bw);

        if (pitch < 36) continue;
        var count = 2 + Math.floor(rnd(bx, by, z, 5) * 3);
        for (var k = 0; k < count; k++) {
          var w = bw * (0.16 + rnd(bx, by, z, 30 + k) * 0.30);
          var h = bw * (0.16 + rnd(bx, by, z, 40 + k) * 0.30);
          var px = x + inset + rnd(bx, by, z, 10 + k) * (bw - w);
          var py = y + inset + rnd(bx, by, z, 20 + k) * (bw - h);
          if (pal.shadow) {
            ctx.fillStyle = pal.shadow;
            ctx.fillRect(px + w * 0.10, py + h * 0.12, w, h);
          }
          ctx.fillStyle = pal.building;
          ctx.fillRect(px, py, w, h);
        }
      }
    }

    // Roads last so they sit over the blocks.
    for (var a = -1; a <= span + 1; a++) {
      paintRoad(ctx, (bx0 + a), true, pitch, ox, oy, ts, pal);
      paintRoad(ctx, (by0 + a), false, pitch, ox, oy, ts, pal);
    }
  }

  function isMajor(index) { return ((index % 4) + 4) % 4 === 0; }

  function paintRoad(ctx, index, vertical, pitch, ox, oy, ts, pal) {
    var pos = index * pitch - (vertical ? ox : oy);
    var major = isMajor(index);
    var w = Math.max(1.4, pitch * (major ? 0.105 : 0.055));

    if (pal.casing) {
      ctx.fillStyle = pal.casing;
      if (vertical) ctx.fillRect(pos - w / 2 - 1, 0, w + 2, ts);
      else ctx.fillRect(0, pos - w / 2 - 1, ts, w + 2);
    }
    ctx.fillStyle = major ? pal.roadMajor : pal.road;
    if (vertical) ctx.fillRect(pos - w / 2, 0, w, ts);
    else ctx.fillRect(0, pos - w / 2, ts, w);
  }

  /** Street names, drawn on the separate overlay layer. */
  function drawLabels(ctx, coords, pal, ts) {
    var z = coords.z;
    var pitch = blockPitch(z);
    if (pitch < 70) return;

    var ox = coords.x * ts, oy = coords.y * ts;
    var bx0 = Math.floor(ox / pitch), by0 = Math.floor(oy / pitch);
    var span = Math.ceil(ts / pitch) + 1;

    ctx.font = '600 11px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,.85)';
    ctx.fillStyle = pal.ink;

    for (var a = -1; a <= span + 1; a++) {
      var vx = bx0 + a;
      if (isMajor(vx)) {
        var x = vx * pitch - ox;
        if (x > -40 && x < ts + 40) {
          var nameV = STREETS[Math.floor(rnd(vx, 0, 0, 91) * STREETS.length)];
          ctx.save();
          ctx.translate(x, ts * 0.5);
          ctx.rotate(-Math.PI / 2);
          ctx.strokeText(nameV, 0, 0);
          ctx.fillText(nameV, 0, 0);
          ctx.restore();
        }
      }
      var vy = by0 + a;
      if (isMajor(vy)) {
        var y = vy * pitch - oy;
        if (y > -20 && y < ts + 20) {
          var nameH = STREETS[Math.floor(rnd(0, vy, 0, 77) * STREETS.length)];
          ctx.strokeText(nameH, ts * 0.5, y);
          ctx.fillText(nameH, ts * 0.5, y);
        }
      }
    }
  }

  var SyntheticLayer = L.GridLayer.extend({
    createTile: function (coords, done) {
      var tile = document.createElement('canvas');
      var size = this.getTileSize();
      tile.width = size.x;
      tile.height = size.y;

      var ctx = tile.getContext('2d');
      var pal = PALETTES[this.options.palette] || PALETTES.aerial;
      if (this.options.role === 'labels') drawLabels(ctx, coords, pal, size.x);
      else drawBase(ctx, coords, pal, size.x);

      // Leaflet expects the callback asynchronously.
      setTimeout(function () { done(null, tile); }, 0);
      return tile;
    }
  });

  /* --------------------------------------------------- basemap swap-in */

  var MV = CMG.mapview;

  MV.setBasemap = function (id, withLabels) {
    var def = CMG.BASEMAPS.filter(function (b) { return b.id === id; })[0] || CMG.BASEMAPS[0];

    if (MV._base) MV.map.removeLayer(MV._base);
    MV._labelLayers.forEach(function (l) { MV.map.removeLayer(l); });
    MV._labelLayers = [];

    MV._base = new SyntheticLayer({
      palette: def.id,
      role: 'base',
      maxZoom: 22,
      attribution: 'Simulated basemap — demo build'
    }).addTo(MV.map);

    if (withLabels && def.supportsLabelOverlay) {
      var overlay = new SyntheticLayer({
        palette: def.id, role: 'labels', maxZoom: 22
      }).addTo(MV.map);
      MV._labelLayers.push(overlay);
    }

    CMG.store.setView({ basemap: def.id, labelOverlay: !!withLabels });
    MV.applyStyleVars();
  };

  /* ------------------------------------------------------- offline geocoder */

  var BOOK = [
    ['1600 Broadway, Denver, CO 80202', 39.74390, -104.98730],
    ['1701 Wynkoop St, Denver, CO 80202', 39.75300, -105.00020],
    ['1550 Wewatta St, Denver, CO 80202', 39.75150, -105.00220],
    ['1144 15th St, Denver, CO 80202', 39.74900, -104.99590],
    ['1801 California St, Denver, CO 80202', 39.74550, -104.98950],
    ['555 17th St, Denver, CO 80202', 39.74600, -104.99120],
    ['999 18th St, Denver, CO 80202', 39.74800, -104.99050],
    ['1400 Wewatta St, Denver, CO 80202', 39.75260, -105.00160],
    ['2000 16th St, Denver, CO 80202', 39.75400, -105.00000],
    ['1900 16th St, Denver, CO 80202', 39.75350, -104.99900],
    ['3000 Larimer St, Denver, CO 80205', 39.76050, -104.98200],
    ['2500 Walnut St, Denver, CO 80205', 39.75900, -104.98400],
    ['1550 Platte St, Denver, CO 80202', 39.75600, -105.00800],
    ['1300 Pearl St, Denver, CO 80203', 39.73650, -104.98000],
    ['100 Fillmore St, Denver, CO 80206', 39.71800, -104.95300],
    ['3000 E 1st Ave, Denver, CO 80206', 39.71750, -104.95400],
    ['4200 Fox St, Denver, CO 80216', 39.77600, -105.00000],
    ['1000 S Broadway, Denver, CO 80209', 39.70400, -104.98800],
    ['2600 W 32nd Ave, Denver, CO 80211', 39.76200, -105.01800],
    ['4900 Federal Blvd, Denver, CO 80221', 39.78600, -105.02500],
    ['5000 E Colfax Ave, Denver, CO 80220', 39.74000, -104.92700],
    ['7800 E Smith Rd, Denver, CO 80207', 39.77700, -104.88000],
    ['200 Quebec St, Denver, CO 80230', 39.71600, -104.89900],
    ['6000 Greenwood Plaza Blvd, Greenwood Village, CO 80111', 39.60000, -104.89300],
    ['8000 E Belleview Ave, Greenwood Village, CO 80111', 39.61800, -104.90000],
    ['1401 Lawrence St, Denver, CO 80202', 39.74760, -104.99630],
    ['1225 17th St, Denver, CO 80202', 39.75000, -104.99400],
    ['2199 California St, Denver, CO 80205', 39.75000, -104.98600]
  ];

  function normalise(s) {
    return String(s || '').toLowerCase()
      .replace(/[.,#]/g, ' ')
      .replace(/\b(street|st)\b/g, 'st')
      .replace(/\b(avenue|ave)\b/g, 'ave')
      .replace(/\b(boulevard|blvd)\b/g, 'blvd')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function score(query, entry) {
    var q = normalise(query).split(' ');
    var e = normalise(entry).split(' ');
    var hit = 0;
    q.forEach(function (tok) { if (e.indexOf(tok) >= 0) hit++; });
    return q.length ? hit / q.length : 0;
  }

  CMG.geocode.search = function (query) {
    var q = String(query || '').trim();
    if (!q) return Promise.resolve({ candidates: [], spreadFeet: null });

    var direct = U.parseLatLng(q);
    if (direct) {
      return Promise.resolve({
        candidates: [{
          lat: direct.lat, lng: direct.lng,
          label: 'Coordinates ' + U.formatLatLng(direct.lat, direct.lng),
          score: 100, provider: 'manual', providerName: 'Typed coordinates',
          precision: 'rooftop', agreement: 1, agreeWith: []
        }],
        spreadFeet: 0
      });
    }

    var ranked = BOOK.map(function (row) {
      return { row: row, s: score(q, row[0]) };
    }).filter(function (r) { return r.s >= 0.5; })
      .sort(function (a, b) { return b.s - a.s; });

    if (ranked.length) {
      // Shared tokens like "denver co st" make almost every entry a weak match.
      // Keep only genuine rivals, so a well-formed address resolves outright
      // instead of always opening the confirm-the-location dialog.
      var best = ranked[0].s;
      ranked = best >= 0.9
        ? ranked.slice(0, 1)
        : ranked.filter(function (r) { return r.s >= best - 0.1; }).slice(0, 4);
    }

    var candidates = ranked.map(function (r, i) {
      return {
        lat: r.row[1], lng: r.row[2], label: r.row[0],
        score: Math.round(88 + r.s * 11) - i * 3,
        provider: i === 0 ? 'census' : 'arcgis',
        providerName: i === 0 ? 'US Census (demo)' : 'Esri (demo)',
        precision: r.s > 0.85 ? 'rooftop' : 'interpolated',
        agreement: r.s > 0.85 ? 2 : 1,
        agreeWith: []
      };
    });

    if (!candidates.length) {
      // Unknown address: place it plausibly rather than failing, and say so.
      var h1 = rnd(q.length, q.charCodeAt(0) || 1, 7, 11);
      var h2 = rnd(q.length, q.charCodeAt(1) || 2, 13, 17);
      candidates.push({
        lat: 39.7392 + (h1 - 0.5) * 0.055,
        lng: -104.9903 + (h2 - 0.5) * 0.075,
        label: q + '  (simulated match — demo build)',
        score: 71, provider: 'nominatim', providerName: 'Demo geocoder',
        precision: 'approximate', agreement: 1, agreeWith: []
      });
    }

    // Slight delay so the loading state is visible, as it is in the real tool.
    return U.sleep(260).then(function () {
      return {
        candidates: candidates,
        spreadFeet: candidates.length > 1
          ? Math.round(U.distanceMiles(candidates[0], candidates[1]) * 5280) : null
      };
    });
  };

  CMG.geocode.reverse = function (lat, lng) {
    return Promise.resolve('Near ' + U.formatLatLng(lat, lng) + ' (demo)');
  };

  CMG.geocode.probe = function () {
    var ok = Promise.resolve([{ demo: true }]);
    return { census: ok, arcgis: ok, nominatim: ok };
  };

  /* --------------------------------------------------- offline parcel service */

  var OWNERS = ['Cherry Creek Holdings LLC', 'Platte Valley Partners LP',
    'Sixteenth Street Trust', 'Highland Park Investments LLC',
    'Union Station Properties LP', 'Ballpark District Holdings LLC'];

  CMG.parcels.describe = function () {
    return U.sleep(220).then(function () {
      return {
        name: 'Demo County Parcels (simulated)',
        geometryType: 'esriGeometryPolygon',
        fields: ['OBJECTID', 'SITUS_ADDRESS', 'SCHEDNUM', 'OWNER', 'ACRES', 'LAND_USE'],
        maxRecordCount: 1000,
        isPolygon: true
      };
    });
  };

  CMG.parcels.queryAtPoint = function (url, lat, lng) {
    return U.sleep(320).then(function () {
      // Snap the parcel to the same block grid the basemap is drawn on, so the
      // boundary lines up with what the map shows.
      var z = 19;
      var pt = CMG.mapview.map.project(L.latLng(lat, lng), z);
      var pitch = blockPitch(z) / 4;                    // quarter block ~ one lot
      var gx = Math.floor(pt.x / pitch), gy = Math.floor(pt.y / pitch);

      var pad = pitch * 0.06;
      var corners = [
        [gx * pitch + pad, gy * pitch + pad],
        [(gx + 1) * pitch - pad, gy * pitch + pad],
        [(gx + 1) * pitch - pad, (gy + 1) * pitch - pad],
        [gx * pitch + pad, (gy + 1) * pitch - pad]
      ].map(function (c) {
        var ll = CMG.mapview.map.unproject(L.point(c[0], c[1]), z);
        return [ll.lng, ll.lat];
      });
      corners.push([corners[0][0], corners[0][1]]);

      var geometry = { type: 'Polygon', coordinates: [corners] };
      var seed = rnd(gx, gy, 0, 5);
      var apn = String(Math.floor(1000000000 + seed * 8999999999));

      return {
        geometry: geometry,
        attributes: { SITUS_ADDRESS: '', SCHEDNUM: apn },
        address: '',
        apn: apn,
        owner: OWNERS[Math.floor(rnd(gx, gy, 0, 9) * OWNERS.length)],
        area: (0.12 + rnd(gx, gy, 0, 13) * 0.9).toFixed(2) + ' ac (simulated)',
        centroid: U.polygonCentroid(geometry),
        source: 'demo'
      };
    });
  };

  CMG.parcels.loadPresets = function () {
    return [
      { id: 'demo', name: 'Demo County Parcels (simulated)', url: 'demo://parcels' },
      { id: 'custom', name: 'Custom URL…', url: '' }
    ];
  };

  CMG.parcels.savePreset = function () { return []; };

  /* ------------------------------------------- sandbox-safe image delivery */

  var renderCanvas = CMG.exporter.renderCanvas;

  function present(canvas) {
    return CMG.showPreview(canvas);
  }

  CMG.exporter.downloadPNG = function (p) {
    return renderCanvas.call(CMG.exporter, p).then(present);
  };
  CMG.exporter.downloadJPG = CMG.exporter.downloadPNG;
  CMG.exporter.copyToClipboard = function (p) {
    return renderCanvas.call(CMG.exporter, p).then(present);
  };

  /* ----------------------------------------------------------- sample project */

  CMG.demoSeed = function () {
    var S = CMG.store;
    var st = S.state;

    st.title = 'Comparable Sales Map';
    st.subtitle = 'File #2026-0142 — LoDo / Ballpark';

    st.subject.address = '1600 Broadway, Denver, CO 80202';
    st.subject.lat = 39.74390;
    st.subject.lng = -104.98730;
    st.subject.geocode = {
      provider: 'census', providerName: 'US Census (demo)',
      matchedAddress: '1600 BROADWAY, DENVER, CO 80202',
      score: 96, precision: 'rooftop', agreement: 2, spreadFeet: 18
    };
    st.subject.fields.size = '0.34 ac';

    [['1701 Wynkoop St, Denver, CO 80202', 39.75300, -105.00020, '4/2026', '6,850,000', '0.41 ac', '$246 / SF'],
     ['1144 15th St, Denver, CO 80202', 39.74900, -104.99590, '2/2026', '4,250,000', '0.28 ac', '$212 / SF'],
     ['2500 Walnut St, Denver, CO 80205', 39.75900, -104.98400, '11/2025', '3,100,000', '0.52 ac', '$137 / SF']
    ].forEach(function (row) {
      var c = S.addComp(row[0]);
      c.lat = row[1];
      c.lng = row[2];
      c.geocode = {
        provider: 'arcgis', providerName: 'Esri (demo)', matchedAddress: row[0],
        score: 97, precision: 'rooftop', agreement: 2, spreadFeet: 22
      };
      c.fields.saleDate = row[3];
      c.fields.salePrice = row[4];
      c.fields.size = row[5];
      c.fields.unitPrice = row[6];
      S.refreshLabel(c);
    });

    S.refreshLabel(st.subject);
    st.parcelService = { presetId: 'demo', url: 'demo://parcels' };
    st.style.radiusRings = '0.5, 1';
    st.exportCfg = { presetId: 'body-half', w: 6.5, h: 4.0, dpi: 300 };
  };

  CMG.DEMO = true;
})(window.CMG);
