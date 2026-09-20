/**
 * The dashboard: one stream of property sales, and every view built on top of
 * it.
 *
 * The detail grid is the hub. Nothing here fetches anything and nothing here
 * reaches for the grid's globals: every factory is handed in, so this file is
 * the same whether the library arrived by script tag, as it does here, or by
 * import, as it does in the ESM edition of this demo.
 *
 * How the pieces fit together:
 *
 *   the sales  ->  the router  ->  the detail grid  ->  the headline tiles
 *                                 ->  derived grids        the six charts
 *                                 ->  the statistics
 *
 * The detail grid holds the individual transactions. The tiles and the charts
 * read it, and the five summary tabs (by county, by type, by year, the Pareto
 * head, and a statistical profile) are derived grids that read it too, so a
 * filter or a grouping moves every view together.
 *
 * A classic script: it reads the constants from `HousePrices`, put there by
 * `house-prices-feed.js`, and adds `buildDashboard` alongside them.
 */
(function (root) {
  'use strict';

  const { PROPERTY_TYPES, DURATIONS } = root.HousePrices;

  /** Make an element with a class and optional text, the long way round. */
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /** One number, written the way a reader expects to see it. */
  function commas(value) {
    return Number(value || 0).toLocaleString('en-GB');
  }

  /** A price, in whole pounds. */
  function pounds(value) {
    if (value == null) return '';
    return '£' + Math.round(value).toLocaleString('en-GB');
  }

  /**
   * A large amount of money, short enough to read in a tile.
   *
   * The total of every sale published runs to fifteen characters written out
   * in full, which is wider than a fifth of the strip; compacted it is six.
   */
  function poundsCompact(value) {
    if (value == null || !Number.isFinite(Number(value))) return '';
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP',
      notation: 'compact',
      maximumFractionDigits: 2,
    }).format(value);
  }

  /** A clock time, local to whoever is reading. */
  function clockText(ms) {
    return new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  /** The 95th percentile of a numeric array, for the price data bar's ceiling. */
  function p95Of(values) {
    return percentileOf(values, 0.95);
  }

  /**
   * The value at a quantile of a numeric array.
   *
   * The price distribution has a very long tail -- a handful of lot sales and
   * portfolio transfers run to hundreds of millions against a median of
   * £285,000 -- so the charts of it need a ceiling that is not the maximum.
   *
   * @param {number[]} values the readings
   * @param {number} q the quantile, 0..1
   * @returns {number} the value at that quantile
   */
  function percentileOf(values, q) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.floor((sorted.length - 1) * q);
    return sorted[index] || 0;
  }

  /* ------------------------------------------------------------------ */
  /* The detail grid                                                     */
  /* ------------------------------------------------------------------ */

  /** The colours each property type is rendered with, pill and tint alike. */
  const TYPE_VARIANTS = {
    Detached: 'success',
    'Semi-detached': 'info',
    Terraced: 'warning',
    'Flat/maisonette': 'accent',
    Other: 'neutral',
  };

  /**
   * The transaction columns, grouped under three headings.
   *
   * The address is a two-line cell (house over postcode), the property type is
   * a pill with a variant per type, the price carries an in-cell data bar and
   * runtime formatting rules, and the rank/percentile/share columns are shadow
   * columns the grid computes rather than fields in the data.
   *
   * @param {number} barMax the data bar's ceiling, taken from the data
   * @returns {object[]} the column definitions
   */
  function saleColumns(barMax) {
    return [
      {
        title: 'The sale',
        columns: [
          {
            id: 'address',
            field: 'address',
            title: 'Address',
            cell: { render: 'twoline', props: { secondary: 'postcode' } },
            filter: { type: 'text' },
            layout: { width: 280 },
          },
          {
            id: 'price',
            field: 'price',
            title: 'Price',
            type: 'number',
            format: 'currency:GBP:0',
            cell: { decoration: { type: 'bar', min: 0, max: barMax } },
            total: 'sum',
            groupTotal: 'sum',
            filter: { type: 'number' },
            layout: { width: 130 },
          },
          {
            id: 'date',
            field: 'date',
            title: 'Transferred',
            type: 'date',
            filter: { type: 'date' },
            layout: { width: 120 },
          },
          {
            id: 'year',
            field: 'year',
            title: 'Year',
            type: 'number',
            filter: { type: 'number' },
            layout: { width: 90, hidden: true },
          },
          {
            id: 'count',
            field: 'count',
            title: 'Sales',
            type: 'number',
            total: 'sum',
            groupTotal: 'sum',
            filter: { type: 'none' },
            layout: { width: 80, hidden: true },
          },
        ],
      },
      {
        title: 'The property',
        columns: [
          {
            id: 'typeLabel',
            field: 'typeLabel',
            title: 'Property type',
            cell: { decoration: 'pill', variant: { map: TYPE_VARIANTS, default: 'neutral' } },
            filter: { type: 'set' },
            layout: { width: 150 },
          },
          {
            id: 'newBuildLabel',
            field: 'newBuildLabel',
            title: 'Build',
            cell: { decoration: 'pill', variant: { map: { 'New build': 'warning', Established: 'neutral' }, default: 'neutral' } },
            filter: { type: 'set' },
            layout: { width: 120 },
          },
          {
            id: 'durationLabel',
            field: 'durationLabel',
            title: 'Tenure',
            filter: { type: 'set' },
            layout: { width: 100 },
          },
        ],
      },
      {
        title: 'Where',
        columns: [
          {
            id: 'postcode',
            field: 'postcode',
            title: 'Postcode',
            filter: { type: 'text' },
            layout: { width: 100 },
          },
          {
            id: 'town',
            field: 'town',
            title: 'Town',
            filter: { type: 'text' },
            layout: { width: 130 },
          },
          {
            id: 'district',
            field: 'district',
            title: 'District',
            filter: { type: 'text' },
            layout: { width: 140 },
          },
          {
            id: 'county',
            field: 'county',
            title: 'County',
            filter: { type: 'set' },
            layout: { width: 150 },
          },
        ],
      },
      {
        title: 'Where it ranks',
        columns: [
          {
            id: 'rank',
            field: 'price',
            shadow: { kind: 'rank' },
            title: 'Price rank',
            type: 'number',
            layout: { width: 100 },
          },
          {
            id: 'percentile',
            field: 'price',
            shadow: { kind: 'percentile' },
            title: 'Percentile',
            type: 'number',
            /* The kernel reports a percentile as 0..100 already, so this is a
               plain number with a percent sign after it, not a ratio. */
            format: { type: 'number', decimals: 1, suffix: '%' },
            layout: { width: 100 },
          },
          {
            id: 'share',
            field: 'price',
            shadow: { kind: 'shareOfTotal' },
            title: 'Share of value',
            type: 'number',
            /* A share of the total is a ratio between 0 and 1; `style: 'percent'`
               is what turns it into a percentage. */
            format: { type: 'number', style: 'percent', decimals: 3 },
            layout: { width: 110 },
          },
        ],
      },
    ];
  }

  /**
   * The conditional-formatting rules the grid holds as runtime state, so a
   * reader can open the Formatting panel and change them.
   *
   * Property type carries a soft tint per type; price carries the money rules
   * (under £100k, and a million pounds or more).
   *
   * @returns {object} rules keyed by column id
   */
  function formattingRules() {
    /*
     * The property type is drawn as a coloured pill, so tinting the cell
     * behind it said the same thing twice in two different ways -- and the
     * tint is the weaker of the two, because a wash of colour has to be
     * learned before it means anything. The pill stays; the rules the reader
     * can edit are the ones about money, where the value itself carries no
     * other signal.
     */
    return {
      price: [
        {
          id: 'price-under',
          label: 'Under £100,000',
          when: { op: 'lt', value: 100000 },
          style: { background: '#eaf3fb', color: '#174a7c' },
        },
        {
          id: 'price-million',
          label: 'A million or more',
          when: { op: 'gte', value: 1000000 },
          style: { background: '#fdf3d8', color: '#7a4b00', fontWeight: '700' },
        },
      ],
    };
  }

  /** The shared settings the detail grid and the derived grids use. */
  function baseGridConfig(title) {
    return {
      rowKey: 'id',
      formatting: formattingRules(),
      theme: 'light',
      density: 'comfortable',
      stripedRows: true,
      columnMenu: true,
      groupPanel: true,
      statusBar: true,
      find: true,
      grandTotalRow: 'bottom',
      groupDefaultExpanded: 0,
      pivot: { groupTotals: 'after' },
      selection: 'multiple',
      title,
    };
  }

  /* ------------------------------------------------------------------ */
  /* The derived grids                                                   */
  /* ------------------------------------------------------------------ */

  /** The money columns a grouped summary shares: a currency formatter. */
  function moneyColumn(id, title, width) {
    return { id, field: id, title, type: 'number', format: 'currency:GBP:0', layout: { width: width || 130 } };
  }

  /**
   * The columns for each derived summary, from the select keys of its source.
   *
   * @param {string} groupField the group key (county / typeLabel / year)
   * @param {string} groupTitle its heading
   * @param {boolean} withStats include the median/p95/mean money columns
   * @returns {object[]}
   */
  function summaryColumns(groupField, groupTitle, withStats) {
    const columns = [
      { id: groupField, field: groupField, title: groupTitle, layout: { width: 220 } },
      { id: 'sales', field: 'sales', title: 'Sales', type: 'number', total: 'sum', layout: { width: 90 } },
      moneyColumn('totalValue', 'Total value', 150),
    ];
    if (withStats) {
      columns.push(
        moneyColumn('mean', 'Mean', 120),
        moneyColumn('median', 'Median', 120),
        moneyColumn('p95', 'P95', 120),
        { id: 'postcodes', field: 'postcodes', title: 'Distinct postcodes', type: 'number', layout: { width: 130 } },
      );
    }
    return columns;
  }

  /** The select kernels the county and type summaries share. */
  function richSelect() {
    return {
      sales: { fn: 'count' },
      totalValue: { of: 'price', fn: 'sum' },
      mean: { of: 'price', fn: 'avg' },
      median: { of: 'price', fn: 'median' },
      p95: { of: 'price', fn: 'p95' },
      postcodes: { of: 'postcode', fn: 'distinct' },
    };
  }

  /**
   * The five derived tabs, each a grid whose rows come from the detail grid.
   *
   * @param {object} detailGrid the transactions grid
   * @returns {object[]} tab descriptors for `createTabs`
   */
  function derivedTabs(detailGrid) {
    return [
      {
        id: 'county',
        label: 'By county',
        badge: true,
        config: {
          ...baseGridConfig('Sales grouped by county'),
          columns: summaryColumns('county', 'County', true),
          source: {
            mode: 'derived',
            from: detailGrid,
            groupBy: 'county',
            select: richSelect(),
            sort: [{ col: 'totalValue', dir: 'desc' }],
            crossFilter: true,
          },
        },
      },
      {
        id: 'type',
        label: 'By property type',
        badge: true,
        config: {
          ...baseGridConfig('Sales grouped by property type'),
          columns: summaryColumns('typeLabel', 'Property type', true),
          source: {
            mode: 'derived',
            from: detailGrid,
            groupBy: 'typeLabel',
            select: richSelect(),
            sort: [{ col: 'totalValue', dir: 'desc' }],
            crossFilter: true,
          },
        },
      },
      {
        id: 'year',
        label: 'By year',
        badge: true,
        config: {
          ...baseGridConfig('Sales grouped by year'),
          columns: [
            { id: 'year', field: 'year', title: 'Year', type: 'number', layout: { width: 100 } },
            { id: 'sales', field: 'sales', title: 'Sales', type: 'number', total: 'sum', layout: { width: 100 } },
            moneyColumn('totalValue', 'Total value', 160),
            moneyColumn('mean', 'Mean price', 140),
            moneyColumn('median', 'Median price', 140),
          ],
          source: {
            mode: 'derived',
            from: detailGrid,
            groupBy: 'year',
            select: {
              sales: { fn: 'count' },
              totalValue: { of: 'price', fn: 'sum' },
              mean: { of: 'price', fn: 'avg' },
              median: { of: 'price', fn: 'median' },
            },
            sort: [{ col: 'year', dir: 'desc' }],
          },
        },
      },
      {
        id: 'pareto',
        label: 'Pareto',
        badge: true,
        config: {
          ...baseGridConfig('The counties that make up 80% of the value'),
          columns: [
            { id: 'county', field: 'county', title: 'County', layout: { width: 220 } },
            { id: 'sales', field: 'sales', title: 'Sales', type: 'number', layout: { width: 100 } },
            moneyColumn('totalValue', 'Total value', 160),
          ],
          source: {
            mode: 'derived',
            from: detailGrid,
            groupBy: 'county',
            select: {
              sales: { fn: 'count' },
              totalValue: { of: 'price', fn: 'sum' },
            },
            sort: [{ col: 'totalValue', dir: 'desc' }],
            cumulative: { of: 'totalValue', upTo: 0.8 },
          },
        },
      },
      {
        id: 'profile',
        label: 'Profile',
        badge: false,
        config: {
          ...baseGridConfig('The statistical profile of the price column'),
          columns: [
            { id: 'column', field: 'column', title: 'Column', layout: { width: 120 } },
            { id: 'rows', field: 'rows', title: 'Rows', type: 'number', layout: { width: 100 } },
            { id: 'present', field: 'present', title: 'Present', type: 'number', layout: { width: 90 } },
            { id: 'missing', field: 'missing', title: 'Missing', type: 'number', layout: { width: 90 } },
            { id: 'distinct', field: 'distinct', title: 'Distinct', type: 'number', layout: { width: 90 } },
            moneyColumn('min', 'Min', 110),
            moneyColumn('q1', 'Q1', 110),
            moneyColumn('median', 'Median', 110),
            moneyColumn('mean', 'Mean', 110),
            moneyColumn('q3', 'Q3', 110),
            moneyColumn('max', 'Max', 110),
            moneyColumn('stddev', 'Std dev', 110),
            { id: 'iqr', field: 'iqr', title: 'IQR', type: 'number', format: 'currency:GBP:0', layout: { width: 110 } },
            { id: 'outliers', field: 'outliers', title: 'Outliers', type: 'number', layout: { width: 90 } },
          ],
          source: {
            mode: 'derived',
            from: detailGrid,
            profile: ['price'],
          },
        },
      },
    ];
  }

  /* ------------------------------------------------------------------ */
  /* The dashboard                                                       */
  /* ------------------------------------------------------------------ */

  /**
   * Build the whole page into `host`.
   *
   * @param {object} options
   * @param {HTMLElement} options.root where the dashboard is drawn
   * @param {Function} options.createGrid the grid factory
   * @param {Function} options.createHeadlessGrid the headless grid factory, for tab badges
   * @param {Function} options.createChart the charts module's factory
   * @param {Function} options.createStat the core's headline-tile factory
   * @param {Function} options.createTabs the tabs module's factory
   * @param {Function} options.createDataRouter the data router module's factory
   * @param {object[]} [options.rows] the sales to start with (snapshot path)
   * @param {object} [options.source] a source config instead of rows (DuckDB path)
   * @param {object} options.meta where the data came from, and when
   * @returns {object} the pieces that were built, for a caller that wants them
   */
  function buildDashboard({
    root: host,
    createGrid,
    createHeadlessGrid,
    createChart,
    createStat,
    createTabs,
    createDataRouter,
    rows,
    source,
    meta,
  }) {
    host.textContent = '';

    const built = {
      detailGrid: null,
      router: null,
      tiles: {},
      charts: [],
      tabs: null,
      status: { lastPoll: null, lastError: null, polls: 0, revisions: 0, arrivals: 0, dropped: 0 },
    };

    /* ---------------- the masthead ---------------- */

    const header = el('header', 'head');
    const heading = el('div', 'head-text');
    heading.append(el('h1', null, 'House prices in England and Wales, as they were paid'));
    heading.append(
      el(
        'p',
        'lede',
        'Every property sale registered in HM Land Registry\u2019s latest monthly release \u2014 the sales it ' +
          'recorded that month, which were agreed anything from weeks to years earlier. Group them, pivot them, or ' +
          'narrow them by county and type, and the headline figures, the charts and the summaries all follow.',
      ),
    );
    if (meta.fellBack) {
      heading.append(
        el(
          'p',
          'notice',
          'The live data could not be read, so this is the saved copy. Reloading the page will try again.',
        ),
      );
    }
    header.append(heading);

    const provenance = el('div', 'head-note');
    const modePill = el('span', 'pill', meta.live ? 'Live' : 'Saved copy');
    const liveDot = el('span', 'dot');
    if (meta.live) modePill.prepend(liveDot);
    const freshness = el('span', 'freshness', 'Waiting for the first update...');
    provenance.append(modePill, freshness);
    header.append(provenance);
    host.append(header);

    /* ---------------- the headline tiles ---------------- */

    const kpiHost = el('section', 'kpi-strip');
    kpiHost.setAttribute('aria-label', 'Headline figures');
    const tileBoxes = {};
    for (const id of ['totalValue', 'sales', 'median', 'mean', 'p95']) {
      const box = el('div', 'kpi-tile');
      box.setAttribute('data-tile', id);
      kpiHost.append(box);
      tileBoxes[id] = box;
    }
    host.append(kpiHost);

    /* ---------------- the charts ---------------- */

    const chartHost = el('section', 'chart-wrap');
    chartHost.setAttribute('aria-label', 'Charts');
    const chartBoxes = [];
    for (let i = 0; i < 6; i += 1) {
      const box = el('div', 'chart-box');
      chartHost.append(box);
      chartBoxes.push(box);
    }
    host.append(chartHost);

    /* ---------------- the controls ---------------- */

    const actions = el('div', 'actions');
    host.append(actions);

    /* ---------------- the detail grid ---------------- */

    const primary = el('section', 'primary-host');
    host.append(primary);

    const barMax = rows && rows.length ? Math.max(1000000, p95Of(rows.map((r) => r.price))) : 2000000;
    /*
     * Where to stop the price charts.
     *
     * The 99th percentile left the right-hand half of the histogram empty:
     * £2,075,000 against a median of £285,000, so the bars that matter were
     * squeezed into the first third. At the 97.5th -- £1,250,000 -- the last
     * bucket still holding half a per cent of sales is the sixteenth of
     * twenty, which puts the readable part of the distribution across four
     * fifths of the width. Twenty buckets rather than twenty-four, so each bar
     * is wide enough to read.
     */
    const priceCeiling = rows && rows.length ? percentileOf(rows.map((r) => r.price), 0.975) : 1500000;
    const aboveCeiling = rows && rows.length
      ? rows.reduce((n, r) => (r.price > priceCeiling ? n + 1 : n), 0) : 0;
    const priceCeilingNote = `Drawn to ${pounds(priceCeiling)}. `
      + `${commas(aboveCeiling)} sales above that \u2014 the highest two and a half per cent, `
      + 'running to hundreds of millions \u2014 are off the top of the scale. The table below holds them all.';

    const detailConfig = {
      ...baseGridConfig('Property sales published by HM Land Registry'),
      columns: saleColumns(barMax),
      /* The same grid can be drawn two ways. As built it is a table of the
         individual sales; the Pivot buttons below switch it to a matrix —
         the rows grouped down the left gutter, the property type across the
         top, each cell a summed price — and switch it back again.

         The matrix is a presentation that replaces the table rather than a
         layer over it, so it is turned on at the moment a pivot dimension is
         chosen and off again when one is not. Turned on with no dimension to
         draw there is nothing for the matrix to show. */
    };
    if (source) detailConfig.source = source;
    else detailConfig.rows = rows;

    const detailGrid = createGrid(primary, detailConfig);
    built.detailGrid = detailGrid;

    /*
     * One row per month of transfer, for the chart below.
     *
     * Drawn by year, this release is two tall bars and twenty-eight empty
     * ones: nearly every sale in a monthly release was transferred in the
     * last year or two, and the long tail back to 1995 is late registrations,
     * a handful at a time. By month over the last two years it is a shape a
     * reader can actually see. The grid keeps every sale either way; this is
     * a summary of it, and it follows the table's filters.
     *
     * It is keyed by the month, because a grouped summary's rows are the
     * aggregates underneath and carry no `id`, and it is ordered by the month
     * *number* -- "Jan 2025" does not sort, and a chart takes its categories
     * in the order its rows arrive.
     */
    const MONTHS_SHOWN = 24;
    const latestMonthKey = rows && rows.length
      ? rows.reduce((max, r) => (r.transferMonthKey > max ? r.transferMonthKey : max), 0)
      : 0;
    const firstMonthKey = latestMonthKey
      ? (() => {
        const year = Math.floor(latestMonthKey / 100);
        const month = latestMonthKey % 100;
        const back = year * 12 + (month - 1) - (MONTHS_SHOWN - 1);
        return Math.floor(back / 12) * 100 + (back % 12) + 1;
      })()
      : 0;
    const firstMonthLabel = rows && rows.length
      ? (rows.find((r) => r.transferMonthKey === firstMonthKey) || {}).transferMonth || ''
      : '';
    const olderSales = rows && rows.length
      ? rows.reduce((n, r) => (r.transferMonthKey < firstMonthKey ? n + 1 : n), 0)
      : 0;

    const byMonthGrid = createGrid(el('div', 'grid-pane'), {
      ...baseGridConfig('Sales by month of transfer'),
      rowKey: 'transferMonth',
      columns: [
        { id: 'transferMonth', field: 'transferMonth', title: 'Month', layout: { width: 120 } },
        { id: 'sales', field: 'sales', title: 'Sales', type: 'number', total: 'sum', layout: { width: 90 } },
        { id: 'monthKey', field: 'monthKey', title: 'Month key', type: 'number', layout: { width: 100, hidden: true } },
      ],
      source: {
        mode: 'derived',
        from: detailGrid,
        follow: 'filtered',
        where: firstMonthKey ? (row) => row.transferMonthKey >= firstMonthKey : undefined,
        groupBy: 'transferMonth',
        select: { sales: { fn: 'count' }, monthKey: { of: 'transferMonthKey', fn: 'min' } },
        sort: [{ col: 'monthKey', dir: 'asc' }],
      },
    });
    built.byMonthGrid = byMonthGrid;

    /* ---------------- the summary tabs ---------------- */

    const tabsHost = el('section', 'tabs-host');
    host.append(tabsHost);
    const tabs = createTabs(tabsHost, {
      createGrid,
      createHeadlessGrid,
      ariaLabel: 'Sales summaries',
      tabs: derivedTabs(detailGrid),
    });
    built.tabs = tabs;

    /* ---------------- the router ---------------- */

    /*
     * One stream in, one grid out. A correction to a sale that has already
     * arrived — a price revised, a record status flipped from added to changed
     * — lands on the row it belongs to rather than adding a second one, because
     * the router keys on the transaction id.
     */
    const router = createDataRouter({
      key: () => 'sales',
      rowKey: 'id',
      overlap: false,
    });
    built.router = router;

    router.attach(detailGrid, () => true);

    router.subscribe(() => true, (change) => {
      built.status.arrivals += (change.add || []).length;
      built.status.revisions += (change.update || []).length;
    });

    const ingest = (incoming) => {
      if (!incoming || !incoming.length) return 0;
      router.apply(incoming.map((row) => ({ op: 'upsert', row })));
      built.status.dropped = router.dropped || 0;
      return incoming.length;
    };

    if (rows) router.load(rows);

    /* ---------------- the headline tiles, bound to the detail grid ---------------- */

    const overallMean = rows && rows.length ? rows.reduce((sum, r) => sum + r.price, 0) / rows.length : null;
    const overallMedian = rows && rows.length ? medianOf(rows.map((r) => r.price)) : null;
    const overallValue = rows && rows.length ? rows.reduce((sum, r) => sum + r.price, 0) : null;

    function medianOf(values) {
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }

    const addTile = (id, spec) => {
      try {
        built.tiles[id] = createStat({ grid: detailGrid, container: tileBoxes[id], ...spec });
      } catch (error) {
        tileBoxes[id].append(el('div', 'kpi-error', `This figure could not be drawn: ${error.message}`));
        console.error('[house prices demo] tile', id, error);
      }
    };

    addTile('totalValue', {
      title: 'Total value',
      value: { of: 'price', fn: 'sum' },
      format: (v) => poundsCompact(v),
      bands: overallValue ? { good: overallValue, warn: overallValue * 0.5, direction: 'up' } : undefined,
    });
    /* A count has no column to take its formatting from, so it says how it
       wants to be read: the same thousands separators as the money beside it. */
    addTile('sales', { title: 'Sales', value: { fn: 'count' }, format: (v) => commas(v) });

    /*
     * The median and the mean are compared against the same figure over every
     * sale published. Until something is narrowed, those are the same set of
     * sales, and a tile comparing a number with itself has nothing to report.
     * A baseline of null is no comparison at all, and the tile then draws no
     * change indicator, so the arrow appears once a filter has actually given
     * it two different things to measure.
     */
    const againstAll = (overall) => (overall == null ? undefined : (g) => (
      g.rows.count() < g.rows.totalCount() ? overall : null
    ));

    addTile('median', {
      title: 'Median price',
      value: { of: 'price', fn: 'median' },
      baseline: againstAll(overallMedian),
      interval: (v, g) => g.statistics.interval('price'),
    });
    addTile('mean', {
      title: 'Mean price',
      value: { of: 'price', fn: 'avg' },
      baseline: againstAll(overallMean),
    });
    addTile('p95', { title: 'P95 price', value: { of: 'price', fn: 'p95' } });

    /* On the DuckDB path the source materialises its whole dataset
       asynchronously, after the tiles have already reduced over the first
       window of rows. Refresh them once the full set has arrived, so they read
       the whole table rather than the window. The derived grids and charts
       follow the grid's rows on their own. */
    if (source) {
      const refreshTiles = () => {
        for (const id of Object.keys(built.tiles)) built.tiles[id].refresh();
      };
      const reloadDerived = () => {
        for (const id of ['county', 'type', 'year', 'pareto', 'profile']) {
          const grid = tabs.tab(id);
          if (grid && grid.rows && grid.rows.load) grid.rows.load();
        }
      };
      const settle = () => {
        refreshTiles();
        reloadDerived();
      };
      detailGrid.on('rows:changed', settle);
      detailGrid.on('model:changed', settle);
      detailGrid.on('ready', settle);
      /* A summary tab opened after the source has already settled still
         derives over the first window unless it is asked to re-read its
         source, so re-load it the moment it opens. */
      tabs.on('tab:changed', () => {
        const grid = tabs.tab(tabs.activeId);
        if (grid && grid.rows && grid.rows.load) grid.rows.load();
      });
    }

    /* ---------------- the charts, bound to the detail grid ---------------- */

    const chartSpecs = [
      /*
       * Both of these read the price, and the price has a tail that ruins
       * them: a few hundred lot sales and portfolio transfers between £100m
       * and £550m against a median of £285,000. Drawn to the full extent,
       * every ordinary sale lands in the first bucket and every box flattens
       * onto the axis. The value axis is held at the 99th percentile so the
       * ninety-nine per cent of sales a reader came to look at fill the
       * picture, and the note under each says what is above the ceiling.
       * The table keeps every sale; this is the charts' scale, not a filter.
       */
      {
        type: 'histogram',
        y: 'price',
        buckets: 20,
        title: 'What prices were paid',
        /*
         * A histogram's buckets span the readings it is given, and no axis
         * setting narrows them -- unlike the box plot below, which takes its
         * ceiling from `axis.y.max`. So this one is handed the readings it
         * should bucket instead: the sales at or under the ceiling, taken
         * from whatever the table is currently showing, so the chart still
         * follows a filter. Nothing is removed from the table itself.
         */
        rows: (g) => {
          const kept = [];
          g.rows.forEach((row) => {
            if (row.group) return;
            const price = g.rows.value(row.key, 'price');
            if (typeof price === 'number' && price <= priceCeiling) kept.push(row);
          });
          return kept;
        },
        axis: { x: 'Price', y: 'Sales' },
        footnote: priceCeilingNote,
        legend: false,
      },
      {
        type: 'boxplot',
        x: 'typeLabel',
        y: 'price',
        title: 'Price spread by property type',
        axis: { x: { labels: true }, y: { title: 'Price', max: priceCeiling } },
        footnote: priceCeilingNote,
        legend: false,
      },
      {
        type: 'treemap',
        x: 'county',
        y: 'price',
        title: 'Value by county',
        /* A treemap writes each county's name on its own tile, so a legend
           repeats what the picture already says -- and with a hundred and
           fifteen counties in it, a legend is all there would be room for. */
        legend: false,
      },
      {
        type: 'bar',
        x: 'transferMonth',
        y: 'sales',
        grid: byMonthGrid,
        title: 'Sales in this release, by month of transfer',
        footnote: olderSales
          ? `A sale is counted in the month it was transferred, not the month it was `
            + `registered, and registration lags completion. Plus ${commas(olderSales)} sales `
            + `agreed before ${firstMonthLabel}, registered late.`
          : 'A sale is counted in the month it was transferred, not the month it was '
            + 'registered, and registration lags completion.',
        /* Twenty-four months in a box this wide gives each label about
           sixteen pixels, which truncates them to "Aug 20...". Every third
           one is labelled instead, so the ones that are drawn can be read. */
        axis: { x: { labels: true, rotate: 'auto', every: 3 }, y: 'Sales' },
        legend: false,
      },
      {
        type: 'bar',
        x: 'typeLabel',
        y: 'count',
        title: 'Sales by property type',
        axis: { x: { labels: true, rotate: 'auto' }, y: 'Sales' },
        legend: false,
      },
      {
        type: 'pareto',
        x: 'county',
        y: 'price',
        title: 'Value by county, as a Pareto',
        axis: { x: { labels: false } },
        legend: false,
      },
    ];

    chartSpecs.forEach((spec, index) => {
      try {
        built.charts.push(createChart({ grid: detailGrid, container: chartBoxes[index], ...spec }));
      } catch (error) {
        chartBoxes[index].append(el('p', 'chart-error', `This chart could not be drawn: ${error.message}`));
        console.error('[house prices demo] chart', spec.type, error);
      }
    });

    /* ---------------- the controls ---------------- */

    const button = (label, onClick, className) => {
      const node = el('button', className || 'action', label);
      node.type = 'button';
      node.addEventListener('click', onClick);
      return node;
    };

    /*
     * The matrix and the table are two presentations of the one grid, and only
     * one of them draws at a time. `pivotView` is what chooses between them, so
     * every control that changes the shape of the grid says which it wants:
     * grouping alone is a tree of sales and stays a table, a pivot dimension is
     * a matrix, and clearing the pivot returns to the table.
     */
    const asTable = () => {
      detailGrid.columns.pivot([]);
      detailGrid.set('pivotView', false);
    };

    const asMatrix = (groupIds, pivotIds) => {
      detailGrid.set('pivotView', true);
      detailGrid.columns.group(groupIds);
      detailGrid.columns.pivot(pivotIds);
    };

    const group = (ids) => () => {
      if (!detailGrid) return;
      asTable();
      detailGrid.columns.group(ids);
    };

    actions.append(el('span', 'actions-label', 'Group by'));
    actions.append(button('County', group(['county'])));
    actions.append(button('Property type', group(['typeLabel'])));
    actions.append(button('Year', group(['year'])));
    actions.append(button('No grouping', group([])));

    actions.append(el('span', 'actions-gap'));
    actions.append(el('span', 'actions-label', 'Pivot'));
    actions.append(
      button('Type across the year', () => asMatrix(['year'], ['typeLabel'])),
    );
    actions.append(
      button('Type across the county', () => asMatrix(['county'], ['typeLabel'])),
    );
    actions.append(
      button('No pivot', () => {
        asTable();
        detailGrid.columns.group([]);
      }),
    );

    actions.append(el('span', 'actions-gap'));
    actions.append(el('span', 'actions-label', 'Sort by'));
    actions.append(button('Price, highest', () => detailGrid && detailGrid.sort.set([{ col: 'price', dir: 'desc' }])));
    actions.append(button('Most recent', () => detailGrid && detailGrid.sort.set([{ col: 'date', dir: 'desc' }])));

    const flatButton = button('Flats only', () => {
      const on = flatButton.getAttribute('aria-pressed') === 'true';
      detailGrid.filters.where('flats', on ? null : (row) => row.typeLabel === 'Flat/maisonette');
      flatButton.setAttribute('aria-pressed', String(!on));
      flatButton.classList.toggle('on', !on);
    }, 'action toggle');
    flatButton.setAttribute('aria-pressed', 'false');

    const londonButton = button('London only', () => {
      const on = londonButton.getAttribute('aria-pressed') === 'true';
      detailGrid.filters.where('london', on ? null : (row) => row.county === 'Greater London');
      londonButton.setAttribute('aria-pressed', String(!on));
      londonButton.classList.toggle('on', !on);
    }, 'action toggle');
    londonButton.setAttribute('aria-pressed', 'false');

    actions.append(el('span', 'actions-gap'));
    actions.append(flatButton);
    actions.append(londonButton);
    built.flatButton = flatButton;
    built.londonButton = londonButton;

    /* ---------------- the live readout ---------------- */

    const setFreshness = (state) => {
      if (!meta.live) {
        const saved = new Date(meta.fetchedAt).toLocaleString('en-GB');
        freshness.textContent = `A saved copy of the Price Paid Data, taken on ${saved}.`;
        freshness.className = 'freshness';
        return;
      }
      if (built.status.lastError) {
        freshness.textContent = built.status.lastPoll
          ? `Could not reach the data. Still showing what arrived at ${clockText(built.status.lastPoll)}.`
          : 'Could not reach the data.';
        freshness.className = 'freshness failed';
        return;
      }
      if (!built.status.lastPoll) {
        freshness.textContent = 'Waiting for the first update...';
        freshness.className = 'freshness';
        return;
      }
      freshness.textContent =
        `Updated ${clockText(built.status.lastPoll)}. ` +
        `${commas(built.status.arrivals)} new, ${commas(built.status.revisions)} revised since the page opened.`;
      freshness.className = 'freshness';
    };
    built.setFreshness = setFreshness;

    built.onPoll = (result) => {
      built.status.lastPoll = result.fetchedAt || Date.now();
      built.status.lastError = null;
      built.status.polls += 1;
      liveDot.classList.add('beat');
      setTimeout(() => liveDot.classList.remove('beat'), 900);
      ingest(result.rows);
      setFreshness();
    };

    built.onPollError = (error) => {
      built.status.lastError = String((error && error.message) || error);
      setFreshness();
      console.warn('[house prices demo] a poll failed:', built.status.lastError);
    };

    /* A hook for the verification script and for anyone poking at the page:
       push rows through exactly the path a poll uses. */
    built.ingest = ingest;

    setFreshness();

    /* ---------------- the footer ---------------- */

    const footer = el('footer', 'foot');
    const line = el('p', null, 'Price data from ');
    const link = el('a', null, 'HM Land Registry Price Paid Data');
    link.href = 'https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads';
    link.rel = 'noopener';
    line.append(link);
    line.append(
      document.createTextNode(
        '. Contains HM Land Registry data © Crown copyright and database right 2021, published under the Open ' +
          'Government Licence v3.0. Property types are Detached, Semi-detached, Terraced, Flat/maisonette and Other; ' +
          'tenure is freehold or leasehold. A small number of very large lot-sales push the mean far above the median, ' +
          'which is why the page reports both.',
      ),
    );
    footer.append(line);
    host.append(footer);

    built.destroy = () => {
      for (const chart of built.charts) chart.destroy();
      for (const id of Object.keys(built.tiles)) built.tiles[id].destroy();
      router.destroy();
      tabs.destroy();
      detailGrid.destroy();
    };

    return built;
  }

  root.HousePrices.buildDashboard = buildDashboard;
})(typeof globalThis !== 'undefined' ? globalThis : window);
