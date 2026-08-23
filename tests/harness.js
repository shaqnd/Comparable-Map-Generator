/* Shared setup for the browser test suites.

   Every suite drives a real Chromium against the real build — there is no
   mocking of the app itself. Only the outside world is stubbed: map tiles,
   the three geocoders and the county parcel services, because the machine
   running the tests is not guaranteed to reach any of them. */
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/* Playwright normally finds its own browser. Set CHROME_PATH to point at a
   pre-installed one (CI images often ship it outside the npm cache). */
const LAUNCH = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};

const PORT = Number(process.env.CMG_TEST_PORT || 8899);
const PAGES_PORT = Number(process.env.CMG_PAGES_PORT || 8901);

/* A 1x1 PNG. Enough for Leaflet to treat a tile as loaded. */
const TILE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mM8U/+/ngEIAB0CA/1p8ykAAAAASUVORK5CYII=',
  'base64');

module.exports = {
  ROOT,
  LAUNCH,
  PORT,
  PAGES_PORT,
  TILE,
  file: (rel) => 'file://' + path.join(ROOT, rel),
  served: (rel) => `http://127.0.0.1:${PORT}/${rel}`
};
