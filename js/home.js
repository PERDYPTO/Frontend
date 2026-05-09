(function () {
  const previewGrid = document.querySelector("[data-preview-grid]");
  if (!previewGrid) return;

  const symbols = ["BTC", "ETH", "SOL"];

  previewGrid.innerHTML = symbols.map((symbol) => `
    <article class="preview-card" aria-label="${symbol} sample loading card">
      <div class="preview-top">
        <div class="preview-dot preview-symbol-${symbol.toLowerCase()}">${symbol}</div>
        <div class="preview-stack" aria-hidden="true">
          <div class="preview-line short skeleton"></div>
          <div class="preview-line medium skeleton"></div>
        </div>
      </div>
      <div class="preview-stack" aria-hidden="true">
        <div class="preview-line long skeleton"></div>
        <div class="preview-line medium skeleton"></div>
        <div class="preview-line long skeleton"></div>
        <div class="preview-line short skeleton"></div>
      </div>
    </article>
  `).join("");
})();
