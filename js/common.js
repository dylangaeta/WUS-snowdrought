// Shared across all three pages (index.html, explore.html, maps.html): the
// manifest fetch and the small set of constants/helpers every page needs.
// No page-specific state lives here.

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const SEASON_LABELS = {
  MAM: "Mar–May", JJA: "Jun–Aug", SON: "Sep–Nov",
  DJF: "Dec–Feb", NDJF: "Nov–Feb",
  DJFM: "Dec–Mar", AMJJ: "Apr–Jul",
};
const SEASON_ORDER = ["NDJF", "DJFM", "DJF", "MAM", "AMJJ", "JJA", "SON"];
// Mirrors config.py's MAP_SEASONAL_PERIODS exactly -- do not diverge.
const SEASON_MONTHS = {
  MAM: [3, 4, 5], JJA: [6, 7, 8], SON: [9, 10, 11],
  DJF: [12, 1, 2], NDJF: [11, 12, 1, 2], DJFM: [12, 1, 2, 3], AMJJ: [4, 5, 6, 7],
};

let manifest = null;

async function loadManifest() {
  const response = await fetch("data/manifest.json");
  manifest = await response.json();
  return manifest;
}

// Large binary assets (COGs under cogs/, static map PNGs under figures/maps/)
// are served from external object storage (a Cloudflare R2 bucket,
// wus-snowdrought), not committed to this repo -- both directories are
// synced to the same bucket under their existing relative-path prefixes, so
// one base URL covers both. Empty string falls back to the local relative
// path, which is what a local checkout with cogs/ and figures/ still on disk
// uses.
const R2_BASE_URL = "https://pub-0bea8387645a493dbf0dddd3045e4ae4.r2.dev";

function assetUrl(relativePath) {
  return R2_BASE_URL ? `${R2_BASE_URL.replace(/\/$/, "")}/${relativePath}` : relativePath;
}

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

const DETREND_METHOD_LABELS = {
  ols: "grid-cell trend removed (OLS)",
  mean_centered: "calendar-month mean removed, no trend",
  native_index: "already a standardized index",
};

// Shared by explore.js and map-viewer.js's product-meta line -- a short
// plain-language definition plus the same units/record/baseline/detrend
// facts already in the exported JSON, never any interpretive claim about
// current conditions.
function productMetaHtml(entry) {
  const recordRange = entry.record_start && entry.record_end
    ? `${entry.record_start.slice(0, 7)} – ${entry.record_end.slice(0, 7)}`
    : "unknown record range";
  const baseline = (entry.baseline_start_year && entry.baseline_end_year)
    ? `${entry.baseline_start_year}–${entry.baseline_end_year}`
    : "n/a";
  const detrend = DETREND_METHOD_LABELS[entry.detrend_method] || "n/a";
  const glossaryLine = entry.glossary ? `<p class="product-glossary">${entry.glossary}</p>` : "";
  return `${glossaryLine}<p class="product-facts">Units: ${entry.units || "n/a"} · Baseline: ${baseline} (${detrend}) · Record: ${recordRange} · Status: ${entry.status}</p>`;
}

// Cross-page continuity for the Explore <-> Maps product picker: the last
// category/product/response chosen on either page becomes the default on
// the other, so switching pages doesn't reset the view. Only a fallback --
// an incoming URL-hash shared view (js/explore.js's parseSharedViewFromUrl,
// js/map-viewer.js's parseSharedMapViewFromUrl) always takes priority, and
// writing here never touches the URL.
const LAST_SELECTION_KEY = "snowdroughtWUS.lastSelection";

function saveLastSelection(category, product, response) {
  try {
    localStorage.setItem(LAST_SELECTION_KEY, JSON.stringify({ category, product, response }));
  } catch (err) {
    // Private browsing / storage disabled -- selection just won't persist.
  }
}

function loadLastSelection() {
  try {
    const raw = localStorage.getItem(LAST_SELECTION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

// Flat (category, product, response) index for the product search box,
// shared by explore.js and map-viewer.js. Matches against the product/
// response codes and each response's own glossary text, so a search for a
// physical quantity ("snow water equivalent") finds it even without
// knowing the acronym.
function buildSearchIndex() {
  const index = [];
  for (const category of manifest.category_order) {
    for (const [product, responses] of Object.entries(manifest.categories[category])) {
      for (const [response, entry] of Object.entries(responses)) {
        index.push({ category, product, response, glossary: entry.glossary || "" });
      }
    }
  }
  return index;
}

function searchProductIndex(index, query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return index.filter((item) =>
    item.product.toLowerCase().includes(q) ||
    item.response.toLowerCase().includes(q) ||
    item.glossary.toLowerCase().includes(q)
  ).slice(0, 12);
}

// Wires a search <input> + results <div> pair (matching IDs on both Explore
// and Maps pages) to buildSearchIndex/searchProductIndex, calling
// onSelect(category, product, response) when a result is clicked.
function wireProductSearch(inputId, resultsId, onSelect) {
  const input = document.getElementById(inputId);
  const results = document.getElementById(resultsId);
  if (!input || !results) return;
  const index = buildSearchIndex();
  input.addEventListener("input", () => {
    const matches = searchProductIndex(index, input.value);
    if (matches.length === 0) {
      results.innerHTML = "";
      results.style.display = "none";
      return;
    }
    results.innerHTML = matches.map((m, i) =>
      `<button type="button" class="search-result" data-index="${i}">
        <strong>${m.product}</strong> &ndash; ${m.response}
        <span class="search-result-category">${manifest.category_labels[m.category]}</span>
      </button>`
    ).join("");
    results.style.display = "block";
    results.querySelectorAll(".search-result").forEach((button, i) => {
      button.addEventListener("click", () => {
        const m = matches[i];
        input.value = "";
        results.innerHTML = "";
        results.style.display = "none";
        onSelect(m.category, m.product, m.response);
      });
    });
  });
  document.addEventListener("click", (event) => {
    if (event.target !== input && !results.contains(event.target)) {
      results.style.display = "none";
    }
  });
}
