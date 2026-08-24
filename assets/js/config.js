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


  /* ---------------------------------------------------------------- region
     First release is scoped to the Colorado Front Range and the nearer
     mountain counties: Wyoming line down to Pueblo, out to Steamboat,
     Breckenridge and Fairplay. Geocoding is biased to this box and anything
     landing outside it is flagged rather than silently accepted. */
  CMG.REGION = {
    id: 'co-front-range',
    name: 'Colorado Front Range & mountains',
    bounds: [[37.85, -107.40], [41.05, -103.80]],
    center: [39.60, -105.40],
    zoom: 8
  };

  /* Colorado is a rectangle, so its bounds are exact. */
  CMG.STATE_BOUNDS = [[36.992, -109.06], [41.003, -102.04]];

  /* ------------------------------------------------------- county registry
     Parcel layers for every county in the launch region.

     These URLs are STARTING POINTS. County GIS endpoints move, and they could
     not be reached from the machine this was built on, so every one is marked
     unverified until it answers. Run "Test every county" in the Parcels panel
     to check the whole list from your own network in one pass, correct any
     that have moved, then export the registry and share the file with the
     office so nobody repeats the work. */
  CMG.COUNTIES = [
    /* ---- Denver metro ---- */
    { id: 'denver', name: 'Denver', group: 'Denver metro',
      url: 'https://services1.arcgis.com/zdB7qR0BtYrg0Xpl/arcgis/rest/services/ODC_PARCELS_A/FeatureServer/0' },
    { id: 'adams', name: 'Adams', group: 'Denver metro',
      url: 'https://gis.adcogov.org/arcgis/rest/services/Assessor/Parcels/MapServer/0' },
    { id: 'arapahoe', name: 'Arapahoe', group: 'Denver metro',
      url: 'https://gis.arapahoegov.com/arcgis/rest/services/Parcels/MapServer/0' },
    { id: 'jefferson', name: 'Jefferson', group: 'Denver metro',
      url: 'https://gis.jeffco.us/arcgis/rest/services/Parcels/MapServer/0' },
    { id: 'douglas', name: 'Douglas', group: 'Denver metro',
      url: 'https://gis.douglas.co.us/arcgis/rest/services/Parcels/MapServer/0' },
    { id: 'broomfield', name: 'Broomfield', group: 'Denver metro',
      url: 'https://gismaps.broomfield.org/arcgis/rest/services/Parcels/MapServer/0' },
    { id: 'boulder', name: 'Boulder', group: 'Denver metro',
      url: 'https://maps.boco.solutions/arcgis/rest/services/Parcels/MapServer/0' },

    /* ---- North to the Wyoming line ---- */
    { id: 'larimer', name: 'Larimer', group: 'Northern Front Range',
      url: 'https://gisservices.larimer.org/arcgis/rest/services/Parcels/MapServer/0' },
    { id: 'weld', name: 'Weld', group: 'Northern Front Range',
      url: 'https://gis.weldgov.com/arcgis/rest/services/Parcels/MapServer/0' },

    /* ---- South to Pueblo ---- */
    { id: 'elpaso', name: 'El Paso', group: 'Southern Front Range',
      url: 'https://gis.elpasoco.com/arcgis/rest/services/Assessor/Parcels/MapServer/0' },
    { id: 'pueblo', name: 'Pueblo', group: 'Southern Front Range',
      url: 'https://gis.pueblocounty.us/arcgis/rest/services/Parcels/MapServer/0' },
    { id: 'teller', name: 'Teller', group: 'Southern Front Range',
      url: 'https://gis.co.teller.co.us/arcgis/rest/services/Parcels/MapServer/0' },
    { id: 'elbert', name: 'Elbert', group: 'Southern Front Range',
      url: 'https://gis.elbertcounty-co.gov/arcgis/rest/services/Parcels/MapServer/0' },
    { id: 'fremont', name: 'Fremont', group: 'Southern Front Range',
      url: 'https://gis.fremontco.com/arcgis/rest/services/Parcels/MapServer/0' },

    /* ---- Mountain counties ---- */
    { id: 'summit', name: 'Summit', group: 'Mountains', note: 'Breckenridge',
      url: 'https://gis.summitcountyco.gov/arcgis/rest/services/Parcels/MapServer/0' },
    { id: 'park', name: 'Park', group: 'Mountains', note: 'Fairplay',
      url: 'https://gis.parkco.us/arcgis/rest/services/Parcels/MapServer/0' },
    { id: 'routt', name: 'Routt', group: 'Mountains', note: 'Steamboat Springs',
      url: 'https://gis.co.routt.co.us/arcgis/rest/services/Parcels/MapServer/0' },
    { id: 'eagle', name: 'Eagle', group: 'Mountains', note: 'Vail',
      url: 'https://gis.eaglecounty.us/arcgis/rest/services/Parcels/MapServer/0' },
    { id: 'grand', name: 'Grand', group: 'Mountains', note: 'Winter Park' ,
      url: 'https://gis.co.grand.co.us/arcgis/rest/services/Parcels/MapServer/0' },
    { id: 'clearcreek', name: 'Clear Creek', group: 'Mountains', note: 'Idaho Springs',
      url: 'https://gis.clearcreekcounty.us/arcgis/rest/services/Parcels/MapServer/0' },
    { id: 'gilpin', name: 'Gilpin', group: 'Mountains', note: 'Central City',
      url: 'https://gis.co.gilpin.co.us/arcgis/rest/services/Parcels/MapServer/0' },
    { id: 'lake', name: 'Lake', group: 'Mountains', note: 'Leadville',
      url: 'https://gis.lakecountyco.gov/arcgis/rest/services/Parcels/MapServer/0' },
    { id: 'chaffee', name: 'Chaffee', group: 'Mountains', note: 'Salida',
      url: 'https://gis.chaffeecounty.org/arcgis/rest/services/Parcels/MapServer/0' }
  ];

  CMG.COUNTY_GROUPS = ['Denver metro', 'Northern Front Range',
                       'Southern Front Range', 'Mountains'];

  CMG.REGISTRY_KEY = 'cmg.counties.v1';

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


  /* ------------------------------------------------------------------ theme
     Every colour the map can draw, as a named token. Grouped for the sidebar;
     `def` is the value in the Classic theme. Tokens marked `auto` may inherit
     another colour instead of holding one of their own. */
  CMG.THEME_TOKENS = [
    { key: 'subject',       group: 'Subject & comparables', label: 'Subject',            def: '#d61f26' },

    { key: 'pinStroke',     group: 'Pins',      label: 'Pin outline',          def: '#ffffff' },
    { key: 'pinDisc',       group: 'Pins',      label: 'Pin centre',           def: 'transparent' },

    { key: 'parcelOpacity', group: 'Parcels',   label: 'Parcel shading',       def: 18, kind: 'opacity' },
    { key: 'parcelStroke',  group: 'Parcels',   label: 'Parcel outline',       def: 'auto', auto: true },

    { key: 'labelBg',       group: 'Labels',    label: 'Label background',     def: '#ffffffee' },
    { key: 'labelText',     group: 'Labels',    label: 'Label text',           def: '#14202c' },
    { key: 'labelBorder',   group: 'Labels',    label: 'Label border',         def: '#00000047' },
    { key: 'leader',        group: 'Labels',    label: 'Leader line',          def: 'auto', auto: true },

    { key: 'ring',          group: 'Lines',     label: 'Radius rings',         def: 'auto', auto: true },
    { key: 'connector',     group: 'Lines',     label: 'Subject-to-comp lines', def: '#1a56db' },

    { key: 'titleBg',       group: 'Title block', label: 'Title background',   def: '#ffffffee' },
    { key: 'titleText',     group: 'Title block', label: 'Title text',         def: '#101a24' },
    { key: 'titleSub',      group: 'Title block', label: 'Subtitle text',      def: '#46586b' },
    { key: 'titleBorder',   group: 'Title block', label: 'Title border',       def: '#0000004d' },
    { key: 'titleAccent',   group: 'Title block', label: 'Title accent bar',   def: 'auto', auto: true },

    { key: 'legendBg',      group: 'Legend',    label: 'Legend background',    def: '#fffffff2' },
    { key: 'legendBorder',  group: 'Legend',    label: 'Legend border',        def: '#00000052' },
    { key: 'legendTitle',   group: 'Legend',    label: 'Legend heading',       def: '#46586b' },
    { key: 'legendText',    group: 'Legend',    label: 'Legend text',          def: '#14202c' },
    { key: 'legendSub',     group: 'Legend',    label: 'Legend detail text',   def: '#5a6a7c' },

    { key: 'north',         group: 'Furniture', label: 'North arrow',          def: '#111111' },
    { key: 'northHalo',     group: 'Furniture', label: 'North arrow halo',     def: '#ffffff' },
    { key: 'scaleInk',      group: 'Furniture', label: 'Scale bar',            def: '#14202c' },
    { key: 'scaleBg',       group: 'Furniture', label: 'Scale bar background', def: '#ffffffd1' }
  ];

  CMG.THEME_GROUPS = ['Subject & comparables', 'Pins', 'Parcels', 'Labels',
                      'Lines', 'Title block', 'Legend', 'Furniture'];

  /* Starting points. "Colorado Atlas" mirrors the Naked Denver product palette;
     "Monochrome" is for reports that get photocopied. */
  CMG.PRESET_THEMES = [
    {
      id: 'classic',
      name: 'Classic appraisal',
      palette: ['#1B4FD8', '#0E7C5A', '#B3261E', '#6D3BC4', '#A85B00', '#0D6E86'],
      tokens: {}
    },
    {
      id: 'atlas',
      name: 'Colorado Atlas',
      palette: ['#2563eb', '#ea7317', '#8b5cf6', '#16a34a', '#db2777', '#0891b2'],
      tokens: {
        subject: '#0f5c46',
        connector: '#0f5c46',
        titleAccent: '#0f5c46',
        titleBg: '#fdfbf6f7',
        legendBg: '#fdfbf6f7',
        labelBg: '#fdfbf6f2',
        titleText: '#12241d',
        labelText: '#12241d'
      }
    },
    {
      id: 'muted',
      name: 'Muted single accent',
      palette: ['#1f4f8f'],
      tokens: {
        subject: '#c2410c',
        connector: '#1f4f8f',
        pinDisc: 'transparent',
        labelBg: '#ffffffe6',
        parcelOpacity: 12
      }
    },
    {
      id: 'mono',
      name: 'Monochrome',
      palette: ['#1c1c1c'],
      tokens: {
        subject: '#1c1c1c',
        pinDisc: '#ffffff',
        connector: '#5a5a5a',
        ring: '#5a5a5a',
        titleAccent: '#1c1c1c',
        legendTitle: '#4a4a4a',
        legendSub: '#6a6a6a',
        titleSub: '#4a4a4a',
        parcelOpacity: 10
      }
    }
  ];

  CMG.THEME_KEY = 'cmg.themes.v1';

  /* --------------------------------------------------------------- defaults */
  CMG.DEFAULT_STYLE = {
    autoFit: true,        // the map's job is showing subject-to-comp relation
    markerStyle: 'disc',  // 'disc' | 'pin'
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

  /* Opens on the launch region; replaced as soon as anything is geocoded. */
  CMG.DEFAULT_VIEW = {
    lat: CMG.REGION.center[0], lng: CMG.REGION.center[1], zoom: CMG.REGION.zoom,
    basemap: 'aerial', labelOverlay: true
  };

  CMG.APP_VERSION = '1.0';

  /* Maps-made counter. Local only: leave the endpoint empty and nothing is ever
     sent anywhere. Set it to a URL that accepts a JSON POST and each newly
     created map sends one content-free tick — no addresses, no client data —
     which is what a platform-wide total would later be built from. */
  CMG.COUNTER_KEY = 'cmg.stats.v1';
  CMG.FIRSTRUN_KEY = 'cmg.seenIntro.v1';
  CMG.COUNTER_ENDPOINT = '';

  /* These keys are deliberately not renamed with the product. They address
     work already sitting in someone's browser, and changing them would orphan
     an appraiser's autosaved map and their saved county presets. */
  CMG.STORAGE_KEY = 'cmg.project.v1';
  CMG.PRESET_KEY = 'cmg.parcelPresets.v1';
  CMG.PROJECT_VERSION = 2;      // 2 = many subjects; 1 files still open

  /* The product name lives here and nowhere else. The window title, the sidebar
     header and the single-file build titles all read it from here, and the badge
     initials are derived from its capitals. It is deliberately absent from
     CMG.SCHEMA_ID below, so a saved corpus never depends on it. */
  CMG.PRODUCT_NAME = 'CompCarto';

  /* Names the shape of a saved job, separately from the app build that wrote
     it. Anything that later reads these files — a comp repository, a sync
     service — keys off this.

     Deliberately carries no product name. A saved corpus is the asset the whole
     strategy rests on, and it must not be invalidated by a branding decision.
     See docs/DATA-MODEL.md. */
  CMG.SCHEMA_ID = 'comparable-sales-map/1';

})(window.CMG);
