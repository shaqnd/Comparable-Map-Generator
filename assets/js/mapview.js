/* The map: base layers, parcels, pins, draggable labels and map furniture.
   Everything drawn here lives inside #mapFrame, which is exactly what the
   exporter captures — so the screen view and the exported image cannot drift. */
(function (CMG) {
  'use strict';

  var U = CMG.util;
  var Store = CMG.store;

  var MV = {
    map: null,
    uiScale: 1,          // >1 only while a high-resolution export is rendering
    mode: 'pan',
    placeTargetId: null,
    selectedId: null,

    _base: null,
    _labelLayers: [],
    _renderer: null,
    _layers: {},         // id -> { pin, label, leader, parcel }
    _rings: [],
    _connectors: [],
    _draw: null,
    _onSelect: null,
    _onParcelAssigned: null,
    _onLabelEdited: null,
    _onStatus: null
  };

  /* ------------------------------------------------------------------ setup */

  MV.init = function (hooks) {
    hooks = hooks || {};
    MV._onSelect = hooks.onSelect || function () {};
    MV._onParcelAssigned = hooks.onParcelAssigned || function () {};
    MV._onLabelEdited = hooks.onLabelEdited || function () {};
    MV._onStatus = hooks.onStatus || function () {};

    var v = Store.state.view;

    MV.map = L.map('map', {
      center: [v.lat, v.lng],
      zoom: v.zoom,
      zoomControl: false,      // re-added bottom-left, clear of the title block
      attributionControl: true,
      zoomSnap: 0,            // fractional zoom is what makes high-res export exact
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 90,
      preferCanvas: true,
      maxZoom: 22
    });

    MV._renderer = L.canvas({ padding: 0.6 });

    MV.map.createPane('parcelPane').style.zIndex = 410;
    MV.map.createPane('linePane').style.zIndex = 420;
    MV.map.createPane('labelPane').style.zIndex = 615;
    MV.map.getPane('labelPane').style.pointerEvents = 'none';

    /* Corners are budgeted: title top-left, north arrow top-right, legend
       bottom-right, and the map's own chrome stacked in the bottom-left.
       Leaflet inserts bottom-corner controls above the previous one, so the
       add order here is deliberate: attribution ends up lowest. */
    MV.map.attributionControl.setPosition('bottomleft');
    MV.scaleControl = L.control.scale({
      position: 'bottomleft', imperial: true, metric: false, maxWidth: 160
    });
    MV.scaleControl.addTo(MV.map);
    L.control.zoom({ position: 'bottomleft' }).addTo(MV.map);

    MV.setBasemap(v.basemap, v.labelOverlay);

    var settle = U.debounce(function () { MV.maybeAutoFit(); }, 450);
    MV.map.on('moveend zoomend', function () {
      var c = MV.map.getCenter();
      Store.setView({ lat: c.lat, lng: c.lng, zoom: MV.map.getZoom() });
      settle();
    });

    MV.map.on('mousemove', function (e) {
      var out = document.getElementById('coordReadout');
      if (out) out.textContent = U.formatLatLng(e.latlng.lat, e.latlng.lng);
    });

    MV.map.on('move zoom viewreset zoomend', MV.updateLeaders);
    MV.map.on('zoomend resize', function () {
      MV.autoPlaceLabels();
      MV.updateLeaders();
    });
    MV.map.on('click', MV.onMapClick);
    MV.map.on('dblclick', MV.onMapDblClick);

    return MV.map;
  };

  /* -------------------------------------------------------------- base layers */

  MV.setBasemap = function (id, withLabels) {
    var def = CMG.BASEMAPS.filter(function (b) { return b.id === id; })[0] || CMG.BASEMAPS[0];

    if (MV._base) MV.map.removeLayer(MV._base);
    MV._labelLayers.forEach(function (l) { MV.map.removeLayer(l); });
    MV._labelLayers = [];

    MV._base = L.tileLayer(def.url, {
      attribution: def.attribution,
      maxNativeZoom: def.maxNativeZoom,
      maxZoom: 22,
      crossOrigin: 'anonymous',   // required so the export canvas is not tainted
      keepBuffer: 4,
      className: 'cmg-basetiles'
    }).addTo(MV.map);

    if (withLabels && def.supportsLabelOverlay) {
      var urls = def.labelOverlayUrls || CMG.LABEL_OVERLAY_URLS;
      urls.forEach(function (u) {
        var l = L.tileLayer(u, {
          maxNativeZoom: def.maxNativeZoom,
          maxZoom: 22,
          crossOrigin: 'anonymous',
          keepBuffer: 4,
          pane: 'tilePane',
          opacity: 1
        }).addTo(MV.map);
        MV._labelLayers.push(l);
      });
    }

    Store.setView({ basemap: def.id, labelOverlay: !!withLabels });
    MV.applyStyleVars();
  };

  MV.currentBasemapDef = function () {
    var id = Store.state.view.basemap;
    return CMG.BASEMAPS.filter(function (b) { return b.id === id; })[0] || CMG.BASEMAPS[0];
  };

  /** Every tile layer currently on the map — the exporter waits on these. */
  MV.tileLayers = function () {
    return [MV._base].concat(MV._labelLayers).filter(Boolean);
  };

  /* ------------------------------------------------------------ style plumbing */

  MV.applyStyleVars = function () {
    var s = Store.state.style;
    var frame = document.getElementById('mapFrame');
    frame.style.setProperty('--ui-scale', MV.uiScale);
    frame.style.setProperty('--pin-scale', (s.pinScale || 100) / 100);
    frame.style.setProperty('--label-size', (s.labelSize || 13));
    CMG.theme.apply(Store.state.theme, frame);

    var tiles = document.querySelector('.leaflet-tile-pane');
    if (tiles) {
      var dim = (s.basemapDim == null ? 100 : s.basemapDim) / 100;
      tiles.style.filter = dim === 1 ? '' : 'brightness(' + dim + ')';
    }

    // The scale bar is measured in pixels, so its target length has to grow
    // with the export scale or it would report an odd fraction of the distance.
    if (MV.scaleControl) {
      MV.scaleControl.options.maxWidth = Math.round(160 * MV.uiScale);
      if (MV.scaleControl._update) MV.scaleControl._update();
    }

    // Title, north arrow and legend are exhibit furniture. On a map with
    // nothing on it they are three cards floating over an empty rectangle,
    // so they arrive with the first pin.
    var started = Store.located().length > 0;

    frame.classList.toggle('hide-labels', !s.showLabels);
    frame.classList.toggle('hide-scale', !s.showScale || !started);
    document.getElementById('ovTitle').hidden = !s.showTitle || !started;
    document.getElementById('ovNorth').hidden = !s.showNorth || !started;
    document.getElementById('ovLegend').hidden = !s.showLegend;
    document.getElementById('ovLegend').setAttribute('data-pos', s.legendPos || 'bottom-right');
  };

  function colorFor(p) {
    return CMG.theme.colorFor(p, Store.state.theme);
  }

  function token(key, itemColor) {
    return CMG.theme.resolve(key, Store.state.theme, itemColor);
  }

  /* ------------------------------------------------------------------- pins */

  /* Two marker forms. "disc" is the modern default — a filled circle with a
     white ring and a short stem, which stays legible at small print sizes and
     over busy imagery. "pin" keeps the classic teardrop for anyone who wants
     it. Both are built from the same theme tokens. */
  function pinIcon(p) {
    var color = colorFor(p);
    var text = Store.keyFor(p);
    var selected = MV.selectedId === p.id ? ' is-selected' : '';
    var ring = U.escapeHtml(token('pinStroke'));
    var core = token('pinDisc');
    var shape = Store.state.style.markerStyle === 'pin' ? 'pin' : 'disc';

    var body;
    if (shape === 'pin') {
      body =
        '<path class="pin-head" d="M17 42C17 42 30 25 30 15A13 13 0 1 0 4 15C4 25 17 42 17 42Z" ' +
              'fill="var(--c)" stroke="' + ring + '" stroke-width="2.4" ' +
              'stroke-linejoin="round" paint-order="stroke"/>' +
        (core === 'transparent' ? '' :
          '<circle class="pin-core" cx="17" cy="15" r="8.4" fill="' + U.escapeHtml(core) + '"/>');
    } else {
      body =
        '<path class="pin-stem" d="M17 41.5 12.4 30.5h9.2Z" fill="var(--c)" ' +
              'stroke="' + ring + '" stroke-width="2.2" stroke-linejoin="round" ' +
              'paint-order="stroke"/>' +
        '<circle class="pin-head" cx="17" cy="16" r="13" fill="var(--c)" ' +
                'stroke="' + ring + '" stroke-width="2.4"/>' +
        (core === 'transparent' ? '' :
          '<circle class="pin-core" cx="17" cy="16" r="8.6" fill="' + U.escapeHtml(core) + '"/>');
    }

    var html =
      '<div class="pin-inner pin-' + shape + selected + '" ' +
           'style="--c:' + U.escapeHtml(color) + '">' +
        '<svg viewBox="0 0 34 44" width="34" height="44">' + body + '</svg>' +
        '<span class="pin-num" style="color:' +
          U.escapeHtml(CMG.theme.pinNumberColor(p, Store.state.theme)) + '">' +
          U.escapeHtml(text) + '</span>' +
      '</div>';

    return L.divIcon({
      className: 'cmg-pin',
      html: html,
      iconSize: [34, 44],
      iconAnchor: [17, 44]
    });
  }

  /* ----------------------------------------------------------------- labels */

  /* Line roles give the card its hierarchy: a heading bar, the street, the
     place, then the figures. Classes are assigned by position, so hand-edited
     text still reads sensibly rather than losing its shape. */
  function lineClass(i) {
    if (i === 0) return 'lbl-head';
    if (i === 1) return 'lbl-line lbl-primary';
    if (i === 2) return 'lbl-line lbl-place';
    return 'lbl-line lbl-figure';
  }

  function labelHtml(p) {
    var off = activeOffset(p);
    var lines = String(p.labelText || '').split('\n');
    var body = lines.map(function (line, i) {
      return '<div class="' + lineClass(i) + '">' + U.escapeHtml(line) + '</div>';
    }).join('');

    return '<div class="cmg-label" data-id="' + p.id + '" ' +
           'style="transform:translate(calc(var(--ui-scale) * ' + off.x + 'px),' +
                                     'calc(var(--ui-scale) * ' + off.y + 'px));' +
                  '--lc:' + U.escapeHtml(colorFor(p)) + '">' +
             '<div class="lbl-body" data-role="text">' + body + '</div>' +
           '</div>';
  }

  function defaultOffset(p) {
    return p.role === 'subject' ? { x: 16, y: -96 } : { x: 16, y: -84 };
  }

  /** The offset in use: hand-placed wins, then auto-placed, then the default. */
  function activeOffset(p) {
    return p.labelOffset || p._autoOffset || defaultOffset(p);
  }

  /* Candidate positions around a pin, in preference order. Each returns the
     label's top-left relative to the pin, for a label of w x h. */
  var LABEL_SLOTS = [
    function (w, h, g) { return { x: g, y: -h - g }; },              // NE
    function (w, h, g) { return { x: g, y: -h / 2 }; },              // E
    function (w, h, g) { return { x: -w - g, y: -h - g }; },         // NW
    function (w, h, g) { return { x: -w - g, y: -h / 2 }; },         // W
    function (w, h, g) { return { x: -w / 2, y: -h - g * 2 }; },     // N
    function (w, h, g) { return { x: g, y: g }; },                   // SE
    function (w, h, g) { return { x: -w - g, y: g }; },              // SW
    function (w, h, g) { return { x: -w / 2, y: g * 2 }; }           // S
  ];

  /* Title block, legend, north arrow and scale bar occupy real space in the
     exhibit. Label placement has to treat them as obstacles, or a comparable's
     card ends up buried under the legend in the exported image. */
  function furnitureBoxes() {
    var mapRect = document.getElementById('map').getBoundingClientRect();
    var out = [];
    ['#ovTitle .title-block', '#ovLegend .legend-box', '#ovNorth svg',
     '.leaflet-control-scale', '.leaflet-control-attribution'].forEach(function (sel) {
      var el = document.querySelector(sel);
      if (!el) return;
      var host = el.closest('.ov');
      if (host && host.hidden) return;
      if (!el.offsetParent && !el.getClientRects().length) return;
      var r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      out.push({ x: r.left - mapRect.left, y: r.top - mapRect.top, w: r.width, h: r.height });
    });
    return out;
  }

  function overlapArea(a, b) {
    var dx = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    var dy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return (dx > 0 && dy > 0) ? dx * dy : 0;
  }

  /**
   * Places labels that the user has not positioned by hand, choosing the
   * corner around each pin that collides least with the labels and pins
   * already placed. Comparables often cluster on one street, and a fixed
   * offset would stack their labels into an unreadable pile.
   *
   * Runs in container pixels, then divides by --ui-scale because the stored
   * offset is multiplied by it again when rendered.
   */
  MV.autoPlaceLabels = function () {
    var s = Store.state.style;
    if (!s.showLabels) return;

    var size = MV.map.getSize();
    var pinS = MV.uiScale * (s.pinScale || 100) / 100;
    /* Clear the pin's own footprint, or every slot to the right of a pin pays
       the same overlap penalty and the cost comparison is biased leftward. */
    var gap = Math.max(10 * MV.uiScale, 16 * pinS);

    var pinBoxes = [];
    var furniture = furnitureBoxes();
    var items = [];

    Store.located().forEach(function (p) {
      var pt = MV.map.latLngToContainerPoint([p.lat, p.lng]);
      pinBoxes.push({ x: pt.x - 15 * pinS, y: pt.y - 44 * pinS, w: 30 * pinS, h: 44 * pinS });

      var entry = MV._layers[p.id];
      if (!entry || !entry.labelEl) return;
      var rect = entry.labelEl.getBoundingClientRect();
      if (!rect.width) return;
      items.push({ p: p, el: entry.labelEl, pt: pt, w: rect.width, h: rect.height });
    });
    if (!items.length) return;

    // Subject first, then comparables in order, so the result is stable.
    items.sort(function (a, b) {
      if (a.p.role !== b.p.role) return a.p.role === 'subject' ? -1 : 1;
      return (a.p.number || 0) - (b.p.number || 0);
    });

    var placed = [];

    items.forEach(function (it) {
      // A hand-placed label is fixed; it still blocks the others.
      if (it.p.labelOffset) {
        placed.push({
          x: it.pt.x + it.p.labelOffset.x * MV.uiScale,
          y: it.pt.y + it.p.labelOffset.y * MV.uiScale,
          w: it.w, h: it.h
        });
        return;
      }

      var best = null, bestCost = Infinity;
      LABEL_SLOTS.forEach(function (slot, i) {
        var o = slot(it.w, it.h, gap);
        var box = { x: it.pt.x + o.x, y: it.pt.y + o.y, w: it.w, h: it.h };

        var cost = i * 40;                       // mild preference for earlier slots
        placed.forEach(function (q) { cost += overlapArea(box, q) * 3; });
        pinBoxes.forEach(function (q) { cost += overlapArea(box, q) * 6; });
        furniture.forEach(function (q) { cost += overlapArea(box, q) * 5; });

        // Keep it inside the frame, with an inset so a label never sits flush
        // against the edge of a printed exhibit.
        var pad = 12 * MV.uiScale;
        var outX = Math.max(0, pad - box.x) + Math.max(0, (box.x + box.w) - (size.x - pad));
        var outY = Math.max(0, pad - box.y) + Math.max(0, (box.y + box.h) - (size.y - pad));
        cost += (outX + outY) * 90;

        if (cost < bestCost) { bestCost = cost; best = { o: o, box: box }; }
      });

      it.p._autoOffset = { x: best.o.x / MV.uiScale, y: best.o.y / MV.uiScale };
      it.el.style.transform =
        'translate(calc(var(--ui-scale) * ' + it.p._autoOffset.x + 'px),' +
                  'calc(var(--ui-scale) * ' + it.p._autoOffset.y + 'px))';
      placed.push(best.box);
    });
  };

  /** Container-pixel point at the centre of a property's label box. */
  function labelAnchorPoint(p) {
    var entry = MV._layers[p.id];
    if (!entry || !entry.labelEl) return null;
    var pinPt = MV.map.latLngToContainerPoint([p.lat, p.lng]);
    var rect = entry.labelEl.getBoundingClientRect();
    var frameRect = document.getElementById('map').getBoundingClientRect();
    if (!rect.width) return null;
    // Nearest edge of the label box to the pin reads better than its centre.
    var cx = rect.left - frameRect.left + rect.width / 2;
    var cy = rect.top - frameRect.top + rect.height / 2;
    var dx = pinPt.x - cx, dy = pinPt.y - cy;
    var hw = rect.width / 2, hh = rect.height / 2;
    var t = 1;
    if (Math.abs(dx) > 0.001) t = Math.min(t, hw / Math.abs(dx));
    if (Math.abs(dy) > 0.001) t = Math.min(t, hh / Math.abs(dy));
    return L.point(cx + dx * t, cy + dy * t);
  }

  /* ------------------------------------------------------------ label dragging */

  function wireLabel(p, el) {
    var inner = el.querySelector('.cmg-label');
    if (!inner) return null;

    L.DomEvent.disableClickPropagation(inner);
    L.DomEvent.disableScrollPropagation(inner);
    inner.style.pointerEvents = 'auto';

    var dragging = false, moved = false, startX = 0, startY = 0, baseOff = null;

    function onDown(ev) {
      if (inner.getAttribute('contenteditable') === 'true') return;  // editing, not dragging
      if (ev.button !== undefined && ev.button !== 0) return;
      dragging = true;
      moved = false;
      startX = ev.clientX;
      startY = ev.clientY;
      baseOff = Object.assign({}, activeOffset(p));
      inner.setPointerCapture && ev.pointerId != null && inner.setPointerCapture(ev.pointerId);
      ev.preventDefault();
      ev.stopPropagation();
    }

    function onMove(ev) {
      if (!dragging) return;
      var dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;   // let clicks stay clicks
      moved = true;
      inner.classList.add('is-dragging');
      var next = { x: Math.round(baseOff.x + dx), y: Math.round(baseOff.y + dy) };
      p.labelOffset = next;
      inner.style.transform = 'translate(calc(var(--ui-scale) * ' + next.x + 'px),' +
                                        'calc(var(--ui-scale) * ' + next.y + 'px))';
      MV.updateLeaders();
      ev.preventDefault();
    }

    function onUp(ev) {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (!dragging) return;
      dragging = false;
      inner.classList.remove('is-dragging');
      if (moved) {
        Store.saveLocal();
        MV.updateLeaders();
      } else {
        MV.select(p.id);
      }
      void ev;
    }

    inner.addEventListener('pointerdown', function (ev) {
      // Bound per drag, not per label: labels are rebuilt on every redraw and
      // permanent window listeners would pile up on stale elements.
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      onDown(ev);
    });

    inner.addEventListener('dblclick', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      startEditing(p, inner);
    });

    return inner;
  }

  function startEditing(p, inner) {
    var body = inner.querySelector('[data-role="text"]');
    if (!body) return;
    inner.classList.add('is-editing');
    body.setAttribute('contenteditable', 'true');
    inner.setAttribute('contenteditable', 'true');   // read by the drag guard
    body.focus();

    var range = document.createRange();
    range.selectNodeContents(body);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    var finished = false;

    function finish() {
      if (finished) return;
      finished = true;
      body.removeEventListener('blur', finish);
      body.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onOutside, true);
      inner.classList.remove('is-editing');
      body.removeAttribute('contenteditable');
      inner.removeAttribute('contenteditable');

      var text = readLabelText(body);
      if (text !== p.labelText) {
        Store.pushUndo();
        p.labelText = text;
        p.labelCustom = true;
        Store.emit('properties');
        MV._onLabelEdited(p.id, text);
      }
    }

    function onKey(ev) {
      if (ev.key === 'Escape') { ev.preventDefault(); body.blur(); }
      // Enter inserts a line break; Ctrl/Cmd+Enter commits.
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); body.blur(); }
      ev.stopPropagation();
    }

    /* Leaflet calls preventDefault on the map's own mousedown, which suppresses
       the blur that would normally end editing. Watch for a press anywhere
       outside the label instead. */
    function onOutside(ev) {
      if (!inner.contains(ev.target)) finish();
    }

    body.addEventListener('blur', finish);
    body.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onOutside, true);
  }

  /** contentEditable divs produce <div>/<br> soup; flatten back to plain lines. */
  function readLabelText(body) {
    var html = body.innerHTML
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(div|p)>/gi, '\n')
      .replace(/<[^>]+>/g, '');
    var txt = document.createElement('textarea');
    txt.innerHTML = html;
    return txt.value.replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
  }

  /* -------------------------------------------------------------- rendering */

  MV.render = function () {
    var s = Store.state.style;
    MV.applyStyleVars();

    var wanted = {};
    Store.all().forEach(function (p) { wanted[p.id] = true; });

    // Drop layers for properties that no longer exist.
    Object.keys(MV._layers).forEach(function (id) {
      if (!wanted[id]) {
        removeEntry(MV._layers[id]);
        delete MV._layers[id];
      }
    });

    Store.all().forEach(function (p) {
      var hasLoc = p.lat != null && p.lng != null;
      var entry = MV._layers[p.id];

      if (!hasLoc) {
        if (entry) { removeEntry(entry); delete MV._layers[p.id]; }
        // A parcel can exist before a pin does; keep it visible.
        if (p.parcel) drawParcelOnly(p);
        return;
      }

      if (!entry) {
        entry = MV._layers[p.id] = {};
      }

      /* pin */
      if (!entry.pin) {
        entry.pin = L.marker([p.lat, p.lng], {
          icon: pinIcon(p),
          draggable: true,
          autoPan: true,
          keyboard: false,
          zIndexOffset: p.role === 'subject' ? 1000 : 0
        }).addTo(MV.map);

        entry.pin.on('dragstart', function () { Store.pushUndo(); });
        entry.pin.on('drag', function () { MV.updateLeaders(); });
        entry.pin.on('dragend', function (e) {
          var ll = e.target.getLatLng();
          Store.setLocation(p.id, ll.lat, ll.lng, p.geocode, true);
          MV._onStatus('Pin moved to ' + U.formatLatLng(ll.lat, ll.lng) + ' (marked hand-placed).');
        });
        entry.pin.on('click', function (e) {
          // A marker swallows the map click, but in the click-the-map modes the
          // pin is exactly where the user aims — pass it through.
          var at = e.latlng || L.latLng(p.lat, p.lng);
          if (MV.mode === 'parcel' || MV.mode === 'place' || MV.mode === 'draw') {
            MV.onMapClick({ latlng: at });
            return;
          }
          MV.select(p.id);
        });
      } else {
        entry.pin.setLatLng([p.lat, p.lng]);
        entry.pin.setIcon(pinIcon(p));
      }

      /* label */
      if (entry.label) { MV.map.removeLayer(entry.label); entry.label = null; }
      if (s.showLabels && p.showLabel !== false && p.labelText) {
        entry.label = L.marker([p.lat, p.lng], {
          icon: L.divIcon({
            className: 'cmg-label-anchor',
            html: labelHtml(p),
            iconSize: [0, 0],
            iconAnchor: [0, 0]
          }),
          interactive: true,
          pane: 'labelPane',
          keyboard: false,
          zIndexOffset: 500
        }).addTo(MV.map);
        entry.labelEl = wireLabel(p, entry.label.getElement());
      } else {
        entry.labelEl = null;
      }

      /* parcel */
      if (entry.parcel) { MV.map.removeLayer(entry.parcel); entry.parcel = null; }
      if (p.parcel && p.parcel.geometry) entry.parcel = addParcelLayer(p);
    });

    drawRings();
    drawConnectors();
    /* Legend and title first: label placement measures them as obstacles, so
       they have to be at their final size before the labels are positioned. */
    MV.renderLegend();
    MV.renderTitle();
    MV.autoPlaceLabels();
    MV.updateLeaders();
    MV.maybeAutoFit();
  };

  function removeEntry(entry) {
    if (!entry) return;
    ['pin', 'label', 'leader', 'parcel'].forEach(function (k) {
      if (entry[k]) MV.map.removeLayer(entry[k]);
    });
  }

  function parcelStyle(p) {
    var s = Store.state.style;
    // A parcel is the property, so it wears the property's colour — the binding
    // that lets the legend do its work without callouts on the map.
    var c = token('parcelStroke', colorFor(p));
    var op = Number(Store.state.theme.tokens.parcelOpacity || 0) / 100;
    return {
      color: c,
      weight: 3,
      opacity: 1,
      fill: !!s.parcelFill,
      fillColor: c,
      fillOpacity: s.parcelFill ? op : 0,
      renderer: MV._renderer,
      pane: 'parcelPane',
      interactive: false
    };
  }

  function addParcelLayer(p) {
    try {
      return L.geoJSON(p.parcel.geometry, parcelStyle(p)).addTo(MV.map);
    } catch (e) {
      console.warn('[cmg] could not draw parcel', e);
      return null;
    }
  }

  function drawParcelOnly(p) {
    var entry = MV._layers[p.id] = MV._layers[p.id] || {};
    if (entry.parcel) MV.map.removeLayer(entry.parcel);
    entry.parcel = addParcelLayer(p);
  }

  /* ----------------------------------------------------- leaders / rings / lines */

  MV.updateLeaders = function () {
    var s = Store.state.style;
    Store.all().forEach(function (p) {
      var entry = MV._layers[p.id];
      if (!entry) return;
      if (entry.leader) { MV.map.removeLayer(entry.leader); entry.leader = null; }
      if (!s.showLeaders || !s.showLabels || !entry.labelEl || p.lat == null) return;

      var anchor = labelAnchorPoint(p);
      if (!anchor) return;
      var pinPt = MV.map.latLngToContainerPoint([p.lat, p.lng]);
      // Stop short of the pin head so the line does not cross the marker.
      var dx = anchor.x - pinPt.x, dy = anchor.y - pinPt.y;
      var len = Math.sqrt(dx * dx + dy * dy);
      if (len < 26 * MV.uiScale) return;

      var stop = 14 * MV.uiScale * (Store.state.style.pinScale / 100);
      var tipPt = L.point(pinPt.x + dx / len * stop, pinPt.y + dy / len * stop);

      entry.leader = L.polyline([
        MV.map.containerPointToLatLng(tipPt),
        MV.map.containerPointToLatLng(anchor)
      ], {
        color: token('leader', colorFor(p)),
        weight: 1.6 * MV.uiScale,
        opacity: 0.95,
        renderer: MV._renderer,
        pane: 'linePane',
        interactive: false
      }).addTo(MV.map);
    });
  };

  function clearLayerList(list) {
    list.forEach(function (l) { MV.map.removeLayer(l); });
    list.length = 0;
  }

  function drawRings() {
    clearLayerList(MV._rings);
    var raw = String(Store.state.style.radiusRings || '').trim();
    if (!raw) return;
    // On a portfolio map every subject gets its own rings — the distance that
    // matters is to the nearest holding, not to whichever one was entered first.
    var first = true;
    Store.state.subjects.forEach(function (subject) {
      if (subject.lat == null) return;
      // Every subject gets rings, but only one set is labelled — the radius is
      // the same for all of them, and three stacks of "0.5 mi" is noise.
      ringsAround(subject, raw, first);
      first = false;
    });
  }

  function ringsAround(subject, raw, withTags) {
    raw.split(',').forEach(function (part) {
      var mi = parseFloat(part);
      if (!isFinite(mi) || mi <= 0) return;
      var circle = L.circle([subject.lat, subject.lng], {
        radius: mi * 1609.344,
        color: token('ring'),
        weight: 1.5 * MV.uiScale,
        opacity: 0.85,
        dashArray: (6 * MV.uiScale) + ',' + (6 * MV.uiScale),
        fill: false,
        renderer: MV._renderer,
        pane: 'linePane',
        interactive: false
      }).addTo(MV.map);
      MV._rings.push(circle);

      if (!withTags) return;

      var edge = L.latLng(subject.lat, subject.lng);
      var north = MV.map.latLngToContainerPoint(edge);
      var radiusPx = circle._radius != null
        ? MV.map.latLngToContainerPoint(edge).y - MV.map.latLngToContainerPoint(destNorth(edge, mi)).y
        : 0;
      var tag = L.marker(MV.map.containerPointToLatLng(L.point(north.x, north.y - radiusPx)), {
        icon: L.divIcon({
          className: 'cmg-ring-tag',
          html: '<span class="ring-tag">' + (mi + ' mi') + '</span>',
          iconSize: [0, 0], iconAnchor: [0, 0]
        }),
        interactive: false,
        pane: 'labelPane'
      }).addTo(MV.map);
      MV._rings.push(tag);
    });
  }

  function destNorth(latlng, miles) {
    return L.latLng(latlng.lat + (miles / 69.0), latlng.lng);
  }

  function drawConnectors() {
    clearLayerList(MV._connectors);
    if (!Store.state.style.showConnectors) return;

    Store.state.comps.forEach(function (c) {
      if (c.lat == null) return;
      // Drawn to the nearest subject, which is the relationship the reader is
      // being shown. Lines to every subject would be a cat's cradle.
      var near = Store.nearestSubject(c);
      if (!near) return;
      var subject = near.subject;
      var line = L.polyline([[subject.lat, subject.lng], [c.lat, c.lng]], {
        color: token('connector'),
        weight: 1.4 * MV.uiScale,
        opacity: 0.7,
        dashArray: (5 * MV.uiScale) + ',' + (5 * MV.uiScale),
        renderer: MV._renderer,
        pane: 'linePane',
        interactive: false
      }).addTo(MV.map);
      MV._connectors.push(line);
    });
  }

  /* ---------------------------------------------------------- map furniture */

  MV.renderTitle = function () {
    document.getElementById('ovTitleMain').textContent =
      Store.state.title || 'Comparable Sales Map';
    var sub = document.getElementById('ovTitleSub');
    sub.textContent = Store.state.subtitle || '';
    sub.hidden = !Store.state.subtitle;
  };

  MV.renderLegend = function () {
    var s = Store.state.style;
    var tbody = document.getElementById('legendRows');
    var many = Store.state.subjects.length > 1;
    var rows = [];

    function cell(p, distance) {
      var swatch = '<td class="lg-key"><span class="lg-dot" style="background:' +
                   U.escapeHtml(colorFor(p)) + '">' +
                   U.escapeHtml(Store.keyFor(p)) +
                   '</span></td>';
      var fallback = p.role === 'subject'
        ? (many ? 'Subject ' + p.number : 'Subject')
        : 'Comparable ' + p.number;
      var main = (p.address || '').split(',')[0] || fallback;
      var extras = [];
      if (p.role === 'comp') {
        var money = U.formatMoney(p.fields.salePrice);
        var date = U.formatDate(p.fields.saleDate);
        if (money) extras.push(money);
        if (date) extras.push(date);
      }
      var detail = extras.length ? '<span class="lg-sub">' + U.escapeHtml(extras.join(' · ')) + '</span>' : '';
      var dist = (s.legendDistance && distance != null)
        ? '<td class="lg-dist">' + U.escapeHtml(distance) + '</td>' : '';
      return '<tr>' + swatch + '<td class="lg-name">' +
             U.escapeHtml(main) + detail + '</td>' + dist + '</tr>';
    }

    Store.state.subjects.forEach(function (sub) {
      if (sub.lat != null || sub.address) rows.push(cell(sub, null));
    });
    Store.state.comps.forEach(function (c) {
      var d = null;
      var near = s.legendDistance ? Store.nearestSubject(c) : null;
      if (near) {
        d = U.formatDistance(near.miles) + ' ' + U.bearingLabel(near.subject, c) +
            // With one subject the reference is obvious; with several it is not.
            (many ? ' of ' + Store.keyFor(near.subject) : '');
      }
      rows.push(cell(c, d));
    });

    tbody.innerHTML = rows.join('');
    document.querySelector('#ovLegend .legend-title').textContent = 'Legend';

    // A legend keys one symbol to another. With only the subject on the map
    // there is nothing to key, and it is just a floating box with a heading —
    // so it earns its place at the first comparable.
    document.getElementById('ovLegend').hidden = !s.showLegend || rows.length < 2;
  };

  /* ------------------------------------------------------------ interaction */

  MV.setMode = function (mode) {
    if (MV.mode === 'draw' && mode !== 'draw') MV.cancelDraw();
    MV.mode = mode;
    var frame = document.getElementById('mapFrame');
    frame.setAttribute('data-mode', mode);
    U.$$('#toolbar .tool[data-mode]').forEach(function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-mode') === mode);
    });
    MV.map.doubleClickZoom[mode === 'draw' ? 'disable' : 'enable']();
    MV._onStatus(MODE_HINTS[mode] || '');
    var hint = document.getElementById('modeHint');
    if (hint) hint.textContent = MODE_HINTS[mode] || '';
  };

  var MODE_HINTS = {
    pan: 'Drag a pin or label to move it · double-click a label to edit',
    parcel: 'Click a property to pull its parcel boundary',
    draw: 'Click each corner · Enter to finish · Esc to cancel',
    place: 'Click the map to place the pin'
  };

  MV.select = function (id) {
    MV.selectedId = id;
    Object.keys(MV._layers).forEach(function (pid) {
      var entry = MV._layers[pid];
      var p = Store.find(pid);
      if (entry && entry.pin && p) entry.pin.setIcon(pinIcon(p));
    });
    MV._onSelect(id);
  };

  MV.targetProperty = function () {
    return Store.find(MV.selectedId) || Store.primarySubject();
  };

  MV.onMapClick = function (e) {
    if (MV.mode === 'place') {
      var target = Store.find(MV.placeTargetId) || MV.targetProperty();
      Store.pushUndo();
      Store.setLocation(target.id, e.latlng.lat, e.latlng.lng, target.geocode, true);
      MV._onStatus((target.role === 'subject' ? 'Subject' : 'Comparable ' + target.number) +
                   ' placed at ' + U.formatLatLng(e.latlng.lat, e.latlng.lng));
      MV.placeTargetId = null;
      MV.setMode('pan');
      return;
    }

    if (MV.mode === 'parcel') {
      MV.pickParcel(e.latlng);
      return;
    }

    if (MV.mode === 'draw') {
      MV.addDrawPoint(e.latlng);
    }
  };

  MV.onMapDblClick = function (e) {
    if (MV.mode === 'draw') {
      L.DomEvent.stop(e);
      MV.finishDraw();
    }
  };

  /* --------------------------------------------------------- parcel picking */

  MV.pickParcel = function (latlng) {
    var svc = Store.state.parcelService.url;
    if (!svc) {
      MV._onStatus('No parcel service selected — choose one under Map → Parcels, ' +
                   'or use Draw boundary to trace it by hand.', 'warn');
      return;
    }
    var target = MV.targetProperty();
    MV._onStatus('Looking up parcel…');

    CMG.parcels.queryAtPoint(svc, latlng.lat, latlng.lng)
      .then(function (hit) {
        if (!hit) {
          MV._onStatus('No parcel found at that point in the selected service.', 'warn');
          return;
        }
        Store.pushUndo();
        target.parcel = hit;
        if (target.lat == null && hit.centroid) {
          target.lat = hit.centroid.lat;
          target.lng = hit.centroid.lng;
          target.pinned = true;
        }
        if (!target.address && hit.address) {
          target.address = hit.address;
          if (!target.labelCustom) Store.refreshLabel(target);
        }
        Store.emit('properties');
        MV._onParcelAssigned(target, hit);
        MV._onStatus('Parcel attached to ' +
          (target.role === 'subject' ? 'the subject' : 'comparable ' + target.number) +
          (hit.apn ? ' (APN ' + hit.apn + ')' : '') + '.', 'ok');
      })
      .catch(function (err) {
        MV._onStatus('Parcel lookup failed: ' + err.message, 'error');
      });
  };

  MV.snapToParcelCentre = function (id) {
    var p = Store.find(id);
    if (!p || !p.parcel) return false;
    var c = p.parcel.centroid || U.polygonCentroid(p.parcel.geometry);
    if (!c) return false;
    Store.pushUndo();
    Store.setLocation(id, c.lat, c.lng, p.geocode, true);
    return true;
  };

  /* ------------------------------------------------------------ hand drawing */

  MV.startDraw = function (targetId) {
    MV.cancelDraw();
    MV._draw = {
      targetId: targetId || MV.targetProperty().id,
      points: [],
      line: L.polyline([], {
        color: colorFor(Store.find(targetId || MV.targetProperty().id) || Store.primarySubject()),
        weight: 3, dashArray: '6,5',
        renderer: MV._renderer, pane: 'parcelPane', interactive: false
      }).addTo(MV.map),
      vertices: L.layerGroup().addTo(MV.map)
    };
    MV.setMode('draw');
  };

  MV.addDrawPoint = function (latlng) {
    if (!MV._draw) MV.startDraw();
    MV._draw.points.push(latlng);
    MV._draw.line.setLatLngs(MV._draw.points.concat(
      MV._draw.points.length > 2 ? [MV._draw.points[0]] : []));
    L.circleMarker(latlng, {
      radius: 4, color: token('pinStroke'), weight: 2,
      fillColor: colorFor(Store.find(MV._draw.targetId) || Store.primarySubject()),
      fillOpacity: 1, renderer: MV._renderer, pane: 'parcelPane', interactive: false
    }).addTo(MV._draw.vertices);
  };

  MV.undoDrawPoint = function () {
    if (!MV._draw || !MV._draw.points.length) return;
    MV._draw.points.pop();
    MV._draw.vertices.clearLayers();
    MV._draw.points.forEach(function (ll) {
      L.circleMarker(ll, {
        radius: 4, color: token('pinStroke'), weight: 2,
        fillColor: colorFor(Store.find(MV._draw.targetId) || Store.primarySubject()),
        fillOpacity: 1, renderer: MV._renderer, pane: 'parcelPane', interactive: false
      }).addTo(MV._draw.vertices);
    });
    MV._draw.line.setLatLngs(MV._draw.points.concat(
      MV._draw.points.length > 2 ? [MV._draw.points[0]] : []));
  };

  MV.finishDraw = function () {
    if (!MV._draw) return;
    var pts = MV._draw.points.slice();
    var targetId = MV._draw.targetId;
    MV.cancelDraw();

    if (pts.length < 3) {
      MV._onStatus('A boundary needs at least three points.', 'warn');
      MV.setMode('pan');
      return;
    }
    var parcel = CMG.parcels.fromDrawnPoints(pts);
    var target = Store.find(targetId) || Store.primarySubject();
    Store.pushUndo();
    target.parcel = parcel;
    if (target.lat == null && parcel.centroid) {
      target.lat = parcel.centroid.lat;
      target.lng = parcel.centroid.lng;
      target.pinned = true;
    }
    Store.emit('properties');
    MV.setMode('pan');
    MV._onStatus('Boundary traced for ' +
      (target.role === 'subject' ? 'the subject' : 'comparable ' + target.number) + '.', 'ok');
  };

  MV.cancelDraw = function () {
    if (!MV._draw) return;
    MV.map.removeLayer(MV._draw.line);
    MV.map.removeLayer(MV._draw.vertices);
    MV._draw = null;
  };

  MV.isDrawing = function () { return !!MV._draw; };


  /* ---------------------------------------------------------------- auto-fit

     This map exists to show where the comparables sit relative to the subject,
     so by default every pin stays on screen: the view refits when the set of
     properties changes, and pulls back if navigation takes one out of frame.
     Small adjustments are left alone — it only acts once something has
     actually left the picture, so it never fights an ordinary nudge. */

  MV.suspendAutoFit = false;

  /* Room left around the content, in screen pixels: enough for a label stack
     above and below the outermost pins. Split for fitBounds, summed for
     getBoundsZoom, so the fit and the check always agree. */
  var FIT_PAD_TL = [100, 130];
  var FIT_PAD_BR = [100, 150];
  var LONE_PIN_ZOOM = 17;

  /** Bounds covering every located pin and any parcel drawn. */
  MV.contentBounds = function () {
    var pts = Store.located().map(function (p) { return [p.lat, p.lng]; });
    Store.all().forEach(function (p) {
      if (!p.parcel || !p.parcel.geometry) return;
      U.outerRings(p.parcel.geometry).forEach(function (ring) {
        ring.forEach(function (c) { pts.push([c[1], c[0]]); });
      });
    });
    return pts.length ? L.latLngBounds(pts) : null;
  };

  /** Is everything inside the view, allowing for the label margin? */
  MV.allInView = function () {
    var content = MV.contentBounds();
    if (!content) return true;
    return MV.map.getBounds().pad(-0.10).contains(content);
  };

  /** The zoom a fit would settle on right now. */
  MV.fitZoom = function () {
    var content = MV.contentBounds();
    if (!content) return null;
    if (Store.located().length < 2) return LONE_PIN_ZOOM;
    var pad = L.point(FIT_PAD_TL[0] + FIT_PAD_BR[0], FIT_PAD_TL[1] + FIT_PAD_BR[1]);
    return MV.map.getBoundsZoom(content, false, pad);
  };

  MV.autoFitEnabled = function () {
    return Store.state.style.autoFit !== false;
  };

  /**
   * Refit when the framing no longer shows the relationship well. Two ways it
   * can go wrong, and both matter: something has drifted off the edge, or the
   * view is far looser than a fit would be — pins clustered in the middle of an
   * empty frame is just as useless as pins off the side.
   */
  MV.maybeAutoFit = function () {
    if (MV.suspendAutoFit || !MV.autoFitEnabled()) return false;
    if (!Store.located().length) return false;

    var want = MV.fitZoom();
    var loose = want != null && Math.abs(want - MV.map.getZoom()) > 0.35;
    if (MV.allInView() && !loose) return false;

    MV.fitAll();
    return true;
  };

  /** Turn auto-fit off because the user asked for a view it would undo. */
  MV.releaseAutoFit = function (why) {
    if (!MV.autoFitEnabled()) return false;
    Store.setStyle({ autoFit: false });
    MV._onStatus((why || 'Free navigation on') +
                 ' — "Keep all pins in view" switched off.', 'warn');
    return true;
  };

  /* ---------------------------------------------------------------- framing */

  MV.fitAll = function () {
    var pts = Store.located().map(function (p) { return [p.lat, p.lng]; });
    Store.all().forEach(function (p) {
      if (!p.parcel || !p.parcel.geometry) return;
      U.outerRings(p.parcel.geometry).forEach(function (ring) {
        ring.forEach(function (c) { pts.push([c[1], c[0]]); });
      });
    });
    if (!pts.length) return false;
    if (pts.length === 1) {
      MV.map.setView(pts[0], LONE_PIN_ZOOM, { animate: false });
      return true;
    }
    // Extra top/left room so labels, title and legend are not clipped.
    MV.map.fitBounds(L.latLngBounds(pts), {
      paddingTopLeft: FIT_PAD_TL,
      paddingBottomRight: FIT_PAD_BR,
      animate: false
    });
    return true;
  };

  /** Frame the subject — or, on a portfolio map, all of them together. */
  MV.fitSubject = function () {
    var pts = Store.state.subjects
      .filter(function (s) { return s.lat != null; })
      .map(function (s) { return [s.lat, s.lng]; });
    if (!pts.length) return false;

    MV.releaseAutoFit(pts.length > 1 ? 'Centred on the subjects' : 'Centred on the subject');
    if (pts.length === 1) {
      MV.map.setView(pts[0], Math.max(MV.map.getZoom(), 17), { animate: false });
    } else {
      MV.map.fitBounds(L.latLngBounds(pts), {
        paddingTopLeft: FIT_PAD_TL, paddingBottomRight: FIT_PAD_BR, animate: false
      });
    }
    return true;
  };

  MV.panTo = function (id) {
    var p = Store.find(id);
    if (!p || p.lat == null) return false;
    if (!MV.allInView()) MV.releaseAutoFit('Moved to one property');
    MV.map.panTo([p.lat, p.lng], { animate: true });
    return true;
  };

  CMG.mapview = MV;
})(window.CMG);
