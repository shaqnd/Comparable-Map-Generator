/* Themes: every colour on the map, as named tokens that can be saved and reused.
   A saved theme is what stops two firms' exhibits looking identical, so it is a
   first-class object — stored with the project, and separately in a library
   that follows the appraiser from job to job. */
(function (CMG) {
  'use strict';

  var U = CMG.util;

  var T = {};

  /** A token set with every value filled in. */
  T.defaults = function () {
    var out = {};
    CMG.THEME_TOKENS.forEach(function (t) { out[t.key] = t.def; });
    return out;
  };

  /** Fill gaps so a theme saved by an older build still resolves. */
  T.normalise = function (theme) {
    var base = {
      id: (theme && theme.id) || U.uid('theme'),
      name: (theme && theme.name) || 'Custom',
      builtIn: !!(theme && theme.builtIn),
      palette: (theme && theme.palette && theme.palette.length)
        ? theme.palette.slice()
        : CMG.PRESET_THEMES[0].palette.slice(),
      tokens: Object.assign(T.defaults(), (theme && theme.tokens) || {})
    };
    return base;
  };

  T.preset = function (id) {
    var p = CMG.PRESET_THEMES.filter(function (x) { return x.id === id; })[0];
    return p ? T.normalise(p) : T.normalise(CMG.PRESET_THEMES[0]);
  };

  /**
   * Colour for one property. Comparables cycle through the palette unless the
   * appraiser has pinned a specific colour to that comp.
   */
  T.colorFor = function (p, theme) {
    theme = theme || CMG.store.state.theme;
    if (!p) return theme.tokens.subject;
    if (p.color) return p.color;
    if (p.role === 'subject') return theme.tokens.subject;
    var n = (p.number || 1) - 1;
    var pal = theme.palette.length ? theme.palette : ['#1a56db'];
    return pal[n % pal.length];
  };

  /** Relative luminance, used to keep pin numbers readable on any disc colour. */
  function luminance(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return 1;                       // transparent / unknown reads as light
    var n = parseInt(m[1], 16);
    var c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  T.isLight = function (hex) { return luminance(hex) > 0.45; };

  /**
   * The number inside a pin: on a light disc it takes the pin's own colour, on
   * a dark or transparent disc it goes white. Chosen rather than exposed,
   * because a wrong pick here makes the pin unreadable.
   */
  T.pinNumberColor = function (p, theme) {
    theme = theme || CMG.store.state.theme;
    var disc = theme.tokens.pinDisc;
    if (disc === 'transparent' || !T.isLight(disc)) return '#ffffff';
    return T.colorFor(p, theme);
  };

  /* What each "auto" token inherits. 'item' means the property being drawn —
     its parcel outline and leader line belong to it, which is the binding that
     lets the legend work without callouts on the map. Anything not listed
     falls back to the subject colour. */
  var AUTO_SOURCE = {
    leader: 'item',
    parcelStroke: 'item',
    titleAccent: 'subject',
    ring: 'subject'
  };

  /** Tokens that may say "auto" and inherit another colour. */
  T.resolve = function (key, theme, itemColor) {
    theme = theme || CMG.store.state.theme;
    var v = theme.tokens[key];
    if (v !== 'auto') return v;
    if (AUTO_SOURCE[key] === 'item' && itemColor) return itemColor;
    return theme.tokens.subject;
  };

  /** Push the theme into CSS custom properties on the exported frame. */
  T.apply = function (theme, frameEl) {
    theme = T.normalise(theme);
    var el = frameEl || document.getElementById('mapFrame');
    if (!el) return;
    CMG.THEME_TOKENS.forEach(function (t) {
      var v = theme.tokens[t.key];
      if (v === 'auto') v = T.resolve(t.key, theme);
      if (t.kind === 'opacity') v = (Number(v) || 0) / 100;
      el.style.setProperty('--t-' + t.key, v);
    });
    el.style.setProperty('--subject-color', theme.tokens.subject);
  };

  /* ------------------------------------------------------------- library */

  T.library = function () {
    var saved = [];
    try {
      saved = JSON.parse(localStorage.getItem(CMG.THEME_KEY) || '[]');
      if (!Array.isArray(saved)) saved = [];
    } catch (e) { saved = []; }

    var builtIns = CMG.PRESET_THEMES.map(function (p) {
      var t = T.normalise(p);
      t.builtIn = true;
      return t;
    });
    return builtIns.concat(saved.map(T.normalise));
  };

  T.saveToLibrary = function (theme) {
    var t = T.normalise(theme);
    t.builtIn = false;

    // A saved theme must never share an id with a built-in, or the built-in
    // shadows it in the library and the customisation silently disappears the
    // next time it is selected. Saving over a built-in forks a copy instead.
    var shadows = CMG.PRESET_THEMES.filter(function (p) { return p.id === t.id; })[0];
    if (shadows) {
      t.id = U.uid('theme');
      if (t.name === shadows.name) t.name = shadows.name + ' (custom)';
    }
    var saved = [];
    try { saved = JSON.parse(localStorage.getItem(CMG.THEME_KEY) || '[]'); }
    catch (e) { saved = []; }
    if (!Array.isArray(saved)) saved = [];

    var at = saved.findIndex(function (x) { return x.id === t.id; });
    if (at >= 0) saved[at] = t; else saved.push(t);
    try { localStorage.setItem(CMG.THEME_KEY, JSON.stringify(saved)); } catch (e) { /* full */ }
    return t;
  };

  T.removeFromLibrary = function (id) {
    var saved = [];
    try { saved = JSON.parse(localStorage.getItem(CMG.THEME_KEY) || '[]'); }
    catch (e) { saved = []; }
    saved = (Array.isArray(saved) ? saved : []).filter(function (x) { return x.id !== id; });
    try { localStorage.setItem(CMG.THEME_KEY, JSON.stringify(saved)); } catch (e) { /* full */ }
  };

  T.toFile = function (theme) {
    return new Blob([JSON.stringify(T.normalise(theme), null, 2)],
                    { type: 'application/json' });
  };

  CMG.theme = T;
})(window.CMG);
