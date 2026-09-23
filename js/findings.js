// Key Findings page. No static images anywhere -- every figure here is
// computed live from the same JSON every other page uses. The pipeline's
// cross-product combined-overlay and monthly-anomaly-heatmap questions
// (formerly static PNGs) are answered by the *same* dynamic components
// already built elsewhere (explore.html's Compare variables, data.html's
// Heatmaps), not reimplemented a second time here -- one implementation, no
// risk of the two views drifting apart. This page only holds visualizations
// that don't already live elsewhere: the snow-drought quadrant
// classification, below. (The observational-coverage timeline used to live
// here too -- moved to about.html, since it's a dataset/reference fact, not
// a finding.)

// Snow-drought quadrant classification -- mirrors
// code/11_context_SnowDroughtQuadrants_analyze.py's VARIABLES/REGIMES/
// classify() exactly (do not diverge). The regime itself always comes from
// the pipeline's own precomputed classification (data/
// snow_drought_classification.json's "regime" field), never recomputed here.
// Labels are dataset-qualified, matching 11_context_SnowDroughtQuadrants_
// analyze.py's own VARIABLES dict verbatim (its "label" field, minus the
// "DJFM Anomaly (unit)" suffix -- unit/window are shown separately here).
const QUADRANT_VARIABLES = {
  t_anom: { label: "ERA5-Land Temperature", unit: "°C", stress_high: true, stress: "warm", benign: "cold" },
  ppt_anom: { label: "PRISM Precipitation", unit: "mm", stress_high: false, stress: "dry", benign: "wet" },
  swe_anom: { label: "SNOTEL Snowpack", unit: "mm", stress_high: false, stress: "low snow", benign: "high snow" },
  vpd_anom: { label: "PRISM Max VPD", unit: "hPa", stress_high: true, stress: "high VPD", benign: "low VPD" },
  sca_anom: { label: "MODIS Snow Cover", unit: "%", stress_high: false, stress: "low snow cover", benign: "high snow cover" },
};
const REGIME_COLORS = { dry: "#dfc27d", warm_dry: "#d6604d", warm: "#f4a582", none: "#92c5de" };
const REGIME_LABELS = {
  dry: "Dry snow drought", warm_dry: "Warm & dry snow drought",
  warm: "Warm snow drought", none: "No snow drought",
};

const quadrantState = { region: "ALL", x: "t_anom", y: "ppt_anom", rows: [] };

async function initQuadrantView() {
  const xSelect = document.getElementById("quadrant-x-select");
  if (!xSelect) return;
  const res = await fetch(assetUrl("data/snow_drought_classification.json"));
  if (!res.ok) {
    document.getElementById("snow-drought-classification").style.display = "none";
    return;
  }
  quadrantState.rows = await res.json();

  // This classification is computed over PILOT_REGIONS specifically (see
  // 11_context_SnowDroughtQuadrants_analyze.py), a narrower set than the
  // dashboard's general manifest.region_labels -- so the region options
  // here come from whichever regions actually appear in this file's own
  // data, not the full region list. manifest.region_labels only supplies
  // the display label for whatever region codes are actually present.
  const regionSelect = document.getElementById("quadrant-region-select");
  const regionCodes = [...new Set(quadrantState.rows.map((r) => r.region))];
  regionSelect.innerHTML = "";
  regionCodes.forEach((code) => {
    const option = document.createElement("option");
    option.value = code;
    option.textContent = manifest.region_labels[code] || code;
    if (code === quadrantState.region) option.selected = true;
    regionSelect.appendChild(option);
  });

  const ySelect = document.getElementById("quadrant-y-select");
  Object.entries(QUADRANT_VARIABLES).forEach(([key, meta]) => {
    [xSelect, ySelect].forEach((select) => {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = meta.label;
      select.appendChild(option);
    });
  });
  xSelect.value = quadrantState.x;
  ySelect.value = quadrantState.y;

  xSelect.addEventListener("change", (e) => { quadrantState.x = e.target.value; renderQuadrantChart(); });
  ySelect.addEventListener("change", (e) => { quadrantState.y = e.target.value; renderQuadrantChart(); });
  regionSelect.addEventListener("change", (e) => {
    quadrantState.region = e.target.value;
    renderQuadrantChart();
  });

  renderQuadrantChart();
}

function renderQuadrantChart() {
  const chart = document.getElementById("quadrant-chart");
  const { region, x, y, rows } = quadrantState;
  const xMeta = QUADRANT_VARIABLES[x];
  const yMeta = QUADRANT_VARIABLES[y];
  const points = rows.filter((r) => r.region === region && r[x] !== null && r[y] !== null);
  if (points.length === 0) {
    chart.innerHTML = '<p class="chart-empty">No data for this axis pair/region.</p>';
    return;
  }

  const xmax = Math.max(...points.map((p) => Math.abs(p[x]))) * 1.12;
  const ymax = Math.max(...points.map((p) => Math.abs(p[y]))) * 1.12;
  const shapes = [];
  const annotations = [];
  const isDierauer = x === "t_anom" && y === "ppt_anom";

  if (isDierauer) {
    // Native Dierauer view: x = temperature (warm right), y = precipitation (wet up).
    const fills = {
      warm: [0, xmax, 0, ymax], none: [-xmax, 0, 0, ymax],
      warm_dry: [0, xmax, -ymax, 0], dry: [-xmax, 0, -ymax, 0],
    };
    const corners = {
      warm: [xmax, ymax, "right", "top"], none: [-xmax, ymax, "left", "top"],
      warm_dry: [xmax, -ymax, "right", "bottom"], dry: [-xmax, -ymax, "left", "bottom"],
    };
    Object.entries(fills).forEach(([regime, [x0, x1, y0, y1]]) => {
      shapes.push({ type: "rect", x0, x1, y0, y1, fillcolor: REGIME_COLORS[regime], opacity: 0.13, line: { width: 0 }, layer: "below" });
    });
    Object.entries(corners).forEach(([regime, [ax, ay, xanchor, yanchor]]) => {
      annotations.push({
        x: ax * 0.96, y: ay * 0.96, text: REGIME_LABELS[regime], showarrow: false,
        font: { size: 12, color: REGIME_COLORS[regime], weight: 700 },
        xanchor, yanchor,
      });
    });
  } else {
    // Generic stress-quadrant shading for any other axis pair: tint by how
    // many of the two axes point toward drought stress.
    const sx = xMeta.stress_high ? 1 : -1;
    const sy = yMeta.stress_high ? 1 : -1;
    const tint = { 2: "#d6604d", 1: "#f4e0c5", 0: "#92c5de" };
    [1, -1].forEach((xs) => {
      const [x0, x1] = xs > 0 ? [0, xmax] : [-xmax, 0];
      [1, -1].forEach((ys) => {
        const [y0, y1] = ys > 0 ? [0, ymax] : [-ymax, 0];
        const n = (xs === sx ? 1 : 0) + (ys === sy ? 1 : 0);
        shapes.push({ type: "rect", x0, x1, y0, y1, fillcolor: tint[n], opacity: 0.13, line: { width: 0 }, layer: "below" });
      });
    });
    const sxp = sx > 0 ? xmax : -xmax;
    const syp = sy > 0 ? ymax : -ymax;
    annotations.push({
      x: sxp * 0.96, y: syp * 0.96, text: `${yMeta.stress} + ${xMeta.stress}`, showarrow: false,
      font: { size: 12, color: "#c0392b", weight: 700 },
      xanchor: sx > 0 ? "right" : "left", yanchor: sy > 0 ? "top" : "bottom",
    });
    annotations.push({
      x: -sxp * 0.96, y: -syp * 0.96, text: `${yMeta.benign} + ${xMeta.benign}`, showarrow: false,
      font: { size: 12, color: "#2166ac", weight: 700 },
      xanchor: sx > 0 ? "left" : "right", yanchor: sy > 0 ? "bottom" : "top",
    });
  }

  const trace = {
    x: points.map((p) => p[x]), y: points.map((p) => p[y]),
    mode: "markers+text", type: "scatter",
    text: points.map((p) => String(p.winter_year)),
    textposition: "top center", textfont: { size: 10, color: "#444" },
    marker: {
      size: points.map((p) => (p.winter_year === 2026 ? 16 : 9)),
      color: points.map((p) => REGIME_COLORS[p.regime]),
      line: { color: "#333", width: 0.8 },
    },
    hovertext: points.map((p) => `${p.winter_year}: ${REGIME_LABELS[p.regime]}`),
    hoverinfo: "text",
  };

  const layout = {
    margin: { t: 20, r: 20, b: 55, l: 65 },
    xaxis: { title: `${xMeta.label} anomaly (${xMeta.unit})`, range: [-xmax, xmax], zeroline: true, zerolinecolor: "#555" },
    yaxis: { title: `${yMeta.label} anomaly (${yMeta.unit})`, range: [-ymax, ymax], zeroline: true, zerolinecolor: "#555" },
    font: { family: "Source Sans Pro, sans-serif", size: 13 },
    shapes, annotations,
    showlegend: false,
  };
  Plotly.newPlot(chart, [trace], layout, { responsive: true, displaylogo: false });
}

loadManifest().then(() => {
  initQuadrantView();
});
