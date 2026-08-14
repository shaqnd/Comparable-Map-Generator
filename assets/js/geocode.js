/* Address -> coordinates.
   Three keyless providers are queried and their answers compared. Agreement
   between providers is the strongest accuracy signal available without paying
   for a parcel-level geocoder, so it is surfaced in the UI rather than hidden. */
(function (CMG) {
  'use strict';

  var U = CMG.util;

  /* Nominatim asks for no more than one request per second. */
  var nominatimQueue = Promise.resolve();
  function throttledNominatim(fn) {
    var run = nominatimQueue.then(fn);
    nominatimQueue = run.catch(function () {}).then(function () { return U.sleep(1100); });
    return run;
  }

  /* JSONP fallback — the Census geocoder is occasionally served without CORS
     headers through corporate proxies, and it supports a callback parameter. */
  var jsonpSeq = 0;
  function jsonp(baseUrl, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var name = '__cmgJsonp' + (++jsonpSeq);
      var script = document.createElement('script');
      var done = false;

      function cleanup() {
        done = true;
        try { delete window[name]; } catch (e) { window[name] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
      }

      var timer = setTimeout(function () {
        if (done) return;
        cleanup();
        reject(new Error('JSONP timeout'));
      }, timeoutMs || 15000);

      window[name] = function (data) {
        if (done) return;
        clearTimeout(timer);
        cleanup();
        resolve(data);
      };

      script.src = baseUrl + (baseUrl.indexOf('?') >= 0 ? '&' : '?') + 'callback=' + name;
      script.onerror = function () {
        if (done) return;
        clearTimeout(timer);
        cleanup();
        reject(new Error('JSONP load failed'));
      };
      document.head.appendChild(script);
    });
  }

  /* Precision buckets, best first. Drives the warning badge in the sidebar. */
  var PRECISION_RANK = {
    rooftop: 0,
    parcel: 1,
    interpolated: 2,
    street: 3,
    approximate: 4
  };

  /** Is a point inside the counties this release covers? */
  function inRegion(lat, lng) {
    var b = CMG.REGION.bounds;
    return lat >= b[0][0] && lat <= b[1][0] && lng >= b[0][1] && lng <= b[1][1];
  }

  function inState(lat, lng) {
    var b = CMG.STATE_BOUNDS;
    return lat >= b[0][0] && lat <= b[1][0] && lng >= b[0][1] && lng <= b[1][1];
  }

  function candidate(o) {
    return {
      lat: o.lat,
      lng: o.lng,
      label: o.label || '',
      score: Math.round(o.score || 0),
      provider: o.provider,
      providerName: o.providerName,
      precision: o.precision || 'approximate',
      agreement: 1,
      agreeWith: [],
      inRegion: inRegion(o.lat, o.lng),
      inState: inState(o.lat, o.lng)
    };
  }

  /* ------------------------------------------------------------ US Census */

  function censusSearch(q) {
    var base = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress' +
               '?benchmark=Public_AR_Current&format=json&address=' + encodeURIComponent(q);

    return U.fetchJSON(base, { timeout: 18000 })
      .catch(function () { return jsonp(base, 18000); })
      .then(function (data) {
        var matches = (data && data.result && data.result.addressMatches) || [];
        return matches.slice(0, 5).map(function (m, i) {
          return candidate({
            lat: m.coordinates.y,
            lng: m.coordinates.x,
            label: m.matchedAddress,
            // The Census geocoder returns only matches it considers correct and
            // gives no score, so rank by order and treat the first as strong.
            score: i === 0 ? 96 : 88 - i * 4,
            provider: 'census',
            providerName: 'US Census',
            precision: 'interpolated'
          });
        });
      })
      .catch(function () { return []; });
  }

  /* ---------------------------------------------------------- Esri / ArcGIS */

  function arcgisPrecision(addrType) {
    switch (addrType) {
      case 'PointAddress':
      case 'Subaddress':
      case 'BuildingName': return 'rooftop';
      case 'Parcel': return 'parcel';
      case 'StreetAddress':
      case 'StreetAddressExt': return 'interpolated';
      case 'StreetName':
      case 'StreetInt': return 'street';
      default: return 'approximate';
    }
  }

  function arcgisSearch(q) {
    // searchExtent biases results to the launch region without excluding
    // anything outside it — an out-of-region hit is flagged, not hidden.
    var b = CMG.REGION.bounds;
    var extent = encodeURIComponent(JSON.stringify({
      xmin: b[0][1], ymin: b[0][0], xmax: b[1][1], ymax: b[1][0],
      spatialReference: { wkid: 4326 }
    }));
    var url = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates' +
              '?f=json&maxLocations=5&outFields=Match_addr,Addr_type' +
              '&countryCode=USA&searchExtent=' + extent +
              '&singleLine=' + encodeURIComponent(q);

    return U.fetchJSON(url, { timeout: 18000 })
      .then(function (data) {
        var list = (data && data.candidates) || [];
        return list.map(function (c) {
          var addrType = (c.attributes && c.attributes.Addr_type) || '';
          return candidate({
            lat: c.location.y,
            lng: c.location.x,
            label: c.address || (c.attributes && c.attributes.Match_addr) || '',
            score: c.score,
            provider: 'arcgis',
            providerName: 'Esri',
            precision: arcgisPrecision(addrType)
          });
        });
      })
      .catch(function () { return []; });
  }

  /* ------------------------------------------------------------- Nominatim */

  function nominatimSearch(q) {
    var b = CMG.REGION.bounds;
    var url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5' +
              '&countrycodes=us&addressdetails=1' +
              '&viewbox=' + [b[0][1], b[1][0], b[1][1], b[0][0]].join(',') +
              '&q=' + encodeURIComponent(q);

    return throttledNominatim(function () {
      return U.fetchJSON(url, { timeout: 18000 });
    })
      .then(function (list) {
        return (list || []).map(function (r) {
          var t = r.addresstype || r.type || '';
          var precise = (t === 'house' || t === 'building' || t === 'address' || !!r.house_number);
          return candidate({
            lat: parseFloat(r.lat),
            lng: parseFloat(r.lon),
            label: r.display_name,
            score: precise ? 90 : 62,
            provider: 'nominatim',
            providerName: 'OpenStreetMap',
            precision: precise ? 'rooftop' : 'approximate'
          });
        });
      })
      .catch(function () { return []; });
  }

  /* ------------------------------------------------------------- combining */

  /** Merge candidates that land within ~30 m of each other and count agreement. */
  function consolidate(lists) {
    var flat = [];
    lists.forEach(function (l) { flat = flat.concat(l || []); });
    flat = flat.filter(function (c) { return isFinite(c.lat) && isFinite(c.lng); });

    var merged = [];
    flat.forEach(function (c) {
      var near = merged.filter(function (m) {
        return U.distanceMiles(m, c) * 5280 < 100;   // ~30 m
      })[0];

      if (!near) {
        merged.push(c);
        return;
      }
      if (near.agreeWith.indexOf(c.provider) < 0 && near.provider !== c.provider) {
        near.agreeWith.push(c.provider);
        near.agreement += 1;
      }
      // Keep whichever reading is more precise; ties break on score.
      var better = PRECISION_RANK[c.precision] < PRECISION_RANK[near.precision] ||
                   (c.precision === near.precision && c.score > near.score);
      if (better) {
        var keepAgree = near.agreement, keepWith = near.agreeWith;
        Object.assign(near, c);
        near.agreement = keepAgree;
        near.agreeWith = keepWith;
      }
    });

    merged.sort(function (a, b) {
      // A match inside the covered counties beats one outside it, whatever it
      // scored — "1953 Gun Club Rd" exists in several states.
      if (a.inRegion !== b.inRegion) return a.inRegion ? -1 : 1;
      if (a.inState !== b.inState) return a.inState ? -1 : 1;
      if (b.agreement !== a.agreement) return b.agreement - a.agreement;
      if (PRECISION_RANK[a.precision] !== PRECISION_RANK[b.precision]) {
        return PRECISION_RANK[a.precision] - PRECISION_RANK[b.precision];
      }
      return b.score - a.score;
    });
    return merged;
  }

  var Geocode = {

    inRegion: inRegion,
    inState: inState,

    /**
     * Look an address up across providers.
     * @returns {Promise<{candidates:Array, spreadFeet:number|null}>}
     *          `spreadFeet` is how far apart the providers' best guesses are —
     *          a large spread means the address needs a human eye.
     */
    search: function (query) {
      var q = String(query || '').trim();
      if (!q) return Promise.resolve({ candidates: [], spreadFeet: null });

      var direct = U.parseLatLng(q);
      if (direct) {
        return Promise.resolve({
          candidates: [candidate({
            lat: direct.lat, lng: direct.lng,
            label: 'Coordinates ' + U.formatLatLng(direct.lat, direct.lng),
            score: 100, provider: 'manual', providerName: 'Typed coordinates',
            precision: 'rooftop'
          })],
          spreadFeet: 0
        });
      }

      return Promise.all([censusSearch(q), arcgisSearch(q)])
        .then(function (results) {
          var best = consolidate(results);
          var strong = best[0] && best[0].score >= CMG.CONFIDENCE_WARN &&
                       best[0].precision !== 'approximate';
          // Only bother OpenStreetMap when the primary providers came up short.
          if (best.length && strong) return best;
          return nominatimSearch(q).then(function (nom) {
            return consolidate(results.concat([nom]));
          });
        })
        .then(function (candidates) {
          return {
            candidates: candidates,
            spreadFeet: Geocode.spreadFeet(candidates)
          };
        });
    },

    /** Distance in feet between the top two distinct provider readings. */
    spreadFeet: function (candidates) {
      if (!candidates || candidates.length < 2) return null;
      var a = candidates[0];
      var b = candidates.filter(function (c) { return c.provider !== a.provider; })[0];
      if (!b) return null;
      return Math.round(U.distanceMiles(a, b) * 5280);
    },

    /** Coordinates -> nearest street address, used after a pin is dragged. */
    reverse: function (lat, lng) {
      var url = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode' +
                '?f=json&location=' + encodeURIComponent(lng + ',' + lat);
      return U.fetchJSON(url, { timeout: 15000 })
        .then(function (d) {
          if (d && d.address && d.address.Match_addr) return d.address.Match_addr;
          return null;
        })
        .catch(function () { return null; });
    },

    /** Used by the diagnostics panel. */
    probe: function () {
      var sample = '1600 Pennsylvania Ave NW, Washington, DC 20500';
      return {
        census: censusSearch(sample),
        arcgis: arcgisSearch(sample),
        nominatim: nominatimSearch(sample)
      };
    },

    PRECISION_LABEL: {
      rooftop: 'rooftop',
      parcel: 'parcel',
      interpolated: 'street-interpolated',
      street: 'street centre-line',
      approximate: 'approximate'
    }
  };

  CMG.geocode = Geocode;
})(window.CMG);
