/**
 * Save a real run of the HM Land Registry Price Paid Data to `data/snapshot/`,
 * and write a Parquet slice beside it, so the dashboard can be opened either
 * from the saved copy (`?source=snapshot`) or by querying the Parquet in the
 * browser through DuckDB WASM.
 *
 * Run it with `node tools/build-snapshot.mjs`. It is a development tool:
 * nothing the page loads imports it.
 *
 * The feed code the page uses is a classic script, not a module, so it cannot
 * be imported. It is run here instead, in this process, exactly as the browser
 * runs it: the file leaves its functions on `globalThis.HousePrices` and they
 * are read from there. One copy of the feed code, used by both.
 *
 * The Parquet is written by `hyparquet-writer`, a small pure-JS Parquet
 * writer fetched into the operating system's temp directory on first use (and
 * cached there), so no build dependency beyond Node itself is needed to keep
 * `data/prices.parquet` fresh. If the writer cannot be fetched, the saved copy
 * still stands and the Parquet is simply left as it was.
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { runInThisContext } from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'data', 'snapshot');
const dataDir = join(here, '..', 'data');

const feedFile = join(here, '..', 'src', 'house-prices-feed.js');
runInThisContext(await readFile(feedFile, 'utf8'), { filename: feedFile });
const { fetchInitial, encodeRow, SNAPSHOT_COLUMNS, MONTHLY_CSV } = globalThis.HousePrices;

const started = Date.now();
console.log('Reading the latest Price Paid Data...');
const { rows } = await fetchInitial();
console.log(`  ${rows.length} sales received.`);

/* Sorted by transaction id so the file is stable and diffable between runs. */
rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

const values = rows.map(encodeRow);

const seconds = Number(((Date.now() - started) / 1000).toFixed(1));

const meta = {
  fetchedAt: new Date().toISOString(),
  fetchedAtMs: Date.now(),
  seconds,
  rows: values.length,
  source: 'HM Land Registry Price Paid Data (latest monthly release)',
  sourceUrl: 'https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads',
  apiUrl: MONTHLY_CSV,
  licence: 'Open Government Licence v3.0',
  columns: SNAPSHOT_COLUMNS,
};

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'sales.json'), JSON.stringify(values));
await writeFile(join(outDir, 'meta.json'), JSON.stringify(meta, null, 2));
/* An inline copy, loaded by a classic <script> in index.html, so the saved
   copy also works when the page is opened straight from disk with no server. */
await writeFile(join(outDir, 'snapshot.js'), `window.HOUSE_PRICES_SNAPSHOT = ${JSON.stringify({ rows: values, meta })};`);

const salesBytes = (await stat(join(outDir, 'sales.json'))).size;
console.log(`\nSaved ${values.length} sales in ${seconds}s.`);
console.log(`sales.json is ${(salesBytes / 1024 / 1024).toFixed(1)} MB.`);

/* ---------------- the Parquet slice ---------------- */

/* The Parquet mirrors the flat rows the browser expects, with the derived
   fields (`year`, the labels, the address, `count`) written out rather than
   rebuilt, so the DuckDB path and the saved copy present identical columns. */
const PARQUET_COLUMNS = [
  ['id', 'STRING'],
  ['price', 'INT32'],
  ['date', 'STRING'],
  ['year', 'INT32'],
  ['postcode', 'STRING'],
  ['type', 'STRING'],
  ['newBuild', 'STRING'],
  ['duration', 'STRING'],
  ['typeLabel', 'STRING'],
  ['newBuildLabel', 'STRING'],
  ['durationLabel', 'STRING'],
  ['address', 'STRING'],
  ['town', 'STRING'],
  ['district', 'STRING'],
  ['county', 'STRING'],
  ['category', 'STRING'],
  ['status', 'STRING'],
  ['count', 'INT32'],
];

const PARQUET_WRITER_VERSION = '0.16.9';
const PARQUET_WRITER_URL = `https://esm.sh/hyparquet-writer@${PARQUET_WRITER_VERSION}/es2022/hyparquet-writer.bundle.mjs`;

/** The bundled writer, cached in the temp directory so a rebuild is offline. */
async function loadParquetWriter() {
  const cache = join(tmpdir(), `hyparquet-writer-${PARQUET_WRITER_VERSION}.bundle.mjs`);
  try {
    return await import(pathToFileURL(cache).href);
  } catch {
    /* fetch and cache */
  }
  console.log('  fetching the Parquet writer...');
  const response = await fetch(PARQUET_WRITER_URL);
  if (!response.ok) throw new Error(`the Parquet writer could not be fetched (${response.status})`);
  const source = await response.text();
  await writeFile(cache, source);
  return await import(pathToFileURL(cache).href);
}

try {
  const { parquetWriteBuffer } = await loadParquetWriter();

  const asString = (field) => rows.map((row) => (row[field] == null ? '' : String(row[field])));
  const asInt = (field) => rows.map((row) => Number(row[field]) || 0);

  const columnData = PARQUET_COLUMNS.map(([name, type]) => ({
    name,
    type,
    data: type === 'INT32' ? asInt(name) : asString(name),
  }));

  const buffer = parquetWriteBuffer({ columnData });
  await writeFile(join(dataDir, 'prices.parquet'), Buffer.from(buffer));
  const parquetBytes = buffer.byteLength;
  console.log(`prices.parquet is ${(parquetBytes / 1024 / 1024).toFixed(1)} MB (${parquetBytes} bytes).`);
} catch (error) {
  console.warn(`  the Parquet slice was not written: ${(error && error.message) || error}`);
  console.warn('  the saved copy is unaffected; only the DuckDB live path needs the Parquet.');
}
