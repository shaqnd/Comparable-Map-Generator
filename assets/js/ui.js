/* Sidebar, toolbar, dialogs — everything the appraiser touches. */
(function (CMG) {
  'use strict';

  var U = CMG.util;
  var $ = U.$, $$ = U.$$;
  var Store = CMG.store;

  var UI = {
    expanded: {},        // property id -> detail panel open
    busy: {},            // property id -> geocoding in flight
    suppressCards: false // set while typing so the card list is not rebuilt
  };

  /* ------------------------------------------------------------------ toast */

  UI.toast = function (msg, kind, ms) {
    var host = $('#toastHost');
    var el = document.createElement('div');
    el.className = 'toast toast-' + (kind || 'info');
    el.textContent = msg;
    host.appendChild(el);
    setTimeout(function () { el.classList.add('is-out'); }, ms || 4200);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, (ms || 4200) + 400);
  };

  UI.status = function (msg, kind) {
    var el = $('#statusText');
    el.textContent = msg || 'Ready';
    el.className = kind ? 'status-' + kind : '';
    if (kind === 'error' || kind === 'warn') UI.toast(msg, kind, 6000);
  };

  /* ------------------------------------------------------------------ modal */

  UI.openModal = function (title, bodyHtml, wire) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = bodyHtml;
    $('#modalHost').hidden = false;
    if (wire) wire($('#modalBody'));
  };

  UI.closeModal = function () {
    $('#modalHost').hidden = true;
    $('#modalBody').innerHTML = '';
  };

  /* ------------------------------------------------------- property cards */

  function badge(p) {
    var color = CMG.theme.colorFor(p);
    var text = p.role === 'subject' ? 'S' : String(p.number);
    return '<span class="prop-badge" style="background:' + U.escapeHtml(color) + '">' +
           U.escapeHtml(text) + '</span>';
  }

  function locationBadge(p) {
    if (UI.busy[p.id]) {
      return '<span class="loc loc-busy"><span class="mini-spin"></span>Locating…</span>';
    }
    if (p.lat == null) {
      return '<span class="loc loc-none">Not located</span>';
    }
    var bits = [];
    if (p.pinned) {
      bits.push('<span class="loc loc-ok">Hand-placed</span>');
    } else if (p.geocode) {
      var g = p.geocode;
      var weak = g.score < CMG.CONFIDENCE_WARN || g.precision === 'approximate' ||
                 g.precision === 'street';
      bits.push('<span class="loc ' + (weak ? 'loc-warn' : 'loc-ok') + '">' +
        U.escapeHtml(g.providerName || g.provider) + ' · ' +
        U.escapeHtml(CMG.geocode.PRECISION_LABEL[g.precision] || g.precision) +
        ' · ' + g.score + '%' +
        (g.agreement > 1 ? ' · ' + g.agreement + ' sources agree' : '') +
        '</span>');
      if (g.matchedAddress && g.matchedAddress !== p.address) {
        bits.push('<span class="loc-matched" title="Address as matched by the geocoder">' +
                  U.escapeHtml(g.matchedAddress) + '</span>');
      }
      if (g.spreadFeet != null && g.spreadFeet > 150) {
        bits.push('<span class="loc loc-warn">Providers differ by ' + g.spreadFeet + ' ft — verify</span>');
      }
      if (p.lat != null && !CMG.geocode.inRegion(p.lat, p.lng)) {
        bits.push('<span class="loc loc-warn">Outside ' +
          U.escapeHtml(CMG.REGION.name) + '</span>');
      }
    } else {
      bits.push('<span class="loc loc-ok">Located</span>');
    }
    if (p.parcel) {
      bits.push('<span class="loc loc-parcel">Parcel' +
                (p.parcel.apn ? ' ' + U.escapeHtml(p.parcel.apn) : '') +
                (p.parcel.source === 'drawn' ? ' (traced)' : '') + '</span>');
    }
    return bits.join('');
  }

  function distanceNote(p) {
    var s = Store.state.subject;
    if (p.role !== 'comp' || s.lat == null || p.lat == null) return '';
    var d = U.distanceMiles(s, p);
    return '<span class="loc loc-dist">' + U.formatDistance(d) + ' ' +
           U.bearingLabel(s, p) + ' of subject</span>';
  }

  function cardHtml(p) {
    var open = !!UI.expanded[p.id];
    var isComp = p.role === 'comp';
    var f = p.fields;

    return '' +
    '<div class="prop-card' + (CMG.mapview.selectedId === p.id ? ' is-selected' : '') +
         '" data-id="' + p.id + '">' +
      '<div class="prop-head">' +
        badge(p) +
        '<input class="prop-address" data-field="address" type="text" ' +
               'placeholder="' + (isComp ? 'Comparable address' : 'Subject address') + '" ' +
               'value="' + U.escapeHtml(p.address) + '" ' +
               'autocomplete="off" spellcheck="false">' +
        '<button class="icon-btn" data-act="geocode" title="Find this address">Find</button>' +
        '<button class="icon-btn" data-act="toggle" title="More" aria-expanded="' + open + '">' +
          (open ? '▴' : '▾') + '</button>' +
      '</div>' +
      '<div class="prop-meta">' + locationBadge(p) + distanceNote(p) + '</div>' +
      (open ? detailHtml(p, f, isComp) : '') +
    '</div>';
  }

  function detailHtml(p, f, isComp) {
    return '' +
    '<div class="prop-detail">' +

      (isComp ?
      '<div class="grid2">' +
        field('Sale date', 'saleDate', f.saleDate, 'text', 'e.g. 3/14/2026') +
        field('Sale price', 'salePrice', f.salePrice, 'text', 'e.g. 1,250,000') +
      '</div>' +
      '<div class="grid2">' +
        field('Size', 'size', f.size, 'text', 'e.g. 0.42 ac') +
        field('Unit price', 'unitPrice', f.unitPrice, 'text', 'e.g. $68 / SF') +
      '</div>'
      :
      '<div class="grid2">' +
        field('Size', 'size', f.size, 'text', 'e.g. 1.10 ac') +
        field('Reference', 'unitPrice', f.unitPrice, 'text', 'optional') +
      '</div>') +

      field('Notes', 'notes', f.notes, 'text', 'shown on the map label') +

      '<label class="field"><span>Coordinates</span>' +
        '<input class="latlng" data-act="latlng" type="text" ' +
               'value="' + U.escapeHtml(p.lat == null ? '' : U.formatLatLng(p.lat, p.lng)) + '" ' +
               'placeholder="latitude, longitude"></label>' +

      '<label class="field label-field"><span>Map label ' +
        (p.labelCustom ? '<em class="tag">edited</em>' : '<em class="tag tag-auto">auto</em>') +
        '</span>' +
        '<textarea data-act="labelText" rows="4" ' +
          'placeholder="Text shown next to the pin">' + U.escapeHtml(p.labelText) + '</textarea>' +
      '</label>' +

      '<div class="btn-row wrap">' +
        '<button class="btn btn-sm" data-act="place">Place pin on map</button>' +
        '<button class="btn btn-sm" data-act="parcel">Select parcel</button>' +
        '<button class="btn btn-sm" data-act="draw">Trace boundary</button>' +
      '</div>' +
      '<div class="btn-row wrap">' +
        '<button class="btn btn-sm" data-act="zoom">Zoom to</button>' +
        (p.parcel ? '<button class="btn btn-sm" data-act="snap">Centre pin on parcel</button>' +
                    '<button class="btn btn-sm" data-act="clearParcel">Remove parcel</button>' : '') +
        (p.labelCustom ? '<button class="btn btn-sm" data-act="resetLabel">Reset label</button>' : '') +
        '<label class="check inline"><input type="checkbox" data-act="showLabel"' +
          (p.showLabel === false ? '' : ' checked') + '><span>Label</span></label>' +
        '<label class="check inline" title="Override this property\'s theme colour">' +
          '<input type="color" data-act="propColor" class="prop-color" value="' +
          U.escapeHtml(CMG.theme.colorFor(p)) + '">' +
          '<span>Colour</span></label>' +
        (p.color ? '<button class="btn btn-sm" data-act="clearColor">Use palette</button>' : '') +
      '</div>' +
      (isComp ?
      '<div class="btn-row wrap">' +
        '<button class="btn btn-sm" data-act="up">Move up</button>' +
        '<button class="btn btn-sm" data-act="down">Move down</button>' +
        '<button class="btn btn-sm btn-danger-ghost" data-act="remove">Remove</button>' +
      '</div>' : '') +
      (p.parcel && (p.parcel.owner || p.parcel.area) ?
        '<p class="hint parcel-info">' +
          (p.parcel.owner ? 'Owner: ' + U.escapeHtml(p.parcel.owner) + '<br>' : '') +
          (p.parcel.area ? 'Area (as published): ' + U.escapeHtml(p.parcel.area) : '') +
        '</p>' : '') +
    '</div>';
  }

  function field(label, name, value, type, placeholder) {
    return '<label class="field"><span>' + U.escapeHtml(label) + '</span>' +
      '<input type="' + type + '" data-fieldname="' + name + '" ' +
      'value="' + U.escapeHtml(value || '') + '" placeholder="' +
      U.escapeHtml(placeholder || '') + '"></label>';
  }

  UI.renderCards = function () {
    $('#subjectCard').innerHTML = cardHtml(Store.state.subject);
    $('#compList').innerHTML = Store.state.comps.map(cardHtml).join('') ||
      '<p class="empty">No comparables yet. Add one below, or paste a list of addresses.</p>';
    $('#compCount').textContent = String(Store.state.comps.length);
  };

  /* --------------------------------------------------------- card handlers */

  function cardProperty(node) {
    var card = node.closest('.prop-card');
    return card ? Store.find(card.getAttribute('data-id')) : null;
  }

  function onCardInput(ev) {
    var p = cardProperty(ev.target);
    if (!p) return;
    var t = ev.target;

    UI.suppressCards = true;
    try {
      if (t.classList.contains('prop-address')) {
        Store.update(p.id, { address: t.value });
      } else if (t.hasAttribute('data-fieldname')) {
        var patch = {};
        patch[t.getAttribute('data-fieldname')] = t.value;
        Store.update(p.id, { fields: patch });
      } else if (t.getAttribute('data-act') === 'labelText') {
        p.labelText = t.value;
        p.labelCustom = true;
        Store.emit('properties');
      }
    } finally {
      UI.suppressCards = false;
    }
  }

  function onCardChange(ev) {
    var p = cardProperty(ev.target);
    if (!p) return;
    var act = ev.target.getAttribute('data-act');

    if (act === 'latlng') {
      var parsed = U.parseLatLng(ev.target.value);
      if (!parsed) {
        if (ev.target.value.trim()) UI.status('Coordinates must look like 39.739200, -104.990300', 'warn');
        return;
      }
      Store.pushUndo();
      Store.setLocation(p.id, parsed.lat, parsed.lng, {
        provider: 'manual', providerName: 'Typed coordinates',
        score: 100, precision: 'rooftop', agreement: 1
      }, true);
      UI.status('Coordinates set for ' + describe(p) + '.', 'ok');
    }

    if (act === 'showLabel') {
      Store.update(p.id, { showLabel: ev.target.checked });
    }

    if (act === 'propColor') {
      Store.update(p.id, { color: ev.target.value });
    }
  }

  function onCardClick(ev) {
    var btn = ev.target.closest('[data-act]');
    if (!btn || btn.tagName === 'INPUT' || btn.tagName === 'TEXTAREA') {
      var card = ev.target.closest('.prop-card');
      if (card) CMG.mapview.select(card.getAttribute('data-id'));
      return;
    }
    var p = cardProperty(btn);
    if (!p) return;
    var act = btn.getAttribute('data-act');

    switch (act) {
      case 'toggle':
        UI.expanded[p.id] = !UI.expanded[p.id];
        UI.renderCards();
        break;

      case 'geocode':
        UI.geocodeProperty(p.id);
        break;

      case 'place':
        CMG.mapview.placeTargetId = p.id;
        CMG.mapview.select(p.id);
        CMG.mapview.setMode('place');
        UI.status('Click the map to place ' + describe(p) + '.');
        break;

      case 'parcel':
        CMG.mapview.select(p.id);
        CMG.mapview.setMode('parcel');
        UI.status('Click the property on the map to pull its parcel for ' + describe(p) + '.');
        break;

      case 'draw':
        CMG.mapview.select(p.id);
        CMG.mapview.startDraw(p.id);
        UI.status('Trace the boundary for ' + describe(p) + '. Double-click or Enter to finish.');
        break;

      case 'snap':
        if (CMG.mapview.snapToParcelCentre(p.id)) {
          UI.status('Pin centred on the parcel.', 'ok');
        }
        break;

      case 'clearColor':
        Store.update(p.id, { color: null });
        break;

      case 'clearParcel':
        Store.pushUndo();
        p.parcel = null;
        Store.emit('properties');
        break;

      case 'zoom':
        if (p.lat != null) {
          CMG.mapview.map.setView([p.lat, p.lng], Math.max(CMG.mapview.map.getZoom(), 18));
        } else {
          UI.status('That property has no location yet.', 'warn');
        }
        break;

      case 'resetLabel':
        Store.pushUndo();
        p.labelCustom = false;
        Store.refreshLabel(p);
        Store.emit('properties');
        break;

      case 'up': Store.moveComp(p.id, -1); break;
      case 'down': Store.moveComp(p.id, 1); break;

      case 'remove':
        Store.removeComp(p.id);
        UI.status('Comparable removed.');
        break;
    }
  }

  function describe(p) {
    return p.role === 'subject' ? 'the subject' : 'comparable ' + p.number;
  }

  /* -------------------------------------------------------------- geocoding */

  UI.geocodeProperty = function (id, silent) {
    var p = Store.find(id);
    if (!p) return Promise.resolve();
    var query = (p.address || '').trim();
    if (!query) {
      if (!silent) UI.status('Enter an address first.', 'warn');
      return Promise.resolve();
    }

    UI.busy[id] = true;
    UI.renderCards();

    return CMG.geocode.search(query).then(function (res) {
      UI.busy[id] = false;
      var list = res.candidates;
      if (!list.length) {
        UI.renderCards();
        UI.status('No match for "' + query + '". Check the address, or place the pin by hand.', 'warn');
        return;
      }

      var top = list[0];
      var ambiguous = list.length > 1 &&
        (top.score < CMG.CONFIDENCE_WARN ||
         top.precision === 'approximate' || top.precision === 'street' ||
         !top.inRegion ||
         (res.spreadFeet != null && res.spreadFeet > 300));

      if (ambiguous && !silent) {
        UI.renderCards();
        UI.pickCandidate(p, list, res.spreadFeet);
        return;
      }
      applyCandidate(p, top, res.spreadFeet);
      UI.status(describe(p) + ' located — ' + top.label, 'ok');
      if (p.role === 'subject') UI.autoPickCounty();
    }).catch(function (err) {
      UI.busy[id] = false;
      UI.renderCards();
      UI.status('Geocoding failed: ' + err.message, 'error');
    });
  };

  function applyCandidate(p, c, spreadFeet) {
    Store.pushUndo();
    Store.setLocation(p.id, c.lat, c.lng, {
      provider: c.provider,
      providerName: c.providerName,
      matchedAddress: c.label,
      score: c.score,
      precision: c.precision,
      agreement: c.agreement,
      spreadFeet: spreadFeet == null ? null : spreadFeet
    }, false);
  }

  /**
   * Geocode every property that has an address but no location yet, one at a
   * time so the free providers are not hammered. Used by the button and when a
   * project arrives carrying addresses only.
   * @returns {Promise<{located:number, missing:number}>}
   */
  UI.locateAllMissing = function () {
    var pending = Store.all().filter(function (p) {
      return (p.address || '').trim() && p.lat == null;
    });
    if (!pending.length) {
      UI.status('Every address already has a location.');
      return Promise.resolve({ located: 0, missing: 0 });
    }

    UI.status('Locating ' + pending.length +
              (pending.length === 1 ? ' address…' : ' addresses…'));

    var chain = Promise.resolve();
    pending.forEach(function (p) {
      chain = chain.then(function () { return UI.geocodeProperty(p.id, true); });
    });

    return chain.then(function () {
      var missing = pending.filter(function (p) {
        var cur = Store.find(p.id);
        return cur && cur.lat == null;
      }).length;
      CMG.mapview.fitAll();
      UI.status(missing
        ? (pending.length - missing) + ' of ' + pending.length + ' located — ' + missing +
          ' need a pin placed by hand.'
        : 'All ' + pending.length + ' addresses located. Check each pin on the aerial ' +
          'before exporting.',
        missing ? 'warn' : 'ok');
      return { located: pending.length - missing, missing: missing };
    });
  };

  UI.pickCandidate = function (p, list, spreadFeet) {
    var rows = list.map(function (c, i) {
      return '<button class="cand" data-i="' + i + '">' +
        '<span class="cand-label">' + U.escapeHtml(c.label) + '</span>' +
        '<span class="cand-meta">' +
          U.escapeHtml(c.providerName) + ' · ' +
          U.escapeHtml(CMG.geocode.PRECISION_LABEL[c.precision] || c.precision) +
          ' · confidence ' + c.score + '%' +
          (c.agreement > 1 ? ' · ' + c.agreement + ' sources agree' : '') +
          (c.inRegion ? '' : ' · <b>outside the covered counties</b>') +
        '</span>' +
        '<span class="cand-coord">' + U.formatLatLng(c.lat, c.lng) + '</span>' +
      '</button>';
    }).join('');

    var warn = (spreadFeet != null && spreadFeet > 150)
      ? '<p class="warn-line">The providers disagree by about ' + spreadFeet +
        ' ft. Pick the reading that matches the actual property, then confirm it ' +
        'on the aerial view.</p>' : '';

    UI.openModal('Confirm the location for ' + describe(p),
      '<p class="modal-lead">' + U.escapeHtml(p.address) + '</p>' + warn +
      '<div class="cand-list">' + rows + '</div>' +
      '<p class="hint">Nothing right? Close this and use <b>Place pin on map</b> to set it by hand.</p>',
      function (body) {
        $$('.cand', body).forEach(function (b) {
          b.addEventListener('click', function () {
            var c = list[Number(b.getAttribute('data-i'))];
            applyCandidate(p, c, spreadFeet);
            UI.closeModal();
            if (p.role === 'subject') UI.autoPickCounty();
            CMG.mapview.panTo(p.id);
            UI.status(describe(p) + ' set to ' + c.label, 'ok');
          });
        });
      });
  };

  /* ------------------------------------------------------------ style panel */

  function bindCheckbox(id, key, after) {
    var el = $('#' + id);
    el.checked = !!Store.state.style[key];
    el.addEventListener('change', function () {
      var patch = {}; patch[key] = el.checked;
      Store.setStyle(patch);
      if (after) after();
    });
  }

  function bindValue(id, key, transform, after) {
    var el = $('#' + id);
    el.value = Store.state.style[key];
    el.addEventListener('input', function () {
      var patch = {}; patch[key] = transform ? transform(el.value) : el.value;
      Store.setStyle(patch);
      if (after) after();
    });
  }

  UI.wireStylePanel = function () {
    /* basemaps */
    var chooser = $('#basemapChooser');
    chooser.innerHTML = CMG.BASEMAPS.map(function (b) {
      return '<button class="choice" data-id="' + b.id + '">' +
             '<strong>' + U.escapeHtml(b.name) + '</strong>' +
             '<em>' + U.escapeHtml(b.blurb) + '</em></button>';
    }).join('');

    function markBasemap() {
      $$('.choice', chooser).forEach(function (b) {
        b.classList.toggle('is-active', b.getAttribute('data-id') === Store.state.view.basemap);
      });
      var def = CMG.mapview.currentBasemapDef();
      $('#toggleLabelsOverlay').disabled = !def.supportsLabelOverlay;
    }

    chooser.addEventListener('click', function (ev) {
      var b = ev.target.closest('.choice');
      if (!b) return;
      CMG.mapview.setBasemap(b.getAttribute('data-id'), $('#toggleLabelsOverlay').checked);
      markBasemap();
    });

    $('#toggleLabelsOverlay').checked = !!Store.state.view.labelOverlay;
    $('#toggleLabelsOverlay').addEventListener('change', function () {
      CMG.mapview.setBasemap(Store.state.view.basemap, this.checked);
    });
    markBasemap();

    bindValue('basemapDim', 'basemapDim', Number, function () {
      $('#dimVal').textContent = Store.state.style.basemapDim + '%';
    });
    $('#dimVal').textContent = Store.state.style.basemapDim + '%';

    /* markers and labels — colours live on the Theme tab */
    bindValue('labelSize', 'labelSize', Number, function () {
      $('#labelSizeVal').textContent = Store.state.style.labelSize + ' px';
      CMG.mapview.updateLeaders();
    });
    $('#labelSizeVal').textContent = Store.state.style.labelSize + ' px';
    bindValue('pinScale', 'pinScale', Number, function () {
      $('#pinSizeVal').textContent = Store.state.style.pinScale + '%';
      CMG.mapview.updateLeaders();
    });
    $('#pinSizeVal').textContent = Store.state.style.pinScale + '%';

    bindCheckbox('toggleParcelFill', 'parcelFill', redraw);
    bindCheckbox('toggleLabels', 'showLabels', redraw);
    bindCheckbox('toggleLeaders', 'showLeaders', redraw);
    bindCheckbox('toggleConnectors', 'showConnectors', redraw);
    bindCheckbox('toggleTitle', 'showTitle');
    bindCheckbox('toggleLegend', 'showLegend');
    bindCheckbox('toggleLegendDist', 'legendDistance', redraw);
    bindCheckbox('toggleNorth', 'showNorth');
    bindCheckbox('toggleScale', 'showScale');

    var legendPos = $('#legendPos');
    legendPos.value = Store.state.style.legendPos;
    legendPos.addEventListener('change', function () {
      Store.setStyle({ legendPos: legendPos.value });
    });

    var rings = $('#radiusRings');
    rings.value = Store.state.style.radiusRings || '';
    rings.addEventListener('input', U.debounce(function () {
      Store.setStyle({ radiusRings: rings.value });
      redraw();
    }, 350));

    function redraw() { CMG.mapview.render(); }
  };


  /* ------------------------------------------------------------ theme panel */

  /** <input type="color"> only understands #rrggbb, so alpha is carried aside. */
  function splitColor(v) {
    var m = /^#([0-9a-f]{6})([0-9a-f]{2})$/i.exec(String(v || ''));
    if (m) return { hex: '#' + m[1], alpha: parseInt(m[2], 16) };
    if (/^#[0-9a-f]{6}$/i.test(String(v || ''))) return { hex: v, alpha: 255 };
    return { hex: '#ffffff', alpha: 255 };
  }

  function joinColor(hex, alpha) {
    if (alpha >= 255) return hex;
    return hex + ('0' + Math.round(alpha).toString(16)).slice(-2);
  }

  function tokenRow(t) {
    var theme = Store.state.theme;
    var raw = theme.tokens[t.key];

    if (t.kind === 'opacity') {
      return '<label class="field"><span>' + U.escapeHtml(t.label) +
        ' <b>' + Number(raw) + '%</b></span>' +
        '<input type="range" min="0" max="100" data-token="' + t.key + '" ' +
        'data-kind="opacity" value="' + Number(raw) + '"></label>';
    }

    var isAuto = raw === 'auto';
    var transparent = raw === 'transparent';
    var c = splitColor(isAuto || transparent
      ? CMG.theme.resolve(t.key, theme) : raw);

    return '<div class="token-row">' +
      '<span class="token-label">' + U.escapeHtml(t.label) + '</span>' +
      '<input type="color" class="token-swatch" data-token="' + t.key + '" ' +
        'value="' + c.hex + '"' + (isAuto || transparent ? ' disabled' : '') + '>' +
      '<input type="range" class="token-alpha" min="0" max="255" ' +
        'data-token-alpha="' + t.key + '" value="' + c.alpha + '" ' +
        'title="Opacity"' + (isAuto || transparent ? ' disabled' : '') + '>' +
      (t.auto
        ? '<label class="token-flag"><input type="checkbox" data-token-auto="' + t.key + '"' +
          (isAuto ? ' checked' : '') + '><span>Auto</span></label>'
        : (t.key === 'pinDisc'
            ? '<label class="token-flag"><input type="checkbox" data-token-none="' + t.key + '"' +
              (transparent ? ' checked' : '') + '><span>None</span></label>'
            : '<span class="token-flag"></span>')) +
    '</div>';
  }

  UI.renderThemePanel = function () {
    var theme = Store.state.theme;

    var sel = $('#themePreset');
    var lib = CMG.theme.library();
    sel.innerHTML =
      '<optgroup label="Built in">' +
        lib.filter(function (t) { return t.builtIn; }).map(function (t) {
          return '<option value="' + t.id + '">' + U.escapeHtml(t.name) + '</option>';
        }).join('') +
      '</optgroup>' +
      (lib.some(function (t) { return !t.builtIn; })
        ? '<optgroup label="Saved">' +
            lib.filter(function (t) { return !t.builtIn; }).map(function (t) {
              return '<option value="' + t.id + '">' + U.escapeHtml(t.name) + '</option>';
            }).join('') +
          '</optgroup>'
        : '');
    sel.value = theme.id;
    $('#themeName').value = theme.name;
    $('#themeDelete').disabled = !lib.some(function (t) {
      return t.id === theme.id && !t.builtIn;
    });

    $('#paletteCount').textContent = String(theme.palette.length);
    $('#paletteEditor').innerHTML = theme.palette.map(function (c, i) {
      return '<label class="pal-chip"><span>' + (i + 1) + '</span>' +
             '<input type="color" data-pal="' + i + '" value="' + U.escapeHtml(c) + '"></label>';
    }).join('');

    $('#tokenGroups').innerHTML = CMG.THEME_GROUPS.map(function (g) {
      var rows = CMG.THEME_TOKENS.filter(function (t) { return t.group === g; });
      if (!rows.length) return '';
      return '<div class="panel"><div class="panel-head"><h3>' + U.escapeHtml(g) +
             '</h3></div>' + rows.map(tokenRow).join('') + '</div>';
    }).join('');
  };

  UI.wireThemePanel = function () {
    UI.renderThemePanel();

    $('#themePreset').addEventListener('change', function () {
      var chosen = CMG.theme.library().filter(function (t) {
        return t.id === this.value;
      }.bind(this))[0];
      if (!chosen) return;
      Store.pushUndo();
      Store.setTheme(chosen);
      UI.renderThemePanel();
      UI.status('Theme set to ' + chosen.name + '.', 'ok');
    });

    $('#themeName').addEventListener('input', function () {
      Store.state.theme.name = this.value;
      Store.saveLocal();
    });

    /* One delegated handler for every swatch, slider and flag. */
    $('#tokenGroups').addEventListener('input', function (ev) {
      var t = ev.target;
      var key = t.getAttribute('data-token');

      if (key && t.getAttribute('data-kind') === 'opacity') {
        Store.setToken(key, Number(t.value));
        var out = t.closest('.field').querySelector('b');
        if (out) out.textContent = Number(t.value) + '%';
        return;
      }
      if (key) {
        var alpha = t.closest('.token-row').querySelector('[data-token-alpha]');
        Store.setToken(key, joinColor(t.value, alpha ? Number(alpha.value) : 255));
        return;
      }
      var alphaKey = t.getAttribute('data-token-alpha');
      if (alphaKey) {
        var sw = t.closest('.token-row').querySelector('[data-token]');
        Store.setToken(alphaKey, joinColor(sw.value, Number(t.value)));
      }
    });

    $('#tokenGroups').addEventListener('change', function (ev) {
      var autoKey = ev.target.getAttribute('data-token-auto');
      var noneKey = ev.target.getAttribute('data-token-none');
      if (autoKey) {
        Store.setToken(autoKey, ev.target.checked
          ? 'auto'
          : CMG.theme.resolve(autoKey, Store.state.theme));
        UI.renderThemePanel();
      }
      if (noneKey) {
        Store.setToken(noneKey, ev.target.checked ? 'transparent' : '#ffffff');
        UI.renderThemePanel();
      }
    });

    $('#paletteEditor').addEventListener('input', function (ev) {
      var i = ev.target.getAttribute('data-pal');
      if (i == null) return;
      var pal = Store.state.theme.palette.slice();
      pal[Number(i)] = ev.target.value;
      Store.setPalette(pal);
    });

    $('#paletteAdd').addEventListener('click', function () {
      var pal = Store.state.theme.palette.slice();
      pal.push(pal[pal.length - 1] || '#1a56db');
      Store.setPalette(pal);
      UI.renderThemePanel();
    });

    $('#paletteRemove').addEventListener('click', function () {
      var pal = Store.state.theme.palette.slice();
      if (pal.length <= 1) { UI.status('A palette needs at least one colour.', 'warn'); return; }
      pal.pop();
      Store.setPalette(pal);
      UI.renderThemePanel();
    });

    $('#themeSave').addEventListener('click', function () {
      // saveToLibrary forks off a built-in; adopt whatever id it settled on.
      var saved = CMG.theme.saveToLibrary(Store.state.theme);
      Store.setTheme(saved);
      UI.renderThemePanel();
      UI.status('Theme "' + saved.name + '" saved to this browser.', 'ok');
    });

    $('#themeSaveNew').addEventListener('click', function () {
      var name = window.prompt('Name for the new theme',
                               Store.state.theme.name + ' copy');
      if (!name) return;
      var copy = CMG.theme.normalise(JSON.parse(JSON.stringify(Store.state.theme)));
      copy.id = U.uid('theme');
      copy.name = name;
      copy.builtIn = false;
      CMG.theme.saveToLibrary(copy);
      Store.setTheme(copy);
      UI.renderThemePanel();
      UI.status('Theme "' + name + '" saved.', 'ok');
    });

    $('#themeDelete').addEventListener('click', function () {
      var t = Store.state.theme;
      if (!window.confirm('Delete the theme "' + t.name + '"? The map keeps its colours.')) return;
      CMG.theme.removeFromLibrary(t.id);
      UI.renderThemePanel();
      UI.status('Theme deleted from the library.');
    });

    $('#themeReset').addEventListener('click', function () {
      Store.pushUndo();
      Store.setTheme(CMG.theme.preset('classic'));
      UI.renderThemePanel();
      UI.status('Reset to the Classic appraisal theme.');
    });

    $('#themeExport').addEventListener('click', function () {
      U.downloadBlob(CMG.theme.toFile(Store.state.theme),
                     U.slugify(Store.state.theme.name) + '.cmtheme.json');
    });

    $('#themeImport').addEventListener('click', function () { $('#themeImportInput').click(); });

    $('#themeImportInput').addEventListener('change', function () {
      var file = this.files && this.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var t = CMG.theme.normalise(JSON.parse(String(reader.result)));
          t.builtIn = false;
          CMG.theme.saveToLibrary(t);
          Store.setTheme(t);
          UI.renderThemePanel();
          UI.status('Theme "' + t.name + '" imported.', 'ok');
        } catch (err) {
          UI.status('That file is not a theme: ' + err.message, 'error');
        }
      };
      reader.readAsText(file);
      this.value = '';
    });
  };

  /* ----------------------------------------------------------- parcel panel */

  UI.refreshParcelPresets = function () {
    var sel = $('#parcelPreset');
    var presets = CMG.parcels.loadPresets();

    // Grouped by region so a 23-county list stays scannable.
    var groups = [''].concat(CMG.COUNTY_GROUPS).concat(['Saved']);
    sel.innerHTML = groups.map(function (g) {
      var rows = presets.filter(function (p) { return (p.group || '') === g; });
      if (!rows.length) return '';
      var opts = rows.map(function (p) {
        return '<option value="' + U.escapeHtml(p.id) + '">' + U.escapeHtml(p.name) + '</option>';
      }).join('');
      return g ? '<optgroup label="' + U.escapeHtml(g) + '">' + opts + '</optgroup>' : opts;
    }).join('');
    sel.value = Store.state.parcelService.presetId || 'none';
    if (!sel.value) sel.value = 'custom';
    $('#parcelUrl').value = Store.state.parcelService.url || '';
    UI.syncParcelUrlVisibility();
  };

  UI.syncParcelUrlVisibility = function () {
    var isNone = $('#parcelPreset').value === 'none';
    $('#parcelUrlField').style.display = isNone ? 'none' : '';
  };

  UI.wireParcelPanel = function () {
    UI.refreshParcelPresets();

    $('#parcelPreset').addEventListener('change', function () {
      var presets = CMG.parcels.loadPresets();
      var chosen = presets.filter(function (p) { return p.id === this.value; }.bind(this))[0];
      Store.state.parcelService.presetId = this.value;
      if (chosen && chosen.id !== 'custom') {
        Store.state.parcelService.url = chosen.url;
        $('#parcelUrl').value = chosen.url;
      }
      UI.syncParcelUrlVisibility();
      Store.saveLocal();
      $('#parcelStatus').innerHTML = '';
    });

    $('#parcelUrl').addEventListener('input', function () {
      Store.state.parcelService.url = this.value.trim();
      Store.state.parcelService.presetId = 'custom';
      Store.saveLocal();
    });

    $('#testParcel').addEventListener('click', function () {
      var url = $('#parcelUrl').value.trim();
      var out = $('#parcelStatus');
      if (!url) { out.innerHTML = '<span class="bad">Enter a layer URL first.</span>'; return; }
      out.innerHTML = '<span class="mini-spin"></span> Testing…';

      CMG.parcels.describe(url).then(function (info) {
        var H = CMG.PARCEL_FIELD_HINTS;
        function detected(hints) {
          var up = info.fields.map(function (f) { return f.toUpperCase(); });
          for (var i = 0; i < hints.length; i++) {
            var idx = up.indexOf(hints[i].toUpperCase());
            if (idx >= 0) return info.fields[idx];
          }
          return null;
        }
        var lines = [
          '<span class="' + (info.isPolygon ? 'good' : 'bad') + '">' +
            (info.isPolygon ? '✓ Reachable' : '✗ Not a polygon layer') + '</span>',
          '<b>' + U.escapeHtml(info.name) + '</b> · ' + info.fields.length + ' fields'
        ];
        var addr = detected(H.address), apn = detected(H.apn);
        lines.push('Address field: ' + (addr ? '<b>' + U.escapeHtml(addr) + '</b>' : '<i>not detected</i>'));
        lines.push('Parcel ID field: ' + (apn ? '<b>' + U.escapeHtml(apn) + '</b>' : '<i>not detected</i>'));
        if (!info.isPolygon) {
          lines.push('<span class="bad">This layer holds ' + U.escapeHtml(info.geometryType) +
                     ' features. Parcel boundaries need a polygon layer.</span>');
        }
        out.innerHTML = lines.join('<br>');
      }).catch(function (err) {
        out.innerHTML = '<span class="bad">✗ ' + U.escapeHtml(err.message) + '</span><br>' +
          '<span class="hint">County endpoints change. Search your county GIS open-data ' +
          'site for a Parcels FeatureServer layer and paste its URL here.</span>';
      });
    });

    $('#saveParcelPreset').addEventListener('click', function () {
      var url = $('#parcelUrl').value.trim();
      if (!url) { UI.status('Enter a layer URL first.', 'warn'); return; }
      var name = window.prompt('Name this parcel service (e.g. "Adams County, CO")', '');
      if (!name) return;
      CMG.parcels.savePreset(name.trim(), url);
      UI.refreshParcelPresets();
      UI.status('Preset saved to this browser.', 'ok');
    });
  };


  /* --------------------------------------------------- county registry UI */

  function registryRow(r) {
    return '<div class="reg-row' + (r.ok ? ' is-ok' : ' is-bad') + '" data-county="' + r.id + '">' +
      '<span class="reg-mark">' + (r.ok ? '✓' : '✗') + '</span>' +
      '<span class="reg-name">' + U.escapeHtml(r.name) + '</span>' +
      '<span class="reg-note">' + U.escapeHtml(r.ok ? (r.layerName || 'polygon layer')
                                                    : (r.error || 'unreachable')) + '</span>' +
      (r.ok ? '' : '<button class="btn btn-sm" data-fix="' + r.id + '">Fix URL</button>') +
    '</div>';
  }

  UI.wireCountyRegistry = function () {
    var out = $('#registryResults');
    $('#countyCount').textContent = String(CMG.COUNTIES.length);

    $('#testAllCounties').addEventListener('click', function () {
      var btn = this;
      btn.disabled = true;
      var done = 0, total = CMG.COUNTIES.length;
      out.innerHTML = '<p class="hint"><span class="mini-spin"></span> Testing 0 of ' +
                      total + '…</p>';
      var rows = [];

      CMG.parcels.testAll(function (r) {
        done += 1;
        rows.push(r);
        rows.sort(function (a, b) {
          if (a.ok !== b.ok) return a.ok ? 1 : -1;   // failures first, they need work
          return a.name.localeCompare(b.name);
        });
        out.innerHTML = '<p class="hint">' +
          (done < total ? '<span class="mini-spin"></span> Testing ' + done + ' of ' + total + '…'
                        : rows.filter(function (x) { return x.ok; }).length + ' of ' + total +
                          ' counties reachable') + '</p>' +
          rows.map(registryRow).join('');
      }).then(function (all) {
        btn.disabled = false;
        var ok = all.filter(function (r) { return r.ok; }).length;
        UI.refreshParcelPresets();
        UI.status(ok + ' of ' + all.length + ' county parcel services answered. ' +
          (ok < all.length ? 'Fix the rest inline, then export to share.' :
                             'Export the file to share with the office.'),
          ok === all.length ? 'ok' : 'warn');
      });
    });

    out.addEventListener('click', function (ev) {
      var id = ev.target.getAttribute && ev.target.getAttribute('data-fix');
      if (!id) return;
      var county = CMG.parcels.county(id);
      var url = window.prompt(
        'ArcGIS parcel layer URL for ' + county.name + ' County\n\n' +
        'Find it on the county GIS or open-data site; it ends in a layer number.',
        county.url || '');
      if (url == null) return;
      CMG.parcels.setCounty(id, { url: url.trim(), verified: false });
      UI.refreshParcelPresets();
      CMG.parcels.describe(url.trim()).then(function (info) {
        CMG.parcels.setCounty(id, {
          verified: info.isPolygon, layerName: info.name,
          checkedAt: new Date().toISOString()
        });
        UI.refreshParcelPresets();
        UI.status(county.name + ': ' + (info.isPolygon ? 'reachable — ' + info.name
                                                       : 'not a polygon layer'),
                  info.isPolygon ? 'ok' : 'warn');
      }).catch(function (e) {
        UI.status(county.name + ': ' + e.message, 'error');
      });
    });

    $('#exportRegistry').addEventListener('click', function () {
      U.downloadBlob(CMG.parcels.exportRegistry(), 'colorado-county-parcels.json');
      UI.status('County registry exported — share it with the office.', 'ok');
    });

    $('#importRegistry').addEventListener('click', function () { $('#importRegistryInput').click(); });

    $('#importRegistryInput').addEventListener('change', function () {
      var file = this.files && this.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var n = CMG.parcels.importRegistry(String(reader.result));
          UI.refreshParcelPresets();
          UI.status(n + ' counties imported.', 'ok');
        } catch (err) {
          UI.status('Could not read that registry: ' + err.message, 'error');
        }
      };
      reader.readAsText(file);
      this.value = '';
    });
  };

  /**
   * Point the parcel service at whichever county the subject sits in. Silent
   * on failure — it is a convenience, and the manual picker is right there.
   */
  UI.autoPickCounty = function () {
    if (!$('#autoCounty') || !$('#autoCounty').checked) return Promise.resolve(null);
    var s = Store.state.subject;
    if (s.lat == null) return Promise.resolve(null);

    return CMG.parcels.countyAt(s.lat, s.lng).then(function (name) {
      var match = CMG.parcels.matchCounty(name);
      if (!match) {
        if (name) {
          UI.status('Subject is in ' + name + ' County, which is outside the ' +
                    CMG.REGION.name + ' coverage. Pick a service by hand if you have one.', 'warn');
        }
        return null;
      }
      if (Store.state.parcelService.presetId === match.id) return match;
      Store.state.parcelService = { presetId: match.id, url: match.url };
      Store.saveLocal();
      UI.refreshParcelPresets();
      UI.status('Parcel service set to ' + match.name + ' County.', 'ok');
      return match;
    });
  };

  /* ----------------------------------------------------------- export panel */

  UI.wireExportPanel = function () {
    var sel = $('#exportPreset');
    sel.innerHTML = CMG.EXPORT_PRESETS.map(function (p) {
      return '<option value="' + p.id + '">' + U.escapeHtml(p.name) + '</option>';
    }).join('');

    var cfg = Store.state.exportCfg;
    sel.value = cfg.presetId;
    $('#exportW').value = cfg.w;
    $('#exportH').value = cfg.h;
    $('#exportDpi').value = String(cfg.dpi);
    $('#exportName').value = Store.state.exportName || '';

    sel.addEventListener('change', function () {
      var preset = CMG.EXPORT_PRESETS.filter(function (p) { return p.id === sel.value; })[0];
      cfg.presetId = sel.value;
      if (preset && preset.w) {
        cfg.w = preset.w;
        cfg.h = preset.h;
        $('#exportW').value = preset.w;
        $('#exportH').value = preset.h;
      }
      UI.applyFrameSize();
    });

    ['exportW', 'exportH'].forEach(function (id) {
      $('#' + id).addEventListener('input', function () {
        var v = parseFloat(this.value);
        if (!isFinite(v) || v <= 0) return;
        cfg[id === 'exportW' ? 'w' : 'h'] = v;
        cfg.presetId = 'custom';
        sel.value = 'custom';
        UI.applyFrameSize();
      });
    });

    $('#exportDpi').addEventListener('change', function () {
      cfg.dpi = Number(this.value);
      UI.updateExportReadout();
      Store.saveLocal();
    });

    $('#exportName').addEventListener('input', function () {
      Store.state.exportName = this.value;
      Store.saveLocal();
    });

    $('#exportPng').addEventListener('click', function () { runExport('png'); });
    $('#exportJpg').addEventListener('click', function () { runExport('jpg'); });
    $('#exportClip').addEventListener('click', function () { runExport('clip'); });

    $('#fitAll').addEventListener('click', function () { CMG.mapview.fitAll(); });
    $('#fitSubject').addEventListener('click', function () { CMG.mapview.fitSubject(); });

    UI.updateExportReadout();
  };

  function runExport(kind) {
    var curtain = $('#exportCurtain');
    var msg = $('#curtainMsg');
    curtain.hidden = false;
    function progress(t) { msg.textContent = t; }

    var job = kind === 'png' ? CMG.exporter.downloadPNG(progress)
            : kind === 'jpg' ? CMG.exporter.downloadJPG(progress)
            : CMG.exporter.copyToClipboard(progress);

    job.then(function () {
      curtain.hidden = true;
      UI.status(kind === 'clip'
        ? 'Map copied — paste into your report with Ctrl+V.'
        : 'Image downloaded.', 'ok');
      UI.toast(kind === 'clip' ? 'Copied to clipboard' : 'Saved to your Downloads folder', 'ok');
    }).catch(function (err) {
      curtain.hidden = true;
      UI.status('Export failed: ' + err.message, 'error');
    });
  }

  UI.updateExportReadout = function () {
    var px = CMG.exporter.targetPixels();
    var cfg = Store.state.exportCfg;
    $('#exportReadout').innerHTML =
      '<b>' + px.w + ' × ' + px.h + ' px</b> at ' + cfg.dpi + ' DPI<br>' +
      'prints at ' + cfg.w + ' × ' + cfg.h + ' in' +
      (px.clamped ? '<br><span class="bad">Reduced to stay within browser limits.</span>' : '');
  };

  /** Sizes the map frame to the exact output aspect ratio — WYSIWYG. */
  UI.applyFrameSize = function () {
    var cfg = Store.state.exportCfg;
    var area = $('#canvasArea');
    var frame = $('#mapFrame');
    var pad = 28;
    var availW = Math.max(200, area.clientWidth - pad);
    var availH = Math.max(160, area.clientHeight - pad);
    var ar = cfg.w / cfg.h;

    var w = availW, h = w / ar;
    if (h > availH) { h = availH; w = h * ar; }

    frame.style.width = Math.round(w) + 'px';
    frame.style.height = Math.round(h) + 'px';

    if (CMG.mapview.map) {
      // invalidateSize with pan:false keeps the top-left corner fixed, not the
      // centre, so every resize would walk the view sideways by half the size
      // change. Put the centre back explicitly.
      var map = CMG.mapview.map;
      var centre = map.getCenter();
      var zoom = map.getZoom();
      map.invalidateSize({ animate: false, pan: false });
      map.setView(centre, zoom, { animate: false });
      CMG.mapview.autoPlaceLabels();
      CMG.mapview.updateLeaders();
    }
    UI.updateExportReadout();
    Store.saveLocal();
  };

  /* ---------------------------------------------------------- project panel */

  UI.wireProjectPanel = function () {
    var title = $('#mapTitle'), sub = $('#mapSubtitle');
    title.value = Store.state.title || '';
    sub.value = Store.state.subtitle || '';

    title.addEventListener('input', function () {
      Store.state.title = this.value;
      $('#projectNameDisplay').textContent = this.value || 'Untitled map';
      CMG.mapview.renderTitle();
      Store.saveLocal();
    });
    sub.addEventListener('input', function () {
      Store.state.subtitle = this.value;
      CMG.mapview.renderTitle();
      Store.saveLocal();
    });

    $('#saveProject').addEventListener('click', function () {
      U.downloadBlob(Store.toFile(), U.slugify(Store.state.title) + '.cmap.json');
      UI.status('Project file saved.', 'ok');
    });

    $('#loadProject').addEventListener('click', function () {
      $('#loadProjectInput').click();
    });

    $('#loadProjectInput').addEventListener('change', function () {
      var file = this.files && this.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          Store.fromFile(String(reader.result));
          UI.status('Project opened.', 'ok');
        } catch (err) {
          UI.status('Could not open that file: ' + err.message, 'error');
        }
      };
      reader.readAsText(file);
      this.value = '';
    });

    $('#newProject').addEventListener('click', function () {
      if (!window.confirm('Start a new map? The current one will be cleared ' +
                          '(Ctrl+Z undoes this).')) return;
      Store.reset();
      UI.status('New map started.');
    });

    $('#addComp').addEventListener('click', function () {
      var c = Store.addComp('');
      UI.expanded[c.id] = true;
      UI.renderCards();
      var input = $('#compList .prop-card[data-id="' + c.id + '"] .prop-address');
      if (input) input.focus();
    });

    $('#locateAll').addEventListener('click', function () { UI.locateAllMissing(); });

    $('#bulkAdd').addEventListener('click', function () {
      var lines = String($('#bulkText').value || '')
        .split('\n')
        .map(function (s) { return s.trim(); })
        .filter(Boolean);
      if (!lines.length) { UI.status('Paste one address per line first.', 'warn'); return; }

      Store.pushUndo();
      var added = lines.map(function (line) { return Store.addComp(line); });
      $('#bulkText').value = '';
      UI.renderCards();
      UI.status('Geocoding ' + added.length + ' addresses…');

      // Serial, so the free geocoders are not hammered in parallel.
      var chain = Promise.resolve();
      added.forEach(function (c) {
        chain = chain.then(function () { return UI.geocodeProperty(c.id, true); });
      });
      chain.then(function () {
        CMG.mapview.fitAll();
        var missing = added.filter(function (c) {
          return Store.find(c.id) && Store.find(c.id).lat == null;
        }).length;
        UI.status(missing
          ? added.length + ' added — ' + missing + ' still need a location.'
          : 'All ' + added.length + ' comparables located.', missing ? 'warn' : 'ok');
      });
    });
  };

  /* ------------------------------------------------------------ diagnostics */

  UI.wireDiagnostics = function () {
    $('#runDiagnostics').addEventListener('click', function () {
      var out = $('#diagOutput');
      out.innerHTML = '<span class="mini-spin"></span> Testing…';
      var rows = [];

      function line(name, ok, detail) {
        rows.push('<div class="diag-row"><span class="' + (ok ? 'good' : 'bad') + '">' +
          (ok ? '✓' : '✗') + '</span> <b>' + U.escapeHtml(name) + '</b> ' +
          '<span class="hint">' + U.escapeHtml(detail || '') + '</span></div>');
        out.innerHTML = rows.join('');
      }

      // Tile imagery, loaded the same way the map loads it.
      var img = new Image();
      img.crossOrigin = 'anonymous';
      var tileDone = new Promise(function (resolve) {
        img.onload = function () { line('Aerial imagery', true, 'tiles load with CORS'); resolve(); };
        img.onerror = function () {
          line('Aerial imagery', false, 'blocked — check firewall/proxy for arcgisonline.com');
          resolve();
        };
      });
      img.src = CMG.BASEMAPS[0].url
        .replace('{z}', '12').replace('{y}', '1546').replace('{x}', '858') +
        '?cachebust=' + Math.floor(Date.now() / 60000);

      var probes = CMG.geocode.probe();
      var checks = [
        probes.census.then(function (r) {
          line('US Census geocoder', r.length > 0, r.length ? r.length + ' candidates' : 'no response');
        }),
        probes.arcgis.then(function (r) {
          line('Esri geocoder', r.length > 0, r.length ? r.length + ' candidates' : 'no response');
        }),
        probes.nominatim.then(function (r) {
          line('OpenStreetMap geocoder', r.length > 0, r.length ? r.length + ' candidates' : 'no response');
        }),
        tileDone
      ];

      var parcelUrl = Store.state.parcelService.url;
      if (parcelUrl) {
        checks.push(CMG.parcels.describe(parcelUrl).then(function (info) {
          line('Parcel service', info.isPolygon, info.name);
        }).catch(function (e) {
          line('Parcel service', false, e.message);
        }));
      } else {
        line('Parcel service', false, 'none selected (optional)');
      }

      checks.push(Promise.resolve(
        line('Image export library', typeof html2canvas === 'function',
             typeof html2canvas === 'function' ? 'loaded' : 'failed to load — reload the page')));

      Promise.all(checks).then(function () {
        rows.push('<div class="hint">Run this from the machine that will build the maps; ' +
                  'office firewalls are the usual cause of failures.</div>');
        out.innerHTML = rows.join('');
      });
    });
  };

  /* ------------------------------------------------------------------ tabs */

  UI.wireTabs = function () {
    $$('.tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var name = btn.getAttribute('data-tab');
        $$('.tab').forEach(function (b) { b.classList.toggle('is-active', b === btn); });
        $$('.tabpanel').forEach(function (p) {
          p.classList.toggle('is-active', p.getAttribute('data-panel') === name);
        });
      });
    });
  };

  /* -------------------------------------------------------------- toolbar */

  UI.wireToolbar = function () {
    $$('#toolbar .tool[data-mode]').forEach(function (b) {
      b.addEventListener('click', function () {
        var mode = b.getAttribute('data-mode');
        if (mode === 'draw') CMG.mapview.startDraw(CMG.mapview.targetProperty().id);
        else CMG.mapview.setMode(mode);
      });
    });
    $('#btnFitAll').addEventListener('click', function () {
      if (!CMG.mapview.fitAll()) UI.status('Nothing to fit yet — add an address.', 'warn');
    });
    $('#btnUndo').addEventListener('click', function () {
      if (!Store.undo()) UI.status('Nothing to undo.');
    });
    $('#modalClose').addEventListener('click', UI.closeModal);
    $('#modalHost .modal-backdrop').addEventListener('click', UI.closeModal);
  };

  UI.wireKeyboard = function () {
    document.addEventListener('keydown', function (ev) {
      var t = ev.target;
      var typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
                         t.getAttribute('contenteditable') === 'true');

      if (ev.key === 'Escape') {
        if (!$('#modalHost').hidden) { UI.closeModal(); return; }
        if (CMG.mapview.isDrawing()) { CMG.mapview.cancelDraw(); CMG.mapview.setMode('pan'); return; }
      }
      if (typing) return;

      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') {
        ev.preventDefault();
        if (!Store.undo()) UI.status('Nothing to undo.');
        return;
      }
      if (CMG.mapview.isDrawing()) {
        if (ev.key === 'Enter') { ev.preventDefault(); CMG.mapview.finishDraw(); return; }
        if (ev.key === 'Backspace') { ev.preventDefault(); CMG.mapview.undoDrawPoint(); return; }
      }
      var map = { v: 'pan', p: 'parcel', m: 'place' };
      var k = ev.key.toLowerCase();
      if (k === 'd') { CMG.mapview.startDraw(CMG.mapview.targetProperty().id); return; }
      if (map[k]) CMG.mapview.setMode(map[k]);
    });
  };

  /* ------------------------------------------------------------------ wiring */

  UI.wireCards = function () {
    ['#subjectCard', '#compList'].forEach(function (sel) {
      var host = $(sel);
      host.addEventListener('input', onCardInput);
      host.addEventListener('change', onCardChange);
      host.addEventListener('click', onCardClick);
      host.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Enter') return;
        if (!ev.target.classList.contains('prop-address')) return;
        ev.preventDefault();
        var p = cardProperty(ev.target);
        if (p) UI.geocodeProperty(p.id);
      });
      host.addEventListener('blur', function (ev) {
        if (!ev.target.classList || !ev.target.classList.contains('prop-address')) return;
        var p = cardProperty(ev.target);
        if (p && p.address && p.lat == null && !UI.busy[p.id]) UI.geocodeProperty(p.id, true);
      }, true);
    });
  };

  CMG.ui = UI;
})(window.CMG);
