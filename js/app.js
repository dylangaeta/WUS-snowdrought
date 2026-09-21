// Homepage logic: manifest-driven nav, curated map images, and Plotly charts
// built from the pipeline's own regional monthly summary values. No science
// happens here -- every number is read straight from the JSON exported by
// code/14_dashboard_export.py in the snowdrought-carbon repo. Two largely
// independent sections share one manifest fetch: the per-product explorer
// (map/time series/seasonal cycle) and the cross-product heatmaps.

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const SEASON_LABELS = {
  MAM: "Mar–May", JJA: "Jun–Aug", SON: "Sep–Nov",
  DJF: "Dec–Feb (winter)", NDJF: "Nov–Feb (winter)",
  DJFM: "Dec–Mar (winter)", AMJJ: "Apr–Jul (growing season)",
};
const SEASON_ORDER = ["NDJF", "DJFM", "DJF", "MAM", "AMJJ", "JJA", "SON"];
// Mirrors config.py's MAP_SEASONAL_PERIODS exactly -- do not diverge.
const SEASON_MONTHS = {
  MAM: [3, 4, 5], JJA: [6, 7, 8], SON: [9, 10, 11],
  DJF: [12, 1, 2], NDJF: [11, 12, 1, 2], DJFM: [12, 1, 2, 3], AMJJ: [4, 5, 6, 7],
};

let manifest = null;

function periodLabel(period) {
  return SEASON_LABELS[period] || MONTH_NAMES[parseInt(period, 10) - 1];
}

function sortedPeriods(periodKeys) {
  return periodKeys.slice().sort((a, b) => {
    const aSeason = SEASON_ORDER.indexOf(a);
    const bSeason = SEASON_ORDER.indexOf(b);
    if (aSeason !== -1 || bSeason !== -1) {
      if (aSeason === -1) return 1;
      if (bSeason === -1) return -1;
      return aSeason - bSeason;
    }
    return parseInt(a, 10) - parseInt(b, 10);
  });
}

function hexToRgba(hex, alpha) {
  const value = hex.replace("#", "");
  const r = parseInt(value.substring(0, 2), 16);
  const g = parseInt(value.substring(2, 4), 16);
  const b = parseInt(value.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ---------------------------------------------------------------- Explorer

const explorerState = {
  category: null,
  product: null,
  response: null,
  region: "ALL",
  view: "map",
  mapPeriod: null,
  mapYear: "baseline",
  timeseriesSeries: "value",
  seasonalSeries: "raw",
  seriesCache: {},
};

function currentResponseEntry() {
  return manifest.categories[explorerState.category][explorerState.product][explorerState.response];
}

// Set once from the URL hash on load (js/map-viewer.js's copyViewLink()
// writes this same shape), consumed once by populateResponseSelect() as
// each selector settles, then cleared -- never re-applied on later clicks.
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

function initExplorer() {
  if (!document.getElementById("category-tabs")) return;
  renderCategoryTabs();
  pendingSharedView = parseSharedViewFromUrl();
  const initialCategory = (pendingSharedView && manifest.categories[pendingSharedView.category])
    ? pendingSharedView.category
    : manifest.category_order.find((cat) => Object.keys(manifest.categories[cat]).length > 0);
  selectCategory(initialCategory);
  wireExplorerControls();
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
  explorerState.product = (pendingSharedView && products.includes(pendingSharedView.product))
    ? pendingSharedView.product : products[0];
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
  explorerState.response = (pendingSharedView && responses.includes(pendingSharedView.response))
    ? pendingSharedView.response : responses[0];
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
    // olMapState is defined in js/map-viewer.js; guarded rather than relying
    // on script-tag load order, since init() only reaches this point after
    // an awaited fetch() yields to the event loop (later <script> tags on
    // the page do run first in practice, but this doesn't depend on that).
    if (typeof olMapState !== "undefined") {
      if (pendingSharedView.period) olMapState.period = pendingSharedView.period;
      if (pendingSharedView.year) {
        olMapState.year = pendingSharedView.year;
        document.querySelectorAll("#ol-year-toggle button").forEach((btn) => {
          btn.classList.toggle("active", btn.dataset.year === pendingSharedView.year);
        });
      }
    }
    pendingSharedView = null; // restore only on initial load, never again
  }
  onSelectionChanged();
}

function onSelectionChanged() {
  const entry = currentResponseEntry();
  const meta = document.getElementById("product-meta");
  const recordRange = entry.record_start && entry.record_end
    ? `${entry.record_start.slice(0, 7)} – ${entry.record_end.slice(0, 7)}`
    : "unknown record range";
  meta.textContent = `Units: ${entry.units || "n/a"} · Record: ${recordRange} · Status: ${entry.status}`;
  explorerState.mapPeriod = null;
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
  document.getElementById("map-period-select").addEventListener("change", (event) => {
    explorerState.mapPeriod = event.target.value;
    renderMap();
  });
  document.getElementById("map-year-toggle").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-year]");
    if (!button || button.disabled) return;
    explorerState.mapYear = button.dataset.year;
    document.querySelectorAll("#map-year-toggle button").forEach((btn) => btn.classList.toggle("active", btn === button));
    renderMap();
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
  else if (explorerState.view === "interactive-map") {
    // Defined in js/map-viewer.js, loaded after this file; guarded in case
    // that script hasn't initialized yet (e.g. OpenLayers CDN still loading).
    if (typeof renderInteractiveMap === "function") renderInteractiveMap();
  } else if (explorerState.view === "timeseries") renderTimeseries();
  else renderSeasonal();
}

function renderMap() {
  const entry = currentResponseEntry();
  const periods = sortedPeriods(Object.keys(entry.maps || {}));
  const select = document.getElementById("map-period-select");
  const wrap = document.getElementById("map-image-wrap");

  if (periods.length === 0) {
    select.innerHTML = "";
    wrap.innerHTML = '<p class="map-empty">No spatial maps for this dataset (site-network product).</p>';
    return;
  }
  if (!explorerState.mapPeriod || !periods.includes(explorerState.mapPeriod)) {
    explorerState.mapPeriod = periods.includes("DJFM") ? "DJFM" : periods[0];
  }
  select.innerHTML = "";
  periods.forEach((period) => {
    const option = document.createElement("option");
    option.value = period;
    option.textContent = periodLabel(period);
    select.appendChild(option);
  });
  select.value = explorerState.mapPeriod;

  const slot = entry.maps[explorerState.mapPeriod];
  const yearButtons = document.querySelectorAll("#map-year-toggle button");
  yearButtons.forEach((btn) => {
    const key = btn.dataset.year === "baseline" ? "baseline" : `anomaly_${btn.dataset.year}`;
    const available = Boolean(slot[key]);
    btn.disabled = !available;
    btn.style.opacity = available ? "1" : "0.4";
  });
  if (!slot[explorerState.mapYear === "baseline" ? "baseline" : `anomaly_${explorerState.mapYear}`]) {
    const firstAvailable = ["baseline", "2026", "2025"].find(
      (year) => slot[year === "baseline" ? "baseline" : `anomaly_${year}`]
    );
    explorerState.mapYear = firstAvailable || "baseline";
  }
  yearButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.year === explorerState.mapYear));

  const key = explorerState.mapYear === "baseline" ? "baseline" : `anomaly_${explorerState.mapYear}`;
  const relpath = slot[key];
  if (!relpath) {
    wrap.innerHTML = '<p class="map-empty">No map available for this selection.</p>';
    return;
  }
  wrap.innerHTML = `<img src="figures/maps/${relpath}" alt="${explorerState.product} ${explorerState.response} ${periodLabel(explorerState.mapPeriod)} map">`;
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

// ---------------------------------------------------------------- Heatmaps

const heatmapState = {
  family: null,
  category: "all",
  threshold: "all",
};

function initHeatmaps() {
  const familySelect = document.getElementById("heatmap-family-select");
  if (!familySelect) return;
  const families = Object.keys(manifest.heatmaps);
  families.forEach((family) => {
    const option = document.createElement("option");
    option.value = family;
    option.textContent = manifest.heatmaps[family].label;
    familySelect.appendChild(option);
  });
  heatmapState.family = families[0];
  familySelect.value = heatmapState.family;
  familySelect.addEventListener("change", (event) => {
    heatmapState.family = event.target.value;
    heatmapState.category = "all";
    heatmapState.threshold = "all";
    renderHeatmapCategoryTabs();
    renderHeatmap();
  });

  document.getElementById("heatmap-threshold-toggle").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-threshold]");
    if (!button || button.disabled) return;
    heatmapState.threshold = button.dataset.threshold;
    document.querySelectorAll("#heatmap-threshold-toggle button").forEach((btn) => btn.classList.toggle("active", btn === button));
    renderHeatmap();
  });

  renderHeatmapCategoryTabs();
  renderHeatmap();
}

function renderHeatmapCategoryTabs() {
  const nav = document.getElementById("heatmap-category-tabs");
  nav.innerHTML = "";
  const familyCategories = manifest.heatmaps[heatmapState.family].categories;

  const allButton = document.createElement("button");
  allButton.className = "category-tab";
  allButton.textContent = "All products";
  allButton.dataset.category = "all";
  allButton.addEventListener("click", () => selectHeatmapCategory("all"));
  nav.appendChild(allButton);

  manifest.category_order.forEach((category) => {
    if (!familyCategories[category]) return;
    const button = document.createElement("button");
    button.className = "category-tab";
    button.textContent = manifest.category_labels[category];
    button.style.setProperty("--cat", manifest.category_colors[category]);
    button.dataset.category = category;
    button.addEventListener("click", () => selectHeatmapCategory(category));
    nav.appendChild(button);
  });
  markActiveHeatmapCategory();
}

function selectHeatmapCategory(category) {
  heatmapState.category = category;
  markActiveHeatmapCategory();
  renderHeatmap();
}

function markActiveHeatmapCategory() {
  document.querySelectorAll("#heatmap-category-tabs .category-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.category === heatmapState.category);
  });
}

function renderHeatmap() {
  const family = manifest.heatmaps[heatmapState.family];
  const categorySlots = family.categories[heatmapState.category] || {};
  const hasThresholds = Object.keys(categorySlots).some((key) => key !== "all");
  document.getElementById("heatmap-threshold-toggle").style.display = hasThresholds ? "inline-flex" : "none";
  if (!hasThresholds) heatmapState.threshold = "all";
  document.querySelectorAll("#heatmap-threshold-toggle button").forEach((btn) => {
    const available = Boolean(categorySlots[btn.dataset.threshold]);
    btn.disabled = !available;
    btn.style.opacity = available ? "1" : "0.4";
    btn.classList.toggle("active", btn.dataset.threshold === heatmapState.threshold);
  });

  const wrap = document.getElementById("heatmap-image-wrap");
  const filename = categorySlots[heatmapState.threshold];
  if (!filename) {
    wrap.innerHTML = '<p class="map-empty">No heatmap available for this selection.</p>';
    return;
  }
  wrap.innerHTML = `<img src="figures/heatmaps/${filename}" alt="${family.label} heatmap">`;
}

// ------------------------------------------------------------- Summary table
//
// Computed entirely client-side from the same monthly grid-cell-detrended
// anomaly arrays the explorer uses -- no new statistics invented here. Each
// response's multi-month aggregation rule (sum / mean / day_weighted_mean /
// native_index) comes from code/14_dashboard_export.py's AGGREGATION_RULE,
// audited against each product's actual reducer/analyzer code, not guessed.
// "Stress vs relief" coloring uses drier_is_high, straight from config.py's
// own response_drier_is_high() -- the same function the canonical
// multi-product heatmap uses -- not a locally invented sign convention.

const summaryState = { window: "DJFM", year: 2026, valueType: "sigma", cache: {} };
let summaryRegionColumns = []; // [{code, label}], built from manifest once

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

// Standard normal CDF via the Abramowitz & Stegun 7.1.26 erf approximation
// (max error ~1.5e-7) -- converts a sigma value to its percentile under a
// normal distribution, purely for display alongside the sigma itself.
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

function sigmaToPercentileLabel(sigma) {
  const percentile = 50 * (1 + erf(sigma / Math.SQRT2));
  if (percentile >= 99.95) return ">99.9%";
  if (percentile <= 0.05) return "<0.1%";
  return `${Math.round(percentile)}%`;
}

function windowMonthYearPairs(windowKey, targetYear) {
  const months = SEASON_MONTHS[windowKey] || [parseInt(windowKey, 10)];
  const crossesNewYear = months.includes(1) && months.some((m) => m >= 10);
  return months.map((month) => ({
    month,
    year: crossesNewYear && month >= 10 ? targetYear - 1 : targetYear,
  }));
}

async function fetchSummaryData(product, response) {
  const key = `${product}_${response}`;
  if (!summaryState.cache[key]) {
    const res = await fetch(`data/timeseries/${key}.json`);
    summaryState.cache[key] = await res.json();
  }
  return summaryState.cache[key];
}

function aggregateWindow(region, windowKey, targetYear, rule, field) {
  const pairs = windowMonthYearPairs(windowKey, targetYear);
  const values = [];
  const weights = [];
  for (const { month, year } of pairs) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-01`;
    const idx = region.dates.indexOf(dateStr);
    if (idx === -1 || region[field][idx] === null) return null;
    values.push(region[field][idx]);
    weights.push(rule === "day_weighted_mean" ? daysInMonth(year, month) : 1);
  }
  if (rule === "sum") return values.reduce((a, b) => a + b, 0);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  return values.reduce((sum, v, i) => sum + v * weights[i], 0) / totalWeight;
}

function meanStd(values) {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  return { mean, std: Math.sqrt(variance) };
}

// Returns { sigma, rawValue, percentOfNormal, isNativeIndex } for one
// product/response/region/window/year. percentOfNormal is null wherever the
// baseline mean is too close to zero to divide by meaningfully (e.g. some
// temperature/VPD anomaly-prone fields), or for native standardized indices
// (already a departure statistic, not a physical quantity with a "normal").
function computeWindowValue(data, region, windowKey, targetYear) {
  if (data.aggregation === "native_index") {
    // A native index (e.g. SPI-03) is already its own trailing N-month
    // statistic, so it can't be re-aggregated across a season window -- but
    // it's still meaningful for one: show its reading as of the window's
    // own last month (e.g. DJFM -> its March value, which for a 3-month
    // index already reflects Jan-Mar). Previously this returned null for
    // any multi-month window, which silently dropped every native index
    // (SPI/SPEI/EDDI/PDSI/ForDRI/ESI) from every season-window view and
    // left USDM -- the only drought-category response with real "mean"
    // aggregation -- looking like the sole drought index available.
    const pairs = windowMonthYearPairs(windowKey, targetYear);
    const { month, year } = pairs[pairs.length - 1];
    const dateStr = `${year}-${String(month).padStart(2, "0")}-01`;
    const idx = region.dates.indexOf(dateStr);
    if (idx === -1) return null;
    const v = region.value[idx];
    return { sigma: v, rawValue: v, percentOfNormal: null, isNativeIndex: true };
  }
  const targetAnomaly = aggregateWindow(region, windowKey, targetYear, data.aggregation, "anomaly");
  const targetRaw = aggregateWindow(region, windowKey, targetYear, data.aggregation, "value");
  if (targetAnomaly === null || targetRaw === null) return null;

  const baselineAnomalies = [];
  const baselineRaws = [];
  for (let y = region.baseline_start_year; y <= region.baseline_end_year; y++) {
    const a = aggregateWindow(region, windowKey, y, data.aggregation, "anomaly");
    const r = aggregateWindow(region, windowKey, y, data.aggregation, "value");
    if (a !== null) baselineAnomalies.push(a);
    if (r !== null) baselineRaws.push(r);
  }
  if (baselineAnomalies.length < 2) return null;
  const { mean: meanAnomaly, std: stdAnomaly } = meanStd(baselineAnomalies);
  if (stdAnomaly === 0) return null;
  const sigma = (targetAnomaly - meanAnomaly) / stdAnomaly;

  let percentOfNormal = null;
  if (baselineRaws.length >= 2) {
    const { mean: meanRaw, std: stdRaw } = meanStd(baselineRaws);
    // Guard: a baseline mean within one baseline std of zero makes "percent
    // of normal" numerically unstable (small denominator), not meaningful.
    if (Math.abs(meanRaw) > stdRaw) percentOfNormal = ((targetRaw - meanRaw) / meanRaw) * 100;
  }
  return { sigma, rawValue: targetRaw, percentOfNormal, isNativeIndex: false };
}

function initSummaryTable() {
  const windowSelect = document.getElementById("summary-window-select");
  if (!windowSelect) return;
  SEASON_ORDER.forEach((key) => {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = `${key} (${SEASON_LABELS[key]})`;
    windowSelect.appendChild(option);
  });
  MONTH_NAMES.forEach((name, i) => {
    const option = document.createElement("option");
    option.value = String(i + 1).padStart(2, "0");
    option.textContent = name;
    windowSelect.appendChild(option);
  });
  windowSelect.value = summaryState.window;

  windowSelect.addEventListener("change", (event) => {
    summaryState.window = event.target.value;
    renderSummaryTable();
  });
  document.getElementById("summary-year-select").addEventListener("change", (event) => {
    summaryState.year = parseInt(event.target.value, 10);
    renderSummaryTable();
  });
  document.getElementById("summary-value-select").addEventListener("change", (event) => {
    summaryState.valueType = event.target.value;
    renderSummaryTable();
  });

  summaryRegionColumns = [
    { code: "ALL", label: manifest.region_labels.ALL },
    { code: "CO_UT_WY", label: manifest.region_labels.CO_UT_WY },
    ...manifest.western_states.map((code) => ({ code, label: code })),
  ];
  const headerRow = document.getElementById("summary-table-header");
  summaryRegionColumns.forEach((col) => {
    const th = document.createElement("th");
    th.textContent = col.label;
    headerRow.appendChild(th);
  });

  renderSummaryTable();
}

function formatSummaryValue(result, units, valueType) {
  const sign = result.sigma >= 0 ? "+" : "";
  if (valueType === "raw") return `${result.rawValue.toFixed(2)} ${units}`;
  if (valueType === "percentile") return sigmaToPercentileLabel(result.sigma);
  if (valueType === "percent_of_normal") {
    if (result.percentOfNormal === null) return "n/a";
    const pctSign = result.percentOfNormal >= 0 ? "+" : "";
    return `${pctSign}${result.percentOfNormal.toFixed(0)}%`;
  }
  return `${sign}${result.sigma.toFixed(1)}`; // "sigma" default
}

async function renderSummaryTable() {
  const body = document.getElementById("summary-table-body");
  const colCount = 2 + summaryRegionColumns.length;
  body.innerHTML = `<tr><td colspan="${colCount}">Computing&hellip;</td></tr>`;
  const rowsByCategory = {};

  for (const category of manifest.category_order) {
    const products = manifest.categories[category];
    for (const [product, responses] of Object.entries(products)) {
      for (const [response, entry] of Object.entries(responses)) {
        if (!entry.aggregation) continue; // no established aggregation rule (e.g. NEON NEE) -- excluded, not guessed
        const data = await fetchSummaryData(product, response);
        const cells = summaryRegionColumns.map((col) => {
          const region = data.regions[col.code];
          if (!region) return null;
          return computeWindowValue(data, region, summaryState.window, summaryState.year);
        });
        if (cells.every((cell) => cell === null)) continue;
        (rowsByCategory[category] = rowsByCategory[category] || []).push({ product, response, cells });
      }
    }
  }

  body.innerHTML = "";
  let anyRows = false;
  manifest.category_order.forEach((category) => {
    const rows = rowsByCategory[category];
    if (!rows || rows.length === 0) return;
    anyRows = true;
    const groupRow = document.createElement("tr");
    groupRow.className = "group-row";
    groupRow.innerHTML = `<td colspan="${colCount}">${manifest.category_labels[category]}</td>`;
    body.appendChild(groupRow);
    rows.forEach((row) => {
      const data = summaryState.cache[`${row.product}_${row.response}`];
      let note = "";
      if (row.cells.some((cell) => cell && cell.isNativeIndex)) {
        if (SEASON_MONTHS[summaryState.window]) {
          const lastMonth = SEASON_MONTHS[summaryState.window].slice(-1)[0];
          note = ` (native index, as of ${MONTH_NAMES[lastMonth - 1]})`;
        } else {
          note = " (native index)";
        }
      }
      const cellsHtml = row.cells.map((result) => {
        if (!result) return "<td>&mdash;</td>";
        const isStress = data.drier_is_high ? result.sigma > 0 : result.sigma < 0;
        const cls = isStress ? "stress" : "relief";
        const text = formatSummaryValue(result, data.units, summaryState.valueType);
        return `<td class="${cls}">${text}</td>`;
      }).join("");
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${row.response}${note}</td><td>${row.product}</td>${cellsHtml}`;
      body.appendChild(tr);
    });
  });
  if (!anyRows) {
    body.innerHTML = `<tr><td colspan="${colCount}">No data for this window/year.</td></tr>`;
  }
}

// ------------------------------------------------------------------- Init

async function init() {
  const response = await fetch("data/manifest.json");
  manifest = await response.json();
  initExplorer();
  initHeatmaps();
  initSummaryTable();
}

init();
