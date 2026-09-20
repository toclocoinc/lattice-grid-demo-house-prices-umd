/**
 * Load the demo in a real browser and check that it works.
 *
 * Serves the project and opens the saved copy, so the check never depends on
 * the land registry or on DuckDB WASM being reachable. It does depend on
 * jsDelivr, because that is where the page gets the grid from: this edition has
 * no local copy of the library at all, and a check that loaded one would not
 * be checking the page.
 *
 * Beyond "it drew something", it asserts the things this demo exists to show:
 *
 *   - the library arrived by classic script tag: there is no `type="module"`
 *     script on the page, every library tag points at the pinned release on
 *     the CDN, and each one left the global it documents;
 *   - narrowing to flats moves the tiles and the charts;
 *   - grouping by county produces group rows, and pivoting the type across the
 *     year turns the grid into a matrix;
 *   - the derived summaries hold rows that agree with the saved data;
 *   - pushing a sale through the router adds it to the detail grid and the
 *     headline figures recompute from the saved data;
 *   - every headline figure agrees with the saved data, recomputed here rather
 *     than read back off the page.
 *
 * It then blocks DuckDB in the browser and opens the live page, to prove a
 * visitor gets the saved copy, and is told so, when the engine cannot be read.
 *
 * `--all` also opens the live DuckDB path, which is not part of the deployment
 * gate.
 *
 * Exits non-zero when any of that fails, so it can gate a deployment.
 *
 * Usage: node tools/verify.mjs [--all] [--shots <dir>]
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const args = process.argv.slice(2);
const shotIndex = args.indexOf('--shots');
const shotDir = shotIndex >= 0 ? resolve(args[shotIndex + 1]) : null;
const all = args.includes('--all');

/** The release every library tag must name, and the globals each file leaves. */
const GRID_VERSION = '1.65.0';
const CDN_BASE = `https://cdn.jsdelivr.net/npm/@toclocoinc/lattice-grid@${GRID_VERSION}/`;
const LIBRARY_TAGS = [
  { file: 'lattice-grid.min.js', global: 'LatticeGrid', member: 'createGrid' },
  { file: 'modules/charts.min.js', global: 'LatticeGrid', member: 'createChart' },
  { file: 'modules/data-router.min.js', global: 'LatticeGridDataRouter', member: 'createDataRouter' },
  { file: 'modules/kpi.min.js', global: 'LatticeGridKPI', member: 'createKPI' },
  { file: 'modules/tabs.min.js', global: 'LatticeGridTabs', member: 'createTabs' },
];

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
].filter(Boolean);

/** The first browser on this machine that actually exists. */
async function findChrome() {
  for (const path of CHROME_CANDIDATES) {
    try {
      await access(path);
      return path;
    } catch {}
  }
  throw new Error(`No browser found. Tried:\n  ${CHROME_CANDIDATES.join('\n  ')}\nSet CHROME_PATH to point at one.`);
}

/** This check needs Node's built-in WebSocket, which arrived in Node 22. */
function requireModernNode() {
  if (typeof WebSocket === 'undefined') {
    throw new Error(
      `This check needs Node 22 or newer. You are running ${process.version}, which has no built in WebSocket.`,
    );
  }
}

/** A free TCP port, asked of the operating system. */
function freePort() {
  return new Promise((ok, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => ok(port));
    });
  });
}

const failures = [];
const notes = [];

/** Record a check and its outcome. */
function check(ok, description, detail) {
  if (ok) {
    notes.push(`  ok   ${description}${detail ? ` (${detail})` : ''}`);
  } else {
    failures.push(`${description}${detail ? ` (${detail})` : ''}`);
    notes.push(`  FAIL ${description}${detail ? ` (${detail})` : ''}`);
  }
}

/** A number from either a plain number or a formatted currency string. */
function toNum(value) {
  if (typeof value === 'number') return value;
  if (value == null) return NaN;
  const text = String(value).replace(/[^0-9.-]/g, '');
  return Number(text);
}

/** Whether two figures agree, to within a fraction of the larger. */
function near(a, b, rel = 0.02) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= Math.max(1, Math.abs(b) * rel);
}

function medianOf(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function p95Of(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * 0.95)] || 0;
}

let browser;
let browserPid = null;
let profile;
let server;

try {
  requireModernNode();
  const chromePath = await findChrome();
  const started = await startServer(0);
  server = started.server;
  const origin = `http://127.0.0.1:${started.port}`;
  console.log(`Browser: ${chromePath}`);
  console.log(`Serving: ${origin}`);

  profile = await mkdtemp(join(tmpdir(), 'house-prices-umd-demo-verify-'));
  const port = await freePort();
  browser = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    '--window-size=1440,900',
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  browserPid = browser.pid;
  browser.stderr.on('data', () => {});

  let wsUrl;
  for (let i = 0; i < 150 && !wsUrl; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) wsUrl = (await response.json()).webSocketDebuggerUrl;
    } catch {}
    if (!wsUrl) await sleep(200);
  }
  if (!wsUrl) throw new Error('the browser never opened its debugging port');

  const socket = new WebSocket(wsUrl);
  await new Promise((done, fail) => {
    socket.onopen = done;
    socket.onerror = () => fail(new Error('could not attach to the browser'));
  });

  let nextId = 0;
  const pending = new Map();
  let consoleErrors = [];
  let pageErrors = [];

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id != null && pending.has(message.id)) {
      const { resolve: ok, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else ok(message.result);
      return;
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      consoleErrors.push(message.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails;
      pageErrors.push(details.exception?.description || details.text);
    }
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      consoleErrors.push(message.params.entry.text);
    }
  };

  const send = (method, params = {}, sessionId) =>
    new Promise((ok, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve: ok, reject });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const call = (method, params) => send(method, params, sessionId);

  await call('Page.enable');
  await call('Runtime.enable');
  await call('Log.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text + ' ' + (result.exceptionDetails.exception?.description || ''));
    }
    return result.result.value;
  };

  const waitFor = async (expression, timeout, what) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      let value;
      try {
        value = await evaluate(expression);
      } catch {}
      if (value) return value;
      await sleep(250);
    }
    throw new Error(`timed out waiting for ${what}`);
  };

  /** Open a URL with a clean error log and wait for the dashboard to report in. */
  const open = async (url, label) => {
    consoleErrors = [];
    pageErrors = [];
    console.log(`\n--- ${label} ---\n${url}`);
    await call('Page.navigate', { url });
    await waitFor('!!(window.__housePrices)', 120000, `${label} to load`);
    const state = await evaluate('({ ready: window.__housePrices.ready, error: window.__housePrices.error || null })');
    if (!state.ready) throw new Error(`${label} reported a failure: ${state.error}`);
    await waitFor('window.__housePrices.detailGrid && window.__housePrices.detailGrid.rows.totalCount() > 0', 60000, `${label} rows`);
  };

  /** Save a screenshot, when a directory was asked for. */
  const shoot = async (name) => {
    if (!shotDir) return;
    await mkdir(shotDir, { recursive: true });
    const { data } = await call('Page.captureScreenshot', { format: 'png' });
    const file = join(shotDir, `${name}.png`);
    await writeFile(file, Buffer.from(data, 'base64'));
    console.log(`  shot ${file}`);
  };

  /** Complain about anything the page logged. */
  const noErrors = (label) => {
    check(consoleErrors.length === 0, `${label}: no console errors`, consoleErrors.slice(0, 3).join(' | '));
    check(pageErrors.length === 0, `${label}: no page errors`, pageErrors.slice(0, 3).join(' | '));
  };

  /* =================================================================== */
  /* 1. The saved copy: the deterministic run, where the figures are      */
  /*    cross-checked against the saved data.                             */
  /* =================================================================== */

  await open(`${origin}/index.html?source=snapshot`, 'saved copy');

  /* ---- how the library arrived ---- */

  const delivery = await evaluate(`(() => {
    const scripts = [...document.querySelectorAll('script')];
    const globals = {};
    for (const name of ['LatticeGrid', 'LatticeGridDataRouter', 'LatticeGridKPI', 'LatticeGridTabs']) {
      const value = window[name];
      globals[name] = value ? Object.keys(value).filter((k) => typeof value[k] === 'function').length : 0;
    }
    return {
      moduleScripts: scripts.filter((s) => s.type === 'module').length,
      importmaps: scripts.filter((s) => s.type === 'importmap').length,
      librarySrcs: scripts.map((s) => s.getAttribute('src') || '').filter((src) => /cdn\\.jsdelivr\\.net/.test(src)),
      withIntegrity: scripts.filter((s) => /cdn\\.jsdelivr\\.net/.test(s.src) && s.integrity).length,
      stylesheetSrc: (document.querySelector('link[rel=stylesheet][href*="cdn.jsdelivr.net"]') || {}).href || null,
      globals,
      members: {
        createGrid: typeof (window.LatticeGrid || {}).createGrid,
        setLicence: typeof (window.LatticeGrid || {}).setLicence,
        createChart: typeof (window.LatticeGrid || {}).createChart,
        createStat: typeof (window.LatticeGrid || {}).createStat,
        createPushdownSource: typeof (window.LatticeGrid || {}).createPushdownSource,
        duckdbAdapter: typeof (window.LatticeGrid || {}).duckdbAdapter,
        createDataRouter: typeof (window.LatticeGridDataRouter || {}).createDataRouter,
        createKPI: typeof (window.LatticeGridKPI || {}).createKPI,
        createTabs: typeof (window.LatticeGridTabs || {}).createTabs,
      },
    };
  })()`);
  console.log(`  library tags: ${delivery.librarySrcs.length} from the CDN, ${delivery.withIntegrity} with an integrity hash; module scripts on the page: ${delivery.moduleScripts}`);
  check(delivery.moduleScripts === 0, 'delivery: no type="module" script on the page', `${delivery.moduleScripts}`);
  check(delivery.importmaps === 0, 'delivery: no import map on the page', `${delivery.importmaps}`);
  check(
    delivery.librarySrcs.length === LIBRARY_TAGS.length,
    `delivery: ${LIBRARY_TAGS.length} library script tags point at the CDN`,
    `${delivery.librarySrcs.length}`,
  );
  for (const tag of LIBRARY_TAGS) {
    const wanted = `${CDN_BASE}${tag.file}`;
    check(delivery.librarySrcs.includes(wanted), `delivery: ${tag.file} is loaded from the pinned ${GRID_VERSION} release`, wanted);
    check(delivery.members[tag.member] === 'function', `delivery: ${tag.file} left ${tag.global}.${tag.member} behind`, delivery.members[tag.member]);
  }
  check(delivery.withIntegrity === LIBRARY_TAGS.length, 'delivery: every library tag carries an integrity hash', `${delivery.withIntegrity} of ${LIBRARY_TAGS.length}`);
  check(
    delivery.stylesheetSrc === `${CDN_BASE}lattice-grid.min.css`,
    `delivery: the stylesheet is loaded from the pinned ${GRID_VERSION} release`,
    delivery.stylesheetSrc,
  );
  check(delivery.members.setLicence === 'function', 'delivery: setLicence is on the core global');
  check(delivery.members.createStat === 'function', 'delivery: createStat is on the core global');
  check(delivery.members.createPushdownSource === 'function', 'delivery: createPushdownSource is on the core global');
  check(delivery.members.duckdbAdapter === 'function', 'delivery: duckdbAdapter is on the core global');

  const snap = await evaluate(`(() => {
    const d = window.__housePrices;
    return {
      rows: d.detailGrid.rows.count(),
      total: d.detailGrid.rows.totalCount(),
      columns: d.detailGrid.columns.visible().length,
      painted: document.querySelectorAll('.lattice [role="row"]').length,
      charts: d.charts.length,
      watermark: d.detailGrid.licence.watermark(),
      licenceState: d.detailGrid.licence.state(),
      tiles: Object.fromEntries(Object.entries(d.tiles).map(([id, t]) => [id, t.value()])),
    };
  })()`);
  console.log(`  ${snap.rows} rows, ${snap.columns} columns, ${snap.painted} painted, ${snap.charts} charts`);
  console.log(`  tiles: ${JSON.stringify(snap.tiles)}`);

  check(snap.rows > 0, 'saved copy: the table holds rows', `${snap.rows}`);
  check(snap.painted > 0, 'saved copy: the table painted rows', `${snap.painted}`);
  check(snap.charts === 6, 'saved copy: all six charts were built', `${snap.charts}`);

  /* Each chart is asked what it actually plotted, so an empty pair of axes is
     not mistaken for a chart. */
  const drawn = await evaluate(`(() => window.__housePrices.charts.map((c, i) => {
    const data = c.data();
    const svg = c.element;
    const marks = svg ? svg.querySelectorAll('rect, circle, path, line, polygon').length : 0;
    const size = data ? JSON.stringify(data).length : 0;
    return { i, marks, size };
  }))()`);
  for (const c of drawn) {
    console.log(`  chart ${c.i}: ${c.marks} marks, ${c.size} bytes of data`);
    check(c.marks > 2, `saved copy: chart ${c.i} drew marks`, `${c.marks} marks`);
    check(c.size > 20, `saved copy: chart ${c.i} has data rather than empty axes`, `${c.size} bytes`);
  }
  check(snap.watermark === false, 'saved copy: no watermark on localhost', `state ${snap.licenceState}`);
  noErrors('saved copy');
  await shoot('01-grid-saved');

  /* The independent recomputation: the saved rows, reduced here in Node. */
  const meta = JSON.parse(await readFile(join(root, 'data', 'snapshot', 'meta.json'), 'utf8'));
  const values = JSON.parse(await readFile(join(root, 'data', 'snapshot', 'sales.json'), 'utf8'));
  const cols = meta.columns;
  const prices = values.map((v) => {
    const row = {};
    cols.forEach((c, i) => { row[c] = v[i]; });
    return Number(row.price);
  });
  const expected = {
    totalValue: prices.reduce((s, p) => s + p, 0),
    sales: values.length,
    median: medianOf(prices),
    mean: prices.reduce((s, p) => s + p, 0) / prices.length,
    p95: p95Of(prices),
  };

  const tile = (id) => toNum(snap.tiles[id]);
  check(near(tile('sales'), expected.sales, 0), 'saved copy: the sales count matches the saved data', `tile ${snap.tiles.sales}, expected ${expected.sales}`);
  check(near(tile('totalValue'), expected.totalValue, 0.001), 'saved copy: the total value matches the saved data', `tile ${snap.tiles.totalValue}, expected ${Math.round(expected.totalValue)}`);
  check(near(tile('mean'), expected.mean, 0.01), 'saved copy: the mean price matches the saved data', `tile ${snap.tiles.mean}, expected ${Math.round(expected.mean)}`);
  check(near(tile('median'), expected.median, 0.01), 'saved copy: the median price matches the saved data', `tile ${snap.tiles.median}, expected ${Math.round(expected.median)}`);
  check(near(tile('p95'), expected.p95, 0.02), 'saved copy: the P95 price matches the saved data', `tile ${snap.tiles.p95}, expected ${Math.round(expected.p95)}`);

  /* ---- narrowing to flats moves the tiles and charts ---- */

  const before = await evaluate(`(() => {
    const d = window.__housePrices;
    return {
      rows: d.detailGrid.rows.count(),
      sales: d.tiles.sales.value(),
      chartSizes: d.charts.map((c) => { const data = c.data(); return data ? JSON.stringify(data).length : 0; }),
    };
  })()`);

  await evaluate('window.__housePrices.flatButton.click()');
  await sleep(700);

  const after = await evaluate(`(() => {
    const d = window.__housePrices;
    return {
      rows: d.detailGrid.rows.count(),
      sales: d.tiles.sales.value(),
      pressed: d.flatButton.getAttribute('aria-pressed'),
      chartSizes: d.charts.map((c) => { const data = c.data(); return data ? JSON.stringify(data).length : 0; }),
    };
  })()`);

  const expectedFlats = values.filter((v) => {
    const row = {};
    cols.forEach((c, i) => { row[c] = v[i]; });
    return row.type === 'F';
  }).length;

  console.log(`  narrowed: ${before.rows} rows -> ${after.rows} rows, tile ${before.sales} -> ${after.sales}`);
  check(after.pressed === 'true', 'the flats filter reports itself pressed');
  check(after.rows < before.rows, 'the flats filter narrows the table', `${before.rows} -> ${after.rows}`);
  check(toNum(after.sales) === expectedFlats, 'the narrowed tile matches the saved flat count', `tile ${after.sales}, expected ${expectedFlats}`);
  const chartsMoved = after.chartSizes.filter((size, i) => size !== before.chartSizes[i]).length;
  check(chartsMoved > 0, 'the charts rebound to the narrowed data', `${chartsMoved} of ${after.chartSizes.length} changed`);
  await shoot('02-charts-filtered');

  await evaluate('window.__housePrices.flatButton.click()');
  await sleep(500);
  const restored = await evaluate('window.__housePrices.detailGrid.rows.count()');
  check(restored === before.rows, 'removing the filter restores the table', `${restored} of ${before.rows}`);

  /* ---- grouping by county and by property type ---- */

  await evaluate("window.__housePrices.detailGrid.columns.group(['county'])");
  await sleep(600);
  const groupedCounty = await evaluate(`(() => {
    const d = window.__housePrices;
    let groups = 0;
    d.detailGrid.rows.forEach((r) => { if (r && r.group) groups += 1; });
    return { groups };
  })()`);
  check(groupedCounty.groups > 0, 'grouping by county produces group rows', `${groupedCounty.groups} groups`);
  await shoot('03-grouped-by-county');

  /* ---- pivoting the property type across the year ---- */

  await evaluate(`(() => {
    const d = window.__housePrices;
    d.detailGrid.columns.group(['year']);
    d.detailGrid.columns.pivot(['typeLabel']);
  })()`);
  await sleep(900);
  const pivoted = await evaluate(`(() => {
    const d = window.__housePrices;
    const state = d.detailGrid.state.get();
    return { pivot: (state.pivot && state.pivot.columns) || [], group: state.group || [] };
  })()`);
  console.log(`  pivot columns: ${JSON.stringify(pivoted.pivot)}, group: ${JSON.stringify(pivoted.group)}`);
  check(pivoted.pivot.includes('typeLabel'), 'pivoting the type across the top is recorded', JSON.stringify(pivoted.pivot));
  check(pivoted.group.includes('year'), 'the row axis is grouped by year', JSON.stringify(pivoted.group));
  await shoot('04-pivot');

  await evaluate(`(() => { const d = window.__housePrices; d.detailGrid.columns.pivot([]); d.detailGrid.columns.group([]); })()`);
  await sleep(500);

  /* ---- a derived summary agrees with the saved data ---- */

  await evaluate("window.__housePrices.tabs.activate('county')");
  await waitFor('window.__housePrices.tabs.tab("county") && window.__housePrices.tabs.tab("county").rows.count() > 0', 30000, 'the by-county summary');
  const byCounty = await evaluate(`(() => {
    const g = window.__housePrices.tabs.tab('county');
    let total = 0;
    g.rows.forEach((r) => { if (r && r.data && !r.group) total += Number(r.data.totalValue) || 0; });
    return { rows: g.rows.count(), total };
  })()`);
  console.log(`  by county: ${byCounty.rows} rows, total value ${Math.round(byCounty.total)}`);
  check(byCounty.rows > 0, 'the by-county derived grid holds rows', `${byCounty.rows}`);
  check(near(byCounty.total, expected.totalValue, 0.001), 'the by-county total value agrees with the saved data', `${Math.round(byCounty.total)} vs ${Math.round(expected.totalValue)}`);
  await shoot('05-by-county');

  await evaluate("window.__housePrices.tabs.activate('pareto')");
  await waitFor('window.__housePrices.tabs.tab("pareto") && window.__housePrices.tabs.tab("pareto").rows.count() > 0', 30000, 'the Pareto head');
  const pareto = await evaluate('window.__housePrices.tabs.tab("pareto").rows.count()');
  console.log(`  Pareto head: ${pareto} counties`);
  check(pareto > 0, 'the Pareto derived grid holds rows', `${pareto}`);
  check(pareto < byCounty.rows, 'the Pareto head is smaller than the full county list', `${pareto} of ${byCounty.rows}`);

  await evaluate("window.__housePrices.tabs.activate('profile')");
  await waitFor('window.__housePrices.tabs.tab("profile") && window.__housePrices.tabs.tab("profile").rows.count() > 0', 30000, 'the profile summary');
  const profileRows = await evaluate(`(() => {
    const g = window.__housePrices.tabs.tab('profile');
    let rows = [];
    g.rows.forEach((r) => { if (r && r.data) rows.push(r.data); });
    return rows;
  })()`);
  console.log(`  profile: ${profileRows.length} row(s), first keys ${profileRows[0] ? Object.keys(profileRows[0]).join(',') : ''}`);
  check(profileRows.length > 0, 'the profile derived grid holds a row', `${profileRows.length}`);

  /* ---- a pushed sale lands in the detail grid and moves the tiles ---- */

  const push = await evaluate(`(async () => {
    const d = window.__housePrices;
    const before = d.detailGrid.rows.totalCount();
    const beforeSales = d.tiles.sales.value();
    const sale = {
      id: 'VERIFY-TEST-SALE-0001',
      price: 425000,
      date: '2026-08-01',
      postcode: 'BS1 1AA',
      type: 'T',
      newBuild: 'N',
      duration: 'F',
      paon: '1',
      saon: '',
      street: 'VERIFY STREET',
      locality: '',
      town: 'BRISTOL',
      district: 'CITY OF BRISTOL',
      county: 'City of Bristol',
      category: 'A',
      status: 'A',
      typeLabel: 'Terraced',
      newBuildLabel: 'Established',
      durationLabel: 'Freehold',
      year: 2026,
      address: '1 VERIFY STREET',
      count: 1,
    };
    d.ingest([sale]);
    await new Promise((r) => setTimeout(r, 500));
    return { before, after: d.detailGrid.rows.totalCount(), beforeSales, afterSales: d.tiles.sales.value() };
  })()`);
  console.log(`  pushed sale: rows ${push.before} -> ${push.after}, sales tile ${push.beforeSales} -> ${push.afterSales}`);
  check(push.after === push.before + 1, 'a pushed sale adds one row to the detail grid', `${push.before} -> ${push.after}`);
  check(toNum(push.afterSales) === toNum(push.beforeSales) + 1, 'the pushed sale moves the sales tile', `${push.beforeSales} -> ${push.afterSales}`);

  noErrors('saved copy, after the checks');

  /* =================================================================== */
  /* 2. What a visitor gets when the live data cannot be read.           */
  /* =================================================================== */

  await call('Network.enable');
  await call('Network.setBlockedURLs', { urls: ['*duckdb-wasm*', '*prices.parquet*'] });
  await open(`${origin}/index.html?source=duckdb`, 'engine page, with the engine unreachable');
  const fallback = await evaluate(`(() => {
    const d = window.__housePrices;
    const notice = document.querySelector('.notice');
    const pill = document.querySelector('.head-note .pill');
    const freshness = document.querySelector('.freshness');
    return {
      rows: d.detailGrid.rows.totalCount(),
      painted: document.querySelectorAll('.lattice [role="row"]').length,
      fellBack: !!(d.timings && d.timings.fellBack),
      mode: d.timings && d.timings.mode,
      badge: pill ? pill.textContent.trim() : null,
      notice: notice ? notice.textContent.trim() : null,
      savedOnShown: freshness ? /saved copy/i.test(freshness.textContent) : false,
      polling: !!d.poller,
    };
  })()`);
  console.log(`  rows ${fallback.rows}, badge "${fallback.badge}", fell back: ${fallback.fellBack}`);
  console.log(`  notice: ${fallback.notice}`);
  check(fallback.rows > 0, 'fallback: the saved copy is on screen', `${fallback.rows} rows`);
  check(fallback.painted > 0, 'fallback: the table painted rows', `${fallback.painted}`);
  check(fallback.fellBack, 'fallback: the page recorded that it fell back to the saved copy');
  check(fallback.mode === 'duckdb', 'fallback: the page ran in the engine mode, not snapshot mode', `mode ${fallback.mode}`);
  check(fallback.badge === 'Saved copy', 'fallback: the badge reads "Saved copy"', `"${fallback.badge}"`);
  check(
    !!fallback.notice && /could not be read/i.test(fallback.notice),
    'fallback: the page says the data was unreachable',
    fallback.notice,
  );
  check(fallback.savedOnShown, "fallback: the saved copy's provenance is shown");
  check(!fallback.polling, 'fallback: no poll is started against an engine that could not be read');
  check(pageErrors.length === 0, 'fallback: no page errors', pageErrors.slice(0, 3).join(' | '));
  await shoot('06-fallback');
  await call('Network.setBlockedURLs', { urls: [] });

  if (all) {
    /* ================================================================= */
    /* 3. Live: the DuckDB + Parquet path.                               */
    /* ================================================================= */

    await open(`${origin}/index.html?source=duckdb`, 'engine');
    /* The Parquet is materialised asynchronously; wait for the headline tiles
       to settle on the full count before reading them back. */
    const savedCount = JSON.parse(await readFile(join(root, 'data', 'snapshot', 'meta.json'), 'utf8')).rows;
    await waitFor(`window.__housePrices.tiles.sales.value() >= ${savedCount}`, 60000, 'the live tiles to settle on the full set');
    const live = await evaluate(`(() => {
      const d = window.__housePrices;
      return {
        rows: d.detailGrid.rows.count(),
        charts: d.charts.length,
        fellBack: !!(d.timings && d.timings.fellBack),
        engine: d.timings && d.timings.engine,
        watermark: d.detailGrid.licence.watermark(),
        freshness: document.querySelector('.freshness').textContent,
        tiles: Object.fromEntries(Object.entries(d.tiles).map(([id, t]) => [id, t.value()])),
      };
    })()`);
    console.log(`  ${live.rows} rows from the live engine (${live.engine}); ${live.freshness}`);
    check(live.fellBack === false, 'live: the rows came from the engine, not the saved copy');
    check(live.rows > 0, 'live: the table holds rows from the Parquet', `${live.rows}`);
    check(live.charts === 6, 'live: all six charts were built', `${live.charts}`);
    check(live.engine === 'duckdb-wasm', 'live: the engine is DuckDB WASM', live.engine);
    check(live.watermark === false, 'live: no watermark on localhost');
    check(toNum(live.tiles.sales) === savedCount, 'live: the tiles read the whole Parquet', `${live.tiles.sales} sales, expected ${savedCount}`);
    noErrors('live');
    await shoot('07-live');
  }

  socket.close();
} catch (error) {
  failures.push(String((error && error.stack) || error));
} finally {
  if (browserPid) {
    try { process.kill(-browserPid, 'SIGKILL'); } catch {}
    try { process.kill(browserPid, 'SIGKILL'); } catch {}
  }
  if (server) server.close();
  await sleep(400);
  if (profile) await rm(profile, { recursive: true, force: true });
}

console.log('\nChecks:');
for (const note of notes) console.log(note);

if (failures.length) {
  console.error(`\nFAILED (${failures.length}):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`\nAll ${notes.length} checks passed.`);
process.exit(0);
