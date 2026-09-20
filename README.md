# House prices in England and Wales, as they were paid

A dashboard of every property sale HM Land Registry has published in the latest
monthly release, grouped and pivoted by county, property type and year, built
on Lattice Grid loaded by `<script>` tag: no npm install, no bundler, no build
step, no `type="module"`.

**[See it running](https://toclocoinc.github.io/lattice-grid-demo-house-prices-umd/)**

| | |
| --- | --- |
| Grid on npm | [@toclocoinc/lattice-grid](https://www.npmjs.com/package/@toclocoinc/lattice-grid) |
| Grid repository | [toclocoinc/latticegrid](https://github.com/toclocoinc/latticegrid) |
| Product site | [latticegrid.dev](https://www.latticegrid.dev) |
| The same demo as an ESM package | [lattice-grid-demo-house-prices](https://github.com/toclocoinc/lattice-grid-demo-house-prices) |

It is one stream of property sales with many views on it: the transaction table
itself, a pivot matrix, four derived summaries (by county, by property type, by
year, and a Pareto head), and a statistical profile of the price column. They
all read the same stream, so narrowing the table moves every headline figure,
chart and summary with it.

The point of the demo is the analysis, not the table. A hundred thousand sales
is small enough to hold in memory but large enough that the reductions — the
median, the P95, the Pareto head, the rank and percentile of each sale — mean
something. The default view reads a plain JSON file, so the dashboard runs
everywhere with no engine at all; add `?source=duckdb` and the same data is
read as a Parquet file queried in the browser through DuckDB WASM, driving the
grid through its `duckdbAdapter`.

## How the grid gets onto the page

Six tags in `index.html`, and that is the whole of the library setup:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@toclocoinc/lattice-grid@1.65.0/lattice-grid.min.css">

<script src="https://cdn.jsdelivr.net/npm/@toclocoinc/lattice-grid@1.65.0/lattice-grid.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@toclocoinc/lattice-grid@1.65.0/modules/charts.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@toclocoinc/lattice-grid@1.65.0/modules/data-router.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@toclocoinc/lattice-grid@1.65.0/modules/kpi.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@toclocoinc/lattice-grid@1.65.0/modules/tabs.min.js"></script>
```

Each file is the package's UMD build (`*.min.js`, beside the `*.esm.min.js`
the ESM edition imports) and leaves a global behind:

| File | Global | Used here for |
| --- | --- | --- |
| `lattice-grid.min.js` | `LatticeGrid` | `createGrid`, `setLicence`, `createStat`, `createPushdownSource`, `duckdbAdapter` |
| `modules/charts.min.js` | extends `LatticeGrid` | `LatticeGrid.createChart` |
| `modules/data-router.min.js` | `LatticeGridDataRouter` | `createDataRouter` |
| `modules/kpi.min.js` | `LatticeGridKPI` | `createKPI` (loaded for completeness; the headline tiles use `createStat`) |
| `modules/tabs.min.js` | `LatticeGridTabs` | `createTabs` |

The charts module folds its exports into the core global rather than defining
one of its own, so its tag must come after the core's. The other three are
self-contained and can go in any order. `main.js` checks that every factory it
needs is actually there before it draws anything, so a tag that did not load
is reported as a sentence rather than as an error from inside the grid.

Every address names the exact release, `1.65.0`, and every tag carries the
`integrity` hash of the file it expects. The page cannot quietly pick up a
different build than the one it was checked against, and the browser refuses
a file that does not match. The hashes are the SHA-384 of the published files.

The demo's own code is four classic scripts, loaded in order after the
library: `src/licence.js`, `src/house-prices-feed.js`, `src/dashboard.js`,
`main.js`. Each file wraps itself in a function and puts what it offers on one
plain object, `HousePrices`, for the next file to read. `src/dashboard.js` is
handed the grid's factories as arguments and never touches a global itself.

## Running it

You need nothing but a browser and a way to serve the folder, because the
page fetches its data with `fetch()` and browsers will not do that from
`file://`. Any static server will do; one is included:

```
node tools/serve.mjs
```

That prints an address. Open it.

| Address | What you get |
| --- | --- |
| `/` | the saved copy in `data/snapshot`, no engine needed (the default) |
| `/?source=duckdb` | the same data as a Parquet file queried in the browser through DuckDB WASM |

Running a copy on your own machine needs no licence key. Publishing it on a
web address does.

## What it shows

**One stream, many views.** The transaction table is the hub. The headline
tiles, the six charts, the four derived summaries and the statistical profile
all read it, so a filter, a grouping or a pivot moves every view together.

**Prices drawn as money.** The price column carries an in-cell data bar, and
conditional-formatting rules the grid holds as runtime state — a reader can
open the Formatting panel and change them. Each property type is a pill with a
variant colour, and the address is a two-line cell: house over postcode.

**Every sale knows its place.** Three shadow columns — rank, percentile and
share of total value — are computed by the grid from the price column rather
than stored, so they sort, filter and export like any other column.

**A pivot in the table itself.** Group the rows down the left gutter and pivot
the property type across the top, and the same grid becomes a cross-tab of
summed prices and counts, with a grand total column.

**Derived summaries, not hand-rolled.** The by-county, by-property-type and
by-year tabs are derived grids: they reduce the transaction grid with kernels
(`sum`, `avg`, `median`, `p95`, `distinct`, `count`) and stay in step with it.
The Pareto tab keeps only the counties that make up 80% of the total value,
using `cumulative`.

**A statistical profile as a table.** The Profile tab is a derived grid with
`profile: ['price']` — one row carrying the mean, median, quartiles, standard
deviation and outlier count of the price column, computed by the grid's
statistics engine.

**Headline figures with an interval.** The five tiles are `createStat` blocks
bound to the grid: total value, sales, median, mean and P95 price. The median
carries a confidence interval from `grid.statistics.interval('price')`, and
the tiles reformat through the column's own currency type.

**Distributions, not just totals.** Six charts draw from the same rows: a
histogram of prices, a box plot of price by property type, a treemap of value
by county, sales and value by year, and a Pareto of value by county.

**A feed that can fail.** If DuckDB WASM cannot load, or the Parquet cannot be
read, the page opens the saved copy instead and says so under the title.

## The data

Everything comes from the HM Land Registry Price Paid Data:

- <https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads>

The page reads the latest monthly release as a single CSV, published at a
stable address with no key needed:

- `https://price-paid-data.publicdata.landregistry.gov.uk/pp-monthly-update-new-version.csv`

Each record is one property sale, as a sixteen-column line: the transaction
unique identifier, the price, the date of transfer, the postcode, the property
type (`D`/`S`/`T`/`F`/`O`), whether it was a new build (`Y`/`N`), the tenure
(`F` freehold / `L` leasehold), the address in PAON / SAON / street form, the
locality, town, district and county, the PPD category (`A` standard / `B`
additional) and the record status (`A` added / `C` changed / `D` deleted).

The data are published under the Open Government Licence v3.0 and are free to
use. A few things worth knowing about the data:

- The identifier is the transaction unique identifier, a GUID in braces. The
  router keys on it, so a corrected sale lands on the row it belongs to rather
  than adding a second one.
- The monthly file is an update release rather than a clean month: it carries
  the latest month's transactions plus additions and corrections to earlier
  releases, so its dates span several years. That spread is what the by-year
  summary draws on.
- A handful of very large lot-sales push the mean far above the median, which
  is why the page reports the mean, the median and the P95 rather than one
  figure dressed as "the" price.
- Address fields are upper-cased in the source; the feed title-cases them for
  display (small words left lower-case) and keeps the postcode as published.

## Files

```
index.html                page shell, and the six library tags
main.js                   works out where the data comes from, then starts
src/licence.js            the key for this demo's own published address
src/house-prices-feed.js  the API: the monthly CSV, parsing, snapshot encode/decode
src/dashboard.js          the views: router, grid, pivot, derived grids, tiles, charts
styles.css                the page around the grid
tools/serve.mjs           a small static file server
tools/build-snapshot.mjs  save a real run into data/snapshot, and write the Parquet
tools/verify.mjs          open it in a real browser and check it
data/snapshot/            a saved run, so the demo works without the engine
data/prices.parquet       the same rows as a Parquet file, for the DuckDB path
```

There is no `package.json` and no `node_modules`. The tools need Node 22 or
newer and nothing else.

The saved copy is a compact array of arrays — one value per column, in the
order `meta.json` documents — so a hundred thousand sales stay a manageable
download. The browser unpacks it with the same code that parses the live CSV,
so the two paths produce identical rows.

## Building the saved copy

```
node tools/build-snapshot.mjs
```

It reads the latest monthly CSV, title-cases the address fields, and writes the
compact form to `data/snapshot/`. It then writes the same rows as
`data/prices.parquet`, using a small pure-JS Parquet writer fetched into the
system temp directory on first use, so the DuckDB live path and the saved copy
describe the same data. Re-run it to refresh the copy.

## Checking it

```
node tools/verify.mjs          # open the page in a real browser and assert
node tools/verify.mjs --all    # also open the live DuckDB path
```

`tools/verify.mjs` is not a smoke test. It first insists on how the library
arrived: no `type="module"` script anywhere on the page, five script tags
pointing at the pinned release on the CDN, each with an integrity hash, and
each leaving the global it documents. It then recomputes the headline figures
from the saved data and compares them with what the page is showing, narrows
the table and insists the tiles and charts moved with it, groups by county,
pivots the type across the year, opens the derived summaries and checks the
Pareto head is a subset of the county list, pushes a sale through and insists
the count moved by exactly one, and finally blocks the engine in the browser
and insists the saved copy appears with a notice saying why. The GitHub Pages
workflow runs it before every publish.

## Licence

The demo code is MIT. See `LICENSE`.

The price data is from HM Land Registry, published under the Open Government
Licence v3.0 and free to use, with the attribution statement the release asks
for: "Contains HM Land Registry data © Crown copyright and database right 2021."

Lattice Grid itself is a separate commercial product with its own terms. It is
free to use on localhost, with no key and no watermark, so a copy of this
repository runs unrestricted on your own machine. This demo carries a key for
its own published address only, which is why you will find one in the source.
Keys for your own sites come from [latticegrid.dev](https://www.latticegrid.dev).

---
Built with [Lattice Grid](https://www.latticegrid.dev), a JavaScript data grid with a Data Router: one live feed keeps grids, charts, boards, Gantt and KPI tiles in step. [Documentation](https://www.latticegrid.dev/docs/) · [Demos](https://www.latticegrid.dev/demos/) · [Licence](https://www.latticegrid.dev/licence/)
