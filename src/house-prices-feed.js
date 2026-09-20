/**
 * HM Land Registry Price Paid Data: reading the monthly CSV, turning each
 * record into a flat row, and packing rows into the compact array form the
 * snapshot stores.
 *
 * Nothing here knows about the grid. It produces plain objects and hands them
 * to whoever asked, so the same code feeds the live page, the saved copy and
 * the snapshot tool.
 *
 * The Price Paid Data is public and needs no key. The current month's file is
 * a single CSV published at a stable address; every record is one property
 * sale, with the price, the date of transfer, the postcode, the property type
 * (D/S/T/F/O), whether it was a new build, the tenure, the address in PAON /
 * SAON / street form, and the county, district and town.
 *
 * This is a classic script, not a module: there is no `import` or `export`
 * anywhere on this page. What this file offers is put on `HousePrices`, a
 * plain object on the global, and the next script reads it from there. The
 * snapshot tool runs this same file under Node, which is why it looks for
 * `globalThis` rather than `window`.
 */
(function (root) {
  'use strict';

  /** The current month's file. One CSV, ~100k rows, no key needed. */
  const BASE = 'https://price-paid-data.publicdata.landregistry.gov.uk';
  const MONTHLY_CSV = `${BASE}/pp-monthly-update-new-version.csv`;

  /** How many rows the snapshot tool aims to save. The file is about this size
      on its own, so the cap rarely binds; it is there as a safety valve. */
  const TARGET_ROWS = 150000;

  /** The parcel of data the browser-side DuckDB query reads. */
  const PARQUET_URL = './data/prices.parquet';

  /** How often the live page would poll the API. Sales are published monthly
      rather than by the minute, so this is deliberately slow. */
  const POLL_MS = 10 * 60 * 1000;

  /** The property-type codes and their long names. */
  const PROPERTY_TYPES = {
    D: 'Detached',
    S: 'Semi-detached',
    T: 'Terraced',
    F: 'Flat/maisonette',
    O: 'Other',
  };

  /** The tenure codes and their long names. */
  const DURATIONS = {
    F: 'Freehold',
    L: 'Leasehold',
  };

  /**
   * The order the snapshot stores its fields in, so a compact array can be
   * decoded back into a row. Shared by the browser and the snapshot tool.
   */
  const SNAPSHOT_COLUMNS = [
    'id', 'price', 'date', 'postcode', 'type', 'newBuild', 'duration',
    'paon', 'saon', 'street', 'locality', 'town', 'district', 'county',
    'category', 'status',
  ];

  /** Small words left lower-case by {@link titleCase}, in the middle of a name. */
  const SMALL_WORDS = new Set([
    'and', 'of', 'the', 'upon', 'in', 'on', 'by', 'under', 'near',
  ]);

  /**
   * Title-case an all-caps name from the register: "CLAVERTON ROAD" becomes
   * "Claverton Road", "BATH AND NORTH EAST SOMERSET" becomes
   * "Bath and North East Somerset". Small words are left lower-case except
   * when they lead the name.
   *
   * @param {string} value the raw, upper-cased name
   * @returns {string} the display form
   */
  function titleCase(value) {
    if (value == null) return '';
    const words = String(value).trim().toLowerCase().split(/\s+/).filter(Boolean);
    return words
      .map((word, index) => {
        if (index > 0 && SMALL_WORDS.has(word)) return word;
        return word.charAt(0).toUpperCase() + word.slice(1);
      })
      .join(' ');
  }

  /** The calendar year of a `YYYY-MM-DD` date, or null. */
  function yearOf(date) {
    return date ? Number(date.slice(0, 4)) : null;
  }

  /**
   * Turn one CSV record (an array of the sixteen columns) into a flat row.
   *
   * @param {string[]} fields one line of the monthly CSV, already split
   * @returns {object|null} the row, or null when the record has no identity
   */
  function toRow(fields) {
    if (!fields || fields.length < 16) return null;
    const id = String(fields[0] || '').replace(/[{}]/g, '').trim();
    if (!id) return null;
    const price = Number(fields[1]);
    const date = String(fields[2] || '').slice(0, 10) || null;
    const type = String(fields[4] || '').trim() || 'O';
    const newBuild = String(fields[5] || '').trim() === 'Y' ? 'Y' : 'N';
    const duration = String(fields[6] || '').trim() === 'L' ? 'L' : 'F';
    const paon = titleCase(fields[7]);
    const saon = titleCase(fields[8]);
    const street = titleCase(fields[9]);
    const town = titleCase(fields[11]);
    const district = titleCase(fields[12]);
    const county = titleCase(fields[13]);
    return {
      id,
      price,
      date,
      postcode: String(fields[3] || '').trim(),
      type,
      newBuild,
      duration,
      paon,
      saon,
      street,
      locality: titleCase(fields[10]),
      town,
      district,
      county,
      category: String(fields[14] || '').trim() || 'A',
      status: String(fields[15] || '').trim() || 'A',
      /* Derived fields, rebuilt by decodeRow rather than stored. */
      typeLabel: PROPERTY_TYPES[type] || 'Other',
      newBuildLabel: newBuild === 'Y' ? 'New build' : 'Established',
      durationLabel: DURATIONS[duration] || 'Freehold',
      year: yearOf(date),
      address: [paon || saon, street].filter(Boolean).join(' '),
      /* Always 1. It is what the charts and the group subtotals add up. */
      count: 1,
    };
  }

  /**
   * Pack a row into the compact array form the snapshot stores.
   *
   * @param {object} row a row from {@link toRow}
   * @returns {Array} one value per {@link SNAPSHOT_COLUMNS}
   */
  function encodeRow(row) {
    return SNAPSHOT_COLUMNS.map((col) => row[col]);
  }

  /**
   * Unpack a compact snapshot array back into a row, deriving the fields that
   * are not stored from the ones that are.
   *
   * @param {Array} values one value per {@link SNAPSHOT_COLUMNS}
   * @returns {object} a row in the same shape {@link toRow} produces
   */
  function decodeRow(values) {
    const row = {};
    SNAPSHOT_COLUMNS.forEach((col, index) => {
      row[col] = values[index];
    });
    row.typeLabel = PROPERTY_TYPES[row.type] || 'Other';
    row.newBuildLabel = row.newBuild === 'Y' ? 'New build' : 'Established';
    row.durationLabel = row.duration === 'L' ? 'Leasehold' : 'Freehold';
    row.year = yearOf(row.date);
    row.address = [row.paon || row.saon, row.street].filter(Boolean).join(' ');
    row.count = 1;
    return row;
  }

  /**
   * Fetch the monthly CSV, retrying a moment later when the service has a
   * wobble. The register is updated monthly and serves this one file without
   * auth, so a short pause and retry is enough rather than giving up.
   *
   * @param {{signal?: AbortSignal}} [opts]
   * @returns {Promise<string>} the raw CSV text
   */
  async function fetchCsv(opts = {}) {
    const maxAttempts = 4;
    for (let attempt = 1; ; attempt += 1) {
      const response = await fetch(MONTHLY_CSV, { signal: opts.signal, cache: 'no-store' });
      if (response.ok) return response.text();
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
        continue;
      }
      throw new Error(`The Price Paid Data answered ${response.status}.`);
    }
  }

  /**
   * Split CSV text into records, honouring quoted fields. Addresses can hold
   * a comma, so a split on the comma alone would tear a record apart.
   *
   * @param {string} text the CSV body
   * @returns {string[][]} one array of fields per record
   */
  function parseCsv(text) {
    const rows = [];
    let field = '';
    let record = [];
    let quoted = false;
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (quoted) {
        if (char === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 1;
          } else {
            quoted = false;
          }
        } else {
          field += char;
        }
      } else if (char === '"') {
        quoted = true;
      } else if (char === ',') {
        record.push(field);
        field = '';
      } else if (char === '\n' || char === '\r') {
        if (char === '\r' && text[i + 1] === '\n') i += 1;
        if (record.length || field.length) {
          record.push(field);
          rows.push(record);
          record = [];
          field = '';
        }
      } else {
        field += char;
      }
    }
    if (record.length || field.length) {
      record.push(field);
      rows.push(record);
    }
    return rows;
  }

  /**
   * Read the live page's starting data from the monthly CSV.
   *
   * @param {{signal?: AbortSignal, onProgress?: Function}} [opts]
   * @returns {Promise<{rows: object[]}>}
   */
  async function fetchInitial(opts = {}) {
    const report = opts.onProgress || (() => {});
    report('Reading the latest Price Paid Data...', 0.1);
    const csv = await fetchCsv(opts);
    report('Parsing the sales...', 0.7);
    const records = parseCsv(csv);
    const rows = [];
    for (const fields of records) {
      const row = toRow(fields);
      if (row) rows.push(row);
    }
    report('Building the dashboard...', 1);
    return { rows };
  }

  /**
   * Poll the CSV for changes and report each result. The file is republished
   * monthly rather than streamed, so a poll re-reads it wholesale.
   *
   * @param {object} opts
   * @param {(result: object) => void} opts.onPoll called with each successful poll
   * @param {(error: Error) => void} [opts.onError] called when a poll fails
   * @param {number} [opts.intervalMs] how often to poll
   * @returns {{stop: Function, pollNow: Function}} a handle that stops the polling
   */
  function startPolling({ onPoll, onError, intervalMs = POLL_MS }) {
    let stopped = false;
    let timer = null;
    let polls = 0;
    const controller = new AbortController();

    const runOnce = async () => {
      if (stopped) return;
      polls += 1;
      try {
        const csv = await fetchCsv({ signal: controller.signal });
        const rows = parseCsv(csv).map(toRow).filter(Boolean);
        if (!stopped) onPoll({ rows, fetchedAt: Date.now(), poll: polls });
      } catch (error) {
        if (!stopped && onError) onError(error);
      }
    };

    timer = setInterval(runOnce, intervalMs);

    return {
      stop() {
        stopped = true;
        clearInterval(timer);
        controller.abort();
      },
      pollNow: runOnce,
    };
  }

  /** Read the saved copy that ships with the demo.
   *
   * The copy is loaded twice over: once as a classic `<script>` in `index.html`
   * (`data/snapshot/snapshot.js`, which leaves `HOUSE_PRICES_SNAPSHOT` on the
   * global), so the dashboard also runs when the page is opened straight from
   * disk with no server; and again here, as a `fetch`, for the snapshot tool
   * and any host that prefers it. The inline copy wins when present.
   */
  async function readSnapshot() {
    const inline = root.HOUSE_PRICES_SNAPSHOT;
    if (inline && Array.isArray(inline.rows)) {
      return { rows: inline.rows.map(decodeRow), meta: { ...inline.meta, live: false } };
    }
    const [values, meta] = await Promise.all(
      ['sales', 'meta'].map(async (name) => {
        const response = await fetch(`./data/snapshot/${name}.json`);
        if (!response.ok) throw new Error(`The saved copy is missing ${name}.json.`);
        return response.json();
      }),
    );
    return { rows: values.map(decodeRow), meta: { ...meta, live: false } };
  }

  root.HousePrices = Object.assign(root.HousePrices || {}, {
    BASE,
    MONTHLY_CSV,
    PARQUET_URL,
    TARGET_ROWS,
    POLL_MS,
    PROPERTY_TYPES,
    DURATIONS,
    SNAPSHOT_COLUMNS,
    titleCase,
    toRow,
    encodeRow,
    decodeRow,
    parseCsv,
    fetchCsv,
    fetchInitial,
    startPolling,
    readSnapshot,
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
