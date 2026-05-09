const ORCHESTRATOR_URL = "https://perdypto-orchestrator.hf.space";

(function () {
  const DEFAULT_COINS = [
    { id: "BTCUSDT", symbol: "BTC", name: "Bitcoin" },
    { id: "ETHUSDT", symbol: "ETH", name: "Ethereum" },
    { id: "BNBUSDT", symbol: "BNB", name: "BNB" },
    { id: "SOLUSDT", symbol: "SOL", name: "Solana" },
    { id: "XRPUSDT", symbol: "XRP", name: "XRP" },
    { id: "ADAUSDT", symbol: "ADA", name: "Cardano" },
    { id: "AVAXUSDT", symbol: "AVAX", name: "Avalanche" },
    { id: "DOTUSDT", symbol: "DOT", name: "Polkadot" },
    { id: "LINKUSDT", symbol: "LINK", name: "Chainlink" },
    { id: "DOGEUSDT", symbol: "DOGE", name: "Dogecoin" }
  ];

  const grid = document.querySelector("[data-coins-grid]");
  const setupBanner = document.querySelector("[data-setup-banner]");
  const controls = document.querySelector("[data-controls]");
  const sortSelect = document.querySelector("[data-sort-select]");
  const filterButtons = document.querySelectorAll("[data-filter]");
  const lastUpdated = document.querySelector("[data-last-updated]");

  if (!grid) return;

  const state = {
    records: new Map(),
    errors: new Map(),
    loadingIds: new Set(),
    expandedId: null,
    filter: "all",
    sort: "confidence-desc",
    lastUpdatedAt: null
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function endpoint(path) {
    return `${ORCHESTRATOR_URL.replace(/\/$/, "")}${path}`;
  }

  function formatPrice(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "N/A";

    const decimals = number > 100 ? 2 : number >= 1 ? 4 : 6;
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    }).format(number);
  }

  function formatPercent(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "N/A";
    const sign = number > 0 ? "+" : "";
    return `${sign}${number.toFixed(2)}%`;
  }

  function formatVolume(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "N/A";
    return new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 2
    }).format(number);
  }

  function minutesAgo(createdAt) {
    const createdTime = Date.parse(createdAt);
    if (!Number.isFinite(createdTime)) return "just now";

    const minutes = Math.max(0, Math.floor((Date.now() - createdTime) / 60000));
    if (minutes < 1) return "just now";
    if (minutes === 1) return "1 minute ago";
    return `${minutes} minutes ago`;
  }

  function normalizeConfidence(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.min(100, number <= 1 ? number * 100 : number));
  }

  function predictionDelta(predicted, current) {
    const next = Number(predicted);
    const base = Number(current);
    if (!Number.isFinite(next) || !Number.isFinite(base) || base === 0) return 0;
    return ((next - base) / base) * 100;
  }

  function getSentiment(record) {
    const averageDelta = (record.delta15m + record.delta1h) / 2;
    if (averageDelta >= 0.05) return "bullish";
    if (averageDelta <= -0.05) return "bearish";
    return "neutral";
  }

  function getSecondsUntilExpiry(record) {
    const expiresTime = Date.parse(record.expiresAt);
    if (Number.isFinite(expiresTime)) {
      return Math.floor((expiresTime - Date.now()) / 1000);
    }
    return Number.isFinite(record.secondsUntilExpiry) ? record.secondsUntilExpiry : 900;
  }

  function normalizeResult(coinId, result) {
    const prediction = result.prediction || result;
    const current = Number(prediction.price_at_prediction);
    const predicted15m = Number(prediction.predicted_15m);
    const predicted1h = Number(prediction.predicted_1h);
    const delta15m = predictionDelta(predicted15m, current);
    const delta1h = predictionDelta(predicted1h, current);
    const id = prediction.coin_id || coinId;

    return {
      id,
      symbol: prediction.symbol || coinLookup(id).symbol,
      name: prediction.name || coinLookup(id).name,
      currentPrice: current,
      priceChange24h: Number(prediction.price_change_24h),
      volume24h: Number(prediction.volume_24h),
      predicted15m,
      predicted1h,
      delta15m,
      delta1h,
      confidence: normalizeConfidence(prediction.confidence_score),
      reasoning: prediction.reasoning || "No AI reasoning returned for this prediction.",
      taSummary: prediction.ta_summary || "No technical analysis summary returned.",
      newsSummary: prediction.news_summary || "No news summary returned.",
      createdAt: prediction.created_at,
      expiresAt: prediction.expires_at,
      fromCache: Boolean(result.from_cache),
      secondsUntilExpiry: Number(result.cache_expires_in),
      raw: result
    };
  }

  function coinLookup(id) {
    return DEFAULT_COINS.find((coin) => coin.id === id) || { id, symbol: id, name: id };
  }

  function renderSkeletonCards(count = 6) {
    grid.innerHTML = Array.from({ length: count }, () => `
      <article class="skeleton-card" aria-label="Loading prediction card">
        <div class="skeleton-header">
          <div class="skeleton-avatar skeleton"></div>
          <div class="skeleton-stack" aria-hidden="true">
            <div class="skeleton-line skeleton-mid skeleton"></div>
            <div class="skeleton-line skeleton-short skeleton"></div>
          </div>
        </div>
        <div class="skeleton-stack" aria-hidden="true">
          <div class="skeleton-line skeleton-wide skeleton"></div>
          <div class="skeleton-line skeleton-mid skeleton"></div>
          <div class="skeleton-line skeleton-wide skeleton"></div>
          <div class="skeleton-line skeleton-wide skeleton"></div>
          <div class="skeleton-line skeleton-short skeleton"></div>
        </div>
      </article>
    `).join("");
  }

  function classForNumber(value) {
    if (!Number.isFinite(Number(value))) return "neutral";
    if (Number(value) > 0) return "positive";
    if (Number(value) < 0) return "negative";
    return "neutral";
  }

  function sentimentRank(sentiment) {
    return { bullish: 0, neutral: 1, bearish: 2 }[sentiment] ?? 3;
  }

  function sortedFilteredRecords() {
    const records = Array.from(state.records.values()).map((record) => ({
      ...record,
      sentiment: getSentiment(record)
    }));

    const filtered = state.filter === "all"
      ? records
      : records.filter((record) => record.sentiment === state.filter);

    return filtered.sort((a, b) => {
      if (state.sort === "confidence-asc") return a.confidence - b.confidence;
      if (state.sort === "symbol-asc") return a.symbol.localeCompare(b.symbol);
      if (state.sort === "sentiment") {
        return sentimentRank(a.sentiment) - sentimentRank(b.sentiment) || b.confidence - a.confidence;
      }
      return b.confidence - a.confidence;
    });
  }

  function renderPredictionRow(label, price, delta) {
    const direction = delta >= 0 ? "↑" : "↓";
    const tone = classForNumber(delta);
    return `
      <div class="prediction-row">
        <span class="timeframe">${label}</span>
        <span class="prediction-price">${formatPrice(price)}</span>
        <span class="prediction-delta ${tone}">${direction} ${formatPercent(delta)}</span>
      </div>
    `;
  }

  function renderRecordCard(record) {
    const sentiment = getSentiment(record);
    const isExpanded = state.expandedId === record.id;
    const isLoading = state.loadingIds.has(record.id);
    const changeClass = classForNumber(record.priceChange24h);
    const source = record.fromCache ? "CACHED" : "LIVE";
    const confidenceText = `${Math.round(record.confidence)}%`;
    const error = state.errors.get(record.id);

    return `
      <article class="prediction-card ${isExpanded ? "is-expanded" : ""} ${isLoading ? "is-refreshing" : ""} ${error ? "has-error" : ""}" data-coin-id="${escapeHtml(record.id)}" aria-expanded="${String(isExpanded)}">
        <div class="card-button" role="button" tabindex="0" data-card-toggle="${escapeHtml(record.id)}">
          <div class="coin-header">
            <div class="coin-logo ${sentiment}">${escapeHtml(record.symbol.slice(0, 4))}</div>
            <div class="coin-title">
              <strong>${escapeHtml(record.symbol)}</strong>
              <span>${escapeHtml(record.name)}</span>
            </div>
            <button class="refresh-button ${isLoading ? "loading" : ""}" type="button" aria-label="Refresh ${escapeHtml(record.symbol)} prediction" data-refresh="${escapeHtml(record.id)}">
              <span class="refresh-icon" aria-hidden="true">↻</span>
            </button>
          </div>

          <div class="price-row">
            <div>
              <div class="current-price">${formatPrice(record.currentPrice)}</div>
              <div class="last-updated">24h volume ${formatVolume(record.volume24h)}</div>
            </div>
            <span class="change-badge ${changeClass}">${Number.isFinite(record.priceChange24h) ? formatPercent(record.priceChange24h) : "24h N/A"}</span>
          </div>

          <div class="divider"></div>
          <p class="section-label">AI Predictions</p>
          <div class="prediction-rows">
            ${renderPredictionRow("15m", record.predicted15m, record.delta15m)}
            ${renderPredictionRow("1h", record.predicted1h, record.delta1h)}
          </div>

          <div class="confidence-block">
            <div class="confidence-meta">
              <span>Confidence</span>
              <span>${confidenceText}</span>
            </div>
            <div class="confidence-track">
              <div class="confidence-fill" style="--confidence-width: ${record.confidence}%"></div>
            </div>
          </div>

          <div class="card-meta">
            <span>Predicted ${minutesAgo(record.createdAt)}</span>
            <span class="sentiment-badge ${sentiment}">${sentiment}</span>
            <span class="source-badge">${source}</span>
          </div>

          ${error ? `
            <div class="card-error-panel">
              <strong>Refresh failed</strong>
              <div>${escapeHtml(error)}</div>
              <button class="retry-button" type="button" data-refresh="${escapeHtml(record.id)}">Retry</button>
            </div>
          ` : ""}
        </div>

        <div class="expanded-panel">
          <div class="expanded-inner">
            <div class="reasoning-block">
              <h3>Full AI Reasoning</h3>
              <p>${escapeHtml(record.reasoning)}</p>
            </div>
            <div class="reasoning-block">
              <h3>TA Summary</h3>
              <p>${escapeHtml(record.taSummary)}</p>
            </div>
            <div class="reasoning-block">
              <h3>News Summary</h3>
              <p>${escapeHtml(record.newsSummary)}</p>
            </div>
            <button class="close-card" type="button" data-close-card="${escapeHtml(record.id)}">Close</button>
          </div>
        </div>
      </article>
    `;
  }

  function renderErrorCard(coin, message) {
    return `
      <article class="prediction-card error-card" data-coin-id="${escapeHtml(coin.id)}">
        <div class="card-button">
          <div class="coin-header">
            <div class="coin-logo bearish">${escapeHtml(coin.symbol)}</div>
            <div class="coin-title">
              <strong>${escapeHtml(coin.symbol)}</strong>
              <span>${escapeHtml(coin.name)}</span>
            </div>
          </div>
          <div class="card-error-panel">
            <strong>Prediction unavailable</strong>
            <div>${escapeHtml(message)}</div>
            <button class="retry-button" type="button" data-refresh="${escapeHtml(coin.id)}">Retry</button>
          </div>
        </div>
      </article>
    `;
  }

  function render() {
    const records = sortedFilteredRecords();
    const errorOnlyCards = Array.from(state.errors.entries())
      .filter(([id]) => !state.records.has(id))
      .map(([id, message]) => renderErrorCard(coinLookup(id), message));

    grid.innerHTML = [
      ...records.map(renderRecordCard),
      ...errorOnlyCards
    ].join("");

    if (!grid.innerHTML.trim()) {
      grid.innerHTML = `
        <article class="prediction-card error-card">
          <div class="card-button">
            <div class="card-error-panel">
              <strong>No cards match this filter</strong>
              <div>Choose another sentiment filter to see the loaded predictions.</div>
            </div>
          </div>
        </article>
      `;
    }
  }

  async function fetchAllPredictions() {
    renderSkeletonCards(6);

    try {
      const response = await fetch(endpoint("/predict/all"));
      if (!response.ok) throw new Error(`Orchestrator returned ${response.status}`);

      const payload = await response.json();
      state.records.clear();
      state.errors.clear();

      Object.entries(payload).forEach(([coinId, result]) => {
        const record = normalizeResult(coinId, result);
        state.records.set(record.id, record);
      });

      if (state.records.size === 0) {
        throw new Error("No predictions were returned by the orchestrator.");
      }

      state.lastUpdatedAt = new Date();
      updateLastUpdated();
      render();
    } catch (error) {
      DEFAULT_COINS.forEach((coin) => {
        state.errors.set(coin.id, error.message || "The prediction request failed.");
      });
      render();
    }
  }

  async function refreshCoin(coinId) {
    if (state.loadingIds.has(coinId)) return;

    state.loadingIds.add(coinId);
    state.errors.delete(coinId);
    render();

    try {
      const response = await fetch(endpoint("/predict"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coin_id: coinId, force_refresh: true })
      });

      if (!response.ok) throw new Error(`Refresh returned ${response.status}`);

      const payload = await response.json();
      const record = normalizeResult(coinId, payload);
      state.records.set(record.id, record);
      state.errors.delete(record.id);
      state.lastUpdatedAt = new Date();
      updateLastUpdated();
    } catch (error) {
      state.errors.set(coinId, error.message || "The prediction refresh failed.");
    } finally {
      state.loadingIds.delete(coinId);
      render();
    }
  }

  function updateLastUpdated() {
    if (!lastUpdated) return;
    if (!state.lastUpdatedAt) {
      lastUpdated.textContent = "Last updated: Waiting for data";
      return;
    }

    lastUpdated.textContent = `Last updated: ${state.lastUpdatedAt.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    })}`;
  }

  function setupEvents() {
    if (sortSelect) {
      sortSelect.addEventListener("change", () => {
        state.sort = sortSelect.value;
        render();
      });
    }

    filterButtons.forEach((button) => {
      button.addEventListener("click", () => {
        state.filter = button.dataset.filter || "all";
        filterButtons.forEach((item) => item.classList.toggle("is-active", item === button));
        render();
      });
    });

    grid.addEventListener("click", (event) => {
      const refreshButton = event.target.closest("[data-refresh]");
      if (refreshButton) {
        event.preventDefault();
        event.stopPropagation();
        refreshCoin(refreshButton.dataset.refresh);
        return;
      }

      const closeButton = event.target.closest("[data-close-card]");
      if (closeButton) {
        event.preventDefault();
        event.stopPropagation();
        state.expandedId = null;
        render();
        return;
      }

      const cardToggle = event.target.closest("[data-card-toggle]");
      if (cardToggle) {
        const coinId = cardToggle.dataset.cardToggle;
        state.expandedId = state.expandedId === coinId ? null : coinId;
        render();
      }
    });

    grid.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (event.target.closest("button, select, a")) return;

      const cardToggle = event.target.closest("[data-card-toggle]");
      if (!cardToggle) return;

      event.preventDefault();
      const coinId = cardToggle.dataset.cardToggle;
      state.expandedId = state.expandedId === coinId ? null : coinId;
      render();
    });

    window.setInterval(() => {
      if (document.hidden) return;

      state.records.forEach((record) => {
        if (getSecondsUntilExpiry(record) < 60) {
          refreshCoin(record.id);
        }
      });
    }, 60000);
  }

  function init() {
    if (!ORCHESTRATOR_URL.trim()) {
      setupBanner.classList.remove("is-hidden");
      controls.classList.add("is-hidden");
      grid.innerHTML = "";
      updateLastUpdated();
      return;
    }

    setupEvents();
    fetchAllPredictions();
  }

  init();
})();
