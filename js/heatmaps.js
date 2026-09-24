// Anomaly heatmaps -- data.html's other big cross-product view, alongside
// the summary table (js/summary.js). Split out of js/explore.js (2026-09)
// when explore.html was narrowed to just the single-product timeseries/
// seasonal/compare views and this moved to its own page with the summary
// table under "dataset exploration."
//
// Product x time standardized-anomaly matrix, computed dynamically from the
// same data every other chart on this dashboard uses -- not a static image.
// "monthly" is a fixed special case (direct per-month sigma, the most
// recent 12 calendar months available, for comparing products along one
// shared recent timeline). Every other family is "this window, by year" --
// the same season/month windows and the same computeWindowValue()
// aggregation the interactive map's period select and the homepage summary
// table already use, so a heatmap row and the matching map/table value are
// always computed the same way.
const HEATMAP_FAMILIES = { monthly: { label: "Monthly anomalies (most recent 12 months)" } };
SEASON_ORDER.forEach((key) => {
  HEATMAP_FAMILIES[`window_${key}`] = { label: `${key} (${SEASON_LABELS[key]}), by year`, window: key };
});
MONTH_NAMES.forEach((name, i) => {
  const key = String(i + 1).padStart(2, "0");
  HEATMAP_FAMILIES[`window_${key}`] = { label: `${name}, by year`, window: key };
});

const heatmapState = { family: "monthly", category: "all", region: "ALL" };

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

// fetchTimeseriesJson (js/common.js) shares one cache with js/summary.js,
// which loads on this same page -- no separate cache needed here.
async function fetchHeatmapSeries(key) {
  return fetchTimeseriesJson(key);
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

  // Fetch every product's JSON concurrently instead of one at a time --
  // "All products" is ~100 items, and awaiting each fetch in turn meant a
  // full re-render waited on ~100 sequential network round-trips
  // (fetchHeatmapSeries' own cache still applies per key either way).
  const dataList = await Promise.all(
    pairs.map(({ product, response }) => fetchHeatmapSeries(`${product}_${response}`))
  );

  let xLabels, computeRow;
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
    // Two-row tick label (month above, year below) instead of one rotated
    // "Jan 2026" string -- easier to read at the narrow per-column width a
    // 12-column heatmap has, and each column here really is its own
    // distinct real month/year (unlike the seasonal chart's shared axis).
    xLabels = months.map(({ year, month }) => `${MONTH_NAMES[month - 1].slice(0, 3)}<br>${year}`);
    computeRow = (data) => {
      const region = data.regions[heatmapState.region];
      if (!region) return months.map(() => null);
      // Flip sign so red always means "more stress" and blue always means
      // "less stress" on every row, regardless of each variable's own raw
      // sign convention (a positive temperature anomaly IS the stress
      // direction, but a positive snowpack anomaly is relief, the opposite)
      // -- same drier_is_high-driven flip the Compare view's "By category"
      // mode already applies for the same reason (see about.html).
      const sign = data.drier_is_high ? 1 : -1;
      return months.map(({ year, month }) => {
        const dateStr = `${year}-${String(month).padStart(2, "0")}-01`;
        const idx = region.dates.indexOf(dateStr);
        return idx === -1 ? null : sign * region.sigma[idx];
      });
    };
  } else {
    const windowKey = HEATMAP_FAMILIES[heatmapState.family].window;
    const { minYear, maxYear } = fullRecordYearRange(); // already floored at DASHBOARD_MIN_YEAR
    const years = [];
    for (let y = minYear; y <= maxYear; y++) years.push(y);
    xLabels = years.map(String);
    computeRow = (data) => {
      const region = data.regions[heatmapState.region];
      if (!region) return years.map(() => null);
      // Same stress-direction sign flip as the "monthly" branch above.
      const sign = data.drier_is_high ? 1 : -1;
      return years.map((year) => {
        const result = computeWindowValue(data, region, windowKey, year);
        return result ? sign * result.sigma : null;
      });
    };
  }

  const yLabels = [];
  const z = [];
  // Plotly's categorical y-axis renders array index 0 at the BOTTOM, so
  // pushing category_order's own top-to-bottom sequence (snow/climate first,
  // drought last) unreversed put drought at the top and snow at the bottom
  // -- backwards. Reverse once here, same fix already used by the About
  // page's coverage chart for the same reason.
  [...pairs].reverse().forEach((pair, i) => {
    const data = dataList[pairs.length - 1 - i];
    const row = computeRow(data);
    if (row.every((v) => v === null)) return;
    const detrendMethod = findResponseEntry(pair.product, pair.response)?.detrend_method;
    yLabels.push(`${pair.product} ${pair.response}${detrendShortSuffix(detrendMethod)}`);
    z.push(row);
  });
  if (z.length === 0) {
    chart.innerHTML = '<p class="chart-empty">No data for this selection.</p>';
    return;
  }

  const trace = {
    x: xLabels, y: yLabels, z, type: "heatmap",
    // Plotly's built-in "RdBu" has a pale gray midpoint, not white -- spell
    // out the stops explicitly so zero (dry/wet-neutral) renders pure white.
    // Order matches the old "RdBu" + reversescale:true (blue low -> red high).
    colorscale: [
      [0, "#2166ac"], [0.25, "#67a9cf"], [0.5, "#ffffff"], [0.75, "#ef8a62"], [1, "#b2182b"],
    ],
    zmid: 0,
    // Stress/relief key is the legend above the chart (data.html) -- this
    // colorbar just shows the numeric sigma scale, not a repeat of the
    // color convention, since squeezing accurate wording ("stress" one end,
    // "relief" the other, not "more/less" of the same thing) into a narrow
    // vertical colorbar title reads worse than a real legend does.
    colorbar: { title: "σ" },
    hoverongaps: false,
  };
  const layout = {
    margin: { t: 20, r: 20, b: 60, l: 180 },
    xaxis: { side: "bottom", tickangle: 0 },
    yaxis: { automargin: true },
    font: { family: "Source Sans Pro, sans-serif", size: 12 },
    height: Math.max(360, yLabels.length * 22 + 100),
  };
  Plotly.newPlot(chart, [trace], layout, { responsive: true, displaylogo: false });
}

// Single loadManifest() call for the whole page (data.html loads
// common.js/summary.js/heatmaps.js together) -- js/summary.js deliberately
// has no self-invoking init of its own, same reason.
loadManifest().then(() => {
  initSummaryTable();
  initHeatmaps();
});
