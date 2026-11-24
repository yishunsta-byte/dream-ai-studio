const mediaButtons = document.querySelectorAll(".compare-switch button");
const cards = document.querySelectorAll(".design-card");
const fitPreview = new ResizeObserver(entries => {
  for (const {target, contentRect} of entries) {
    target.style.setProperty("--frame-scale", contentRect.width / 1280);
  }
});
cards.forEach(card => fitPreview.observe(card.querySelector(".design-preview")));

for (const button of mediaButtons) {
  button.addEventListener("click", () => {
    mediaButtons.forEach(other => other.setAttribute("aria-pressed", String(other === button)));
    for (const card of cards) {
      const path = "studio.html?look=" + card.dataset.look;
      card.querySelector("iframe").src = path + "&embed=1#" + button.dataset.media;
      card.querySelector(".open").href = path + "#" + button.dataset.media;
    }
  });
}
