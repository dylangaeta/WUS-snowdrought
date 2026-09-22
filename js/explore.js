// "Explore the data" page: category tabs, product/response selection, and
// three per-product views (static map / time series / seasonal cycle), plus
// the cross-product heatmaps section below it. No science happens here --
// every number is read straight from the JSON exported by
// code/14_dashboard_export.py in the snowdrought-carbon repo. The interactive
// COG map viewer lives on its own page (maps.html, js/map-viewer.js) with its
// own product picker, not here.

const explorerState = {
  category: null,
  product: null,
  response: null,
  region: "ALL",
  view: "map",
  timeseriesSeries: "value",
  seasonalSeries: "raw",
  seriesCache: {},
};

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
      explorerState.view = pendingSharedView.view;
      document.querySelectorAll("#view-tabs button").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.view === pendingSharedView.view);
      });
      document.querySelectorAll(".view-panel").forEach((panel) => {
        panel.classList.toggle("active", panel.id === `panel-${pendingSharedView.view}`);
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
  renderActiveView();
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
}

function renderActiveView() {
  if (explorerState.view === "map") renderMap();
  else if (explorerState.view === "timeseries") renderTimeseries();
  else renderSeasonal();
}

// The static per-product map picture is gone -- this embeds the real,
// already-verified interactive COG map (maps.html) via the same URL-hash
// view-sharing format js/map-viewer.js's copyViewLink() writes, rather than
// duplicating its ~500 lines of OpenLayers setup for a second instance.
function renderMap() {
  const params = new URLSearchParams({
    category: explorerState.category, product: explorerState.product, response: explorerState.response,
  });
  document.getElementById("map-panel-iframe").src = `maps.html?embed=1#${params.toString()}`;
  document.getElementById("map-panel-open-link").href = `maps.html#${params.toString()}`;
}

async function fetchSeries(kind) {
  const key = `${kind}:${explorerState.product}_${explorerState.response}`;
  if (!explorerState.seriesCache[key]) {
    const response = await fetch(`data/${kind}/${explorerState.product}_${explorerState.response}.json`);
    explorerState.seriesCache[key] = await response.json();
  }
  return explorerState.seriesCache[key];
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
  const y = isSigma ? region.sigma : region.value;
  // Native standardized indices (SPI/SPEI/EDDI/PDSI/ForDRI/ESI) are already
  // a standardized departure -- their sigma series is identical to raw, not
  // a re-standardization (see common/canonical.py::_load_drought_index).
  const sigmaLabel = data.native_standardized
    ? `${data.response} (native standardized index)`
    : "Standardized anomaly (σ)";
  const traces = [{
    x: region.dates, y, type: "scatter", mode: "lines",
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
  const layout = {
    margin: { t: 20, r: 20, b: 45, l: 60 },
    yaxis: { title: isAnomaly ? `${data.response} anomaly (${data.units})` : `${data.response} (${data.units})`, zeroline: isAnomaly },
    xaxis: { type: "category" },
    font: { family: "Source Sans Pro, sans-serif", size: 13 },
  };
  Plotly.newPlot(chart, traces, layout, { responsive: true, displaylogo: false });
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
  mode: "category",
  region: "ALL",
  category: null,
  selections: [null, null, null],
  cache: {},
  seasonalCache: {},
};
const COMPARE_COLORS = ["#205493", "#a0290f", "#2e8540"];
const CATEGORY_OVERLAY_COLORS = [
  "#205493", "#a0290f", "#2e8540", "#946e00", "#5c3d99",
  "#00767a", "#b5390c", "#3a6b8a", "#8a3a6b", "#556b2f",
  "#a0522d", "#4b5320",
];

function setCompareMode(mode) {
  compareState.mode = mode;
  document.querySelectorAll("#compare-mode-toggle button").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
  document.getElementById("compare-custom-row").style.display = mode === "custom" ? "" : "none";
  document.getElementById("compare-category-row").style.display = mode === "category" ? "" : "none";
  document.getElementById("compare-category-note").style.display = mode === "category" ? "" : "none";
}

function initCompareView() {
  const chart = document.getElementById("compare-chart");
  if (!chart) return;

  populateRegionSelect(document.getElementById("compare-region-select"), compareState.region);

  document.getElementById("compare-mode-toggle").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-mode]");
    if (!button) return;
    setCompareMode(button.dataset.mode);
    renderCompareChart();
  });

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
    renderCompareChart();
  });

  const selects = [0, 1, 2].map((i) => document.getElementById(`compare-select-${i}`));
  const index = buildSearchIndex();
  selects.forEach((select, i) => {
    const noneOption = document.createElement("option");
    noneOption.value = "";
    noneOption.textContent = i === 0 ? "Select a variable..." : "-- none --";
    select.appendChild(noneOption);
    index.forEach((item) => {
      const option = document.createElement("option");
      option.value = `${item.product}|${item.response}`;
      option.textContent = `${item.product} – ${item.response}`;
      select.appendChild(option);
    });
    select.addEventListener("change", () => {
      compareState.selections[i] = select.value || null;
      renderCompareChart();
    });
  });

  document.getElementById("compare-preset-snowdrought").addEventListener("click", () => {
    setCompareMode("custom");
    const findFirst = (matchFn) => index.find(matchFn);
    const picks = [
      findFirst((it) => it.response === "MONTHLY_SWE"),
      findFirst((it) => it.product === "PRISM" && it.response === "PPT"),
      findFirst((it) => it.product === "ERA5-Land" && it.response === "T2m"),
    ].filter(Boolean);
    picks.forEach((item, i) => {
      if (!selects[i]) return;
      selects[i].value = `${item.product}|${item.response}`;
      compareState.selections[i] = selects[i].value;
    });
    renderCompareChart();
  });

  document.getElementById("compare-region-select").addEventListener("change", (event) => {
    compareState.region = event.target.value;
    renderCompareChart();
  });

  setCompareMode("category");
  renderCompareChart();
}

async function fetchCompareSeries(key) {
  if (!compareState.cache[key]) {
    const res = await fetch(`data/timeseries/${key}.json`);
    compareState.cache[key] = await res.json();
  }
  return compareState.cache[key];
}

async function fetchCompareSeasonal(key) {
  if (!(key in compareState.seasonalCache)) {
    const res = await fetch(`data/seasonal/${key}.json`);
    compareState.seasonalCache[key] = res.ok ? await res.json() : null;
  }
  return compareState.seasonalCache[key];
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

async function renderCompareChart() {
  if (compareState.mode === "category") {
    await renderCategoryOverlay();
  } else {
    await renderCustomOverlay();
  }
}

async function renderCustomOverlay() {
  const chart = document.getElementById("compare-chart");
  const active = compareState.selections.filter(Boolean);
  if (active.length === 0) {
    chart.innerHTML = '<p class="chart-empty">Pick at least one variable to compare.</p>';
    return;
  }
  const traces = [];
  for (let i = 0; i < compareState.selections.length; i++) {
    const sel = compareState.selections[i];
    if (!sel) continue;
    const [product, response] = sel.split("|");
    const data = await fetchCompareSeries(`${product}_${response}`);
    const region = data.regions[compareState.region];
    if (!region) continue;
    traces.push({
      x: region.dates, y: region.sigma, type: "scatter", mode: "lines",
      line: { color: COMPARE_COLORS[i], width: 1.8 },
      name: `${product} ${response}`,
    });
  }
  Plotly.newPlot(chart, traces, plotlyLayout(), { responsive: true, displaylogo: false });
}

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
    return;
  }
  note.textContent = "Solid = observation, dashed = model -- the same grouping and styling as the pipeline's own combined-overlay figures.";

  const traces = [];
  let colorIndex = 0;
  for (const { product, response } of pairs) {
    const key = `${product}_${response}`;
    const data = await fetchCompareSeries(key);
    const region = data.regions[compareState.region];
    if (!region) continue;

    let sigma = region.sigma;
    if (category === "vegetation") {
      const seasonal = await fetchCompareSeasonal(key);
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
    traces.push({
      x: region.dates, y: sigma, type: "scatter", mode: "lines", connectgaps: false,
      line: {
        color: CATEGORY_OVERLAY_COLORS[colorIndex % CATEGORY_OVERLAY_COLORS.length],
        width: 1.6, dash: isObservation ? "solid" : "dash",
      },
      name: `${product} ${response}`,
    });
    colorIndex++;
  }
  Plotly.newPlot(chart, traces, plotlyLayout(), { responsive: true, displaylogo: false });
}

// ---------------------------------------------------------------- Heatmaps
//
// Product x time standardized-anomaly matrix, computed dynamically from the
// same data every other chart on this page uses -- not a static image. Two
// families: "monthly" (direct per-month sigma, the most recent 12 months
// available) and "ndjf_winter" (each winter's NDJF sigma via the same
// window-aggregation + non-parametric standardization used by the homepage
// summary table -- see computeWindowValue() in js/common.js).

const HEATMAP_FAMILIES = {
  monthly: { label: "Monthly anomalies (most recent 12 months)" },
  ndjf_winter: { label: "NDJF winter anomalies (1999–2026)" },
};

const heatmapState = { family: "monthly", category: "all", region: "ALL", cache: {} };

function initHeatmaps() {
  const familySelect = document.getElementById("heatmap-family-select");
  if (!familySelect) return;
  populateRegionSelect(document.getElementById("heatmap-region-select"), heatmapState.region);
  Object.entries(HEATMAP_FAMILIES).forEach(([key, family]) => {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = family.label;
    familySelect.appendChild(option);
  });
  familySelect.value = heatmapState.family;
  familySelect.addEventListener("change", (event) => {
    heatmapState.family = event.target.value;
    renderHeatmap();
  });

  document.getElementById("heatmap-region-select").addEventListener("change", (event) => {
    heatmapState.region = event.target.value;
    renderHeatmap();
  });

  renderHeatmapCategoryTabs();
  renderHeatmap();
}

function renderHeatmapCategoryTabs() {
  const nav = document.getElementById("heatmap-category-tabs");
  nav.innerHTML = "";
  const allButton = document.createElement("button");
  allButton.className = "category-tab active";
  allButton.textContent = "All products";
  allButton.dataset.category = "all";
  allButton.addEventListener("click", () => selectHeatmapCategory("all"));
  nav.appendChild(allButton);

  manifest.category_order.forEach((category) => {
    const button = document.createElement("button");
    button.className = "category-tab";
    button.textContent = manifest.category_labels[category];
    button.style.setProperty("--cat", manifest.category_colors[category]);
    button.dataset.category = category;
    button.addEventListener("click", () => selectHeatmapCategory(category));
    nav.appendChild(button);
  });
}

function selectHeatmapCategory(category) {
  heatmapState.category = category;
  document.querySelectorAll("#heatmap-category-tabs .category-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.category === category);
  });
  renderHeatmap();
}

async function fetchHeatmapSeries(key) {
  if (!heatmapState.cache[key]) {
    const res = await fetch(`data/timeseries/${key}.json`);
    heatmapState.cache[key] = await res.json();
  }
  return heatmapState.cache[key];
}

function heatmapPairs(category) {
  const pairs = [];
  const cats = category === "all" ? manifest.category_order : [category];
  cats.forEach((cat) => {
    const products = manifest.categories[cat] || {};
    for (const [product, responses] of Object.entries(products)) {
      for (const response of Object.keys(responses)) pairs.push({ product, response });
    }
  });
  return pairs;
}

// Every product's own record_end differs; derive the shared 12-month window
// from whichever record extends furthest, rather than a hardcoded date.
function latestRecordEndMonth() {
  let latest = null;
  for (const products of Object.values(manifest.categories)) {
    for (const responses of Object.values(products)) {
      for (const entry of Object.values(responses)) {
        if (entry.record_end && (!latest || entry.record_end > latest)) latest = entry.record_end;
      }
    }
  }
  return latest; // "YYYY-MM-DD"
}

async function renderHeatmap() {
  const chart = document.getElementById("heatmap-chart");
  const pairs = heatmapPairs(heatmapState.category);
  if (pairs.length === 0) {
    chart.innerHTML = '<p class="chart-empty">No products in this category.</p>';
    return;
  }
  chart.innerHTML = '<p class="chart-empty">Computing…</p>';

  let xLabels, z, dataForRow;
  if (heatmapState.family === "monthly") {
    const endDate = latestRecordEndMonth();
    const endYear = parseInt(endDate.slice(0, 4), 10);
    const endMonth = parseInt(endDate.slice(5, 7), 10);
    const months = [];
    for (let i = 11; i >= 0; i--) {
      let m = endMonth - i, y = endYear;
      if (m <= 0) { m += 12; y -= 1; }
      months.push({ year: y, month: m });
    }
    xLabels = months.map(({ year, month }) => `${MONTH_NAMES[month - 1].slice(0, 3)} ${year}`);
    dataForRow = async ({ product, response }) => {
      const data = await fetchHeatmapSeries(`${product}_${response}`);
      const region = data.regions[heatmapState.region];
      if (!region) return months.map(() => null);
      return months.map(({ year, month }) => {
        const dateStr = `${year}-${String(month).padStart(2, "0")}-01`;
        const idx = region.dates.indexOf(dateStr);
        return idx === -1 ? null : region.sigma[idx];
      });
    };
  } else {
    const endDate = latestRecordEndMonth();
    const endYear = parseInt(endDate.slice(0, 4), 10);
    const years = [];
    for (let y = 1999; y <= endYear; y++) years.push(y);
    xLabels = years.map(String);
    dataForRow = async ({ product, response }) => {
      const data = await fetchHeatmapSeries(`${product}_${response}`);
      const region = data.regions[heatmapState.region];
      if (!region) return years.map(() => null);
      return years.map((year) => {
        const result = computeWindowValue(data, region, "NDJF", year);
        return result ? result.sigma : null;
      });
    };
  }

  const yLabels = [];
  z = [];
  for (const pair of pairs) {
    const row = await dataForRow(pair);
    if (row.every((v) => v === null)) continue;
    yLabels.push(`${pair.product} ${pair.response}`);
    z.push(row);
  }
  if (z.length === 0) {
    chart.innerHTML = '<p class="chart-empty">No data for this selection.</p>';
    return;
  }

  const trace = {
    x: xLabels, y: yLabels, z, type: "heatmap",
    colorscale: "RdBu", reversescale: true, zmid: 0,
    colorbar: { title: "σ" },
    hoverongaps: false,
  };
  const layout = {
    margin: { t: 20, r: 20, b: 60, l: 180 },
    xaxis: { side: "bottom" },
    yaxis: { automargin: true },
    font: { family: "Source Sans Pro, sans-serif", size: 12 },
    height: Math.max(360, yLabels.length * 22 + 100),
  };
  Plotly.newPlot(chart, [trace], layout, { responsive: true, displaylogo: false });
}

async function init() {
  await loadManifest();
  initExplorer();
  initCompareView();
  initHeatmaps();
}

init();
