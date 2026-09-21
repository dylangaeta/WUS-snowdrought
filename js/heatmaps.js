// Heatmaps page: manifest-driven family/category/threshold selection over
// the pipeline's own pre-rendered multi-product anomaly heatmap PNGs.

const state = {
  manifest: null,
  family: null,
  category: "all",
  threshold: "all",
};

async function init() {
  const response = await fetch("data/manifest.json");
  state.manifest = await response.json();
  const families = Object.keys(state.manifest.heatmaps);
  const familySelect = document.getElementById("heatmap-family-select");
  families.forEach((family) => {
    const option = document.createElement("option");
    option.value = family;
    option.textContent = state.manifest.heatmaps[family].label;
    familySelect.appendChild(option);
  });
  state.family = families[0];
  familySelect.value = state.family;
  familySelect.addEventListener("change", (event) => {
    state.family = event.target.value;
    state.category = "all";
    state.threshold = "all";
    renderCategoryTabs();
    render();
  });

  document.getElementById("heatmap-threshold-toggle").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-threshold]");
    if (!button || button.disabled) return;
    state.threshold = button.dataset.threshold;
    document.querySelectorAll("#heatmap-threshold-toggle button").forEach((btn) => btn.classList.toggle("active", btn === button));
    render();
  });

  renderCategoryTabs();
  render();
}

function renderCategoryTabs() {
  const nav = document.getElementById("heatmap-category-tabs");
  nav.innerHTML = "";
  const familyCategories = state.manifest.heatmaps[state.family].categories;

  const allButton = document.createElement("button");
  allButton.className = "category-tab";
  allButton.textContent = "All products";
  allButton.dataset.category = "all";
  allButton.addEventListener("click", () => selectCategory("all"));
  nav.appendChild(allButton);

  state.manifest.category_order.forEach((category) => {
    if (!familyCategories[category]) return;
    const button = document.createElement("button");
    button.className = "category-tab";
    button.textContent = state.manifest.category_labels[category];
    button.style.setProperty("--cat", state.manifest.category_colors[category]);
    button.dataset.category = category;
    button.addEventListener("click", () => selectCategory(category));
    nav.appendChild(button);
  });
  markActiveCategory();
}

function selectCategory(category) {
  state.category = category;
  markActiveCategory();
  render();
}

function markActiveCategory() {
  document.querySelectorAll(".category-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.category === state.category);
  });
}

function render() {
  const family = state.manifest.heatmaps[state.family];
  const categorySlots = family.categories[state.category] || {};
  const hasThresholds = Object.keys(categorySlots).some((key) => key !== "all");
  document.getElementById("heatmap-threshold-toggle").style.display = hasThresholds ? "inline-flex" : "none";
  if (!hasThresholds) state.threshold = "all";
  document.querySelectorAll("#heatmap-threshold-toggle button").forEach((btn) => {
    const available = Boolean(categorySlots[btn.dataset.threshold]);
    btn.disabled = !available;
    btn.style.opacity = available ? "1" : "0.4";
    btn.classList.toggle("active", btn.dataset.threshold === state.threshold);
  });

  const wrap = document.getElementById("heatmap-image-wrap");
  const filename = categorySlots[state.threshold];
  if (!filename) {
    wrap.innerHTML = '<p class="map-empty">No heatmap available for this selection.</p>';
    return;
  }
  wrap.innerHTML = `<img src="figures/heatmaps/${filename}" alt="${family.label} heatmap">`;
}

init();
