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
  else if (explorerState.view === "timeseries") renderTimeseries();
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
  wrap.innerHTML = `<img src="${assetUrl(`figures/maps/${relpath}`)}" alt="${explorerState.product} ${explorerState.response} ${periodLabel(explorerState.mapPeriod)} map">`;
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
// Overlays up to 3 variables' already-computed standardized anomalies (the
// same `region.sigma` series js/explore.js's own renderTimeseries() plots)
// on one shared axis. Sigma removes each variable's own physical units, so
// this is a direct, purely-descriptive overlay -- no new statistic, no
// interpretation of what the co-movement means.

const compareState = { region: "ALL", selections: [null, null, null], cache: {} };
const COMPARE_COLORS = ["#205493", "#a0290f", "#2e8540"];

function initCompareView() {
  const selects = [0, 1, 2].map((i) => document.getElementById(`compare-select-${i}`));
  if (!selects[0]) return;
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
  document.getElementById("compare-region-select").addEventListener("change", (event) => {
    compareState.region = event.target.value;
    renderCompareChart();
  });
  // Seed the first picker so the chart isn't empty on first load.
  if (index.length > 0) {
    selects[0].value = `${index[0].product}|${index[0].response}`;
    compareState.selections[0] = selects[0].value;
    renderCompareChart();
  }
}

async function fetchCompareSeries(key) {
  if (!compareState.cache[key]) {
    const res = await fetch(`data/timeseries/${key}.json`);
    compareState.cache[key] = await res.json();
  }
  return compareState.cache[key];
}

async function renderCompareChart() {
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
  const layout = {
    margin: { t: 20, r: 20, b: 45, l: 60 },
    yaxis: { title: "Standardized anomaly (σ)", zeroline: true },
    xaxis: { title: "Year" },
    font: { family: "Source Sans Pro, sans-serif", size: 13 },
    shapes: [{ type: "line", x0: 0, x1: 1, xref: "paper", y0: 0, y1: 0, line: { color: "#888", width: 1 } }],
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
  if (families.length === 0) {
    document.getElementById("heatmap-image-wrap").innerHTML = '<p class="map-empty">No heatmaps available yet.</p>';
    return;
  }
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

async function init() {
  await loadManifest();
  initExplorer();
  initCompareView();
  initHeatmaps();
}

init();
