// Interactive COG map viewer (OpenLayers, global `ol` UMD bundle from CDN).
// Its own page (maps.html) with its own category/product/response picker --
// mirrors "Explore the data"'s picker (js/explore.js's explorerState) but is
// entirely independent since the two pages never load together. Colors are
// never computed in JS: every value comes from the per-product style JSON
// exported by code/17_dashboard_cog_export.py (same boundaries/colors the
// pipeline's own PNG maps use, via common/maps.py's _diverging_bins +
// config.py's response_anomaly_cmap -- ported once server-side, not
// re-derived here).

const mapPickerState = { category: null, product: null, response: null };

function currentResponseEntry() {
  return manifest.categories[mapPickerState.category][mapPickerState.product][mapPickerState.response];
}

function parseSharedMapViewFromUrl() {
  if (!window.location.hash || window.location.hash.length < 2) return null;
  try {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const view = Object.fromEntries(params.entries());
    return view.category && view.product && view.response ? view : null;
  } catch (err) {
    return null;
  }
}

let pendingSharedMapView = null;
let lastMapSelection = null;

// A URL fragment-only change (e.g. an embedding iframe's src updated to a
// new #category=...&product=...&response=... on the same maps.html
// document) does not reload the page or re-run init(), so it must be
// re-applied explicitly via the hashchange event below -- confirmed missing
// in real embedding testing, 2026-09.
function applySharedMapView() {
  const view = parseSharedMapViewFromUrl();
  if (!view || !manifest.categories[view.category]) return false;
  pendingSharedMapView = view;
  selectMapCategory(view.category);
  return true;
}

function initMapPicker() {
  renderMapCategoryTabs();
  if (!applySharedMapView()) {
    lastMapSelection = loadLastSelection();
    const preferredCategory = lastMapSelection?.category;
    const initialCategory = (preferredCategory && manifest.categories[preferredCategory])
      ? preferredCategory
      : manifest.category_order.find((cat) => Object.keys(manifest.categories[cat]).length > 0);
    selectMapCategory(initialCategory);
  }

  document.getElementById("product-select").addEventListener("change", (event) => {
    mapPickerState.product = event.target.value;
    populateMapResponseSelect();
  });
  document.getElementById("response-select").addEventListener("change", (event) => {
    mapPickerState.response = event.target.value;
    onMapSelectionChanged();
  });
  wireProductSearch("product-search", "product-search-results", (category, product, response) => {
    pendingSharedMapView = { category, product, response };
    selectMapCategory(category);
  });
  window.addEventListener("hashchange", applySharedMapView);
}

function renderMapCategoryTabs() {
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
    button.addEventListener("click", () => selectMapCategory(category));
    nav.appendChild(button);
  });
}

function selectMapCategory(category) {
  mapPickerState.category = category;
  document.querySelectorAll("#category-tabs .category-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.category === category);
  });
  populateMapProductSelect();
}

function populateMapProductSelect() {
  const select = document.getElementById("product-select");
  select.innerHTML = "";
  const products = Object.keys(manifest.categories[mapPickerState.category]);
  products.forEach((product) => {
    const option = document.createElement("option");
    option.value = product;
    option.textContent = product;
    select.appendChild(option);
  });
  const preferredProduct = pendingSharedMapView?.product || lastMapSelection?.product;
  mapPickerState.product = (preferredProduct && products.includes(preferredProduct))
    ? preferredProduct : products[0];
  select.value = mapPickerState.product;
  populateMapResponseSelect();
}

function populateMapResponseSelect() {
  const select = document.getElementById("response-select");
  select.innerHTML = "";
  const responses = Object.keys(manifest.categories[mapPickerState.category][mapPickerState.product]);
  responses.forEach((response) => {
    const option = document.createElement("option");
    option.value = response;
    option.textContent = response;
    select.appendChild(option);
  });
  const preferredResponse = pendingSharedMapView?.response || lastMapSelection?.response;
  mapPickerState.response = (preferredResponse && responses.includes(preferredResponse))
    ? preferredResponse : responses[0];
  select.value = mapPickerState.response;

  if (pendingSharedMapView) {
    if (pendingSharedMapView.period) olMapState.period = pendingSharedMapView.period;
    if (pendingSharedMapView.year) {
      olMapState.year = pendingSharedMapView.year;
      document.querySelectorAll("#ol-year-toggle button").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.year === pendingSharedMapView.year);
      });
    }
    pendingSharedMapView = null; // restore only on initial load, never again
  }
  lastMapSelection = null; // consumed as a one-time fallback, same as pendingSharedMapView
  onMapSelectionChanged();
}

function onMapSelectionChanged() {
  const entry = currentResponseEntry();
  document.getElementById("product-meta").innerHTML = productMetaHtml(entry);
  saveLastSelection(mapPickerState.category, mapPickerState.product, mapPickerState.response);
  renderInteractiveMap();
}

const olMapState = {
  map: null,
  rasterLayer: null,
  boundaryLayer: null,
  period: null,
  year: "baseline",
  lastAnomalyYear: null, // remembered so the Climatology button can toggle back to it
  styleCache: {},
  currentStyle: null,
  currentCogUrl: null,
  currentScale: null,
};

const COG_NODATA = -32768;

// ol.layer.WebGLTile's style expression mirrors common/maps.py's
// BoundaryNorm discrete binning exactly: value in [boundaries[i],
// boundaries[i+1]) -> colors[i]. Below the first / at or above the last
// boundary clamp to the end colors, matching matplotlib's default "extend"
// behavior for an unbounded diverging cmap. ol.source.Raster was tried
// instead (CPU-side, no shader) but crashes the browser when combined with
// ol.source.GeoTIFF (reproduced in isolation, 2026-09, headless Chromium);
// WebGLTile+GeoTIFF is the stable, working combination once geotiff.js
// (the separate TIFF-decoding library ol.source.GeoTIFF depends on at
// runtime) is loaded alongside ol.js -- see maps.html's <script> tags.
function buildBinnedColorExpression(boundaries, colors, scale) {
  const band = ["band", 1];
  const value = ["/", band, scale];
  // ol.source.GeoTIFF's `nodata` option auto-generates a second (alpha)
  // band -- 1 where valid, 0 where nodata -- rather than preserving the
  // sentinel value in band 1 (confirmed directly via getData() in a real
  // browser: a known-ocean pixel read back as [0, 0], a known-land pixel as
  // [realValue, 255/1]). Without this explicit check every nodata pixel's
  // band-1 value of 0 fell into whatever bin straddles zero, rendering
  // ocean as an opaque "near-normal" color instead of transparent.
  const expr = ["case", ["==", ["band", 2], 0], ["color", 0, 0, 0, 0]];
  for (let i = 0; i < boundaries.length - 1; i++) {
    expr.push(["<", value, boundaries[i + 1]], colors[i]);
  }
  expr.push(colors[colors.length - 1]);
  return expr;
}

// Smallest number of decimal places at which every boundary in a
// BoundaryNorm scale formats to a distinct string -- e.g. [-0.11, -0.09,
// ...] needs 2 decimals (1 decimal collapses both to "-0.1").
function pickTickDecimals(boundaries) {
  for (let d = 0; d <= 6; d++) {
    const formatted = boundaries.map((v) => v.toFixed(d));
    if (new Set(formatted).size === formatted.length) return d;
  }
  return 6;
}

function olPeriodLabel(period) {
  return SEASON_LABELS[period] || MONTH_NAMES[parseInt(period, 10) - 1];
}

function initInteractiveMap() {
  if (olMapState.map || typeof ol === "undefined") return;

  olMapState.boundaryLayer = new ol.layer.Vector({
    source: new ol.source.Vector({
      url: "data/western_states.geojson",
      format: new ol.format.GeoJSON(),
    }),
    style: new ol.style.Style({
      stroke: new ol.style.Stroke({ color: "#1b1b1b", width: 1 }),
    }),
    zIndex: 10,
  });

  olMapState.map = new ol.Map({
    target: "ol-map",
    layers: [
      new ol.layer.Tile({ source: new ol.source.OSM({ opaque: false }), opacity: 0.5 }),
      olMapState.boundaryLayer,
    ],
    view: new ol.View({
      center: ol.proj.fromLonLat([-113, 40]), // overridden by view.fit() below to the real domain extent
      zoom: 5,
    }),
  });
  // Fixed Western-US extent (matches c.WEST/EAST_PLOT/SOUTH/NORTH in the
  // pipeline's own config.py) -- set directly rather than relying on a
  // guessed center, since the manifest doesn't carry domain bounds.
  const extent = ol.proj.transformExtent([-125.0, 31.0, -101.5, 49.5], "EPSG:4326", "EPSG:3857");
  olMapState.map.getView().fit(extent, { size: olMapState.map.getSize() || [600, 500] });

  document.getElementById("ol-period-select").addEventListener("change", (event) => {
    olMapState.period = event.target.value;
    updateInteractiveMapLayer();
  });
  document.getElementById("ol-year-toggle").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-year]");
    if (!button || button.disabled) return;
    olMapState.year = button.dataset.year;
    document.querySelectorAll("#ol-year-toggle button").forEach((btn) => btn.classList.toggle("active", btn === button));
    updateInteractiveMapLayer();
  });
  document.getElementById("ol-year-slider").addEventListener("input", (event) => {
    const years = olMapState.sliderYears || [];
    const year = years[parseInt(event.target.value, 10)];
    if (year === undefined) return;
    olMapState.year = String(year);
    const label = document.getElementById("ol-year-slider-label");
    label.textContent = olMapState.year;
    label.classList.remove("inactive");
    document.getElementById("ol-year-slider-baseline").classList.remove("active");
    event.target.classList.add("active");
    updateInteractiveMapLayer();
  });
  document.getElementById("ol-year-slider-baseline").addEventListener("click", () => {
    // Toggle: clicking Climatology while already on it restores whichever
    // anomaly year was showing before, instead of being a dead-end click.
    if (olMapState.year === "baseline") {
      if (olMapState.lastAnomalyYear !== null) olMapState.year = olMapState.lastAnomalyYear;
    } else {
      olMapState.lastAnomalyYear = olMapState.year;
      olMapState.year = "baseline";
    }
    updateInteractiveMapLayer();
  });
  document.getElementById("ol-boundary-toggle").addEventListener("change", (event) => {
    olMapState.boundaryLayer.setVisible(event.target.checked);
  });
  document.getElementById("ol-screenshot-btn").addEventListener("click", takeMapScreenshot);
  document.getElementById("ol-copy-url-btn").addEventListener("click", () => {
    if (olMapState.currentCogUrl) copyToClipboard(new URL(olMapState.currentCogUrl, window.location.href).href);
  });
  document.getElementById("ol-copy-view-btn").addEventListener("click", copyViewLink);

  olMapState.map.on("singleclick", (event) => {
    const readout = document.getElementById("ol-query-readout");
    if (!olMapState.rasterLayer) return;
    try {
      const data = olMapState.rasterLayer.getData(event.pixel);
      // ol.source.GeoTIFF's `nodata` option auto-generates a second (alpha)
      // band -- 255 where valid, 0 where nodata -- and zeroes out band 1
      // itself at nodata pixels rather than preserving the sentinel value,
      // so nodata must be detected from data[1], not by comparing data[0]
      // to COG_NODATA (confirmed directly via getData() in a real browser).
      const raw = data && data[0];
      const alpha = data && data[1];
      if (!data || !Number.isFinite(raw) || alpha === 0) {
        readout.textContent = "No data at this point.";
        return;
      }
      const value = raw / olMapState.currentScale; // undo this file's own Int16 scale (varies per file, read from its style JSON entry)
      const lonLat = ol.proj.toLonLat(event.coordinate);
      readout.textContent = `${value.toFixed(2)} at ${lonLat[1].toFixed(3)}°N, ${lonLat[0].toFixed(3)}°E`;
    } catch (err) {
      readout.textContent = "Could not read a value at this point.";
    }
  });
}

async function fetchMapStyle(product, response) {
  const key = `${product}_${response}`;
  if (!olMapState.styleCache[key]) {
    const res = await fetch(`data/map_styles/${key}.json`);
    if (!res.ok) {
      olMapState.styleCache[key] = null;
      return null;
    }
    olMapState.styleCache[key] = await res.json();
  }
  return olMapState.styleCache[key];
}

// DJFM (this project's own flagship winter window) is exported with a COG
// for every year in each product's record, not just baseline/2025/2026 --
// see code/17_dashboard_cog_export.py's matching SLIDER_PERIODS. Every
// other period keeps the plain 3-button toggle.
const SLIDER_PERIODS = ["DJFM"];

function updateYearControlForPeriod(slot) {
  const toggle = document.getElementById("ol-year-toggle");
  const sliderWrap = document.getElementById("ol-year-slider-wrap");
  const slider = document.getElementById("ol-year-slider");
  const label = document.getElementById("ol-year-slider-label");
  const minBound = document.getElementById("ol-year-slider-min");
  const maxBound = document.getElementById("ol-year-slider-max");
  const baselineBtn = document.getElementById("ol-year-slider-baseline");

  if (!SLIDER_PERIODS.includes(olMapState.period)) {
    toggle.style.display = "";
    sliderWrap.style.display = "none";
    if (!["baseline", "2025", "2026"].includes(olMapState.year)) olMapState.year = "baseline";
    return;
  }

  toggle.style.display = "none";
  sliderWrap.style.display = "inline-flex";
  const years = Object.keys(slot)
    .filter((k) => k.startsWith("anomaly_"))
    .map((k) => parseInt(k.slice("anomaly_".length), 10))
    .sort((a, b) => a - b);
  olMapState.sliderYears = years;
  if (olMapState.year !== "baseline" && !years.includes(parseInt(olMapState.year, 10))) {
    olMapState.year = years.length ? String(years[years.length - 1]) : "baseline";
  }
  slider.min = "0";
  slider.max = String(Math.max(years.length - 1, 0));
  minBound.textContent = years.length ? String(years[0]) : "";
  maxBound.textContent = years.length ? String(years[years.length - 1]) : "";
  const currentIndex = olMapState.year === "baseline" ? years.length - 1 : years.indexOf(parseInt(olMapState.year, 10));
  slider.value = String(Math.max(currentIndex, 0));
  // Always show a real year (never blank) so the slider reads as labeled
  // even in Climatology mode -- "inactive" styling communicates that this
  // parked year isn't the one currently on the map.
  label.textContent = String(years[Math.max(currentIndex, 0)] ?? "");
  label.classList.toggle("inactive", olMapState.year === "baseline");
  baselineBtn.classList.toggle("active", olMapState.year === "baseline");
  slider.classList.toggle("active", olMapState.year !== "baseline");
}

async function updateInteractiveMapLayer() {
  const entry = currentResponseEntry();
  const style = await fetchMapStyle(mapPickerState.product, mapPickerState.response);
  const emptyMsg = document.getElementById("ol-map-empty");
  const wrap = document.getElementById("ol-map-wrap");
  if (!style || !style.periods[olMapState.period]) {
    wrap.style.display = "none";
    emptyMsg.style.display = "block";
    return;
  }
  const slot = style.periods[olMapState.period];
  updateYearControlForPeriod(slot);
  const key = olMapState.year === "baseline" ? "baseline" : `anomaly_${olMapState.year}`;
  const fileEntry = slot[key];
  if (!fileEntry) {
    wrap.style.display = "none";
    emptyMsg.style.display = "block";
    return;
  }
  const file = fileEntry.file;
  wrap.style.display = "";
  emptyMsg.style.display = "none";

  const url = assetUrl(`cogs/${file}`);
  olMapState.currentCogUrl = url;
  olMapState.currentScale = fileEntry.scale;
  document.getElementById("ol-geotiff-link").href = url;
  document.getElementById("ol-geotiff-link").setAttribute(
    "download", `${mapPickerState.product}_${mapPickerState.response}_${olMapState.period}_${olMapState.year}.tif`
  );

  const source = new ol.source.GeoTIFF({
    sources: [{ url, nodata: -32768 }],
    normalize: false,
  });

  const legend = document.getElementById("ol-legend");
  const units = entry.units || "";
  const isBaseline = olMapState.year === "baseline";
  const palette = isBaseline ? style.baseline_colors : style.anomaly_colors;
  const label = isBaseline ? `Climatology (${units})` : `${units} anomaly`;
  const boundaries = fileEntry.boundaries;
  if (boundaries) {
    const nBins = boundaries.length - 1;
    // Every bin boundary gets its own tick -- these are discrete
    // BoundaryNorm bins (matching the pipeline's own static maps), not a
    // continuous colorbar, so skipping a boundary hides a real category
    // edge. Fixed 1-decimal formatting made adjacent boundaries render as
    // duplicate-looking labels (e.g. -0.11 and -0.09 both "-0.1"); instead
    // pick the fewest decimals that keep every boundary distinguishable.
    const decimals = pickTickDecimals(boundaries);
    // Adjacent boundaries are only 34px (one swatch) apart, too narrow for
    // most label text, so alternate labels onto a second row -- doubles the
    // effective horizontal spacing to 68px without touching swatch width.
    const tickRowClass = (boundaryIndex) => (boundaryIndex % 2 === 0 ? "" : " ol-legend-tick-row2");
    const swatches = Array.from({ length: nBins }, (_, i) => {
      const leftTick = `<span class="ol-legend-tick${tickRowClass(i)}">${boundaries[i].toFixed(decimals)}</span>`;
      const rightTick = i === nBins - 1
        ? `<span class="ol-legend-tick ol-legend-tick-last${tickRowClass(nBins)}">${boundaries[i + 1].toFixed(decimals)}</span>`
        : "";
      return `<span class="ol-legend-swatch" style="background:${palette[i]}" title="${boundaries[i].toFixed(decimals)} to ${boundaries[i + 1].toFixed(decimals)}">${leftTick}${rightTick}</span>`;
    }).join("");
    legend.innerHTML = `<div class="ol-legend-label">${label}</div><div class="ol-legend-scale">${swatches}</div>`;
  } else {
    // Native standardized indices (SPI/SPEI/EDDI/...): value IS the anomaly,
    // no boundaries computed yet -- show units only, no color scale.
    legend.innerHTML = `<div class="ol-legend-label">${units}</div>`;
  }

  const colorExpr = boundaries ? buildBinnedColorExpression(boundaries, palette, fileEntry.scale) : null;

  if (olMapState.rasterLayer) olMapState.map.removeLayer(olMapState.rasterLayer);
  olMapState.rasterLayer = new ol.layer.WebGLTile({
    source,
    style: colorExpr ? { color: colorExpr } : undefined,
  });
  olMapState.map.getLayers().insertAt(1, olMapState.rasterLayer); // above basemap, below boundaries
}

async function renderInteractiveMap() {
  initInteractiveMap();
  if (!olMapState.map) {
    document.getElementById("ol-map-empty").style.display = "block";
    document.getElementById("ol-map-empty").textContent = "Interactive map library failed to load.";
    return;
  }
  const style = await fetchMapStyle(mapPickerState.product, mapPickerState.response);
  const select = document.getElementById("ol-period-select");
  select.innerHTML = "";
  if (!style) {
    document.getElementById("ol-map-wrap").style.display = "none";
    document.getElementById("ol-map-empty").style.display = "block";
    document.getElementById("ol-map-empty").textContent = "No interactive map for this dataset yet.";
    return;
  }
  const periods = sortedPeriods(Object.keys(style.periods));
  periods.forEach((period) => {
    const option = document.createElement("option");
    option.value = period;
    option.textContent = olPeriodLabel(period);
    select.appendChild(option);
  });
  if (!olMapState.period || !periods.includes(olMapState.period)) {
    olMapState.period = periods.includes("DJFM") ? "DJFM" : periods[0];
  }
  select.value = olMapState.period;
  setTimeout(() => olMapState.map.updateSize(), 0);
  updateInteractiveMapLayer();
}

// 300/96 DPI: exporting at the map's plain on-screen CSS pixel size would
// be far below print quality (a screen is ~96 DPI). Follows OpenLayers'
// own documented pattern (examples/print-to-scale.js): temporarily grow
// the map's target element, call updateSize(), and shrink the view
// resolution by the same factor so the same geographic extent renders at
// higher pixel density -- then restore both afterward. No new dependency:
// reuses this function's own existing canvas-compositing logic, just at a
// larger captured size.
const SCREENSHOT_SCALE_FACTOR = 3;

function takeMapScreenshot() {
  const map = olMapState.map;
  const targetEl = map.getTargetElement();
  const originalWidth = targetEl.clientWidth;
  const originalHeight = targetEl.clientHeight;
  const originalResolution = map.getView().getResolution();

  targetEl.style.width = `${originalWidth * SCREENSHOT_SCALE_FACTOR}px`;
  targetEl.style.height = `${originalHeight * SCREENSHOT_SCALE_FACTOR}px`;
  map.updateSize();
  map.getView().setResolution(originalResolution / SCREENSHOT_SCALE_FACTOR);

  map.once("rendercomplete", () => {
    const mapCanvas = document.createElement("canvas");
    const size = map.getSize();
    mapCanvas.width = size[0];
    mapCanvas.height = size[1];
    const mapContext = mapCanvas.getContext("2d");
    Array.from(document.querySelectorAll("#ol-map .ol-layer canvas, #ol-map canvas")).forEach((canvas) => {
      if (canvas.width === 0) return;
      const opacity = canvas.parentElement.style.opacity || canvas.style.opacity;
      mapContext.globalAlpha = opacity === "" ? 1 : Number(opacity);
      const transform = canvas.style.transform;
      let matrix = [1, 0, 0, 1, 0, 0];
      if (transform) {
        matrix = transform.match(/^matrix\(([^)]+)\)$/)[1].split(",").map(Number);
      }
      mapContext.setTransform(...matrix);
      mapContext.drawImage(canvas, 0, 0);
    });
    mapContext.setTransform(1, 0, 0, 1, 0, 0);
    const link = document.createElement("a");
    link.download = `${mapPickerState.product}_${mapPickerState.response}_${olMapState.period}_${olMapState.year}.png`;
    link.href = mapCanvas.toDataURL();
    link.click();

    // Restore the interactive map to its normal on-screen size/resolution.
    targetEl.style.width = "";
    targetEl.style.height = "";
    map.updateSize();
    map.getView().setResolution(originalResolution);
  });
  map.renderSync();
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).catch(() => {});
}

function copyViewLink() {
  const params = new URLSearchParams({
    category: mapPickerState.category, product: mapPickerState.product,
    response: mapPickerState.response, period: olMapState.period, year: olMapState.year,
  });
  const url = `${window.location.origin}${window.location.pathname}#${params.toString()}`;
  copyToClipboard(url);
}

async function init() {
  // ?embed=1 (set by js/explore.js's renderMap() iframe) hides the page
  // chrome duplicated from whichever page is embedding this map -- the
  // interactive map itself is otherwise identical, same URL-hash state.
  if (new URLSearchParams(window.location.search).get("embed") === "1") {
    document.body.classList.add("embedded");
  }
  await loadManifest();
  initMapPicker();
}

init();
