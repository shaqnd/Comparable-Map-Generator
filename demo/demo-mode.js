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
      ground: '#6d6a5e', block: '#7b7666', building: '#b4afa4', roofDark: '#6f6a60',
      shadow: 'rgba(20,18,14,.34)', road: '#57564f', roadMajor: '#5e5d55',
      park: '#5a6b3c', canopy: '#3f5230', water: '#4a5a63', lot: 'rgba(0,0,0,.16)',
      paving: '#847e70', casing: null, ink: '#f4f1e8', inkHalo: 'rgba(20,20,18,.75)'
    },
    street: {
      ground: '#ece8e0', block: '#f8f6f2', building: '#e0dbd0', roofDark: '#d6d0c4',
      shadow: null, road: '#ffffff', roadMajor: '#ffffff',
      park: '#d6e7c8', canopy: '#c2dcb0', water: '#a9c8d8', lot: 'rgba(0,0,0,.07)',
      paving: '#efece5', casing: '#d8d4ca', ink: '#5d6b53', inkHalo: 'rgba(255,255,255,.9)'
    },
    osm: {
      ground: '#e8e2d8', block: '#f4efe4', building: '#dcd3c3', roofDark: '#d0c6b4',
      shadow: null, road: '#ffffff', roadMajor: '#fbe9a5',
      park: '#c9e2b4', canopy: '#b6d69f', water: '#9fc4dd', lot: 'rgba(0,0,0,.07)',
      paving: '#ece5d8', casing: '#cfc7b6', ink: '#6b6250', inkHalo: 'rgba(255,255,255,.9)'
    },
    topo: {
      ground: '#e6e5d6', block: '#eeeddf', building: '#d8d5c2', roofDark: '#ccc8b4',
      shadow: null, road: '#ffffff', roadMajor: '#f3dfa8',
      park: '#c6dcae', canopy: '#b3cf9a', water: '#a8c8d6', lot: 'rgba(0,0,0,.07)',
      paving: '#e4e2d0', casing: '#cbc8b2', ink: '#6c6a52', inkHalo: 'rgba(255,255,255,.9)'
    },
    light: {
      ground: '#eef0f1', block: '#f8f9fa', building: '#e3e6e8', roofDark: '#dadde0',
      shadow: null, road: '#ffffff', roadMajor: '#ffffff',
      park: '#e4ede1', canopy: '#d6e5d2', water: '#cfe0e8', lot: 'rgba(0,0,0,.05)',
      paving: '#f0f2f3', casing: '#dcdfe2', ink: '#7c848b', inkHalo: 'rgba(255,255,255,.9)'
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

  /* Every feature below is a pure function of WORLD position, never of the
     tile being drawn. That is what makes adjacent tiles line up — a river or a
     diagonal avenue computed per-tile would break at every seam. */

  /* Linear features repeat on a period in world space. Anchoring them to the
     world origin instead would put them millions of pixels from anywhere a user
     actually looks, and they would never appear. */
  function waveAt(wx, pitch) {
    return Math.sin(wx / (pitch * 7)) * pitch * 2.1
         + Math.sin(wx / (pitch * 2.3)) * pitch * 0.45;
  }

  /** Indices of every repeat of a feature that could cross this tile. */
  function bands(oy, ts, period, slack) {
    var lo = Math.floor((oy - slack) / period);
    var hi = Math.ceil((oy + ts + slack) / period);
    var out = [];
    for (var k = lo; k <= hi; k++) out.push(k * period);
    return out;
  }

  /** A block's character, stable for that block at that zoom. */
  function blockKind(bx, by, z) {
    var r = rnd(bx, by, z, 61);
    if (r > 0.93) return 'park';
    if (r > 0.86) return 'paving';      // surface parking / yard
    if (r > 0.80) return 'large';       // one big footprint — warehouse, box store
    return 'urban';
  }

  function drawBase(ctx, coords, pal, ts) {
    var z = coords.z;
    var pitch = blockPitch(z);
    var ox = coords.x * ts, oy = coords.y * ts;
    var detail = pitch >= 26;

    ctx.fillStyle = pal.ground;
    ctx.fillRect(0, 0, ts, ts);

    var bx0 = Math.floor(ox / pitch), by0 = Math.floor(oy / pitch);
    var span = Math.ceil(ts / pitch) + 1;
    var inset = Math.max(1, pitch * 0.055);

    for (var i = -1; i <= span; i++) {
      for (var j = -1; j <= span; j++) {
        var bx = bx0 + i, by = by0 + j;
        var x = bx * pitch - ox, y = by * pitch - oy;
        var bw = pitch - inset * 2;
        var kind = blockKind(bx, by, z);

        if (kind === 'park') {
          ctx.fillStyle = pal.park;
          ctx.fillRect(x + inset, y + inset, bw, bw);
          if (detail) scatterCanopy(ctx, x + inset, y + inset, bw, bx, by, z, pal, 7);
          continue;
        }

        ctx.fillStyle = kind === 'paving' ? pal.paving
                      : shade(pal.block, Math.round((rnd(bx, by, z, 8) - 0.5) * 22));
        ctx.fillRect(x + inset, y + inset, bw, bw);

        if (!detail) continue;

        // Lot lines. An appraisal map lives or dies on parcel texture, and a
        // block drawn as one flat rectangle reads as a placeholder.
        var lots = kind === 'large' ? 1 : 2 + Math.floor(rnd(bx, by, z, 71) * 3);
        drawLots(ctx, x + inset, y + inset, bw, lots, pal, bx, by, z);

        if (kind === 'paving') { scatterCanopy(ctx, x + inset, y + inset, bw, bx, by, z, pal, 2); continue; }
        buildings(ctx, x + inset, y + inset, bw, lots, kind, pal, bx, by, z);
        scatterCanopy(ctx, x + inset, y + inset, bw, bx, by, z, pal, 3);
      }
    }

    water(ctx, ox, oy, ts, pitch, pal);

    for (var a = -2; a <= span + 2; a++) {
      paintRoad(ctx, (bx0 + a), true, pitch, ox, oy, ts, pal);
      paintRoad(ctx, (by0 + a), false, pitch, ox, oy, ts, pal);
    }
    diagonal(ctx, ox, oy, ts, pitch, pal);
    rail(ctx, ox, oy, ts, pitch, pal);
  }

  /** Split a block into lots and rule the boundaries. */
  function drawLots(ctx, x, y, bw, lots, pal, bx, by, z) {
    if (lots < 2) return;
    ctx.strokeStyle = pal.lot;
    ctx.lineWidth = 1;
    var vertical = rnd(bx, by, z, 83) > 0.5;
    for (var k = 1; k < lots; k++) {
      var t = k / lots + (rnd(bx, by, z, 90 + k) - 0.5) * 0.10;
      ctx.beginPath();
      if (vertical) { ctx.moveTo(x + bw * t, y); ctx.lineTo(x + bw * t, y + bw); }
      else { ctx.moveTo(x, y + bw * t); ctx.lineTo(x + bw, y + bw * t); }
      ctx.stroke();
    }
  }

  function buildings(ctx, x, y, bw, lots, kind, pal, bx, by, z) {
    var count = kind === 'large' ? 1 : lots;
    for (var k = 0; k < count; k++) {
      var frac = 1 / count;
      var lx = x + bw * frac * k;
      var lw = bw * frac;
      var w = lw * (kind === 'large' ? 0.86 : 0.52 + rnd(bx, by, z, 30 + k) * 0.30);
      var h = bw * (kind === 'large' ? 0.72 : 0.38 + rnd(bx, by, z, 40 + k) * 0.34);
      var px = lx + (lw - w) * (0.25 + rnd(bx, by, z, 10 + k) * 0.5);
      var py = y + (bw - h) * (0.25 + rnd(bx, by, z, 20 + k) * 0.5);

      if (pal.shadow) {
        ctx.fillStyle = pal.shadow;
        ctx.fillRect(px + w * 0.09, py + h * 0.11, w, h);
      }
      // Roofs vary: real imagery is never one flat tone across a block.
      ctx.fillStyle = rnd(bx, by, z, 50 + k) > 0.62 ? pal.roofDark : pal.building;
      ctx.fillRect(px, py, w, h);
    }
  }

  /** Tree canopy — the strongest single cue that imagery is real. */
  function scatterCanopy(ctx, x, y, bw, bx, by, z, pal, n) {
    if (!pal.canopy || bw < 20) return;
    ctx.fillStyle = pal.canopy;
    for (var k = 0; k < n; k++) {
      var r = bw * (0.045 + rnd(bx, by, z, 110 + k) * 0.055);
      var cx = x + rnd(bx, by, z, 120 + k) * bw;
      var cy = y + rnd(bx, by, z, 130 + k) * bw;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function water(ctx, ox, oy, ts, pitch, pal) {
    if (!pal.water) return;
    var half = pitch * 0.34;
    ctx.fillStyle = pal.water;
    bands(oy, ts, pitch * 22, pitch * 3).forEach(function (base) {
      ctx.beginPath();
      for (var sx = -8; sx <= ts + 8; sx += 4) {
        var wy = base + waveAt(ox + sx, pitch) - oy;
        if (sx === -8) ctx.moveTo(sx, wy - half); else ctx.lineTo(sx, wy - half);
      }
      for (var ex = ts + 8; ex >= -8; ex -= 4) {
        ctx.lineTo(ex, base + waveAt(ox + ex, pitch) - oy + half);
      }
      ctx.closePath();
      ctx.fill();
    });
  }

  /** Diagonal arterials, so the grid does not read as graph paper. */
  function diagonal(ctx, ox, oy, ts, pitch, pal) {
    var w = Math.max(2, pitch * 0.115);
    var slope = 0.58;
    var skew = ox * slope;
    ctx.save();
    ctx.lineCap = 'butt';
    bands(oy - skew, ts, pitch * 17, pitch * 12).forEach(function (base) {
      var y0 = base + skew + (-10) * slope - oy;
      var y1 = base + skew + (ts + 10) * slope - oy;
      if (pal.casing) {
        ctx.strokeStyle = pal.casing; ctx.lineWidth = w + 2;
        ctx.beginPath(); ctx.moveTo(-10, y0); ctx.lineTo(ts + 10, y1); ctx.stroke();
      }
      ctx.strokeStyle = pal.roadMajor; ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(-10, y0); ctx.lineTo(ts + 10, y1); ctx.stroke();
    });
    ctx.restore();
  }

  function rail(ctx, ox, oy, ts, pitch, pal) {
    if (pitch < 30) return;
    var slope = -0.22;
    var skew = ox * slope;
    ctx.save();
    ctx.strokeStyle = 'rgba(118,114,102,.9)';
    ctx.lineWidth = Math.max(1.2, pitch * 0.020);
    ctx.setLineDash([pitch * 0.10, pitch * 0.07]);
    bands(oy - skew, ts, pitch * 29, pitch * 9).forEach(function (base) {
      ctx.beginPath();
      ctx.moveTo(-10, base + skew + (-10) * slope - oy);
      ctx.lineTo(ts + 10, base + skew + (ts + 10) * slope - oy);
      ctx.stroke();
    });
    ctx.restore();
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
    ctx.strokeStyle = pal.inkHalo || 'rgba(255,255,255,.85)';
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

  /* Every county answers here, which is the one thing the demo cannot be
     honest about — the banner says so, and each layer name repeats it. */
  CMG.parcels.describe = function () {
    return U.sleep(220).then(function () {
      return {
        name: 'Parcels (simulated)',
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

  CMG.parcels.savePreset = function () { return []; };

  /* County lookup, offline. Picks whichever registered county centre is
     nearest, so auto-detect behaves plausibly across the region. */
  var COUNTY_POINTS = {
    Denver: [39.74, -104.99], Adams: [39.87, -104.34], Arapahoe: [39.65, -104.34],
    Jefferson: [39.58, -105.25], Douglas: [39.33, -104.93], Broomfield: [39.95, -105.05],
    Boulder: [40.09, -105.36], Larimer: [40.67, -105.46], Weld: [40.55, -104.39],
    'El Paso': [38.83, -104.53], Pueblo: [38.17, -104.51], Teller: [38.88, -105.16],
    Elbert: [39.29, -104.14], Fremont: [38.47, -105.44], Summit: [39.63, -106.12],
    Park: [39.12, -105.72], Routt: [40.48, -106.99], Eagle: [39.63, -106.70],
    Grand: [40.10, -106.12], 'Clear Creek': [39.69, -105.64], Gilpin: [39.86, -105.52],
    Lake: [39.20, -106.35], Chaffee: [38.75, -106.19]
  };

  CMG.parcels.countyAt = function (lat, lng) {
    return U.sleep(200).then(function () {
      var best = null, bestD = Infinity;
      Object.keys(COUNTY_POINTS).forEach(function (name) {
        var c = COUNTY_POINTS[name];
        var d = U.distanceMiles({ lat: lat, lng: lng }, { lat: c[0], lng: c[1] });
        if (d < bestD) { bestD = d; best = name; }
      });
      return bestD < 90 ? best : null;
    });
  };

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

    var subject = st.subjects[0];
    subject.address = '1600 Broadway, Denver, CO 80202';
    subject.lat = 39.74390;
    subject.lng = -104.98730;
    subject.geocode = {
      provider: 'census', providerName: 'US Census (demo)',
      matchedAddress: '1600 BROADWAY, DENVER, CO 80202',
      score: 96, precision: 'rooftop', agreement: 2, spreadFeet: 18
    };
    subject.fields.size = '0.34 ac';

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

    S.refreshLabel(subject);
    // A real county from the registry, so the picker reads correctly; only the
    // service behind it is simulated.
    var denver = CMG.parcels.county('denver');
    st.parcelService = { presetId: 'denver', url: denver ? denver.url : '' };
    st.style.radiusRings = '0.5, 1';
    st.exportCfg = { presetId: 'body-half', w: 6.5, h: 4.0, dpi: 300 };
  };

  CMG.DEMO = true;
})(window.CMG);
