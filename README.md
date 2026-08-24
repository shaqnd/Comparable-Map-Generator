# CompCarto

*The product name lives in one constant, `CMG.PRODUCT_NAME` in
`assets/js/config.js`; nothing else hard-codes it, and the saved-file schema id
deliberately carries no product name at all. The repository is still named
`Comparable-Map-Generator` — renaming it on GitHub would change the clone URL,
so that is a deliberate separate step.*

A single-page tool for building comparable sales exhibits for appraisal reports.
Enter the subject — or a whole portfolio of them — and the comparables, confirm
each location on aerial imagery, pull in parcel boundaries, adjust the labels,
and export a print-resolution image sized for your report.

No install, no account, no API keys. Everything runs in the browser and nothing
leaves the machine except the address lookups.

---

## Getting started

**Easiest:** double-click `index.html`. It opens in your browser and works.

**Shared with the office:** put the folder on a network drive, or publish it with
GitHub Pages (Settings → Pages → deploy from the `main` branch) and send everyone
the link. Serving it over `http(s)` is slightly more reliable than `file://` on
locked-down corporate networks.

Chrome or Edge are recommended — **Copy to clipboard** needs one of them. Everything
else works in Firefox and Safari too.

First time on a new machine, open **Map → Diagnostics → Run connection test**. It
checks the imagery, the three geocoders and your parcel service, and tells you
exactly which one an office firewall is blocking.

---

## The workflow

### 1. Locate the properties

Type the subject address and press **Enter**. Add comparables one at a time, or open
**Paste a list of addresses** and drop in a column copied from a spreadsheet — each
line becomes a numbered comparable and is geocoded automatically. **Locate every
address** looks up anything still missing a pin, which is the one click needed after
opening a project that carries addresses but no coordinates.

Both lists are unbounded — as many subjects and as many comparables as the job
needs. Numbering, colours and label headings all follow position, so nothing has
a ceiling.

**Valuing a portfolio?** Click **+ Add another subject**. The panel becomes
*Subject Properties*, the pins key as `S1`, `S2`, `S3` in the subject colour, and
the labels head *SUBJECT 1*, *SUBJECT 2*. With one subject nothing changes — it
stays a plain `S` and *SUBJECT*.

The comparables are shared across every subject on the map, which is the usual
portfolio case: several holdings in one submarket valued off one set of sales.
Every distance is then measured to the **nearest** subject and names it —
`0.52 mi NW of S2` — in the sidebar and in the legend, because "of subject" means
nothing when there are three. Radius rings are drawn around each subject and
labelled once; connector lines run from each comparable to the subject nearest
it.

Every address is looked up against **three independent geocoders**:

| Provider | Strength |
|---|---|
| US Census | authoritative for US street addresses |
| Esri World Geocoder | often rooftop-accurate; handles suites and new construction |
| OpenStreetMap | worldwide fallback, only queried when the first two come up short |

Each result carries a badge showing which provider matched it, how precise the match
is (rooftop / parcel / street-interpolated / approximate), the confidence score, and
**how many providers agree**. When the providers disagree by more than ~150 ft, or the
best match is only street-level, you get a picker listing every candidate instead of a
silent guess — so a bad geocode can't quietly end up in a report.

You can always override:

- **Place pin on map** — click the exact spot; the pin is marked *hand-placed*.
- **Drag the pin** — same effect, marked *hand-placed*.
- **Coordinates** — paste `39.739200, -104.990300` directly. You can also type
  coordinates into the address box.

Distance and bearing are computed for every comparable (great-circle, in statute
miles) and shown in both the sidebar and the legend — measured to the nearest
subject, and naming it when the map carries more than one.

### 2. Choose the view

Under **Map → Base layer**: Aerial, Street, OpenStreetMap, Topographic, or Light grey.
Street names and boundaries can be overlaid on the aerial. **Base layer brightness**
dims busy imagery so the pins and text read clearly in print.

### 3. Parcels

This release covers the **Colorado Front Range and nearer mountain counties** — the
Wyoming line down to Pueblo, west to Steamboat, Breckenridge and Fairplay. 23 counties
ship in the picker, grouped by region:

| Group | Counties |
|---|---|
| Denver metro | Denver, Adams, Arapahoe, Jefferson, Douglas, Broomfield, Boulder |
| Northern Front Range | Larimer, Weld |
| Southern Front Range | El Paso, Pueblo, Teller, Elbert, Fremont |
| Mountains | Summit, Park, Routt, Eagle, Grand, Clear Creek, Gilpin, Lake, Chaffee |

Address lookup is biased to this box, and a match landing outside it is flagged in the
sidebar rather than silently accepted — "1953 Gun Club Rd" exists in several states.

**The county is picked for you** from the subject's location, via the Census geography
service. Untick *Pick the county automatically* to choose by hand.

> **Verify the county list before you rely on it.** County GIS endpoints move, and none
> of them could be reached from the machine this was built on, so every URL ships
> unverified. **Map → Parcels → County coverage → Test every county** checks all 23 from
> your own network in one pass, four at a time. Failures list first with a **Fix URL**
> button; paste the corrected endpoint and it re-tests immediately. Then **Export** the
> registry and share the file — one person's verification serves the whole office, and
> **Import** loads it on everyone else's machine.

**Test this county** reports whether the selected layer is reachable, whether it holds
polygons, and which attribute fields it found for address and parcel ID.

Then click **Select parcel** on the toolbar and click a property. The boundary is
drawn on the map and attached to whichever property is selected, along with its APN,
owner and published area. If the property had no address yet, the parcel's address
fills it in.

The bundled service list is a **starting point, not a guarantee** — county GIS
endpoints move. To add your own:

1. Search your county's GIS or open-data site for a *Parcels* layer.
2. Copy its ArcGIS REST URL — it ends in a layer number, e.g.
   `https://…/arcgis/rest/services/Parcels/FeatureServer/0`.
3. Paste it, press **Test service**, then **Save as preset**. Saved presets stay in
   your browser and appear in the dropdown from then on.

Any ArcGIS FeatureServer or MapServer polygon layer works. Field names are sniffed
rather than hard-coded, so schemas vary freely between counties.

**No public service for your county?** Use **Draw boundary** and trace it by hand —
click each corner, `Backspace` to undo a point, double-click or `Enter` to close it.

### 4. Labels and styling

Every pin gets a text label built from the data you entered. Edit it two ways:

- **On the map** — double-click a label, type, then click away. `Ctrl+Enter` commits,
  `Esc` cancels.
- **In the sidebar** — expand a property and use the *Map label* box.

Once you type into a label it is marked *edited* and stops regenerating from the
fields. **Reset label** puts it back on automatic.

Drag any label to reposition it; a leader line follows it back to the pin. Label
offsets are stored in the project, so they survive zooming, saving and reloading.

Also under **Map**: label text size, pin size, leader lines, subject-to-comparable
connector lines, and radius rings around each subject (enter `0.5, 1, 2` for half-,
one- and two-mile rings). Colours live on their own tab.

### 4b. Themes — making the map yours

Every colour the map can draw is a named token on the **Theme** tab: subject, the
comparable palette, pin outline and centre, parcel shading, label background, text and
border, leader lines, radius rings, connector lines, the title block, the legend, the
north arrow and the scale bar. Each takes a colour and an opacity.

- **Comparable palette** — comparables take these colours in order, then cycle. Add or
  remove entries; any single comp can be overridden from its card on the Properties tab.
- **Parcels wear their property's colour**, so a shaded parcel and its pin and its
  legend row are visibly the same thing without a callout on the map.
- **Auto** tokens inherit rather than hold a colour — a leader line follows the item it
  points at, the title accent follows the subject. Untick Auto to pin a colour instead.
- **Pin centre → None** gives a solid disc with a white numeral instead of the badge
  look. The numeral colour is chosen for contrast, so it stays readable either way.

**Save theme** puts it in a library that persists in the browser and appears in the
*Start from* list on every future job. **Export file** writes a `.cmtheme.json` to send
to a colleague, so a whole office can share one house style. Saving over a built-in
forks a copy — the four supplied themes (Classic appraisal, Colorado Atlas, Muted
single accent, Monochrome) always stay as shipped.

The theme travels inside the `.cmap.json` too, so reopening an old job reproduces
exactly the exhibit that went into that report.

### 4c. Keeping the pins in frame

The point of this map is the relationship between the subject and its comparables, so
**Keep all pins in view** is on by default. The view refits whenever a pin is added,
moved or removed, and pulls back if navigation takes one off screen. A small nudge that
leaves everything visible is respected — it only acts once something has actually left
the frame.

Untick it (toolbar, or **Export → Framing**) to pan and zoom freely. **Centre on
subject** and **Zoom to** a single property need free navigation, so they switch it off
for you and say so.

### 5. Map furniture

Title block, subtitle/file number, legend with the comparable schedule (optionally
including distance and bearing), north arrow and scale bar — each toggleable, with the
legend placeable in any corner.

### 6. Export

Pick a preset under **Export**:

| Preset | Size |
|---|---|
| Report body, half page | 6.5 × 4.0 in |
| Report body, large | 6.5 × 6.0 in |
| Full page exhibit | 7.5 × 9.0 in |
| Full width, half height | 7.5 × 5.0 in |
| Letter landscape | 10.0 × 7.5 in |
| Square | 6.0 × 6.0 in |
| Slide 16:9 | 10.0 × 5.63 in |
| Custom | any dimensions |

**The map area on screen is always the exact shape of the output**, so framing is
WYSIWYG — pan and zoom until it looks right and that is precisely what you get.

Then **Download PNG**, **Download JPG**, or **Copy to clipboard** and paste straight
into Word with `Ctrl+V`.

At 300 DPI a 6.5 × 4 in export is 1950 × 1200 px. This is *not* an upscaled
screenshot: the map is re-rendered at the higher resolution (see below), so the
imagery, text and line work are genuinely sharp in print.

### 7. Saving

Work is auto-saved in your browser as you go and restored when you come back. Use
**Save file** to write a `.cmap.json` project you can archive with the report file or
hand to a colleague, and **Open file** to load it back.

`Ctrl+Z` undoes structural changes — deletions, moves, geocodes, parcel edits.

### 8. Maps made

A quiet figure sits at the right of the status bar, counting the maps this install
has produced. A map counts once, the first time it is rendered for output —
re-exporting the same job at a different size is the same map — so the number stays
honest. Click it for the breakdown.

It is local by default and nothing leaves the machine. Setting `CMG.COUNTER_ENDPOINT`
in `assets/js/config.js` to a URL that accepts a JSON POST makes each newly created map
send one content-free tick — timestamp, an anonymous install id, the running total and
the app version. No addresses, no client names, no project data, ever. That is the hook
a platform-wide total would later be built on.

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| `V` | Pan / select |
| `P` | Select parcel |
| `D` | Draw boundary |
| `M` | Place pin |
| `Enter` | Finish the boundary being drawn |
| `Backspace` | Remove the last boundary point |
| `Esc` | Cancel drawing, or close a dialog |
| `Ctrl+Z` | Undo |

---

## How the high-resolution export works

A plain screenshot captures the map at ~96 DPI and stretches it, which looks soft on
paper. Instead, at export time the map container is temporarily enlarged by a factor
`k` and the zoom is raised by `log2(k)`. Those two changes cancel out geographically —
the extent stays identical — while the tile service is asked for `k` times more
detail.

Every element drawn on the map is sized from a single CSS variable, `--ui-scale`,
which is `1` on screen and `k` during export. Pins, label text, leader-line weights,
the title block, legend, north arrow and scale bar therefore all grow in step, and the
exported image is proportionally identical to what was on screen. The exporter waits
for the tile layers to go quiet before capturing, then restores the previous view
exactly.

Where a tile service publishes no imagery above its maximum native zoom, those tiles
are upsampled — but the pins, text and vector work are still rendered at full output
resolution, which is where print quality is most visible.

---

## Accuracy notes

- Geocoded coordinates are a *starting point*. Always confirm the pin against the
  aerial before exporting — that is what the aerial layer and parcel boundaries are
  for.
- `street-interpolated` means the point was estimated along a street segment from the
  address range. It is usually within a lot or two, not on the roof.
- Hand-placed pins and traced boundaries are labelled as such in the sidebar so a
  reviewer can tell at a glance which locations were verified by a person.
- Parcel geometry and attributes come straight from the county service and are shown
  unaltered. The published area field is whatever the county publishes; it is not
  recomputed.
- Distances are great-circle, centre-to-centre, in statute miles.

---

## Single-file builds

`tools/build.js` inlines every stylesheet and script into one HTML file — handy for
emailing, a shared drive, or a machine where nothing can be installed.

```
node tools/build.js --mode=live                        # dist/comparable-map-standalone.html
node tools/build.js --mode=demo                        # demo/comparable-map-demo.html
node tools/build.js --mode=live --project=job.cmap.json --out=dist/job.html
node tools/build.js --mode=live --autorun --project=job.cmap.json --out=dist/job.html
```

- **live** is the real tool: Esri imagery, three geocoders, county parcel layers.
- **demo** replaces tiles, geocoding and parcels with offline stand-ins, so the page
  makes no network requests at all. Useful for showing the workflow on a locked-down
  network — the imagery is simulated and must never be used in a report.
- `--project` bakes a project in, so the file opens with the subject and comparables
  already entered. Addresses arrive without coordinates on purpose and are looked up
  on first open, in the browser, against the live geocoders — never guessed at build
  time.
- `--autorun` goes further: on open it locates every address, frames them, renders the
  map at the configured size and hands over the finished image with Save and Copy.
  Hand someone a job file and they get the exhibit without touching the interface.

## Layout

```
index.html                     markup and the exportable map frame
assets/css/app.css             interface plus the --ui-scale export mechanics
assets/js/util.js              geometry, formatting, small helpers
assets/js/config.js            base layers, export presets, parcel presets
assets/js/store.js             project state, undo, autosave, file I/O
assets/js/geocode.js           the three geocoders and cross-checking
assets/js/parcels.js           ArcGIS parcel queries and the preset library
assets/js/mapview.js           map, pins, labels, parcels, furniture
assets/js/exporter.js          high-resolution rendering
assets/js/ui.js                sidebar, toolbar, dialogs
assets/js/app.js               bootstrap
assets/vendor/                 Leaflet 1.9.4 and html2canvas 1.4.1
demo/demo-mode.js              offline stand-ins for tiles, geocoding, parcels
tools/build.js                 single-file build (live or demo)
docs/DATA-MODEL.md             the saved-job record shape, and why it looks like that
```

Leaflet and html2canvas are bundled locally on purpose — a CDN is one more thing an
office firewall can block, and this way the tool keeps working offline apart from the
map tiles themselves.

A saved `.cmap.json` is a structured record, not a screenshot with coordinates
attached: it names its own schema, carries canonical ids, and reserves the fields
a comp repository will need later. [docs/DATA-MODEL.md](docs/DATA-MODEL.md) sets
out the shape, how it lines up with the product strategy, and what is
deliberately absent for now.

---

## Attribution

Imagery and street data © Esri, Maxar, Earthstar Geographics, HERE, Garmin, USGS, NGA
and © OpenStreetMap contributors. The attribution shown on the map must stay on
exported images — it is a condition of using these free services. Geocoding by the US
Census Bureau, Esri and OpenStreetMap/Nominatim. Parcel data belongs to the publishing
county.

---

## Tests

```
npm install          # playwright only
npm test             # 17 suites, 215 checks
npm test -- smoke    # or a subset, matched by name
```

`tests/run.js` starts the static servers, produces the single-file builds and the
seeded fixture, then drives a real Chromium against the real build. Nothing has to
be running first. Only the outside world is stubbed — map tiles, the three
geocoders and the county parcel services — because the machine running the tests
is not guaranteed to reach any of them.

If Playwright cannot find a browser, point `CHROME_PATH` at one you already have.
