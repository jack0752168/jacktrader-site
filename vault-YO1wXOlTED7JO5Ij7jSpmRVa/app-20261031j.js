(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const SVG_NS = "http://www.w3.org/2000/svg";
  const PALETTE = ["#78d9f0", "#d2b47e", "#b8a1f1", "#f0a98f", "#9cd5a5"];
  const TOTAL_COLOR = "#70e7bf";
  const state = {
    latest: null,
    points: [],
    dayPoints: [],
    benchmarkPoints: [],
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
  const quantityFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 });
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

  function formatQuantity(value) {
    const n = finite(value);
    return n === null ? "—" : quantityFormat.format(n);
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
      getJson("/api/history?range=24h"),
      getJson("/api/history?range=all"),
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
    if (results[2].status === "fulfilled") {
      state.dayPoints = Array.isArray(results[2].value?.points) ? results[2].value.points : [];
    } else {
      failures += 1;
    }
    if (results[3].status === "fulfilled") {
      state.benchmarkPoints = Array.isArray(results[3].value?.points) ? results[3].value.points : [];
    } else {
      failures += 1;
    }
    renderTodayPnl();
    renderBenchmark();
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
    $("deltaMultiple").textContent = "現貨、合約與期權方向合計";
    $("btcPrice").textContent = formatUsd(data.btc_usd);
    $("leverageValue").textContent = equityBtc && deltaBtc !== null ? `${(Math.abs(deltaBtc) / equityBtc).toFixed(2)}×` : "—";
    $("latestTime").textContent = `資料時間 ${formatDate(data.timestamp)}（新加坡）`;
    renderAccounts();
    renderPositions();
    renderAssetMix();
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
        <div class="account-detail"><span>等值 <b>${formatBtc(account.btc_equiv)}</b></span><span>Delta <b>${formatDelta(account.delta_btc)}</b></span><span>有效槓桿 <b>${finite(account.btc_equiv) > 0 && finite(account.delta_btc) !== null ? `${(Math.abs(Number(account.delta_btc)) / Number(account.btc_equiv)).toFixed(2)}×` : "—"}</b></span></div>
        <div class="account-source">${source}${escapeHtml(relativeTime(account.asof))}</div>
        ${note}${edit}
      </article>`;
    }).join("");
    $("accountGrid").querySelectorAll("[data-manual-edit]").forEach((button) => button.addEventListener("click", openManualDialog));
  }



  function renderAssetMix() {
    const target = $("assetMix");
    const total = finite(state.latest?.total_usd);
    const accounts = getAccounts();
    if (!total || !accounts.length) {
      target.textContent = "等待五戶完整資產資料。";
      return;
    }
    const amounts = new Map();
    const quantities = new Map();
    let valuedHoldings = 0;
    for (const account of accounts) for (const row of (account.holdings || [])) {
      if (row.asset === "淨值調整") continue;
      const asset = String(row.asset || "其他").toUpperCase();
      const value = finite(row.usd);
      const quantity = finite(row.quantity);
      if (value !== null) { amounts.set(asset, (amounts.get(asset) || 0) + value); valuedHoldings += value; }
      if (quantity !== null) quantities.set(asset, (quantities.get(asset) || 0) + quantity);
    }
    const derivatives = Array.isArray(state.latest?.derivatives) ? state.latest.derivatives : [];
    const optionValue = derivatives.reduce((sum, row) => sum + (finite(row.market_value_usd) || 0), 0);
    const primary = ["BTC", "USD", "USDC", "USDT", "BNB"];
    const otherValue = [...amounts.entries()].filter(([asset]) => !primary.includes(asset)).reduce((sum, [, value]) => sum + value, 0);
    const rows = primary.map((asset) => ({ name: asset, usd: amounts.get(asset) || 0, quantity: quantities.get(asset), color: ({ BTC: "#f4b75f", USD: "#7cceb2", USDC: "#8daff1", USDT: "#71c9a0", BNB: "#e6c66d" })[asset] }));
    rows.push({ name: "BTC 期權", usd: optionValue, quantity: null, color: "#bd9af3" });
    if (otherValue >= 10) rows.push({ name: "其他幣種", usd: otherValue, quantity: null, color: "#b4c4c2" });
    const remainder = total - valuedHoldings - optionValue;
    if (remainder >= 10) rows.push({ name: "未拆分／估值差額", usd: remainder, quantity: null, color: "#6f898a" });
    const visible = rows.filter((row) => row.usd >= 10).sort((a, b) => b.usd - a.usd);
    const bar = visible.map((row) => `<span style="width:${Math.min(100, row.usd / total * 100).toFixed(4)}%;background:${row.color}" title="${escapeHtml(row.name)} ${(row.usd / total * 100).toFixed(1)}%"></span>`).join("");
    const list = visible.map((row) => `<div class="mix-row"><span class="mix-name"><i style="background:${row.color}"></i>${escapeHtml(row.name)}</span><span>${row.quantity === null || row.quantity === undefined ? "市值" : formatQuantity(row.quantity)}</span><strong>${formatUsd(row.usd)}</strong><b>${(row.usd / total * 100).toFixed(1)}%</b></div>`).join("");
    const discrepancy = Math.abs(remainder) >= 10 && remainder < 0 ? ` · 估值差額 ${formatUsd(remainder)}` : "";
    target.innerHTML = `<div class="mix-bar" aria-label="持有資產市值占比">${bar}</div><div class="mix-list">${list}</div><p class="mix-note">占比以五戶淨值 ${formatUsd(total)} 為分母；小於 $10 的資產不逐項列出。期權按市值列示，合約名義不計入${discrepancy}。</p>`;
  }

  function renderBenchmark() {
    const target = $("btcBenchmark");
    const latest = state.latest;
    const currentUsd = finite(latest?.total_usd);
    const currentPrice = finite(latest?.btc_usd);
    const first = state.benchmarkPoints.find((point) => finite(point.total_usd) > 0 && finite(point.total_btc_equiv) > 0 && timestamp(point.timestamp) !== null);
    if (!first || currentUsd === null || !currentPrice || timestamp(latest?.timestamp) === null) {
      target.textContent = "需要完整起點與目前快照，才能對比 BTC。";
      return;
    }
    const startUsd = Number(first.total_usd);
    const startPrice = startUsd / Number(first.total_btc_equiv);
    const ownReturn = currentUsd / startUsd - 1;
    const btcReturn = currentPrice / startPrice - 1;
    const excess = ownReturn - btcReturn;
    const btcHoldValue = startUsd * currentPrice / startPrice;
    const ownChange = currentUsd - startUsd;
    const btcChange = btcHoldValue - startUsd;
    const signedPct = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "always" });
    const percent = (value) => `${signedPct.format(value * 100)}%`;
    const roundedExcess = Number((excess * 100).toFixed(2));
    const status = roundedExcess > 0 ? "淨值變動暫時跑贏 BTC" : roundedExcess < 0 ? "淨值變動暫時落後 BTC" : "目前與 BTC 基本持平";
    const series = state.benchmarkPoints.filter((point) => finite(point.total_usd) > 0 && finite(point.total_btc_equiv) > 0 && timestamp(point.timestamp) !== null)
      .map((point) => ({ t: timestamp(point.timestamp), own: Number(point.total_usd) / startUsd * 100, btc: (Number(point.total_usd) / Number(point.total_btc_equiv)) / startPrice * 100 }));
    series.push({ t: timestamp(latest.timestamp), own: currentUsd / startUsd * 100, btc: currentPrice / startPrice * 100 });
    series.sort((a, b) => a.t - b.t);
    const times = series.map((point) => point.t), values = series.flatMap((point) => [point.own, point.btc]);
    const minT = Math.min(...times), maxT = Math.max(...times), minV = Math.min(...values), maxV = Math.max(...values);
    const pad = Math.max(0.05, (maxV - minV) * 0.12);
    const x = (t) => 10 + (t - minT) / Math.max(1, maxT - minT) * 580;
    const y = (v) => 110 - (v - (minV - pad)) / (maxV - minV + 2 * pad) * 100;
    const line = (key) => series.map((point, index) => `${index ? "L" : "M"}${x(point.t).toFixed(1)},${y(point[key]).toFixed(1)}`).join(" ");
    const benchmarkChart = series.length > 1 ? `<div class="benchmark-chart" role="img" aria-label="五戶組合與 BTC 自起點 100 的淨值對比"><svg viewBox="0 0 600 120" preserveAspectRatio="none" aria-hidden="true"><line x1="10" x2="590" y1="${y(100).toFixed(1)}" y2="${y(100).toFixed(1)}" stroke="#46615f" stroke-dasharray="4 5"/><path d="${line("own")}" fill="none" stroke="#70e7bf" stroke-width="2.5"/><path d="${line("btc")}" fill="none" stroke="#f4b75f" stroke-width="2.5"/></svg><div class="benchmark-legend"><span><i class="own"></i>五戶組合</span><span><i class="btc"></i>BTC</span><span>起點均為 100</span></div></div>` : "";
    target.innerHTML = `<div class="benchmark-grid">
      <div class="benchmark-card"><span>五戶組合</span><strong class="${ownReturn < 0 ? "down" : "up"}">${percent(ownReturn)}</strong><small>淨值變動 ${signedUsdFormat.format(ownChange)}</small></div>
      <div class="benchmark-card"><span>等額買入並持有 BTC</span><strong class="${btcReturn < 0 ? "down" : "up"}">${percent(btcReturn)}</strong><small>同額起點變動 ${signedUsdFormat.format(btcChange)}</small></div>
      <div class="benchmark-card benchmark-excess"><span>相對 BTC</span><strong class="${roundedExcess < 0 ? "down" : roundedExcess > 0 ? "up" : ""}">${roundedExcess > 0 ? "+" : ""}${roundedExcess.toFixed(2)} 個百分點</strong><small>${status}</small></div>
    </div>${benchmarkChart}<div class="benchmark-period">起點 ${formatDate(first.timestamp)} · 五戶 ${formatUsd(startUsd)} · BTC ${formatUsd(startPrice)}／枚；截至 ${formatDate(latest.timestamp)} · BTC ${formatUsd(currentPrice)}／枚</div>
    <p class="benchmark-caveat">這是有完整快照以來的資產淨值對比。若期間有五戶以外的入出金或修改人工現貨基數，需先扣除資金流，才能判斷真正投資收益及是否跑贏 BTC；五戶之間互轉在總資產中互相抵銷。</p>`;
  }

  function renderTodayPnl() {
    const target = $("todayPnl");
    const latest = state.latest;
    const latestMs = timestamp(latest?.timestamp);
    const latestUsd = finite(latest?.total_usd);
    const latestBtc = finite(latest?.total_btc_equiv);
    if (latestMs === null || latestUsd === null || latestBtc === null) {
      target.innerHTML = '<div class="today-unavailable">等待五戶完整淨值快照。</div>';
      return;
    }
    // Beijing 08:00 is 00:00 UTC. The trading day continues until the next 08:00.
    const latestDate = new Date(latestMs);
    const boundary = Date.UTC(latestDate.getUTCFullYear(), latestDate.getUTCMonth(), latestDate.getUTCDate());
    const points = state.dayPoints.filter((point) => timestamp(point.timestamp) !== null && finite(point.total_usd) !== null && finite(point.total_btc_equiv) !== null)
      .sort((a, b) => timestamp(a.timestamp) - timestamp(b.timestamp));
    const before = [...points].reverse().find((point) => timestamp(point.timestamp) <= boundary);
    const after = points.find((point) => timestamp(point.timestamp) >= boundary);
    const windowMs = 10 * 60_000;
    if (!before || !after || boundary - timestamp(before.timestamp) > windowMs || timestamp(after.timestamp) - boundary > windowMs) {
      target.innerHTML = '<div class="today-unavailable">缺少北京時間 08:00 前後的完整快照，今日浮盈暫不計算。<small>不以昨日收盤或首筆晚到資料冒充 08:00 基準。</small></div>';
      return;
    }
    const a = timestamp(before.timestamp);
    const b = timestamp(after.timestamp);
    const weight = a === b ? 0 : (boundary - a) / (b - a);
    const blend = (x, y) => x + (y - x) * weight;
    const baseUsd = blend(Number(before.total_usd), Number(after.total_usd));
    const baseBtc = blend(Number(before.total_btc_equiv), Number(after.total_btc_equiv));
    const basePrice = baseBtc > 0 ? baseUsd / baseBtc : null;
    if (!basePrice || !Number.isFinite(basePrice)) {
      target.innerHTML = '<div class="today-unavailable">08:00 基準的 BTC 換算價無效，暫不計算。</div>';
      return;
    }
    const signedBtc = new Intl.NumberFormat("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 6, signDisplay: "always" });
    const signed = (value, unit) => unit === "btc" ? `${signedBtc.format(value)} BTC` : signedUsdFormat.format(value);
    const cls = (value) => value < 0 ? "down" : value > 0 ? "up" : "flat";
    const pct = (change, base) => base ? `${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "always" }).format(change / base * 100)}%` : "—";
    const usdChange = latestUsd - baseUsd;
    const btcChange = latestBtc - baseBtc;
    const accounts = getAccounts();
    const rows = accounts.map((account) => {
      const first = finite(before.accounts?.[account.id]);
      const second = finite(after.accounts?.[account.id]);
      const nowUsd = finite(account.usd);
      const nowBtc = finite(account.btc_equiv);
      if (first === null || second === null || nowUsd === null || nowBtc === null) return null;
      const startUsd = blend(first, second);
      const startBtc = startUsd / basePrice;
      const changeUsd = nowUsd - startUsd;
      const changeBtc = nowBtc - startBtc;
      return `<tr><td>${escapeHtml(account.name || account.id)}</td><td class="num ${cls(changeUsd)}">${signed(changeUsd, "usd")}</td><td class="num ${cls(changeBtc)}">${signed(changeBtc, "btc")}</td></tr>`;
    });
    const approximated = a !== boundary || b !== boundary;
    const baselineNote = approximated ? `08:00 基準由 ${formatDate(before.timestamp, true)} 與 ${formatDate(after.timestamp, true)} 快照內插估算` : "08:00 完整快照基準";
    target.innerHTML = `<div class="today-metrics">
      <div class="today-metric"><span>美元本位 · 今日變動</span><strong class="${cls(usdChange)}">${signed(usdChange, "usd")}</strong><small>${pct(usdChange, baseUsd)} · 08:00 淨值 ${formatUsd(baseUsd)}</small></div>
      <div class="today-metric"><span>BTC 本位 · 今日變動</span><strong class="${cls(btcChange)}">${signed(btcChange, "btc")}</strong><small>${pct(btcChange, baseBtc)} · 08:00 淨值 ${formatBtc(baseBtc)}</small></div>
    </div><div class="today-baseline">${baselineNote} · 截至 ${formatDate(latest.timestamp)}（北京時間）</div>
    <div class="today-table-wrap"><table class="today-table"><thead><tr><th>帳戶</th><th class="num">美元本位</th><th class="num">BTC 本位</th></tr></thead><tbody>${rows.every(Boolean) ? rows.join("") : '<tr><td colspan="3">個別帳戶基準不完整</td></tr>'}</tbody></table></div>
    <p class="today-caveat">按帳戶淨值差額計算，已包含市值及浮盈虧；未扣除入出金或帳戶間轉帳，因此是浮盈參考，不等同交易所交易損益。BTC 本位按各時點 BTC 價換算。</p>`;
  }

  function renderPositions() {
    const accounts = getAccounts();
    const derivatives = Array.isArray(state.latest?.derivatives) ? state.latest.derivatives : [];
    if (!accounts.length) {
      $("accountPositions").textContent = "暫無帳戶持倉資料";
      $("aggregatePositions").textContent = "暫無可匯總的帳戶資料";
      return;
    }
    $("accountPositions").innerHTML = accounts.map((account) => {
      const holdings = Array.isArray(account.holdings) ? account.holdings : [];
      const adjustment = holdings.filter((row) => row.asset === "淨值調整").reduce((sum, row) => sum + (finite(row.usd) || 0), 0);
      const assetHoldings = holdings.filter((row) => row.asset !== "淨值調整");
      const visibleHoldings = assetHoldings.filter((row) => finite(row.usd) !== null && Math.abs(Number(row.usd)) >= 10);
      const hiddenCount = assetHoldings.length - visibleHoldings.length;
      const positions = derivatives.filter((row) => row.account === account.id);
      const cashRows = visibleHoldings.length ? visibleHoldings.map((row) => `<tr><td>${escapeHtml(row.wallet)}</td><td>${escapeHtml(row.asset)}</td><td>${formatQuantity(row.quantity)}</td><td>${formatUsd(row.usd)}</td><td>${row.note ? escapeHtml(row.note) : "—"}</td></tr>`).join("") : '<tr><td colspan="5" class="table-empty">沒有估值達 $10 的餘額</td></tr>';
      const derivativeRows = positions.length ? positions.map((row) => `<tr><td>${escapeHtml(row.instrument)}</td><td>${escapeHtml(row.side)}</td><td>${formatBtc(row.nominal_btc)}</td><td>${formatUsd(row.market_value_usd ?? row.unrealized_pnl_usd)}</td><td>${formatDelta(row.delta_btc)}</td></tr>`).join("") : '<tr><td colspan="5" class="table-empty">無未平倉衍生品</td></tr>';
      return `<details class="account-position" open><summary><strong>${escapeHtml(account.name)}</strong><span>淨值 ${formatUsd(account.usd)} · ${visibleHoldings.length} 筆主要資產 · ${positions.length} 筆衍生品</span></summary>
        <div class="position-subtitle">現貨／錢包餘額 <small>幣種估值供核對；不可再加到帳戶淨值</small></div>
        <div class="table-scroll"><table><thead><tr><th>錢包</th><th>幣種</th><th>數量</th><th>估值 USD</th><th>說明</th></tr></thead><tbody>${cashRows}</tbody></table></div>
        ${hiddenCount ? `<div class="position-small-note">已隱藏 ${hiddenCount} 筆低於 $10 或未估值的小額餘額；帳戶淨值仍包含它們。</div>` : ""}
        ${Math.abs(adjustment) >= 1 ? `<div class="position-small-note">錢包估值差額 ${formatUsd(adjustment)} 已包含於帳戶淨值；這不是持倉。</div>` : ""}
        <div class="position-subtitle">合約／期權 <small>名義是曝險；市值或浮盈虧已計入淨值</small></div>
        <div class="table-scroll"><table><thead><tr><th>合約</th><th>方向</th><th>名義 BTC</th><th>市值／浮盈虧</th><th>BTC Delta</th></tr></thead><tbody>${derivativeRows}</tbody></table></div>
      </details>`;
    }).join("");
    const groups = new Map();
    for (const account of accounts) for (const row of (account.holdings || [])) {
      if (row.asset === "淨值調整") continue;
      const asset = String(row.asset || "未知");
      if (!groups.has(asset)) groups.set(asset, { quantity: 0, hasQuantity: false, usd: 0, partial: false, accounts: new Set() });
      const group = groups.get(asset);
      const qty = finite(row.quantity), usd = finite(row.usd);
      if (qty !== null) { group.quantity += qty; group.hasQuantity = true; }
      if (usd !== null) group.usd += usd; else group.partial = true;
      group.accounts.add(account.name);
    }
    const majorAssets = [...groups.entries()].filter(([, row]) => Math.abs(row.usd) >= 10).sort((a, b) => Math.abs(b[1].usd) - Math.abs(a[1].usd));
    const assetRows = majorAssets.map(([asset, row]) => `<tr><td>${escapeHtml(asset)}</td><td>${row.hasQuantity ? formatQuantity(row.quantity) : "—"}</td><td>${formatUsd(row.usd)}${row.partial ? " <small>部分未估值</small>" : ""}</td><td>${[...row.accounts].map(escapeHtml).join("、")}</td></tr>`).join("");
    const hiddenAssets = groups.size - majorAssets.length;
    const totalAdjustment = accounts.flatMap((account) => account.holdings || []).filter((row) => row.asset === "淨值調整").reduce((sum, row) => sum + (finite(row.usd) || 0), 0);
    const allocationTotal = finite(state.latest.total_usd) || 0;
    const allocation = accounts.map((account, index) => ({ name: account.name, share: allocationTotal > 0 ? Math.max(0, Number(account.usd) / allocationTotal * 100) : 0, color: colorFor(String(account.id || index), index) }));
    const allocationBar = allocation.map((row) => `<span style="width:${row.share.toFixed(4)}%;background:${row.color}" title="${escapeHtml(row.name)} ${row.share.toFixed(1)}%"></span>`).join("");
    const allocationLegend = allocation.map((row) => `<span><i style="background:${row.color}"></i>${escapeHtml(row.name)} ${row.share.toFixed(1)}%</span>`).join("");
    const accountRows = accounts.map((account) => `<tr><td>${escapeHtml(account.name)}</td><td>${formatUsd(account.usd)}</td><td>${formatBtc(account.btc_equiv)}</td><td>${formatDelta(account.delta_btc)}</td><td>${finite(account.btc_equiv) > 0 && finite(account.delta_btc) !== null ? `${(Math.abs(Number(account.delta_btc)) / Number(account.btc_equiv)).toFixed(2)}×` : "—"}</td></tr>`).join("");
    const nominal = derivatives.reduce((sum, row) => sum + (finite(row.nominal_btc) || 0), 0);
    const optionValue = derivatives.reduce((sum, row) => sum + (finite(row.market_value_usd) || 0), 0);
    const futuresPnl = derivatives.reduce((sum, row) => sum + (finite(row.unrealized_pnl_usd) || 0), 0);
    $("aggregatePositions").innerHTML = `<div class="position-subtitle">五戶淨值對帳 <small>權威合計 ${formatUsd(state.latest.total_usd)}／${formatBtc(state.latest.total_btc_equiv)}</small></div><div class="table-scroll"><table><thead><tr><th>帳戶</th><th>淨值 USD</th><th>BTC 等值</th><th>BTC Delta</th><th>有效槓桿</th></tr></thead><tbody>${accountRows}</tbody></table></div><div class="allocation"><div class="allocation-title">按帳戶淨值分布</div><div class="allocation-bar" aria-label="五戶資產占比">${allocationBar}</div><div class="allocation-legend">${allocationLegend}</div></div>
      <div class="position-subtitle">幣種／錢包合併 <small>已列示的餘額；未拆分估值與衍生品另看上方帳戶明細</small></div><div class="table-scroll"><table><thead><tr><th>幣種</th><th>合計數量</th><th>列示估值 USD</th><th>涉及帳戶</th></tr></thead><tbody>${assetRows || '<tr><td colspan="4" class="table-empty">無估值達 $10 的幣種</td></tr>'}</tbody></table></div>${hiddenAssets ? `<div class="position-small-note">已隱藏 ${hiddenAssets} 種低於 $10 或未估值資產；仍包含在各戶淨值。</div>` : ""}
      <div class="position-reconcile">衍生品 ${derivatives.length} 筆 · 名義 ${formatBtc(nominal)} · 期權市值 ${formatUsd(optionValue)} · 合約浮盈虧 ${formatUsd(futuresPnl)} · 全倉 BTC Delta ${formatDelta(state.latest.total_delta_btc)}<small>衍生品市值／浮盈虧已在各戶淨值，不另加總。${Math.abs(totalAdjustment) >= 1 ? `錢包估值差額 ${formatUsd(totalAdjustment)} 已含在淨值，並非幣種持倉。` : ""}</small></div>`;
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
