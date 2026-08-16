/* Bootstrap: wire the store, the map and the interface together. */
(function (CMG) {
  'use strict';

  var U = CMG.util;
  var Store = CMG.store;
  var UI = CMG.ui;

  function boot() {
    Store.init();

    CMG.mapview.init({
      onSelect: function () { UI.renderCards(); },
      onParcelAssigned: function () { UI.renderCards(); },
      onLabelEdited: function () { UI.renderCards(); },
      onStatus: function (msg, kind) { UI.status(msg, kind); }
    });

    UI.wireTabs();
    UI.wireCards();
    UI.wireProjectPanel();
    UI.wireStylePanel();
    UI.wireThemePanel();
    UI.wireParcelPanel();
    UI.wireCountyRegistry();
    UI.wireExportPanel();
    UI.wireDiagnostics();
    UI.wireToolbar();
    UI.wireKeyboard();
    CMG.counter.wire();
    UI.wireFirstRun();
    UI.syncAutoFit();

    /* Redraw whenever the project changes.

       Typing a field or dragging a colour fires a change per keystroke, and
       each redraw tears down and rebuilds every marker and label. Coalescing
       into one frame turns a burst of edits into a single repaint. */
    var pending = null;
    Store.subscribe(function (reason) {
      if (!pending) pending = { cards: false, controls: false };
      if (reason !== 'style' || reason === 'all') pending.cards = true;
      if (reason === 'all') pending.controls = true;

      if (pending.frame) return;
      pending.frame = requestAnimationFrame(function () {
        var todo = pending;
        pending = null;
        CMG.mapview.render();
        if (todo.cards && !UI.suppressCards) UI.renderCards();
        if (todo.controls) syncControlsFromState();
        UI.syncAutoFit();
      });
    });

    UI.applyFrameSize();
    UI.renderCards();
    CMG.mapview.setMode('pan');
    CMG.mapview.render();

    $sync();
    window.addEventListener('resize', U.debounce(UI.applyFrameSize, 120));

    if (Store.located().length) {
      CMG.mapview.fitAll();
      UI.status('Project restored from this browser.');
    } else {
      UI.status('Enter the subject address to begin.');
    }

    // Warn before losing unsaved work only when there is something to lose.
    window.addEventListener('beforeunload', function (e) {
      if (!Store.located().length) return;
      // Autosave has already run; this is a safety net for a mis-click.
      void e;
    });
  }

  function $sync() {
    document.getElementById('projectNameDisplay').textContent =
      Store.state.title || 'Untitled map';
  }

  /** After opening a file or resetting, push the new state into every control. */
  function syncControlsFromState() {
    var s = Store.state;
    document.getElementById('mapTitle').value = s.title || '';
    document.getElementById('mapSubtitle').value = s.subtitle || '';
    document.getElementById('exportName').value = s.exportName || '';
    document.getElementById('exportPreset').value = s.exportCfg.presetId;
    document.getElementById('exportW').value = s.exportCfg.w;
    document.getElementById('exportH').value = s.exportCfg.h;
    document.getElementById('exportDpi').value = String(s.exportCfg.dpi);

    document.getElementById('labelSize').value = s.style.labelSize;
    document.getElementById('labelSizeVal').textContent = s.style.labelSize + ' px';
    document.getElementById('pinScale').value = s.style.pinScale;
    document.getElementById('pinSizeVal').textContent = s.style.pinScale + '%';
    document.getElementById('basemapDim').value = s.style.basemapDim;
    document.getElementById('dimVal').textContent = s.style.basemapDim + '%';
    document.getElementById('radiusRings').value = s.style.radiusRings || '';
    document.getElementById('legendPos').value = s.style.legendPos;
    document.getElementById('markerStyle').value = s.style.markerStyle || 'disc';

    [['toggleParcelFill', 'parcelFill'], ['toggleLabels', 'showLabels'],
     ['toggleLeaders', 'showLeaders'], ['toggleConnectors', 'showConnectors'],
     ['toggleTitle', 'showTitle'], ['toggleLegend', 'showLegend'],
     ['toggleLegendDist', 'legendDistance'], ['toggleNorth', 'showNorth'],
     ['toggleScale', 'showScale']].forEach(function (pair) {
      document.getElementById(pair[0]).checked = !!s.style[pair[1]];
    });

    document.getElementById('toggleLabelsOverlay').checked = !!s.view.labelOverlay;
    CMG.mapview.setBasemap(s.view.basemap, s.view.labelOverlay);
    CMG.mapview.map.setView([s.view.lat, s.view.lng], s.view.zoom, { animate: false });

    CMG.ui.refreshParcelPresets();
    CMG.ui.renderThemePanel();
    UI.applyFrameSize();
    $sync();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window.CMG);
