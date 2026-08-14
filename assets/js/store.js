/* Project state: the single source of truth for the map.
   Anything that changes the drawing goes through here so the map, the sidebar
   and the legend can never disagree with each other. */
(function (CMG) {
  'use strict';

  var U = CMG.util;

  function blankProperty(role, number) {
    return {
      id: U.uid(role),
      role: role,                 // 'subject' | 'comp'
      number: number || null,     // comps are numbered 1..n
      address: '',
      lat: null,
      lng: null,
      geocode: null,              // { provider, matchedAddress, score, precision }
      pinned: false,              // true once the user has hand-placed/dragged the pin
      fields: {
        saleDate: '',
        salePrice: '',
        size: '',                 // "0.42 ac" / "12,400 SF" — free text on purpose
        unitPrice: '',
        notes: ''
      },
      labelText: '',              // resolved text shown on the map
      labelCustom: false,         // true once hand-edited; stops auto-regeneration
      color: null,                // overrides the theme palette for this one property
      labelOffset: null,          // {x,y} in pixels from the pin, at zoom-independent scale
      showLabel: true,
      parcel: null                // { geometry, attributes, source }
    };
  }

  var Store = {
    state: null,
    listeners: [],
    _undo: [],

    init: function () {
      var restored = null;
      try {
        var raw = localStorage.getItem(CMG.STORAGE_KEY);
        if (raw) restored = Store.migrate(JSON.parse(raw));
      } catch (e) { restored = null; }

      Store.state = restored || Store.blankProject();
      return Store.state;
    },

    blankProject: function () {
      return {
        version: CMG.PROJECT_VERSION,
        id: U.uid('map'),           // stable across saves; the counter dedupes on it
        title: 'Comparable Sales Map',
        subtitle: '',
        exportName: '',
        subject: blankProperty('subject'),
        comps: [],
        view: JSON.parse(JSON.stringify(CMG.DEFAULT_VIEW)),
        style: JSON.parse(JSON.stringify(CMG.DEFAULT_STYLE)),
        theme: CMG.theme.preset('classic'),
        parcelService: { presetId: 'none', url: '' },
        exportCfg: { presetId: 'body-half', w: 6.5, h: 4.0, dpi: 300 }
      };
    },

    /* Fills in anything a project saved by an older build is missing. */
    migrate: function (p) {
      if (!p || typeof p !== 'object') return null;
      var base = Store.blankProject();
      var out = Object.assign({}, base, p);
      out.id = p.id || base.id;
      out.style = Object.assign({}, base.style, p.style || {});

      // Projects saved before themes existed carried three loose colours.
      var legacy = p.style || {};
      out.theme = CMG.theme.normalise(p.theme || null);
      if (!p.theme && legacy.subjectColor) {
        out.theme.tokens.subject = legacy.subjectColor;
        if (legacy.compColor) out.theme.palette = [legacy.compColor];
        if (legacy.compColor) out.theme.tokens.connector = legacy.compColor;
        out.theme.name = 'Imported';
      }
      out.view = Object.assign({}, base.view, p.view || {});
      out.exportCfg = Object.assign({}, base.exportCfg, p.exportCfg || {});
      out.parcelService = Object.assign({}, base.parcelService, p.parcelService || {});
      out.subject = Object.assign(blankProperty('subject'), p.subject || {});
      out.subject.fields = Object.assign(blankProperty('subject').fields, (p.subject || {}).fields || {});
      out.comps = (p.comps || []).map(function (c, i) {
        var merged = Object.assign(blankProperty('comp', i + 1), c);
        merged.fields = Object.assign(blankProperty('comp').fields, c.fields || {});
        merged.number = i + 1;
        return merged;
      });
      out.version = CMG.PROJECT_VERSION;
      return out;
    },

    /* ---------------------------------------------------------- change feed */

    subscribe: function (fn) { Store.listeners.push(fn); },

    /**
     * @param {string} reason  what changed — listeners use it to skip work
     *                         ('properties', 'style', 'view', 'all')
     */
    emit: function (reason) {
      Store.listeners.forEach(function (fn) {
        try { fn(reason, Store.state); }
        catch (e) { console.error('[cmg] listener failed', e); }
      });
      Store.saveLocal();
    },

    /* Snapshot before a destructive edit so Ctrl+Z can put it back. */
    pushUndo: function () {
      try {
        Store._undo.push(Store.serialise());
        if (Store._undo.length > 40) Store._undo.shift();
      } catch (e) { /* a snapshot we cannot take is not worth failing the edit for */ }
    },

    undo: function () {
      var snap = Store._undo.pop();
      if (!snap) return false;
      Store.state = Store.migrate(JSON.parse(snap));
      Store.emit('all');
      return true;
    },

    /* ------------------------------------------------------------- accessors */

    all: function () {
      return [Store.state.subject].concat(Store.state.comps);
    },

    located: function () {
      return Store.all().filter(function (p) { return p.lat != null && p.lng != null; });
    },

    find: function (id) {
      return Store.all().filter(function (p) { return p.id === id; })[0] || null;
    },

    /* ------------------------------------------------------------- mutations */

    /** @param {boolean} [batched] caller owns the undo snapshot for the batch */
    addComp: function (address, batched) {
      if (!batched) Store.pushUndo();
      var c = blankProperty('comp', Store.state.comps.length + 1);
      c.address = address || '';
      Store.state.comps.push(c);
      Store.renumber();
      Store.emit('properties');
      return c;
    },

    removeComp: function (id) {
      Store.pushUndo();
      Store.state.comps = Store.state.comps.filter(function (c) { return c.id !== id; });
      Store.renumber();
      Store.emit('properties');
    },

    moveComp: function (id, delta) {
      var i = Store.state.comps.findIndex(function (c) { return c.id === id; });
      var j = i + delta;
      if (i < 0 || j < 0 || j >= Store.state.comps.length) return;
      Store.pushUndo();
      var arr = Store.state.comps;
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
      Store.renumber();
      Store.emit('properties');
    },

    renumber: function () {
      Store.state.comps.forEach(function (c, i) {
        var was = c.number;
        c.number = i + 1;
        if (!c.labelCustom) { Store.refreshLabel(c); return; }
        // A hand-written label is the appraiser's text and stays theirs, but a
        // heading that names the old number would now contradict the pin.
        if (was !== c.number) Store.renumberLabel(c, was);
      });
      if (!Store.state.subject.labelCustom) Store.refreshLabel(Store.state.subject);
    },

    /** Rewrite only a leading "COMPARABLE <n>" heading, leaving the rest alone. */
    renumberLabel: function (p, oldNumber) {
      var lines = String(p.labelText || '').split('\n');
      if (!lines.length) return;
      var head = new RegExp('^(\\s*COMPARABLE\\s+)' + oldNumber + '(\\s*)$', 'i');
      if (head.test(lines[0])) {
        lines[0] = lines[0].replace(head, '$1' + p.number + '$2');
        p.labelText = lines.join('\n');
      }
    },

    setLocation: function (id, lat, lng, geocode, pinned) {
      var p = Store.find(id);
      if (!p) return;
      p.lat = lat;
      p.lng = lng;
      if (geocode !== undefined) p.geocode = geocode;
      if (pinned !== undefined) p.pinned = !!pinned;
      if (!p.labelCustom) Store.refreshLabel(p);
      Store.emit('properties');
    },

    update: function (id, patch) {
      var p = Store.find(id);
      if (!p) return;
      Object.keys(patch).forEach(function (k) {
        if (k === 'fields') Object.assign(p.fields, patch.fields);
        else p[k] = patch[k];
      });
      if (!p.labelCustom) Store.refreshLabel(p);
      Store.emit('properties');
    },

    /**
     * Rebuilds the on-map label from the data fields. Skipped for any property
     * whose label the user has typed into — their words win.
     */
    refreshLabel: function (p) {
      var lines = [];
      lines.push(p.role === 'subject' ? 'SUBJECT' : ('COMPARABLE ' + (p.number || '')));

      var addr = (p.address || '').trim();
      if (addr) {
        // Keep the street line on its own row; push city/state/zip to a second row.
        var parts = addr.split(',');
        lines.push(parts[0].trim());
        var rest = parts.slice(1).join(',').trim();
        if (rest) lines.push(rest);
      }

      var money = U.formatMoney(p.fields.salePrice);
      var date = U.formatDate(p.fields.saleDate);
      if (p.role === 'comp' && (money || date)) {
        lines.push([money, date].filter(Boolean).join('  ·  '));
      }
      if (p.fields.size) lines.push(p.fields.size);
      if (p.fields.unitPrice) lines.push(p.fields.unitPrice);
      if (p.fields.notes) lines.push(p.fields.notes);

      p.labelText = lines.filter(Boolean).join('\n');
      return p.labelText;
    },

    setStyle: function (patch) {
      Object.assign(Store.state.style, patch);
      Store.emit('style');
    },

    /** Replace the whole look. Called by the preset picker and on import. */
    setTheme: function (theme) {
      Store.state.theme = CMG.theme.normalise(theme);
      Store.emit('theme');
    },

    /** Change one colour without disturbing the rest of the theme. */
    setToken: function (key, value) {
      Store.state.theme.tokens[key] = value;
      Store.emit('theme');
    },

    setPalette: function (colors) {
      Store.state.theme.palette = colors.slice();
      Store.emit('theme');
    },

    setView: function (patch) {
      Object.assign(Store.state.view, patch);
      Store.saveLocal();
    },

    /* ----------------------------------------------------------- persistence */

    /* Underscore-prefixed fields are working state — auto-placed label offsets,
       for instance — and have no business in a saved job. */
    serialise: function (indent) {
      return JSON.stringify(Store.state, function (key, value) {
        return key.charAt(0) === '_' ? undefined : value;
      }, indent);
    },

    saveLocal: U.debounce(function () {
      try {
        localStorage.setItem(CMG.STORAGE_KEY, Store.serialise());
      } catch (e) { /* private browsing or quota — the file save still works */ }
    }, 400),

    toFile: function () {
      return new Blob([Store.serialise(2)], { type: 'application/json' });
    },

    fromFile: function (text) {
      var parsed = JSON.parse(text);
      var migrated = Store.migrate(parsed);
      if (!migrated) throw new Error('Not a comparable-map project file.');
      Store.pushUndo();
      Store.state = migrated;
      Store.emit('all');
    },

    reset: function () {
      Store.pushUndo();
      Store.state = Store.blankProject();
      Store.emit('all');
    },

    blankProperty: blankProperty
  };

  CMG.store = Store;
})(window.CMG);
