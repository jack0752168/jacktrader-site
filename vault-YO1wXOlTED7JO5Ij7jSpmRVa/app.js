(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const SVG_NS = "http://www.w3.org/2000/svg";
  const PALETTE = ["#78d9f0", "#d2b47e", "#b8a1f1", "#f0a98f", "#9cd5a5"];
  const TOTAL_COLOR = "#70e7bf";
  const state = {
    latest: null,
    points: [],
    range: "24h",
    currency: "usd",
    series: "total",
    chartPoints: [],
    accountColors: new Map(),
    busy: false,
  };

  const usdFormat = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const signedUsdFormat = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0, signDisplay: "always" });
  const btcFormat = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
  const deltaFormat = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4, signDisplay: "always" });
  const dateFormat = new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Singapore", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  const timeFormat = new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Singapore", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

  function finite(value) {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function timestamp(value) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "number" || /^\d+$/.test(String(value))) {
      const n = Number(value);
      return Number.isFinite(n) ? (n < 1e12 ? n * 1000 : n) : null;
    }
    const n = Date.parse(value);
    return Number.isFinite(n) ? n : null;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  }

  function formatUsd(value) {
    const n = finite(value);
    return n === null ? "—" : usdFormat.format(n);
  }

  function formatBtc(value) {
    const n = finite(value);
    return n === null ? "—" : `${btcFormat.format(n)} BTC`;
  }

  function formatDelta(value) {
    const n = finite(value);
    return n === null ? "—" : `${deltaFormat.format(n)} BTC`;
  }

  function formatDate(value, onlyTime = false) {
    const ms = timestamp(value);
    if (ms === null) return "時間未提供";
    return (onlyTime ? timeFormat : dateFormat).format(new Date(ms));
  }

  function relativeTime(value) {
    const ms = timestamp(value);
    if (ms === null) return "時間未提供";
    const age = Math.max(0, Date.now() - ms);
    if (age < 60_000) return "剛剛";
    if (age < 3_600_000) return `${Math.floor(age / 60_000)} 分鐘前`;
    if (age < 86_400_000) return `${Math.floor(age / 3_600_000)} 小時前`;
    return formatDate(value);
  }

  function setSync(message, isError = false) {
    $("syncStatus").textContent = message;
    $("syncStatus").classList.toggle("is-error", isError);
  }

  function renderFreshness(errorMessage = "") {
    const banner = $("freshnessBanner");
    const badge = $("freshnessBadge");
    const title = $("freshnessTitle");
    const detail = $("freshnessDetail");
    const data = state.latest;
    const cutoff = timestamp(data?.timestamp);
    banner.className = "freshness-banner";
    if (!data || cutoff === null) {
      banner.classList.add("is-error");
      badge.textContent = "無資料";
      title.textContent = "尚未讀到資產快照";
      detail.textContent = errorMessage || "請從原始 iMessage 完整連結開啟，再按右上角刷新。";
      return;
    }
    const ageMinutes = Math.max(0, Math.floor((Date.now() - cutoff) / 60_000));
    const cached = data.delivery?.mode === "cached";
    const sourceAges = Array.isArray(data.accounts) ? data.accounts.map((account) => {
      const sourceTime = timestamp(account.asof);
      return sourceTime === null ? Infinity : Math.max(0, Math.floor((Date.now() - sourceTime) / 60_000));
    }) : [];
    const oldestSourceMinutes = sourceAges.length === 5 ? Math.max(...sourceAges) : Infinity;
    const fresh = data.quality === "complete" && !cached && ageMinutes < 5 && oldestSourceMinutes < 10 && !errorMessage;
    if (fresh) {
      badge.textContent = "資料已更新";
    } else if (ageMinutes >= 15 || errorMessage) {
      banner.classList.add("is-error");
      badge.textContent = "更新中斷";
    } else {
      banner.classList.add("is-stale");
      badge.textContent = cached ? "顯示暫存" : oldestSourceMinutes >= 10 ? "來源較舊" : "資料較舊";
    }
    title.textContent = `資料截止：${formatDate(data.timestamp)}（新加坡時間）`;
    const published = timestamp(data.delivery?.publishedAt);
    const publishText = published === null ? "" : ` · 密文上傳 ${formatDate(data.delivery.publishedAt, true)}`;
    const sourceText = oldestSourceMinutes >= 10 && Number.isFinite(oldestSourceMinutes) ? ` · 最舊帳戶 ${oldestSourceMinutes} 分鐘前` : "";
    detail.textContent = `${ageMinutes < 1 ? "不足 1" : ageMinutes} 分鐘前${publishText}${sourceText}${cached ? " · 正使用上次可解密快照" : ""}${errorMessage ? " · 目前無法取得更新" : ""}`;
  }

  async function getJson(path, options) {
    return window.portfolioVault.getJson(path, options);
  }

  async function refresh() {
    if (state.busy) return;
    state.busy = true;
    $("refreshButton").classList.add("is-loading");
    setSync("正在同步帳戶…");
    const results = await Promise.allSettled([
      getJson("/api/latest"),
      getJson(`/api/history?range=${encodeURIComponent(state.range)}`),
    ]);
    let failures = 0;
    if (results[0].status === "fulfilled") {
      state.latest = results[0].value;
      renderLatest();
    } else {
      failures += 1;
      if (!state.latest) renderConnectionError(results[0].reason?.message);
      else { state.latest.delivery = { ...(state.latest.delivery || {}), mode: "cached" }; renderFreshness(results[0].reason?.message); }
    }
    if (results[1].status === "fulfilled") {
      state.points = Array.isArray(results[1].value?.points) ? results[1].value.points : [];
      renderChart();
      renderHeroChange();
    } else {
      failures += 1;
      if (!state.points.length) renderChart();
    }
    const quality = state.latest?.quality;
    if (failures === 0 && quality === "stale") setSync("資料較舊 · 顯示上次完整快照", true);
    else if (failures === 0 && (quality === "partial" || quality === "degraded")) setSync("部分帳戶未更新", true);
    else if (failures === 0 && quality === "loading") setSync("正在採集帳戶…");
    else if (failures === 0) setSync(`已同步 · ${formatDate(state.latest?.timestamp, true)}`);
    else if (failures === 1 && state.latest) setSync("部分資料未更新", true);
    else setSync(results.find((result) => result.status === "rejected")?.reason?.message || "連線失敗 · 顯示上次資料", true);
    $("refreshButton").classList.remove("is-loading");
    state.busy = false;
  }

  async function refreshHistory() {
    try {
      const data = await getJson(`/api/history?range=${encodeURIComponent(state.range)}`);
      state.points = Array.isArray(data?.points) ? data.points : [];
      renderChart();
      renderHeroChange();
    } catch {
      setSync("歷史曲線暫時無法更新", true);
    }
  }

  function renderConnectionError(message) {
    renderFreshness(message);
    $("accountGrid").innerHTML = '<div class="account-placeholder">無法連接資料服務；稍後會自動重試。</div>';
    $("derivativesBody").innerHTML = '<tr><td colspan="7" class="table-empty">等待資料服務</td></tr>';
    $("chartEmpty").querySelector("strong").textContent = "等待資料服務";
    $("chartEmpty").querySelector("span:last-child").textContent = "請確認私人連結完整，且 Mac 已同步加密快照。";
  }

  function getAccounts() {
    return Array.isArray(state.latest?.accounts) ? state.latest.accounts : [];
  }

  function colorFor(id, index) {
    if (!state.accountColors.has(id)) state.accountColors.set(id, PALETTE[index % PALETTE.length]);
    return state.accountColors.get(id);
  }

  function statusInfo(account) {
    const raw = String(account.status || "").toLowerCase();
    const source = String(account.source || "").toLowerCase();
    const age = timestamp(account.asof) === null ? 0 : Date.now() - timestamp(account.asof);
    if (raw.includes("error") || raw.includes("fail")) return { label: "連線異常", className: "error" };
    if (raw.includes("manual") || source.includes("manual") || String(account.id).toLowerCase() === "okx2") {
      return age > 20 * 60_000 ? { label: "手動·待確認", className: "stale" } : { label: "手動基數", className: "manual" };
    }
    if (raw.includes("stale") || age > 20 * 60_000) return { label: "資料較舊", className: "stale" };
    if (raw.includes("estimate") || source.includes("estimate")) return { label: "估算", className: "estimated" };
    if (raw.includes("fixed") || source.includes("fixed")) return { label: "固定資產", className: "manual" };
    return { label: "已更新", className: "ok" };
  }

  function isManualOkx(account) {
    const id = String(account.id || "").toLowerCase();
    const name = String(account.name || "");
    return id === "okx2" || id === "okx_second" || (name.includes("第二") && name.toLowerCase().includes("okx"));
  }

  function renderLatest() {
    const data = state.latest || {};
    renderFreshness();
    $("totalUsd").textContent = formatUsd(data.total_usd);
    $("totalBtc").textContent = formatBtc(data.total_btc_equiv);
    $("totalDelta").textContent = formatDelta(data.total_delta_btc);
    $("totalDelta").className = finite(data.total_delta_btc) < 0 ? "negative" : "positive";
    const equityBtc = finite(data.total_btc_equiv);
    const deltaBtc = finite(data.total_delta_btc);
    $("deltaMultiple").textContent = equityBtc && deltaBtc !== null
      ? `方向倍數 ≈ ${(deltaBtc / equityBtc).toFixed(2)}×（Delta / 淨值）`
      : "現貨與合約、期權方向合計";
    $("btcPrice").textContent = formatUsd(data.btc_usd);
    $("latestTime").textContent = `資料時間 ${formatDate(data.timestamp)}（新加坡）`;
    renderAccounts();
    renderSeriesSelector();
    renderDerivatives();
    renderQuality();
    renderHeroChange();
    renderChart();
  }

  function renderAccounts() {
    const accounts = getAccounts();
    $("accountCount").textContent = `${accounts.length} 個帳戶 · 按來源時間顯示`;
    if (!accounts.length) {
      $("accountGrid").innerHTML = '<div class="account-placeholder">目前沒有帳戶資料。</div>';
      return;
    }
    $("accountGrid").innerHTML = accounts.map((account, index) => {
      const id = String(account.id || index);
      const status = statusInfo(account);
      const source = account.source ? `${escapeHtml(account.source)} · ` : "";
      const note = account.notes ? `<div class="account-note">${escapeHtml(account.notes)}</div>` : "";
      const edit = ""; // Public viewer is read-only; update the cash amount on the Mac.
      return `<article class="account-card${state.series === id ? " selected" : ""}" style="--card-color:${colorFor(id, index)}" data-account-id="${escapeHtml(id)}">
        <div class="account-card-header"><span class="account-name">${escapeHtml(account.name || id)}</span><span class="status-badge ${status.className}">${status.label}</span></div>
        <strong class="account-value">${formatUsd(account.usd)}</strong>
        <div class="account-detail"><span>等值 <b>${formatBtc(account.btc_equiv)}</b></span><span>Delta <b>${formatDelta(account.delta_btc)}</b></span></div>
        <div class="account-source">${source}${escapeHtml(relativeTime(account.asof))}</div>
        ${note}${edit}
      </article>`;
    }).join("");
    $("accountGrid").querySelectorAll("[data-manual-edit]").forEach((button) => button.addEventListener("click", openManualDialog));
  }

  function renderSeriesSelector() {
    const accounts = getAccounts();
    const buttons = [{ id: "total", name: "五戶合計", color: TOTAL_COLOR }, ...accounts.map((account, index) => ({
      id: String(account.id || index), name: String(account.name || account.id || `帳戶 ${index + 1}`), color: colorFor(String(account.id || index), index),
    }))];
    if (!buttons.some((item) => item.id === state.series)) state.series = "total";
    $("seriesSelector").innerHTML = buttons.map((item) => `<button type="button" class="series-button${item.id === state.series ? " selected" : ""}" data-series="${escapeHtml(item.id)}" aria-pressed="${item.id === state.series}"><span class="series-swatch" style="--series-color:${item.color}"></span>${escapeHtml(item.name)}</button>`).join("");
    $("seriesSelector").querySelectorAll("[data-series]").forEach((button) => button.addEventListener("click", () => {
      state.series = button.dataset.series;
      renderSeriesSelector();
      renderAccounts();
      renderChart();
    }));
  }

  function renderDerivatives() {
    const items = Array.isArray(state.latest?.derivatives) ? state.latest.derivatives : [];
    $("derivativesCount").textContent = `${items.length} 筆未平倉`;
    if (!items.length) {
      $("derivativesBody").innerHTML = '<tr><td colspan="7" class="table-empty">目前沒有可顯示的衍生品倉位。</td></tr>';
      return;
    }
    $("derivativesBody").innerHTML = items.map((item) => {
      const side = String(item.side || "");
      const short = /short|sell|空|賣/i.test(side);
      const delta = finite(item.delta_btc);
      const pnl = finite(item.unrealized_pnl_usd);
      const value = finite(item.market_value_usd) !== null
        ? formatUsd(item.market_value_usd)
        : pnl !== null ? `${signedUsdFormat.format(pnl)} <small>浮盈虧</small>` : "—";
      return `<tr><td>${escapeHtml(item.account || "—")}</td><td class="instrument-cell">${escapeHtml(item.instrument || "—")}</td><td><span class="side-badge${short ? " short" : ""}">${escapeHtml(side || "—")}</span></td><td class="num">${finite(item.nominal_btc) === null ? "—" : btcFormat.format(Number(item.nominal_btc))}</td><td class="num">${formatUsd(item.notional_usd)}</td><td class="num">${value}</td><td class="num ${delta === null ? "" : delta < 0 ? "delta-negative" : "delta-positive"}">${formatDelta(delta)}</td></tr>`;
    }).join("");
  }

  function renderQuality() {
    const quality = state.latest?.quality;
    const missing = getAccounts().filter((account) => ["error", "stale"].includes(statusInfo(account).className));
    if (quality === "stale") {
      $("qualityNote").textContent = "本輪採集未完成；頁面顯示上次完整快照，請留意上方資料時間。";
    } else if (missing.length) {
      $("qualityNote").textContent = `${missing.map((account) => account.name).join("、")}資料較舊或暫時不可用；合計請以各戶時間為準。`;
    } else if (quality === "complete") {
      $("qualityNote").textContent = "五戶資料已更新；手動帳戶仍請以你確認的現貨數量為準。";
    } else if (quality === "partial" || quality === "degraded") {
      $("qualityNote").textContent = "部分帳戶資料未及時更新；請查看各戶來源與時間。";
    } else if (typeof quality === "string" && quality.trim()) {
      $("qualityNote").textContent = quality;
    } else if (quality && typeof quality.note === "string" && quality.note.trim()) {
      $("qualityNote").textContent = quality.note;
    } else {
      $("qualityNote").textContent = "各帳戶估值以資料來源與時間標示為準。";
    }
  }

  function renderHeroChange() {
    const points = [...state.points].filter((point) => finite(point.total_usd) !== null && timestamp(point.timestamp) !== null).sort((a, b) => timestamp(a.timestamp) - timestamp(b.timestamp));
    const el = $("heroChange");
    if (points.length < 2) {
      el.textContent = "歷史資料收集中";
      el.className = "change-pill neutral";
      return;
    }
    const first = Number(points[0].total_usd);
    const last = Number(points[points.length - 1].total_usd);
    const change = last - first;
    const pct = first === 0 ? "" : ` (${change >= 0 ? "+" : ""}${((change / first) * 100).toFixed(2)}%)`;
    el.textContent = `自 ${formatDate(points[0].timestamp)} 資產變動 ${signedUsdFormat.format(change)}${pct}`;
    el.className = `change-pill${change < 0 ? " negative" : ""}`;
  }

  function svgElement(tag, attrs = {}, text = "") {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
    if (text) el.textContent = text;
    return el;
  }

  function chartValue(point) {
    if (state.series === "total") return finite(state.currency === "usd" ? point.total_usd : point.total_btc_equiv);
    const dollars = finite(point.accounts?.[state.series]);
    if (dollars === null) return null;
    if (state.currency === "usd") return dollars;
    const totalUsd = finite(point.total_usd);
    const totalBtc = finite(point.total_btc_equiv);
    if (totalUsd === null || totalBtc === null || totalUsd <= 0 || totalBtc <= 0) return null;
    return dollars / (totalUsd / totalBtc);
  }

  function axisValue(value) {
    if (state.currency === "btc") return `${value.toFixed(value < 1 ? 3 : 2)} BTC`;
    return `$${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value)}`;
  }

  function chartDisplayValue(value) {
    return state.currency === "usd" ? formatUsd(value) : formatBtc(value);
  }

  function clearChart() {
    $("chartLine").setAttribute("d", "");
    $("chartArea").setAttribute("d", "");
    $("chartGrid").replaceChildren();
    $("chartLabels").replaceChildren();
    $("chartCrosshair").setAttribute("visibility", "hidden");
    $("chartHoverDot").setAttribute("visibility", "hidden");
    $("chartTooltip").hidden = true;
    state.chartPoints = [];
  }

  function renderChart() {
    clearChart();
    const source = [...state.points].map((point) => ({ timestamp: timestamp(point.timestamp), value: chartValue(point) }))
      .filter((point) => point.timestamp !== null && point.value !== null)
      .sort((a, b) => a.timestamp - b.timestamp);
    const selected = state.series === "total" ? "五戶合計" : getAccounts().find((account) => String(account.id) === state.series)?.name || "帳戶";
    $("chartPointCount").textContent = source.length ? `${source.length} 筆快照 · ${selected}` : `尚無${selected}曲線資料`;
    $("chartSubtitle").textContent = `${selected} · ${state.currency.toUpperCase()} 計價 · 轉入轉出也會改變曲線。`;
    if (source.length < 2) {
      $("chartEmpty").hidden = false;
      $("chartEmpty").querySelector("strong").textContent = source.length === 1 ? "已收到第一筆快照" : "資金曲線開始記錄中";
      $("chartEmpty").querySelector("span:last-child").textContent = source.length === 1 ? "下一筆有效快照寫入後，就會出現真實曲線。" : "收到至少兩筆有效快照後，這裡會顯示真實曲線。";
      $("chartRegion").setAttribute("aria-label", `${selected}曲線尚待更多有效快照`);
      return;
    }
    $("chartEmpty").hidden = true;
    const color = state.series === "total" ? TOTAL_COLOR : state.accountColors.get(state.series) || TOTAL_COLOR;
    $("chartLine").setAttribute("stroke", color);
    $("chartHoverDot").setAttribute("stroke", color);
    $("gradientTop").setAttribute("stop-color", color);
    $("gradientBottom").setAttribute("stop-color", color);
    const left = 80, right = 972, top = 25, bottom = 300;
    const minValue = Math.min(...source.map((point) => point.value));
    const maxValue = Math.max(...source.map((point) => point.value));
    const spread = Math.max(maxValue - minValue, Math.abs(maxValue) * .001, state.currency === "usd" ? 100 : .001);
    const yMin = minValue - spread * .12;
    const yMax = maxValue + spread * .12;
    const tMin = source[0].timestamp;
    const tMax = source[source.length - 1].timestamp;
    state.chartPoints = source.map((point, index) => ({
      ...point,
      x: tMax === tMin ? left + (right - left) * index / (source.length - 1) : left + (point.timestamp - tMin) / (tMax - tMin) * (right - left),
      y: bottom - (point.value - yMin) / (yMax - yMin) * (bottom - top),
    }));
    const path = state.chartPoints.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
    $("chartLine").setAttribute("d", path);
    $("chartArea").setAttribute("d", `${path} L${state.chartPoints[state.chartPoints.length - 1].x.toFixed(2)} ${bottom} L${state.chartPoints[0].x.toFixed(2)} ${bottom} Z`);
    const grid = $("chartGrid");
    const labels = $("chartLabels");
    for (let i = 0; i < 5; i += 1) {
      const y = top + (bottom - top) * i / 4;
      const value = yMax - (yMax - yMin) * i / 4;
      grid.appendChild(svgElement("line", { x1: left, x2: right, y1: y, y2: y }));
      labels.appendChild(svgElement("text", { x: 0, y: y + 4 }, axisValue(value)));
    }
    for (let i = 0; i < 4; i += 1) {
      const fraction = i / 3;
      const x = left + (right - left) * fraction;
      const date = new Date(tMin + (tMax - tMin) * fraction);
      const label = dateFormat.format(date);
      labels.appendChild(svgElement("text", { x, y: 336, "text-anchor": i === 0 ? "start" : i === 3 ? "end" : "middle" }, label));
    }
    $("chartRegion").setAttribute("aria-label", `${selected}從${chartDisplayValue(source[0].value)}到${chartDisplayValue(source[source.length - 1].value)}，共${source.length}筆快照`);
  }

  function showHover(event) {
    if (state.chartPoints.length < 2) return;
    const region = $("chartRegion");
    const rect = region.getBoundingClientRect();
    const x = Math.min(972, Math.max(80, (event.clientX - rect.left) / rect.width * 1000));
    const point = state.chartPoints.reduce((best, item) => Math.abs(item.x - x) < Math.abs(best.x - x) ? item : best);
    $("chartCrosshair").setAttribute("x1", point.x);
    $("chartCrosshair").setAttribute("x2", point.x);
    $("chartCrosshair").setAttribute("visibility", "visible");
    $("chartHoverDot").setAttribute("cx", point.x);
    $("chartHoverDot").setAttribute("cy", point.y);
    $("chartHoverDot").setAttribute("visibility", "visible");
    const tooltip = $("chartTooltip");
    tooltip.innerHTML = `<strong>${escapeHtml(chartDisplayValue(point.value))}</strong><span>${escapeHtml(formatDate(point.timestamp))} · 新加坡</span>`;
    tooltip.style.left = `${Math.min(rect.width - 78, Math.max(78, point.x / 1000 * rect.width))}px`;
    tooltip.style.top = `${Math.max(57, point.y / 350 * rect.height - 6)}px`;
    tooltip.hidden = false;
  }

  function hideHover() {
    $("chartCrosshair").setAttribute("visibility", "hidden");
    $("chartHoverDot").setAttribute("visibility", "hidden");
    $("chartTooltip").hidden = true;
  }

  function openManualDialog() {
    const known = state.latest?.manual?.okx2_btc_cash ?? "";
    $("manualBtcCash").value = known === "" ? "" : String(known);
    $("manualError").textContent = "";
    $("manualDialog").showModal();
    $("manualBtcCash").focus();
  }

  async function saveManual(event) {
    event.preventDefault();
    const value = Number($("manualBtcCash").value);
    if (!Number.isFinite(value) || value < 0 || value > 1_000) {
      $("manualError").textContent = "請填寫有效的 BTC 現貨數量。";
      return;
    }
    $("manualSave").disabled = true;
    $("manualError").textContent = "";
    try {
      await getJson("/api/manual/okx2", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ btc_cash: value }) });
      $("manualDialog").close();
      setSync("已保存，重新估值中…");
      setTimeout(refresh, 2_500);
      setTimeout(refresh, 8_000);
    } catch (error) {
      $("manualError").textContent = `更新失敗：${error.message || "請稍後再試"}`;
    } finally {
      $("manualSave").disabled = false;
    }
  }

  document.querySelectorAll("[data-range]").forEach((button) => button.addEventListener("click", () => {
    if (state.range === button.dataset.range) return;
    state.range = button.dataset.range;
    document.querySelectorAll("[data-range]").forEach((item) => {
      const selected = item.dataset.range === state.range;
      item.classList.toggle("selected", selected);
      item.setAttribute("aria-pressed", String(selected));
    });
    refreshHistory();
  }));
  document.querySelectorAll("[data-currency]").forEach((button) => button.addEventListener("click", () => {
    state.currency = button.dataset.currency;
    document.querySelectorAll("[data-currency]").forEach((item) => {
      const selected = item.dataset.currency === state.currency;
      item.classList.toggle("selected", selected);
      item.setAttribute("aria-pressed", String(selected));
    });
    renderChart();
  }));
  $("refreshButton").addEventListener("click", refresh);
  $("chartRegion").addEventListener("pointermove", showHover);
  $("chartRegion").addEventListener("pointerleave", hideHover);
  $("manualCancel").addEventListener("click", () => $("manualDialog").close());
  $("manualForm").addEventListener("submit", saveManual);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  setInterval(() => { if (!document.hidden) refresh(); }, 150_000);
  setInterval(() => { if (!document.hidden) renderFreshness(); }, 30_000);
  refresh();
})();
