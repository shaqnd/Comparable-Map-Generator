/* Static configuration: base layers, export sizes, geocoders, parcel presets. */
(function (CMG) {
  'use strict';

  var ESRI_ATTR = 'Imagery &copy; Esri, Maxar, Earthstar Geographics';
  var ESRI_MAP_ATTR = 'Map data &copy; Esri, HERE, Garmin, USGS, NGA';

  /* ---------------------------------------------------------------- basemaps
     `maxNativeZoom` stays at the highest zoom the service actually publishes;
     Leaflet upscales beyond it instead of showing blank tiles. */
  CMG.BASEMAPS = [
    {
      id: 'aerial',
      name: 'Aerial',
      blurb: 'High-resolution imagery',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attribution: ESRI_ATTR,
      maxNativeZoom: 19,
      supportsLabelOverlay: true
    },
    {
      id: 'street',
      name: 'Street',
      blurb: 'Clean street map',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
      attribution: ESRI_MAP_ATTR,
      maxNativeZoom: 19,
      supportsLabelOverlay: false
    },
    {
      id: 'osm',
      name: 'OpenStreetMap',
      blurb: 'Detailed street names',
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '&copy; OpenStreetMap contributors',
      maxNativeZoom: 19,
      supportsLabelOverlay: false
    },
    {
      id: 'topo',
      name: 'Topographic',
      blurb: 'Terrain and contours',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
      attribution: ESRI_MAP_ATTR,
      maxNativeZoom: 19,
      supportsLabelOverlay: false
    },
    {
      id: 'light',
      name: 'Light grey',
      blurb: 'Muted — pins stand out',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
      attribution: ESRI_MAP_ATTR,
      maxNativeZoom: 16,
      supportsLabelOverlay: true,
      labelOverlayUrls: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}'
      ]
    }
  ];

  /* Street names / boundaries drawn on top of imagery. */
  CMG.LABEL_OVERLAY_URLS = [
    'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}'
  ];

  /* ----------------------------------------------------------- export sizes
     Sized for a US Letter report with 1" margins (6.5" of usable width) and for
     full-page exhibits. */
  CMG.EXPORT_PRESETS = [
    { id: 'body-half', name: 'Report body, half page — 6.5 × 4.0 in', w: 6.5, h: 4.0 },
    { id: 'body-large', name: 'Report body, large — 6.5 × 6.0 in', w: 6.5, h: 6.0 },
    { id: 'full-page', name: 'Full page exhibit — 7.5 × 9.0 in', w: 7.5, h: 9.0 },
    { id: 'full-half', name: 'Full width, half height — 7.5 × 5.0 in', w: 7.5, h: 5.0 },
    { id: 'landscape', name: 'Letter landscape — 10.0 × 7.5 in', w: 10.0, h: 7.5 },
    { id: 'square', name: 'Square — 6.0 × 6.0 in', w: 6.0, h: 6.0 },
    { id: 'slide', name: 'Slide 16:9 — 10.0 × 5.63 in', w: 10.0, h: 5.63 },
    { id: 'custom', name: 'Custom…', w: null, h: null }
  ];

  /* --------------------------------------------------------------- geocoders
     Ordered by how well they do on US street addresses. All three are keyless
     and send CORS headers, so they work straight from the browser. */
  CMG.GEOCODERS = [
    {
      id: 'census',
      name: 'US Census',
      note: 'Authoritative for US street addresses',
      usOnly: true
    },
    {
      id: 'arcgis',
      name: 'Esri World Geocoder',
      note: 'Often rooftop-accurate; good on suites and new construction',
      usOnly: false
    },
    {
      id: 'nominatim',
      name: 'OpenStreetMap',
      note: 'Worldwide fallback',
      usOnly: false
    }
  ];

  /* Below this score a candidate is flagged for the appraiser to confirm. */
  CMG.CONFIDENCE_WARN = 85;

  /* ---------------------------------------------------------- parcel presets
     Starting points only — county GIS endpoints move. Hit "Test service" to
     confirm one before relying on it, edit the URL if it has changed, and
     "Save as preset" to keep it. Saved presets live in this browser. */
  CMG.PARCEL_PRESETS = [
    {
      id: 'none',
      name: '— none —',
      url: ''
    },
    {
      id: 'denver-co',
      name: 'Denver County, CO',
      url: 'https://services1.arcgis.com/zdB7qR0BtYrg0Xpl/arcgis/rest/services/ODC_PARCELS_A/FeatureServer/0'
    },
    {
      id: 'jeffco-co',
      name: 'Jefferson County, CO',
      url: 'https://gis.jeffco.us/arcgis/rest/services/Parcels/MapServer/0'
    },
    {
      id: 'arapahoe-co',
      name: 'Arapahoe County, CO',
      url: 'https://gis.arapahoegov.com/arcgis/rest/services/Parcels/MapServer/0'
    },
    {
      id: 'custom',
      name: 'Custom URL…',
      url: ''
    }
  ];

  /* Attribute names counties commonly use, checked in order. */
  CMG.PARCEL_FIELD_HINTS = {
    address: ['SITUS_ADDRESS', 'SITUSADDR', 'SITE_ADDR', 'SITEADDRESS', 'PROP_ADDR',
              'ADDRESS', 'FULL_ADDR', 'SITUS', 'STREET_ADDRESS', 'ADDR', 'LOCATION'],
    apn:     ['APN', 'PARCEL_ID', 'PARCELID', 'PIN', 'SCHEDNUM', 'SCHEDULE_NUM',
              'ACCOUNT', 'ACCOUNTNO', 'TAXID', 'PARCELNUM', 'PROPERTY_ID'],
    owner:   ['OWNER', 'OWNER_NAME', 'OWNERNAME', 'OWNER1', 'TAXPAYER', 'DEED_HOLDER'],
    area:    ['ACRES', 'ACREAGE', 'GIS_ACRES', 'LAND_SQFT', 'SQFT', 'AREA', 'SHAPE_Area',
              'LOT_SIZE', 'LANDAREA']
  };

  /* --------------------------------------------------------------- defaults */
  CMG.DEFAULT_STYLE = {
    subjectColor: '#d61f26',
    compColor: '#1a56db',
    parcelColor: '#ffd400',
    parcelFill: true,
    labelSize: 13,
    pinScale: 100,
    showLabels: true,
    showLeaders: true,
    showConnectors: false,
    showTitle: true,
    showLegend: true,
    legendPos: 'bottom-right',
    legendDistance: true,
    showNorth: true,
    showScale: true,
    basemapDim: 100,
    radiusRings: ''
  };

  /* Denver, CO — a sensible opening view; replaced as soon as anything is geocoded. */
  CMG.DEFAULT_VIEW = { lat: 39.7392, lng: -104.9903, zoom: 12, basemap: 'aerial', labelOverlay: true };

  CMG.STORAGE_KEY = 'cmg.project.v1';
  CMG.PRESET_KEY = 'cmg.parcelPresets.v1';
  CMG.PROJECT_VERSION = 1;

})(window.CMG);
