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
  const pipelineStatus = document.querySelector("[data-pipeline-status]");
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
    lastUpdatedAt: null,
    priceUpdatedAt: null,
    directLivePrices: new Map()
  };

  let directPricePollInFlight = false;

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

  function setPipelineStatus(message, tone = "info") {
    if (!pipelineStatus) return;

    pipelineStatus.textContent = message || "";
    pipelineStatus.dataset.statusTone = tone;
    pipelineStatus.classList.toggle("is-hidden", !message);
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

  function okxInstrumentId(coinId) {
    const symbol = String(coinId || "").toUpperCase();
    const quote = ["USDT", "USDC", "USD"].find((suffix) => symbol.endsWith(suffix));
    if (!quote) return symbol;

    return `${symbol.slice(0, -quote.length)}-${quote}`;
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

  function normalizeResult(coinId, result) {
    const prediction = result.prediction || result;
    const livePrice = result.current_price || result.price || null;
    const priceAtPrediction = Number(prediction.price_at_prediction);
    const current = Number(livePrice?.current_price ?? prediction.current_price ?? priceAtPrediction);
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
      priceAtPrediction,
      priceChange24h: Number(prediction.price_change_24h),
      volume24h: Number(prediction.volume_24h),
      priceSource: livePrice?.source || null,
      priceTimestamp: livePrice?.timestamp || prediction.created_at,
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
    const displayedCurrentPrice = state.directLivePrices.get(record.id) ?? record.currentPrice;
    const lastPriceValue = Number.isFinite(Number(displayedCurrentPrice)) ? String(Number(displayedCurrentPrice)) : "";

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
              <div class="current-price" data-live-price="${escapeHtml(record.id)}" data-last-price="${escapeHtml(lastPriceValue)}">${formatPrice(displayedCurrentPrice)}</div>
              <div class="last-updated">At prediction ${formatPrice(record.priceAtPrediction)}</div>
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

  function applyLivePrice(priceData) {
    const id = priceData?.coin_id;
    const record = state.records.get(id);
    if (!record) return;

    const current = Number(priceData.current_price);
    if (Number.isFinite(current)) {
      record.currentPrice = current;
    }

    record.priceChange24h = Number(priceData.price_change_24h);
    record.volume24h = Number(priceData.volume_24h);
    record.priceSource = priceData.source || record.priceSource;
    record.priceTimestamp = priceData.timestamp || record.priceTimestamp;
    record.delta15m = predictionDelta(record.predicted15m, record.currentPrice);
    record.delta1h = predictionDelta(record.predicted1h, record.currentPrice);
  }

  async function fetchBinanceTickerPrice(coinId) {
    const symbol = encodeURIComponent(String(coinId || "").toUpperCase());
    const response = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`, {
      cache: "no-store"
    });
    if (!response.ok) throw new Error("Binance price fetch failed");

    const payload = await response.json();
    const price = Number(payload.price);
    if (!Number.isFinite(price)) throw new Error("Binance returned an invalid price");
    return price;
  }

  async function fetchOkxTickerPrice(coinId) {
    const instId = encodeURIComponent(okxInstrumentId(coinId));
    const response = await fetch(`https://www.okx.com/api/v5/market/ticker?instId=${instId}`, {
      cache: "no-store"
    });
    if (!response.ok) throw new Error("OKX price fetch failed");

    const payload = await response.json();
    const price = Number(payload?.data?.[0]?.last);
    if (!Number.isFinite(price)) throw new Error("OKX returned an invalid price");
    return price;
  }

  async function fetchDirectTickerPrice(coinId) {
    try {
      return await fetchBinanceTickerPrice(coinId);
    } catch (error) {
      return fetchOkxTickerPrice(coinId);
    }
  }

  function flashLivePrice(element) {
    element.classList.remove("is-live-price-updated");
    void element.offsetWidth;
    element.classList.add("is-live-price-updated");

    window.setTimeout(() => {
      element.classList.remove("is-live-price-updated");
    }, 700);
  }

  function updateLivePriceElement(element, price) {
    const nextText = formatPrice(price);
    const previousText = element.textContent;

    element.textContent = nextText;
    element.dataset.lastPrice = String(price);

    if (previousText && previousText !== nextText) {
      flashLivePrice(element);
    }
  }

  function visibleLivePriceGroups() {
    return Array.from(grid.querySelectorAll("[data-live-price]")).reduce((groups, element) => {
      const coinId = element.dataset.livePrice;
      if (!coinId) return groups;

      if (!groups.has(coinId)) groups.set(coinId, []);
      groups.get(coinId).push(element);
      return groups;
    }, new Map());
  }

  async function pollVisibleLivePrices() {
    if (directPricePollInFlight || document.hidden) return;

    const priceGroups = visibleLivePriceGroups();
    if (priceGroups.size === 0) return;

    directPricePollInFlight = true;

    try {
      await Promise.all(Array.from(priceGroups.entries()).map(async ([coinId, elements]) => {
        try {
          const price = await fetchDirectTickerPrice(coinId);
          state.directLivePrices.set(coinId, price);
          elements.forEach((element) => {
            if (element.isConnected) updateLivePriceElement(element, price);
          });
        } catch (error) {
          // Direct exchange polling is intentionally silent; the cached prediction UI remains unchanged.
        }
      }));
    } finally {
      directPricePollInFlight = false;
    }
  }

  function applyPredictionPayload(payload) {
    const nextRecords = new Map();

    Object.entries(payload).forEach(([coinId, result]) => {
      const record = normalizeResult(coinId, result);
      nextRecords.set(record.id, record);
    });

    if (nextRecords.size === 0) {
      throw new Error("No predictions were returned by the orchestrator.");
    }

    state.records.clear();
    nextRecords.forEach((record, id) => {
      state.records.set(id, record);
    });
    state.errors.clear();

    return nextRecords.size;
  }

  function cachedRecordCount() {
    return Array.from(state.records.values()).filter((record) => record.fromCache).length;
  }

  function setPredictionLoadStatus() {
    const total = state.records.size;
    const cached = cachedRecordCount();
    const generated = Math.max(0, total - cached);

    if (total === 0) return;

    if (cached >= DEFAULT_COINS.length) {
      setPipelineStatus("Loaded fresh cached predictions. No pipeline run needed.", "success");
      return;
    }

    if (cached > 0) {
      if (generated > 0) {
        setPipelineStatus(`Loaded ${cached} fresh cached predictions and generated ${generated} missing or expired predictions.`, "success");
      } else {
        setPipelineStatus(`Loaded ${cached} fresh cached predictions. Missing or expired coins were not returned yet.`, "warning");
      }
      return;
    }

    setPipelineStatus("No fresh cached predictions were available. Prediction pipeline finished and cache was refreshed.", "success");
  }

  async function fetchCachedPredictions() {
    try {
      const response = await fetch(endpoint("/predict/all/cache"), { cache: "no-store" });
      if (!response.ok) throw new Error(`Cache preflight returned ${response.status}`);

      const payload = await response.json();
      if (Object.keys(payload).length === 0) return 0;

      const loaded = applyPredictionPayload(payload);
      state.lastUpdatedAt = new Date();
      await fetchLivePrices({ rerender: false });
      updateLastUpdated();
      render();
      pollVisibleLivePrices();

      return loaded;
    } catch (error) {
      console.warn("Prediction cache preflight failed", error);
      return null;
    }
  }

  async function fetchLivePrices({ rerender = true } = {}) {
    if (state.records.size === 0) return;

    try {
      const response = await fetch(endpoint("/prices"), { cache: "no-store" });
      if (!response.ok) throw new Error(`Price update returned ${response.status}`);

      const payload = await response.json();
      const prices = Array.isArray(payload) ? payload : payload.prices || [];
      prices.forEach(applyLivePrice);

      if (prices.length > 0) {
        state.priceUpdatedAt = new Date();
        state.lastUpdatedAt = state.priceUpdatedAt;
        updateLastUpdated();
        if (rerender) render();
      }
    } catch (error) {
      console.warn("Live price update failed", error);
    }
  }

  async function fetchAllPredictions({ showSkeleton = true } = {}) {
    if (showSkeleton) renderSkeletonCards(6);

    try {
      const response = await fetch(endpoint("/predict/all"));
      if (!response.ok) throw new Error(`Orchestrator returned ${response.status}`);

      const payload = await response.json();
      applyPredictionPayload(payload);

      state.lastUpdatedAt = new Date();
      await fetchLivePrices({ rerender: false });
      updateLastUpdated();
      render();
      pollVisibleLivePrices();
      setPredictionLoadStatus();
    } catch (error) {
      if (state.records.size === 0) {
        DEFAULT_COINS.forEach((coin) => {
          state.errors.set(coin.id, error.message || "The prediction request failed.");
        });
      }
      setPipelineStatus(
        state.records.size > 0
          ? "Prediction load failed. Showing the fresh cached predictions already available."
          : "Prediction load failed. No cached predictions were available.",
        "warning"
      );
      render();
    }
  }

  async function loadPredictions() {
    renderSkeletonCards(6);
    setPipelineStatus("Checking prediction cache...", "info");

    const cachedCount = await fetchCachedPredictions();

    if (cachedCount >= DEFAULT_COINS.length) {
      setPredictionLoadStatus();
      return;
    }

    if (cachedCount > 0) {
      setPipelineStatus(`Showing ${cachedCount} fresh cached predictions. Running the pipeline for missing or expired coins...`, "warning");
      await fetchAllPredictions({ showSkeleton: false });
      return;
    }

    if (cachedCount === 0) {
      setPipelineStatus("No fresh cached predictions found. Running the full prediction pipeline now...", "warning");
    } else {
      setPipelineStatus("Cache check was unavailable. Loading predictions now...", "warning");
    }

    await fetchAllPredictions({ showSkeleton: true });
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
      pollVisibleLivePrices();
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
      fetchLivePrices();
    }, 60000);

    window.setInterval(() => {
      pollVisibleLivePrices();
    }, 5000);
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
    loadPredictions();
  }

  init();
})();
