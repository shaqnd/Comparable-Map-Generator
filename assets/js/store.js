/* Project state: the single source of truth for the map.
   Anything that changes the drawing goes through here so the map, the sidebar
   and the legend can never disagree with each other. */
(function (CMG) {
  'use strict';

  var U = CMG.util;

  /* The property record.

     Beyond what the map draws, each record carries the fields the product
     strategy calls for in Phase 0 — a canonical id, a subject profile that can
     describe a property without naming it, and verification as an append-only
     list of observations rather than a boolean. Nothing in the map UI writes
     the latter two yet; they exist so that a saved job is a structured record
     from the first release instead of a screenshot with coordinates. */
  function blankProperty(role, number) {
    return {
      id: U.uid(role),
      role: role,                 // 'subject' | 'comp'
      number: number || null,     // numbered 1..n within its own role
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
      parcel: null,               // { geometry, attributes, source }

      /* Phase-0 structure, not yet surfaced in the UI. */
      profile: {},                // subjects: type, age, size, class, submarket…
      verifications: [],          // comps: one record per observation, never overwritten
      source: null                // where the sale data came from
    };
  }

  /* The two lists behave identically; only the record's role differs. */
  function addTo(listKey, role, address, batched) {
    if (!batched) Store.pushUndo();
    var heads = Store.headings();
    var p = blankProperty(role, Store.state[listKey].length + 1);
    p.address = address || '';
    Store.state[listKey].push(p);
    Store.renumber(heads);
    Store.emit('properties');
    return p;
  }

  function removeFrom(listKey, id) {
    Store.pushUndo();
    var heads = Store.headings();
    Store.state[listKey] = Store.state[listKey].filter(function (p) { return p.id !== id; });
    Store.renumber(heads);
    Store.emit('properties');
  }

  function moveWithin(listKey, id, delta) {
    var arr = Store.state[listKey];
    var i = arr.findIndex(function (p) { return p.id === id; });
    var j = i + delta;
    if (i < 0 || j < 0 || j >= arr.length) return;
    Store.pushUndo();
    var heads = Store.headings();
    var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    Store.renumber(heads);
    Store.emit('properties');
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
        schema: CMG.SCHEMA_ID,      // names the record shape, not the app build
        id: U.uid('map'),           // stable across saves; the counter dedupes on it
        title: 'Comparable Sales Map',
        subtitle: '',
        exportName: '',
        subjects: [blankProperty('subject', 1)],
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
      function restore(role, raw, i) {
        var blank = blankProperty(role, i + 1);
        var merged = Object.assign(blank, raw || {});
        merged.fields = Object.assign(blankProperty(role).fields, (raw || {}).fields || {});
        merged.profile = Object.assign({}, (raw || {}).profile || {});
        merged.verifications = ((raw || {}).verifications || []).slice();
        merged.role = role;
        merged.number = i + 1;
        return merged;
      }

      // Files written before portfolios carried a single `subject`.
      var rawSubjects = p.subjects || (p.subject ? [p.subject] : []);
      out.subjects = rawSubjects.map(function (s, i) { return restore('subject', s, i); });
      if (!out.subjects.length) out.subjects = [blankProperty('subject', 1)];
      delete out.subject;

      out.comps = (p.comps || []).map(function (c, i) { return restore('comp', c, i); });
      out.version = CMG.PROJECT_VERSION;
      out.schema = CMG.SCHEMA_ID;
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
      return Store.state.subjects.concat(Store.state.comps);
    },

    subjects: function () { return Store.state.subjects; },

    /** The first subject — what a single-subject operation should act on. */
    primarySubject: function () {
      var located = Store.state.subjects.filter(function (s) { return s.lat != null; });
      return located[0] || Store.state.subjects[0];
    },

    /**
     * The subject a comparable sits closest to. On a portfolio map "3.4 mi SW
     * of subject" is meaningless — the reader needs to know which one.
     * @returns {{subject: object, miles: number}|null}
     */
    nearestSubject: function (p) {
      if (!p || p.lat == null) return null;
      var best = null;
      Store.state.subjects.forEach(function (s) {
        if (s.lat == null || s.id === p.id) return;
        var d = U.distanceMiles(s, p);
        if (!best || d < best.miles) best = { subject: s, miles: d };
      });
      return best;
    },

    /** The short key drawn on the pin, the card badge and the legend swatch. */
    keyFor: function (p) {
      if (p.role !== 'subject') return String(p.number || '');
      return Store.state.subjects.length > 1 ? 'S' + (p.number || 1) : 'S';
    },

    /** The auto-generated first line of a map label. */
    headingFor: function (p) {
      if (p.role !== 'subject') return 'COMPARABLE ' + (p.number || '');
      return Store.state.subjects.length > 1 ? 'SUBJECT ' + (p.number || 1) : 'SUBJECT';
    },

    /** Every current heading, keyed by id — snapshot this before renumbering. */
    headings: function () {
      var m = {};
      Store.all().forEach(function (p) { m[p.id] = Store.headingFor(p); });
      return m;
    },

    located: function () {
      return Store.all().filter(function (p) { return p.lat != null && p.lng != null; });
    },

    find: function (id) {
      return Store.all().filter(function (p) { return p.id === id; })[0] || null;
    },

    /* ------------------------------------------------------------- mutations */

    /* Both lists are unbounded: a portfolio can carry as many subjects as it
       owns, and a valuation as many comparables as it cites. Numbering,
       colours and label headings all derive from position, so nothing here
       has a ceiling. */

    /** @param {boolean} [batched] caller owns the undo snapshot for the batch */
    addComp: function (address, batched) {
      return addTo('comps', 'comp', address, batched);
    },

    addSubject: function (address, batched) {
      return addTo('subjects', 'subject', address, batched);
    },

    removeComp: function (id) { removeFrom('comps', id); },

    /** A map always has at least one subject; removing the last one blanks it. */
    removeSubject: function (id) {
      if (Store.state.subjects.length <= 1) {
        var only = Store.state.subjects[0];
        if (!only || only.id !== id) return false;
        Store.pushUndo();
        Store.state.subjects = [blankProperty('subject', 1)];
        Store.renumber();
        Store.emit('properties');
        return true;
      }
      removeFrom('subjects', id);
      return true;
    },

    moveComp: function (id, delta) { moveWithin('comps', id, delta); },
    moveSubject: function (id, delta) { moveWithin('subjects', id, delta); },

    /**
     * Renumber both lists and bring auto-generated headings back in line.
     * @param {Object.<string,string>} [oldHeads] headings captured before the
     *        change, so a hand-written label whose first line is still the old
     *        auto heading can be retitled rather than left contradicting the pin.
     */
    renumber: function (oldHeads) {
      Store.state.subjects.forEach(function (p, i) { p.number = i + 1; });
      Store.state.comps.forEach(function (c, i) { c.number = i + 1; });

      Store.all().forEach(function (p) {
        if (!p.labelCustom) { Store.refreshLabel(p); return; }
        // A hand-written label is the appraiser's text and stays theirs — all
        // that is corrected is a heading that now names the wrong pin.
        if (oldHeads && oldHeads[p.id]) Store.retitleLabel(p, oldHeads[p.id]);
      });
    },

    /** Replace a leading auto heading, leaving every other line alone. */
    retitleLabel: function (p, oldHeading) {
      var lines = String(p.labelText || '').split('\n');
      if (!lines.length) return;
      var now = Store.headingFor(p);
      if (lines[0].trim().toUpperCase() !== String(oldHeading).toUpperCase()) return;
      if (lines[0].trim() === now) return;
      lines[0] = lines[0].replace(/\S.*\S|\S/, now);
      p.labelText = lines.join('\n');
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
      lines.push(Store.headingFor(p));

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
