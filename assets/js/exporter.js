/* High-resolution export.

   Naive screenshots just upscale a 96 DPI view and look soft in print. Instead
   the map container is temporarily enlarged by a factor k and the zoom raised
   by log2(k). That keeps the geographic extent identical while asking the tile
   service for k times more detail, so the exported image is genuinely sharper
   rather than interpolated. Every on-map element is sized from --ui-scale, so
   pins, text and line weights grow with it and the proportions are preserved. */
(function (CMG) {
  'use strict';

  var U = CMG.util;
  var Store = CMG.store;

  var MAX_EDGE_PX = 8000;   // well inside browser canvas limits

  var Exporter = {

    /** Pixel dimensions the current settings will produce. */
    targetPixels: function () {
      var cfg = Store.state.exportCfg;
      var w = Math.round(cfg.w * cfg.dpi);
      var h = Math.round(cfg.h * cfg.dpi);
      var scale = Math.min(1, MAX_EDGE_PX / Math.max(w, h));
      return { w: Math.round(w * scale), h: Math.round(h * scale), clamped: scale < 1 };
    },

    /**
     * Render the map frame to a canvas at the configured output size.
     * @param {function(string)} onProgress
     */
    renderCanvas: function (onProgress) {
      var MV = CMG.mapview;
      var frame = document.getElementById('mapFrame');
      var mapEl = document.getElementById('map');
      var report = onProgress || function () {};

      if (typeof html2canvas !== 'function') {
        return Promise.reject(new Error(
          'The image library did not load. Check your internet connection and reload.'));
      }

      var target = Exporter.targetPixels();
      var startRect = frame.getBoundingClientRect();
      if (!startRect.width || !startRect.height) {
        return Promise.reject(new Error('The map is not visible.'));
      }

      var k = target.w / startRect.width;
      var center = MV.map.getCenter();
      var zoom = MV.map.getZoom();
      var zoomBump = Math.log(k) / Math.LN2;

      // Saved so the on-screen view is restored byte-for-byte afterwards.
      var saved = {
        frameW: frame.style.width,
        frameH: frame.style.height,
        bodyOverflow: document.body.style.overflow
      };

      function enterExportMode() {
        document.body.classList.add('is-exporting');
        document.body.style.overflow = 'hidden';
        frame.classList.add('export-render');
        frame.style.width = target.w + 'px';
        frame.style.height = target.h + 'px';
        MV.uiScale = k;
        MV.applyStyleVars();
        MV.map.invalidateSize({ animate: false, pan: false });
        MV.map.setView(center, Math.min(22, zoom + zoomBump), { animate: false });
        MV.render();
      }

      function leaveExportMode() {
        frame.classList.remove('export-render');
        frame.style.width = saved.frameW;
        frame.style.height = saved.frameH;
        document.body.style.overflow = saved.bodyOverflow;
        document.body.classList.remove('is-exporting');
        MV.uiScale = 1;
        MV.applyStyleVars();
        MV.map.invalidateSize({ animate: false, pan: false });
        MV.map.setView(center, zoom, { animate: false });
        MV.render();
      }

      report('Preparing high-resolution view…');

      return Promise.resolve()
        .then(function () {
          enterExportMode();
          return U.sleep(120);
        })
        .then(function () {
          report('Loading map tiles at full resolution…');
          return Exporter.waitForTiles(MV.tileLayers(), 45000, report);
        })
        .then(function () {
          // One more frame so labels and leader lines settle at the new scale.
          MV.updateLeaders();
          return U.sleep(250);
        })
        .then(function () {
          report('Drawing image…');
          return html2canvas(frame, {
            backgroundColor: '#ffffff',
            useCORS: true,
            allowTaint: false,
            scale: 1,
            width: target.w,
            height: target.h,
            windowWidth: Math.max(document.documentElement.clientWidth, target.w),
            windowHeight: Math.max(document.documentElement.clientHeight, target.h),
            logging: false,
            imageTimeout: 30000,
            ignoreElements: function (el) {
              if (!el.classList) return false;
              return el.id === 'exportCurtain' ||
                     el.classList.contains('leaflet-control-zoom');
            }
          });
        })
        .then(function (canvas) {
          leaveExportMode();
          return canvas;
        })
        .catch(function (err) {
          leaveExportMode();
          throw err;
        });
    },

    /**
     * Resolves once every tile layer has been quiet for two consecutive checks.
     * A single 'load' event is not enough — panning to a new zoom kicks off a
     * second wave of requests a moment later.
     */
    waitForTiles: function (layers, timeoutMs, report) {
      var start = Date.now();
      var quiet = 0;

      return new Promise(function (resolve) {
        (function poll() {
          var loading = layers.filter(function (l) { return l && l._loading; }).length;
          var elapsed = Date.now() - start;

          if (loading === 0) {
            quiet += 1;
            if (quiet >= 3) return resolve();
          } else {
            quiet = 0;
            if (report && elapsed > 1500) report('Loading map tiles… (' + loading + ' layer(s) pending)');
          }
          if (elapsed > timeoutMs) return resolve();   // publish what we have
          setTimeout(poll, 160);
        })();
      });
    },

    canvasToBlob: function (canvas, type, quality) {
      return new Promise(function (resolve, reject) {
        if (canvas.toBlob) {
          canvas.toBlob(function (b) {
            b ? resolve(b) : reject(new Error('Could not encode the image.'));
          }, type, quality);
        } else {
          try {
            var data = canvas.toDataURL(type, quality);
            var bin = atob(data.split(',')[1]);
            var arr = new Uint8Array(bin.length);
            for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            resolve(new Blob([arr], { type: type }));
          } catch (e) { reject(e); }
        }
      });
    },

    fileName: function (ext) {
      var name = Store.state.exportName || U.slugify(Store.state.title);
      return U.slugify(name) + '.' + ext;
    },

    downloadPNG: function (onProgress) {
      return Exporter.renderCanvas(onProgress)
        .then(function (c) { return Exporter.canvasToBlob(c, 'image/png'); })
        .then(function (blob) {
          U.downloadBlob(blob, Exporter.fileName('png'));
          return blob;
        });
    },

    downloadJPG: function (onProgress) {
      return Exporter.renderCanvas(onProgress)
        .then(function (c) { return Exporter.canvasToBlob(c, 'image/jpeg', 0.94); })
        .then(function (blob) {
          U.downloadBlob(blob, Exporter.fileName('jpg'));
          return blob;
        });
    },

    copyToClipboard: function (onProgress) {
      if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
        return Promise.reject(new Error(
          'This browser cannot copy images. Use Download PNG instead ' +
          '(Chrome and Edge support copying).'));
      }
      return Exporter.renderCanvas(onProgress)
        .then(function (c) { return Exporter.canvasToBlob(c, 'image/png'); })
        .then(function (blob) {
          return navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob })
          ]);
        });
    }
  };

  CMG.exporter = Exporter;
})(window.CMG);
