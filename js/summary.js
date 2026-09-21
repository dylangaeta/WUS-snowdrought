// Homepage summary table. Computed entirely client-side from the same
// monthly grid-cell-detrended anomaly arrays the Explore page uses -- no new
// statistics invented here. Each response's multi-month aggregation rule
// (sum / mean / day_weighted_mean / native_index) comes from
// code/14_dashboard_export.py's AGGREGATION_RULE, audited against each
// product's actual reducer/analyzer code, not guessed. "Stress vs relief"
// coloring uses drier_is_high, straight from config.py's own
// response_drier_is_high() -- the same function the canonical multi-product
// heatmap uses -- not a locally invented sign convention.

const summaryState = { window: "DJFM", year: 2026, valueType: "sigma", regionGroup: "summary", cache: {} };
let summaryRegionColumns = []; // [{code, label}], rebuilt whenever regionGroup changes

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

// Inverse standard normal CDF (probit) via Peter Acklam's rational
// approximation (accurate to ~1.15e-9) -- mirrors scipy.stats.norm.ppf, used
// so the season-window statistic below matches code/common/detrend.py's
// normal_score_transform (the pipeline's canonical, non-parametric
// standardization) instead of a from-scratch parametric z-score.
function normInv(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= pHigh) {
    const q = p - 0.5;
    const r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

function sigmaToPercentileLabel(percentile) {
  if (percentile >= 99.95) return ">99.9%";
  if (percentile <= 0.05) return "<0.1%";
  return `${Math.round(percentile)}%`;
}

// Standard normal CDF via the Abramowitz & Stegun 7.1.26 erf approximation
// (max error ~1.5e-7) -- only used for native standardized indices
// (SPI/SPEI/EDDI/...), whose own value is already an approximately
// standard-normal quantity by construction, so a forward CDF is the correct
// (not the rank-based) way to read its percentile.
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

function nativeIndexPercentile(sigma) {
  return 50 * (1 + erf(sigma / Math.SQRT2));
}

// Mirrors common/detrend.py's MIN_BASELINE_YEARS -- must stay in sync.
const MIN_BASELINE_YEARS = 3;

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

// Returns { sigma, percentile, rawValue, percentOfNormal, isNativeIndex }
// for one product/response/region/window/year. sigma/percentile standardize
// the window-aggregated anomaly the same way common/detrend.py's
// normal_score_transform standardizes a single month: rank the target
// against the baseline years' own aggregated-anomaly distribution (Weibull
// plotting position), then map that percentile through the inverse normal
// CDF -- non-parametric, so it stays meaningful for skewed/bounded fields
// instead of assuming the baseline years are normally distributed.
// percentOfNormal is null wherever the baseline mean is too close to zero to
// divide by meaningfully (e.g. some temperature/VPD anomaly-prone fields),
// or for native standardized indices (already a departure statistic, not a
// physical quantity with a "normal").
function computeWindowValue(data, region, windowKey, targetYear) {
  if (data.aggregation === "native_index") {
    // A native index (e.g. SPI-03) is already its own trailing N-month
    // statistic, so it can't be re-aggregated across a season window -- but
    // it's still meaningful for one: show its reading as of the window's
    // own last month (e.g. DJFM -> its March value, which for a 3-month
    // index already reflects Jan-Mar).
    const pairs = windowMonthYearPairs(windowKey, targetYear);
    const { month, year } = pairs[pairs.length - 1];
    const dateStr = `${year}-${String(month).padStart(2, "0")}-01`;
    const idx = region.dates.indexOf(dateStr);
    if (idx === -1) return null;
    const v = region.value[idx];
    return { sigma: v, percentile: null, rawValue: v, percentOfNormal: null, isNativeIndex: true };
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
  if (baselineAnomalies.length < MIN_BASELINE_YEARS) return null;
  baselineAnomalies.sort((a, b) => a - b);
  const n = baselineAnomalies.length;
  const rank = baselineAnomalies.filter((a) => a <= targetAnomaly).length; // matches np.searchsorted(..., side="right")
  const percentile = ((rank + 0.5) / (n + 1)) * 100;
  const sigma = normInv(percentile / 100);

  let percentOfNormal = null;
  if (baselineRaws.length >= 2) {
    const { mean: meanRaw, std: stdRaw } = meanStd(baselineRaws);
    // Guard: a baseline mean within one baseline std of zero makes "percent
    // of normal" numerically unstable (small denominator), not meaningful.
    if (Math.abs(meanRaw) > stdRaw) percentOfNormal = ((targetRaw - meanRaw) / meanRaw) * 100;
  }
  return { sigma, percentile, rawValue: targetRaw, percentOfNormal, isNativeIndex: false };
}

function regionColumnsForGroup(group) {
  if (group === "states") return manifest.western_states.map((code) => ({ code, label: code }));
  if (group === "huc2") return manifest.huc2_regions.map((code) => ({ code, label: manifest.huc2_labels[code] }));
  return [
    { code: "ALL", label: manifest.region_labels.ALL },
    { code: "CO_UT_WY", label: manifest.region_labels.CO_UT_WY },
  ];
}

function rebuildRegionColumns() {
  summaryRegionColumns = regionColumnsForGroup(summaryState.regionGroup);
  const headerRow = document.getElementById("summary-table-header");
  while (headerRow.children.length > 2) headerRow.removeChild(headerRow.lastChild); // keep Variable/Product
  summaryRegionColumns.forEach((col) => {
    const th = document.createElement("th");
    th.textContent = col.label;
    headerRow.appendChild(th);
  });
}

// The year select's range comes from the actual record_start/record_end
// spread across every product in the manifest, not a fixed cutoff -- a
// product with a longer record (e.g. PRISM back to 1895) simply produces
// "--" rows for years outside its own coverage, same as already happens
// for 2025 vs. 2026 today.
function fullRecordYearRange() {
  let minYear = Infinity;
  let maxYear = -Infinity;
  for (const products of Object.values(manifest.categories)) {
    for (const responses of Object.values(products)) {
      for (const entry of Object.values(responses)) {
        if (entry.record_start) minYear = Math.min(minYear, parseInt(entry.record_start.slice(0, 4), 10));
        if (entry.record_end) maxYear = Math.max(maxYear, parseInt(entry.record_end.slice(0, 4), 10));
      }
    }
  }
  return { minYear, maxYear };
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

  const yearSelect = document.getElementById("summary-year-select");
  const { minYear, maxYear } = fullRecordYearRange();
  for (let year = maxYear; year >= minYear; year--) {
    const option = document.createElement("option");
    option.value = String(year);
    option.textContent = String(year);
    yearSelect.appendChild(option);
  }
  yearSelect.value = String(summaryState.year);
  yearSelect.addEventListener("change", (event) => {
    summaryState.year = parseInt(event.target.value, 10);
    renderSummaryTable();
  });

  const valueSelect = document.getElementById("summary-value-select");
  const updateValueGlossary = () => {
    document.getElementById("summary-value-glossary").textContent =
      (manifest.value_type_glossary || {})[valueSelect.value] || "";
  };
  valueSelect.addEventListener("change", (event) => {
    summaryState.valueType = event.target.value;
    updateValueGlossary();
    renderSummaryTable();
  });
  updateValueGlossary();

  document.getElementById("summary-region-group-select").addEventListener("change", (event) => {
    summaryState.regionGroup = event.target.value;
    rebuildRegionColumns();
    renderSummaryTable();
  });
  rebuildRegionColumns();

  renderSummaryTable();
}

function formatSummaryValue(result, units, valueType) {
  const sign = result.sigma >= 0 ? "+" : "";
  if (valueType === "raw") return `${result.rawValue.toFixed(2)} ${units}`;
  if (valueType === "percentile") {
    const percentile = result.isNativeIndex ? nativeIndexPercentile(result.sigma) : result.percentile;
    return sigmaToPercentileLabel(percentile);
  }
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
      const responseCell = data.glossary
        ? `<td title="${data.glossary.replace(/"/g, "&quot;")}">${row.response}${note}</td>`
        : `<td>${row.response}${note}</td>`;
      tr.innerHTML = `${responseCell}<td>${row.product}</td>${cellsHtml}`;
      body.appendChild(tr);
    });
  });
  if (!anyRows) {
    body.innerHTML = `<tr><td colspan="${colCount}">No data for this window/year.</td></tr>`;
  }
}

async function init() {
  await loadManifest();
  initSummaryTable();
}

init();
