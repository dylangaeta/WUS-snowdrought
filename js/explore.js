// "Explore the data" page: category tabs, product/response selection, two
// per-product views (time series / seasonal cycle), and the cross-product
// Compare section below it. No science happens here -- every number is read
// straight from the JSON exported by code/14_dashboard_export.py in the
// snowdrought-carbon repo. The interactive COG map lives on the homepage
// (index.html, js/map-viewer.js); the summary table and anomaly heatmaps
// live on data.html (js/summary.js, js/heatmaps.js) -- this page used to
// bundle all of it, split apart 2026-09 so each page has one clear job.

const explorerState = {
  category: null,
  product: null,
  response: null,
  region: "ALL",
  view: "timeseries",
  timeseriesSeries: "value",
  seasonalSeries: "raw",
  timeseriesStartYear: null, // null = full record
  extraYears: [], // user-added seasonal-chart years, beyond manifest.seasonal_highlight_years
};

// Distinct from manifest.seasonal_highlight_year_colors (an orange/red
// family) and from the teal climatology-mean line, so user-added years
// never blend into either.
const EXTRA_YEAR_COLORS = ["#3182bd", "#756bb1", "#31a354", "#e7298a", "#636363", "#1b9e77"];

// DASHBOARD_MIN_YEAR is defined once in js/common.js (shared by every page).
function filterFrom1990(dates, values) {
  return {
    dates: dates.filter((d) => parseInt(d.slice(0, 4), 10) >= DASHBOARD_MIN_YEAR),
    values: values.filter((_, i) => parseInt(dates[i].slice(0, 4), 10) >= DASHBOARD_MIN_YEAR),
  };
}

function currentResponseEntry() {
  return manifest.categories[explorerState.category][explorerState.product][explorerState.response];
}

// Set once from the URL hash on load (js/map-viewer.js's copyViewLink()
// writes this same shape for its own page), consumed once by
// populateResponseSelect() as each selector settles, then cleared -- never
// re-applied on later clicks.
let pendingSharedView = null;

function parseSharedViewFromUrl() {
  if (!window.location.hash || window.location.hash.length < 2) return null;
  try {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const view = Object.fromEntries(params.entries());
    return view.category && view.product && view.response ? view : null;
  } catch (err) {
    return null;
  }
}

let lastSelection = null;

function initExplorer() {
  if (!document.getElementById("category-tabs")) return;
  populateRegionToggle(document.getElementById("region-toggle"), explorerState.region);
  renderCategoryTabs();
  pendingSharedView = parseSharedViewFromUrl();
  lastSelection = pendingSharedView ? null : loadLastSelection();
  const preferredCategory = pendingSharedView?.category || lastSelection?.category;
  const initialCategory = (preferredCategory && manifest.categories[preferredCategory])
    ? preferredCategory
    : manifest.category_order.find((cat) => Object.keys(manifest.categories[cat]).length > 0);
  selectCategory(initialCategory);
  wireExplorerControls();
  wireProductSearch("product-search", "product-search-results", (category, product, response) => {
    pendingSharedView = { category, product, response };
    selectCategory(category);
  });
}

function renderCategoryTabs() {
  const nav = document.getElementById("category-tabs");
  nav.innerHTML = "";
  manifest.category_order.forEach((category) => {
    const products = manifest.categories[category];
    if (Object.keys(products).length === 0) return;
    const button = document.createElement("button");
    button.className = "category-tab";
    button.textContent = manifest.category_labels[category];
    button.style.setProperty("--cat", manifest.category_colors[category]);
    button.dataset.category = category;
    button.addEventListener("click", () => selectCategory(category));
    nav.appendChild(button);
  });
}

function selectCategory(category) {
  explorerState.category = category;
  document.querySelectorAll("#category-tabs .category-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.category === category);
  });
  populateProductSelect();
}

function populateProductSelect() {
  const select = document.getElementById("product-select");
  select.innerHTML = "";
  const products = Object.keys(manifest.categories[explorerState.category]);
  products.forEach((product) => {
    const option = document.createElement("option");
    option.value = product;
    option.textContent = product;
    select.appendChild(option);
  });
  const preferredProduct = pendingSharedView?.product || lastSelection?.product;
  explorerState.product = (preferredProduct && products.includes(preferredProduct))
    ? preferredProduct : products[0];
  select.value = explorerState.product;
  populateResponseSelect();
}

function populateResponseSelect() {
  const select = document.getElementById("response-select");
  select.innerHTML = "";
  const responses = Object.keys(manifest.categories[explorerState.category][explorerState.product]);
  responses.forEach((response) => {
    const option = document.createElement("option");
    option.value = response;
    option.textContent = response;
    select.appendChild(option);
  });
  const preferredResponse = pendingSharedView?.response || lastSelection?.response;
  explorerState.response = (preferredResponse && responses.includes(preferredResponse))
    ? preferredResponse : responses[0];
  select.value = explorerState.response;

  if (pendingSharedView) {
    if (pendingSharedView.region) {
      explorerState.region = pendingSharedView.region;
      document.querySelectorAll("#region-toggle button").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.region === pendingSharedView.region);
      });
    }
    if (pendingSharedView.view) {
      // "map" was a real view here before the embedded map was removed
      // (2026-09) -- an old shared link naming it falls back to the new
      // default rather than matching nothing and leaving every tab/panel
      // inactive.
      const view = pendingSharedView.view === "map" ? "timeseries" : pendingSharedView.view;
      explorerState.view = view;
      document.querySelectorAll("#view-tabs button").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.view === view);
      });
      document.querySelectorAll(".view-panel").forEach((panel) => {
        panel.classList.toggle("active", panel.id === `panel-${view}`);
      });
    }
    pendingSharedView = null; // restore only on initial load, never again
  }
  lastSelection = null; // consumed as a one-time fallback, same as pendingSharedView
  onSelectionChanged();
}

function onSelectionChanged() {
  const entry = currentResponseEntry();
  document.getElementById("product-meta").innerHTML = productMetaHtml(entry);
  saveLastSelection(explorerState.category, explorerState.product, explorerState.response);
  // A new product/response has its own record span -- last product's start
  // year or added years may not even exist in this one, so reset rather
  // than carry them over silently.
  explorerState.timeseriesStartYear = null;
  explorerState.extraYears = [];
  populateYearControls(entry);
  renderActiveView();
}

// Populates the Time series "Start year" select and the Seasonal cycle
// "Add year" select from this response's own record span (manifest
// record_start/record_end) -- no data fetch needed, those are already in
// the manifest entry every page already has in hand.
function populateYearControls(entry) {
  const startYear = entry.record_start
    ? Math.max(DASHBOARD_MIN_YEAR, parseInt(entry.record_start.slice(0, 4), 10))
    : null;
  const endYear = entry.record_end ? parseInt(entry.record_end.slice(0, 4), 10) : null;

  const tsSelect = document.getElementById("timeseries-start-year-select");
  tsSelect.innerHTML = "";
  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = `All years (from ${DASHBOARD_MIN_YEAR})`;
  tsSelect.appendChild(allOption);
  if (startYear !== null && endYear !== null) {
    for (let y = startYear; y <= endYear; y++) {
      const option = document.createElement("option");
      option.value = String(y);
      option.textContent = String(y);
      tsSelect.appendChild(option);
    }
  }
  tsSelect.value = "";

  const addSelect = document.getElementById("seasonal-add-year-select");
  addSelect.innerHTML = "";
  // A water year runs Oct(Y-1)-Sep(Y), so the earliest addable one needs a
  // full prior October already in the record -- starts one year after the
  // record's own first calendar year, not at it.
  if (startYear !== null && endYear !== null) {
    for (let y = startYear + 1; y <= endYear; y++) {
      const option = document.createElement("option");
      option.value = String(y);
      option.textContent = waterYearLabel(y);
      addSelect.appendChild(option);
    }
  }
}

// "2025-2026" not "Water year 2026" -- matches the format the pre-defined
// highlight years already use (manifest.seasonal_highlight_years' own
// curve.label), so a user-added year reads the same way, not a different
// naming convention for what's otherwise an identical kind of series.
function waterYearLabel(year) {
  return `${year - 1}-${year}`;
}

// Water-year-ordered {raw, anomaly} for an arbitrary year, built client-side
// from the already-complete monthly timeseries data (region.dates/.value/
// .anomaly cover the full record) -- the same shape manifest.seasonal_
// highlight_years' precomputed curves already use, so it overlays exactly
// like one of the default highlight years. null where a whole year's data
// isn't available (e.g. year not fully in the record) rather than plotting
// a broken partial curve.
function computeWaterYearCurve(region, year) {
  const months = [
    [10, year - 1], [11, year - 1], [12, year - 1],
    [1, year], [2, year], [3, year], [4, year], [5, year],
    [6, year], [7, year], [8, year], [9, year],
  ];
  const raw = [];
  const anomaly = [];
  for (const [month, y] of months) {
    const dateStr = `${y}-${String(month).padStart(2, "0")}-01`;
    const idx = region.dates.indexOf(dateStr);
    raw.push(idx === -1 ? null : region.value[idx]);
    anomaly.push(idx === -1 ? null : region.anomaly[idx]);
  }
  return raw.every((v) => v === null) ? null : { raw, anomaly };
}

function wireExplorerControls() {
  document.getElementById("product-select").addEventListener("change", (event) => {
    explorerState.product = event.target.value;
    populateResponseSelect();
  });
  document.getElementById("response-select").addEventListener("change", (event) => {
    explorerState.response = event.target.value;
    onSelectionChanged();
  });
  document.getElementById("region-toggle").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-region]");
    if (!button) return;
    explorerState.region = button.dataset.region;
    document.querySelectorAll("#region-toggle button").forEach((btn) => btn.classList.toggle("active", btn === button));
    renderActiveView();
  });
  document.getElementById("view-tabs").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-view]");
    if (!button) return;
    explorerState.view = button.dataset.view;
    document.querySelectorAll("#view-tabs button").forEach((btn) => btn.classList.toggle("active", btn === button));
    document.querySelectorAll(".view-panel").forEach((panel) => {
      panel.classList.toggle("active", panel.id === `panel-${explorerState.view}`);
    });
    renderActiveView();
  });
  document.getElementById("timeseries-toggle").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-series]");
    if (!button) return;
    explorerState.timeseriesSeries = button.dataset.series;
    document.querySelectorAll("#timeseries-toggle button").forEach((btn) => btn.classList.toggle("active", btn === button));
    renderTimeseries();
  });
  document.getElementById("seasonal-toggle").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-series]");
    if (!button) return;
    explorerState.seasonalSeries = button.dataset.series;
    document.querySelectorAll("#seasonal-toggle button").forEach((btn) => btn.classList.toggle("active", btn === button));
    renderSeasonal();
  });
  document.getElementById("timeseries-start-year-select").addEventListener("change", (event) => {
    explorerState.timeseriesStartYear = event.target.value ? parseInt(event.target.value, 10) : null;
    renderTimeseries();
  });
  document.getElementById("seasonal-add-year-btn").addEventListener("click", () => {
    const year = parseInt(document.getElementById("seasonal-add-year-select").value, 10);
    if (!year || explorerState.extraYears.includes(year) || manifest.seasonal_highlight_years.includes(year)) return;
    explorerState.extraYears.push(year);
    renderSeasonal();
  });
}

// The interactive map lives on the Home page only now -- this page used to
// embed it a second time via iframe, which just duplicated it (Dylan,
// 2026-09: "why is the mapping feature also shown on the explore the data
// page? we don't need a duplicated map page").
function renderActiveView() {
  if (explorerState.view === "timeseries") renderTimeseries();
  else renderSeasonal();
}

// Delegates to js/common.js's shared per-page caches (fetchTimeseriesJson /
// fetchSeasonalJson) instead of keeping its own -- the same product/response
// JSON is also fetched by the Compare view below whenever that product
// happens to be checked there too.
function fetchSeries(kind) {
  const key = `${explorerState.product}_${explorerState.response}`;
  return kind === "timeseries" ? fetchTimeseriesJson(key) : fetchSeasonalJson(key);
}

async function renderTimeseries() {
  const chart = document.getElementById("timeseries-chart");
  const data = await fetchSeries("timeseries");
  const region = data.regions[explorerState.region];
  if (!region) {
    chart.innerHTML = '<p class="chart-empty">No data for this region.</p>';
    return;
  }
  const isSigma = explorerState.timeseriesSeries === "sigma";
  const fullY = isSigma ? region.sigma : region.value;
  // Native standardized indices (SPI/SPEI/EDDI/PDSI/ForDRI/ESI) are already
  // a standardized departure -- their sigma series is identical to raw, not
  // a re-standardization (see common/canonical.py::_load_drought_index).
  const sigmaLabel = data.native_standardized
    ? `${data.response} (native standardized index)`
    : "Standardized anomaly (σ)";
  const startYear = Math.max(DASHBOARD_MIN_YEAR, explorerState.timeseriesStartYear || DASHBOARD_MIN_YEAR);
  const dates = region.dates.filter((d) => parseInt(d.slice(0, 4), 10) >= startYear);
  const y = fullY.filter((_, i) => parseInt(region.dates[i].slice(0, 4), 10) >= startYear);
  const traces = [{
    x: dates, y, type: "scatter", mode: "lines",
    line: { color: "#1b1b1b", width: 1.4 },
    name: isSigma ? sigmaLabel : `${data.response} (${data.units})`,
    hovertemplate: "%{x|%Y-%m}: %{y:.2f}<extra></extra>",
  }];
  const layout = {
    margin: { t: 20, r: 20, b: 45, l: 60 },
    yaxis: { title: isSigma ? sigmaLabel : `${data.response} (${data.units})`, zeroline: isSigma },
    xaxis: { title: "Year" },
    font: { family: "Source Sans Pro, sans-serif", size: 13 },
    shapes: isSigma ? [{ type: "line", x0: 0, x1: 1, xref: "paper", y0: 0, y1: 0, line: { color: "#888", width: 1 } }] : [],
  };
  Plotly.newPlot(chart, traces, layout, { responsive: true, displaylogo: false });
}

async function renderSeasonal() {
  const chart = document.getElementById("seasonal-chart");
  const data = await fetchSeries("seasonal");
  const region = data.regions[explorerState.region];
  if (!region) {
    chart.innerHTML = '<p class="chart-empty">No data for this region.</p>';
    return;
  }
  const x = manifest.water_year_month_names;
  // Two-row tick labels (month above, calendar year below) using the most
  // recent highlight year as the reference water year -- Oct/Nov/Dec are
  // that water year's own prior calendar year, Jan-Sep are its own. Every
  // overlaid curve is still its OWN real water year underneath (the x
  // values themselves stay plain month names); this only makes the
  // shared axis concretely dated instead of a bare, ambiguous "Oct...Sep".
  const referenceYear = Math.max(...manifest.seasonal_highlight_years);
  const tickText = x.map((month, i) => `${month}<br>${i < 3 ? referenceYear - 1 : referenceYear}`);
  const isAnomaly = explorerState.seasonalSeries === "anomaly";
  const teal = manifest.climatology_color;
  const upper = isAnomaly ? region.anomaly_upper : region.climatology_upper;
  const lower = isAnomaly ? region.anomaly_lower : region.climatology_lower;
  const mean = isAnomaly ? upper.map(() => 0) : region.climatology_mean;

  const traces = [
    { x, y: lower, type: "scatter", mode: "lines", line: { width: 0 }, showlegend: false, hoverinfo: "skip" },
    {
      x, y: upper, type: "scatter", mode: "lines", line: { width: 0 }, fill: "tonexty",
      fillcolor: hexToRgba(teal, 0.25), name: "Climatology ± 2σ", hoverinfo: "skip",
    },
    {
      x, y: mean, type: "scatter", mode: "lines+markers", line: { color: teal, width: 3 },
      marker: { color: teal, size: 6 }, name: "Climatological mean",
    },
  ];
  manifest.seasonal_highlight_years.forEach((year) => {
    const curve = region.highlight_years[String(year)];
    if (!curve) return;
    traces.push({
      x, y: isAnomaly ? curve.anomaly : curve.raw, type: "scatter", mode: "lines",
      line: { color: manifest.seasonal_highlight_year_colors[String(year)], width: 2 },
      name: curve.label,
    });
  });
  if (explorerState.extraYears.length > 0) {
    // The precomputed highlight_years curves only cover manifest.seasonal_
    // highlight_years -- any other year is built client-side from the
    // already-complete monthly timeseries data instead of needing a new
    // pipeline export.
    const tsData = await fetchSeries("timeseries");
    const tsRegion = tsData.regions[explorerState.region];
    explorerState.extraYears.forEach((year, i) => {
      const curve = tsRegion && computeWaterYearCurve(tsRegion, year);
      if (!curve) return;
      traces.push({
        x, y: isAnomaly ? curve.anomaly : curve.raw, type: "scatter", mode: "lines",
        line: { color: EXTRA_YEAR_COLORS[i % EXTRA_YEAR_COLORS.length], width: 2, dash: "dot" },
        name: waterYearLabel(year),
      });
    });
  }
  const layout = {
    margin: { t: 20, r: 20, b: 55, l: 60 },
    yaxis: { title: isAnomaly ? `${data.response} anomaly (${data.units})` : `${data.response} (${data.units})`, zeroline: isAnomaly },
    xaxis: { type: "category", tickvals: x, ticktext: tickText },
    font: { family: "Source Sans Pro, sans-serif", size: 13 },
  };
  Plotly.newPlot(chart, traces, layout, { responsive: true, displaylogo: false });
  renderExtraYearChips();
}

function renderExtraYearChips() {
  const row = document.getElementById("seasonal-extra-years");
  row.innerHTML = "";
  explorerState.extraYears.forEach((year, i) => {
    const chip = document.createElement("span");
    chip.className = "year-chip";
    chip.style.background = EXTRA_YEAR_COLORS[i % EXTRA_YEAR_COLORS.length];
    chip.innerHTML = `${waterYearLabel(year)} <button type="button" aria-label="Remove ${year}">&times;</button>`;
    chip.querySelector("button").addEventListener("click", () => {
      explorerState.extraYears = explorerState.extraYears.filter((y) => y !== year);
      renderSeasonal();
    });
    row.appendChild(chip);
  });
}

// ------------------------------------------------------------------ Compare
//
// Two modes, both overlaying already-computed standardized anomalies (sigma
// removes each variable's own physical units) on one shared axis -- no new
// statistic, no interpretation of what the co-movement means.
//
// "category" mode reproduces code/11_combined_GroupOverlays_analyze.py's
// canonical multi-product overlay dynamically instead of as a static PNG:
// every product/response the manifest already groups under one category
// (manifest.categories[category], the same figure_category() grouping the
// Python script's COMBINED_GROUPS is built from), styled solid
// (observation) / dashed (model) per PRODUCT_OBSERVATION_KIND, sign-negated
// per COMBINED_INVERTED_VALENCE_RESPONSES, and -- for vegetation -- limited
// to each product's own growing-season months via
// COMBINED_GROWING_SEASON_MIN_AMPLITUDE_FRACTION so a near-zero dormant-
// season baseline spread doesn't explode the standardized value. All three
// constants mirror 00_config.py exactly (see js/common.js).
//
// "custom" mode is the original pick-up-to-3 overlay for open-ended
// exploration outside the canonical groupings.

const compareState = {
  region: "ALL",
  category: null,
  // { [category]: Set of "product|response" keys currently checked }. Set
  // once per category the first time it's shown (defaulting to the first
  // CATEGORY_OVERLAY_DEFAULT_VISIBLE) and then persists across region
  // changes -- previously every re-render (including a plain region change)
  // rebuilt the legend from the hardcoded default, silently discarding
  // whatever the user had checked/unchecked (Dylan, 2026-09).
  checkedByCategory: {},
};
const CATEGORY_OVERLAY_COLORS = [
  "#205493", "#a0290f", "#2e8540", "#946e00", "#5c3d99",
  "#00767a", "#b5390c", "#3a6b8a", "#8a3a6b", "#556b2f",
  "#a0522d", "#4b5320",
];

function initCompareView() {
  const chart = document.getElementById("compare-chart");
  if (!chart) return;

  populateRegionSelect(document.getElementById("compare-region-select"), compareState.region);

  const categorySelect = document.getElementById("compare-category-select");
  manifest.category_order.forEach((cat) => {
    const option = document.createElement("option");
    option.value = cat;
    option.textContent = manifest.category_labels[cat];
    categorySelect.appendChild(option);
  });
  compareState.category = manifest.category_order[0];
  categorySelect.addEventListener("change", (event) => {
    compareState.category = event.target.value;
    renderCategoryOverlay();
  });

  document.getElementById("compare-region-select").addEventListener("change", (event) => {
    compareState.region = event.target.value;
    renderCategoryOverlay();
  });

  renderCategoryOverlay();
}

function plotlyLayout() {
  return {
    margin: { t: 20, r: 20, b: 45, l: 60 },
    yaxis: { title: "Standardized anomaly (σ)", zeroline: true },
    xaxis: { title: "Year" },
    font: { family: "Source Sans Pro, sans-serif", size: 13 },
    shapes: [{ type: "line", x0: 0, x1: 1, xref: "paper", y0: 0, y1: 0, line: { color: "#888", width: 1 } }],
  };
}

// How many series start checked/visible the first time a category is shown
// -- the rest are opt-in via the checkbox legend (renderCategoryLegend
// below). Only applies on first view; compareState.checkedByCategory
// remembers whatever the user changes it to after that.
const CATEGORY_OVERLAY_DEFAULT_VISIBLE = 2;

async function renderCategoryOverlay() {
  const chart = document.getElementById("compare-chart");
  const note = document.getElementById("compare-category-note");
  const category = compareState.category;
  const products = manifest.categories[category] || {};
  const pairs = [];
  for (const [product, responses] of Object.entries(products)) {
    for (const response of Object.keys(responses)) pairs.push({ product, response });
  }
  if (pairs.length === 0) {
    chart.innerHTML = '<p class="chart-empty">No products in this category.</p>';
    document.getElementById("compare-category-legend").innerHTML = "";
    return;
  }
  // Snow/precipitation/soil-moisture categories are never OLS-detrended
  // (a deliberate pipeline-wide policy, not a per-product coincidence), so
  // every single item in those categories carries the same "(no trend)"
  // suffix -- with 15-27 items that's pure repetition, not useful
  // per-line information. Only show it per-item when the category actually
  // mixes methods (where it's genuinely telling you which ones differ);
  // otherwise state it once for the whole category instead.
  const methodsInCategory = new Set(
    pairs.map(({ product, response }) => products[product][response].detrend_method)
  );
  const uniformMethod = methodsInCategory.size === 1 ? [...methodsInCategory][0] : null;
  const baseNote = "Solid = observation, dashed = model. Check a variable below to add it to the chart.";
  note.textContent = uniformMethod
    ? `${baseNote} Every product here is ${DETREND_METHOD_LABELS[uniformMethod]}.`
    : baseNote;

  // First time this category is shown, default to the first N visible;
  // after that, keep whatever the user has checked/unchecked -- switching
  // region re-renders the same category and must not silently discard it.
  const checkedKey = compareState.checkedByCategory[category] || new Set(
    pairs.slice(0, CATEGORY_OVERLAY_DEFAULT_VISIBLE).map((p) => `${p.product}|${p.response}`)
  );
  compareState.checkedByCategory[category] = checkedKey;

  // Fetch every product's JSON concurrently instead of one at a time (plus
  // each one's seasonal JSON too, for the vegetation category's growing-
  // season mask) -- some categories have 15-27 products, and awaiting each
  // fetch in turn meant a full re-render waited on that many sequential
  // network round-trips (fetchTimeseriesJson/fetchSeasonalJson's shared
  // per-page caches, js/common.js, still apply per key either way -- also
  // shared with the single-product Explorer view above, so switching between
  // Explorer and Compare on the same product never re-fetches it).
  const seriesList = await Promise.all(
    pairs.map(({ product, response }) => fetchTimeseriesJson(`${product}_${response}`))
  );
  const seasonalList = category === "vegetation"
    ? await Promise.all(pairs.map(({ product, response }) => fetchSeasonalJson(`${product}_${response}`)))
    : null;

  const traces = [];
  const legendItems = [];
  let colorIndex = 0;
  pairs.forEach(({ product, response }, pairIndex) => {
    const data = seriesList[pairIndex];
    const region = data.regions[compareState.region];
    if (!region) return;

    let sigma = region.sigma;
    if (category === "vegetation") {
      const seasonal = seasonalList[pairIndex];
      const seasonalRegion = seasonal && seasonal.regions[compareState.region];
      if (seasonalRegion) {
        const mean = seasonalRegion.climatology_mean;
        const trough = Math.min(...mean);
        const amplitude = Math.max(...mean) - trough;
        const keepMonth = mean.map((v) => (v - trough) > COMBINED_GROWING_SEASON_MIN_AMPLITUDE_FRACTION * amplitude);
        sigma = region.dates.map((d, i) => {
          const month = parseInt(d.slice(5, 7), 10);
          return keepMonth[month - 1] ? sigma[i] : null;
        });
      }
    }
    if (COMBINED_INVERTED_VALENCE_RESPONSES.has(response)) {
      sigma = sigma.map((v) => (v === null || v === undefined ? null : -v));
    }

    const isObservation = PRODUCT_OBSERVATION_KIND[product] === "observation";
    const detrendMethod = products[product][response].detrend_method;
    const color = CATEGORY_OVERLAY_COLORS[colorIndex % CATEGORY_OVERLAY_COLORS.length];
    const name = `${product} ${response}${uniformMethod ? "" : detrendShortSuffix(detrendMethod)}`;
    const pairKey = `${product}|${response}`;
    const visible = checkedKey.has(pairKey);
    const { dates, values } = filterFrom1990(region.dates, sigma);
    traces.push({
      x: dates, y: values, type: "scatter", mode: "lines", connectgaps: false,
      line: { color, width: 1.6, dash: isObservation ? "solid" : "dash" },
      name, visible,
    });
    legendItems.push({ name, color, visible, pairKey });
    colorIndex++;
  });
  Plotly.newPlot(chart, traces, { ...plotlyLayout(), showlegend: false }, { responsive: true, displaylogo: false });
  renderCategoryLegend(legendItems);
}

function renderCategoryLegend(items) {
  const container = document.getElementById("compare-category-legend");
  container.innerHTML = "";
  items.forEach((item, i) => {
    const label = document.createElement("label");
    label.className = "compare-legend-item";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = item.visible;
    checkbox.addEventListener("change", (event) => {
      const checkedKey = compareState.checkedByCategory[compareState.category];
      if (event.target.checked) checkedKey.add(item.pairKey);
      else checkedKey.delete(item.pairKey);
      Plotly.restyle(document.getElementById("compare-chart"), { visible: event.target.checked }, [i]);
    });
    const swatch = document.createElement("span");
    swatch.className = "compare-legend-swatch";
    swatch.style.background = item.color;
    label.appendChild(checkbox);
    label.appendChild(swatch);
    label.appendChild(document.createTextNode(item.name));
    container.appendChild(label);
  });
}

async function init() {
  await loadManifest();
  initExplorer();
  initCompareView();
}

init();
