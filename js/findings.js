// Key Findings page. Renders the pipeline's own curated headline figure set
// (code/00_config.py's HEADLINE_FIGURES, exported by 14_dashboard_export.py
// as data/headline.json) -- question and note text come straight from that
// config, nothing paraphrased or interpreted here.

async function init() {
  const res = await fetch("data/headline.json");
  const entries = res.ok ? await res.json() : [];
  const list = document.getElementById("findings-list");
  const empty = document.getElementById("findings-empty");

  if (entries.length === 0) {
    empty.style.display = "block";
    return;
  }

  entries
    .slice()
    .sort((a, b) => a.slot - b.slot)
    .forEach((entry) => {
      const card = document.createElement("div");
      card.className = "panel finding-card";
      card.innerHTML = `
        <h3>${entry.question}</h3>
        <div class="map-image-wrap">
          <img src="figures/synthesis/${entry.stem}.png" alt="${entry.question}" loading="lazy">
        </div>
        <p class="finding-note">${entry.note}</p>
      `;
      list.appendChild(card);
    });
}

init();
