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

async function fetchSummaryData(product, response) {
  const key = `${product}_${response}`;
  if (!summaryState.cache[key]) {
    const res = await fetch(`data/timeseries/${key}.json`);
    summaryState.cache[key] = await res.json();
  }
  return summaryState.cache[key];
}

function regionColumnsForGroup(group) {
  if (group === "states") return manifest.western_states.map((code) => ({ code, label: code }));
  if (group === "huc2") return manifest.huc2_regions.map((code) => ({ code, label: manifest.huc2_labels[code] }));
  return regionEntries(); // "Regions": Western US, CO-UT-WY, and whatever else manifest.region_labels has
}

function rebuildRegionColumns() {
  summaryRegionColumns = regionColumnsForGroup(summaryState.regionGroup);
  const headerRow = document.getElementById("summary-table-header");
  while (headerRow.children.length > 3) headerRow.removeChild(headerRow.lastChild); // keep Variable/Product/Detrended?
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
  const colCount = 3 + summaryRegionColumns.length;
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
        (rowsByCategory[category] = rowsByCategory[category] || []).push({
          product, response, cells, detrendMethod: entry.detrend_method,
        });
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
      const detrendCell = `<td>${detrendBadgeHtml(row.detrendMethod)}</td>`;
      tr.innerHTML = `${responseCell}<td>${row.product}</td>${detrendCell}${cellsHtml}`;
      body.appendChild(tr);
    });
  });
  if (!anyRows) {
    body.innerHTML = `<tr><td colspan="${colCount}">No data for this window/year.</td></tr>`;
  }
}

// No self-invoking init here -- this now shares explore.html with
// js/explore.js, which owns the single loadManifest() call and calls
// initSummaryTable() itself (calling loadManifest() twice would double the
// 342KB manifest fetch for no reason).
