(() => {
  "use strict";

  const amountFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 });
  const usdFormat = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const deltaFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 6, signDisplay: "exceptZero" });
  const dateFormat = new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Singapore", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const METRICS = ["quantity", "nominal_btc", "notional_usd", "market_value_usd", "delta_btc"];
  const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };

  function number(value) {
    if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
    const result = Number(value);
    return Number.isFinite(result) ? result : null;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }

  function isoDate(year, month, day) {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function parseOption(instrument) {
    const raw = String(instrument || "").toUpperCase();
    let match = raw.match(/^([A-Z0-9]+)-(?:USD|USDT|USDC)-(\d{2})(\d{2})(\d{2})-(\d+(?:\.\d+)?)-(C|P)$/);
    if (match) {
      const expiry = isoDate(2000 + Number(match[2]), Number(match[3]), Number(match[4]));
      if (expiry && Number(match[5]) > 0) return { underlying: match[1], expiry, strike: Number(match[5]), option_type: match[6] };
    }
    match = raw.match(/^([A-Z0-9]+)-(\d{1,2})([A-Z]{3})(\d{2})-(\d+(?:\.\d+)?)-(C|P)$/);
    if (match && MONTHS[match[3]]) {
      const expiry = isoDate(2000 + Number(match[4]), MONTHS[match[3]], Number(match[2]));
      if (expiry && Number(match[5]) > 0) return { underlying: match[1], expiry, strike: Number(match[5]), option_type: match[6] };
    }
    return null;
  }

  function sideOf(row) {
    const value = String(row.side || row.direction || "").toLowerCase();
    if (/short|sell|空|賣/.test(value)) return "short";
    if (/long|buy|多|買/.test(value)) return "long";
    const raw = number(row.quantity ?? row.nominal_btc);
    return raw !== null && raw < 0 ? "short" : "unknown";
  }

  function underlyingOf(instrument) {
    const raw = String(instrument || "").toUpperCase();
    if (/^[A-Z0-9]+-/.test(raw)) return raw.split("-")[0];
    const match = raw.match(/^([A-Z0-9]+?)(?:USDT|USDC|BUSD|USD)(?:_PERP|_\d+)?$/);
    return match ? match[1] : null;
  }

  function newMetrics() {
    return Object.fromEntries(METRICS.map((key) => [key, { sum: 0, known: 0, missing: 0 }]));
  }

  function addMetric(metrics, key, value) {
    const parsed = number(value);
    if (parsed === null) metrics[key].missing += 1;
    else { metrics[key].sum += parsed; metrics[key].known += 1; }
  }

  function metricFields(metrics) {
    const result = { missing: {}, partial: {}, complete: {} };
    for (const key of METRICS) {
      const metric = metrics[key];
      result[key] = metric.known ? metric.sum : null;
      result.missing[key] = metric.missing;
      result.partial[key] = metric.known > 0 && metric.missing > 0;
      result.complete[key] = metric.missing === 0;
    }
    return result;
  }

  function addAccount(group, id, names, quantity, unit, wallet) {
    if (!group._accounts.has(id)) group._accounts.set(id, { id, name: names.get(id) || id || "未知帳戶", quantity: 0, known: 0, missing: 0, quantity_unit: unit, wallets: new Set() });
    const account = group._accounts.get(id);
    const value = number(quantity);
    if (value === null) account.missing += 1;
    else { account.quantity += value; account.known += 1; }
    if (wallet) account.wallets.add(String(wallet));
  }

  function finish(group) {
    const { _metrics, _accounts, _instruments, _wallets, ...visible } = group;
    const metrics = metricFields(_metrics);
    const sign = group.side === "short" ? -1 : group.side === "long" ? 1 : null;
    return { ...visible, ...metrics,
      signed_quantity: sign === null || metrics.quantity === null ? null : sign * metrics.quantity,
      accounts: [..._accounts.values()].map((account) => ({ id: account.id, name: account.name,
        quantity: account.known ? account.quantity : null, quantity_unit: account.quantity_unit,
        missing_quantity: account.missing, wallets: [...account.wallets] })),
      instruments: [...(_instruments || [])], wallets: [...(_wallets || [])] };
  }

  function createGroup(fields) {
    return { ...fields, position_count: 0, _metrics: newMetrics(), _accounts: new Map(), _instruments: new Set(), _wallets: new Set() };
  }

  function groupTotals(groups, extras = {}) {
    const metrics = newMetrics();
    for (const group of groups) for (const key of METRICS) {
      if (group[key] !== null) { metrics[key].sum += group[key]; metrics[key].known += 1; }
      metrics[key].missing += group.missing[key];
    }
    return { ...metricFields(metrics), group_count: groups.length,
      position_count: groups.reduce((sum, group) => sum + group.position_count, 0), ...extras };
  }

  function aggregate(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.accounts) || !snapshot.accounts.length || !Array.isArray(snapshot.derivatives)) {
      return { status: "unavailable", reason: "等待五戶完整持倉資料。" };
    }
    const names = new Map(snapshot.accounts.map((account) => [String(account.id), String(account.name || account.id)]));
    const options = new Map(), futures = new Map(), assets = new Map();
    const unclassified = [];
    for (const row of snapshot.derivatives) {
      const instrument = String(row.instrument || "未命名合約");
      const accountId = String(row.account || "未知帳戶");
      const parsed = parseOption(instrument);
      const kind = row.kind === "option" || (!row.kind && parsed) ? "option" : row.kind === "future" ? "future" : null;
      if (!kind) { unclassified.push({ account: accountId, instrument }); continue; }
      const side = sideOf(row);
      const unit = kind === "option" ? parsed?.underlying || (number(row.nominal_btc) !== null ? "BTC" : "") : underlyingOf(instrument) || "";
      const nominal = number(row.nominal_btc);
      let quantity = unit === "BTC" && nominal !== null ? Math.abs(nominal) : number(row.nominal_underlying ?? row.quantity ?? row.amount);
      if (quantity !== null) quantity = Math.abs(quantity);
      if (kind === "future" && unit !== "BTC" && quantity === null) {
        const notional = number(row.notional_usd), mark = number(row.mark_price);
        if (notional !== null && mark !== null && mark > 0) quantity = Math.abs(notional / mark);
      }
      const key = kind === "option"
        ? parsed ? [parsed.underlying, parsed.expiry, parsed.strike, parsed.option_type, side].join("|") : ["unparsed", accountId, instrument, side].join("|")
        : [instrument, side].join("|");
      const map = kind === "option" ? options : futures;
      if (!map.has(key)) map.set(key, createGroup({ key, kind, instrument, parsed: Boolean(parsed),
        underlying: kind === "option" ? parsed?.underlying || null : unit || null,
        expiry: parsed?.expiry || null, strike: parsed?.strike || null, option_type: parsed?.option_type || null,
        side, quantity_unit: unit }));
      const group = map.get(key);
      group.position_count += 1;
      group._instruments.add(instrument);
      addMetric(group._metrics, "quantity", quantity);
      // A non-BTC underlying never becomes a BTC quantity through valuation.
      if (unit === "BTC") addMetric(group._metrics, "nominal_btc", nominal === null ? null : Math.abs(nominal));
      addMetric(group._metrics, "notional_usd", row.notional_usd);
      if (kind === "option") addMetric(group._metrics, "market_value_usd", row.market_value_usd);
      addMetric(group._metrics, "delta_btc", row.delta_btc);
      addAccount(group, accountId, names, quantity, unit);
    }
    let omittedAdjustments = 0;
    for (const account of snapshot.accounts) for (const row of (Array.isArray(account.holdings) ? account.holdings : [])) {
      if (row.asset === "淨值調整") { omittedAdjustments += 1; continue; }
      const asset = String(row.asset || "未知資產").toUpperCase();
      if (!assets.has(asset)) assets.set(asset, createGroup({ key: asset, kind: "spot", asset,
        quantity_unit: asset, side: null, has_negative_balance: false, negative_balances: [] }));
      const group = assets.get(asset), quantity = number(row.quantity);
      group.position_count += 1;
      addMetric(group._metrics, "quantity", quantity);
      addMetric(group._metrics, "market_value_usd", row.usd);
      if (asset === "BTC") addMetric(group._metrics, "delta_btc", quantity);
      if (quantity !== null && quantity < 0) {
        group.has_negative_balance = true;
        group.negative_balances.push({ account: String(account.id), wallet: String(row.wallet || ""), quantity });
      }
      if (row.wallet) group._wallets.add(String(row.wallet));
      addAccount(group, String(account.id), names, quantity, asset, row.wallet);
    }
    const optionGroups = [...options.values()].map(finish).sort((a, b) => String(a.underlying).localeCompare(String(b.underlying))
      || String(a.expiry).localeCompare(String(b.expiry)) || (a.strike || 0) - (b.strike || 0) || a.side.localeCompare(b.side));
    const futureGroups = [...futures.values()].map(finish).sort((a, b) => a.instrument.localeCompare(b.instrument) || a.side.localeCompare(b.side));
    const spotGroups = [...assets.values()].map(finish).sort((a, b) => Math.abs(b.market_value_usd ?? 0) - Math.abs(a.market_value_usd ?? 0));
    const visible = spotGroups.filter((group) => group.market_value_usd !== null && Math.abs(group.market_value_usd) >= 10);
    const hidden = spotGroups.filter((group) => group.market_value_usd === null || Math.abs(group.market_value_usd) < 10);
    const complete = snapshot.quality === "complete" && snapshot.accounts.length === 5 && !snapshot.accounts.some((account) => /error|fail|stale|missing|partial/i.test(String(account.status || "")));
    return { status: "ready", complete, asof: snapshot.timestamp || null,
      options: { groups: optionGroups, totals: groupTotals(optionGroups) },
      futures: { groups: futureGroups, totals: groupTotals(futureGroups) },
      spot: { groups: visible, all_groups: spotGroups, totals: groupTotals(spotGroups), visible_totals: groupTotals(visible),
        hidden: { groups: hidden, asset_count: hidden.length, small_asset_count: hidden.filter((group) => group.market_value_usd !== null).length,
          unpriced_asset_count: hidden.filter((group) => group.market_value_usd === null).length, totals: groupTotals(hidden) },
        omitted_adjustments: omittedAdjustments }, unclassified_derivatives: unclassified };
  }

  function format(value, formatter = amountFormat) { return value === null ? "—" : formatter.format(value); }
  function displayMetric(group, key, formatter = amountFormat) {
    const label = format(group[key], formatter);
    return group.partial[key] ? `${label}<small>部分資料</small>` : label;
  }
  function sideLabel(side) { return side === "long" ? "做多" : side === "short" ? "做空" : "方向未確認"; }
  function valueClass(value) { return value !== null && value < 0 ? " holdings-negative" : ""; }
  function accountText(group) {
    return group.accounts.map((account) => `${account.name} ${account.quantity === null ? "數量待確認" : `${format(account.quantity)}${account.quantity_unit ? ` ${account.quantity_unit}` : ""}`}${account.missing_quantity ? "（部分）" : ""}`).map(escapeHtml).join(" · ");
  }
  function metric(label, group, key, formatter) {
    return `<div class="holdings-metric"><span>${escapeHtml(label)}</span><strong class="${valueClass(group[key])}">${displayMetric(group, key, formatter)}</strong></div>`;
  }
  function totalsLine(parts) { return `<div class="holdings-total">${parts.join("<span aria-hidden=\"true\"> · </span>")}</div>`; }
  function optionCard(group) {
    const title = group.parsed ? `${group.underlying} · ${group.expiry.replaceAll("-", "/")} · ${usdFormat.format(group.strike)} ${group.option_type === "C" ? "Call" : "Put"}` : group.instrument;
    return `<article class="holdings-card"><div class="holdings-card-heading"><strong>${escapeHtml(title)}</strong><span class="holdings-side ${group.side === "short" ? "is-short" : group.side === "long" ? "is-long" : "is-unknown"}">${sideLabel(group.side)}</span></div>
      <div class="holdings-metrics">${metric(`名義數量${group.quantity_unit ? ` · ${group.quantity_unit}` : ""}`, group, "quantity")}${metric("當前市值 · USD", group, "market_value_usd", usdFormat)}${metric("BTC Delta", group, "delta_btc", deltaFormat)}</div>
      <p class="holdings-accounts">${accountText(group)}</p></article>`;
  }
  function futureCard(group) {
    return `<article class="holdings-card"><div class="holdings-card-heading"><strong>${escapeHtml(group.instrument)}</strong><span class="holdings-side ${group.side === "short" ? "is-short" : group.side === "long" ? "is-long" : "is-unknown"}">${sideLabel(group.side)}</span></div>
      <div class="holdings-metrics">${metric(`名義數量${group.quantity_unit ? ` · ${group.quantity_unit}` : ""}`, group, "quantity")}${metric("美元名義", group, "notional_usd", usdFormat)}${metric("BTC Delta", group, "delta_btc", deltaFormat)}</div>
      <p class="holdings-accounts">${accountText(group)}</p></article>`;
  }
  function spotCard(group) {
    const holdingType = group.asset === "BTC" ? "現貨／抵押" : group.wallets.some((wallet) => /放貸|funding/i.test(wallet)) && group.asset === "USD" ? "現金／放貸" : ["USD", "USDC", "USDT", "USDG", "U"].includes(group.asset) ? "現金／錢包" : "錢包餘額";
    const negative = group.has_negative_balance ? '<span class="holdings-balance-note">含負餘額</span>' : "";
    return `<article class="holdings-card"><div class="holdings-card-heading"><strong>${escapeHtml(group.asset)}</strong><span class="holdings-holding-type">${holdingType}</span></div>
      <div class="holdings-metrics${group.asset === "BTC" ? "" : " is-two"}">${metric("實際數量", group, "quantity")}${metric("估值 · USD", group, "market_value_usd", usdFormat)}${group.asset === "BTC" ? metric("BTC Delta", group, "delta_btc", deltaFormat) : ""}</div>
      <p class="holdings-accounts">${accountText(group)}${negative}</p></article>`;
  }

  function render(snapshot) {
    const root = document.getElementById("holdingsSummary");
    if (!root) return;
    root.classList.add("holdings-summary");
    const data = aggregate(snapshot);
    if (data.status !== "ready") { root.innerHTML = `<div class="holdings-empty">${escapeHtml(data.reason)}</div>`; return; }
    const parsed = data.asof ? new Date(data.asof) : null;
    const asof = parsed && Number.isFinite(parsed.getTime()) ? `資料截止 ${dateFormat.format(parsed)}（新加坡時間）` : "資料截止時間待確認";
    const options = data.options, futures = data.futures, spot = data.spot;
    const optionTotals = totalsLine([`期權市值 <b>${displayMetric(options.totals, "market_value_usd", usdFormat)}</b>`, `BTC Delta <b>${displayMetric(options.totals, "delta_btc", deltaFormat)}</b>`, `BTC 名義 <b>${displayMetric(options.totals, "nominal_btc")} BTC</b>`]);
    const futureTotals = totalsLine([`合約美元名義 <b>${displayMetric(futures.totals, "notional_usd", usdFormat)}</b>`, `BTC Delta <b>${displayMetric(futures.totals, "delta_btc", deltaFormat)}</b>`]);
    const spotTotals = totalsLine([`已估值餘額合計 <b>${format(spot.totals.market_value_usd, usdFormat)}</b>`, `${spot.groups.length} 種主要資產`]);
    const omittedNote = spot.hidden.asset_count ? `<p class="holdings-note">另有 ${spot.hidden.asset_count} 種小額或未估值資產未逐項列出，仍包含於帳戶淨值；其中已估值 ${format(spot.hidden.totals.market_value_usd, usdFormat)}。${spot.hidden.groups.some((group) => group.has_negative_balance) ? "未逐項列出的資產中含負餘額。" : ""}</p>` : "";
    const incomplete = !data.complete ? '<p class="holdings-state">部分帳戶資料尚未完整，以下先列已知持倉，合計可能不完整。</p>' : "";
    const unknown = data.unclassified_derivatives.length ? `<p class="holdings-state">另有 ${data.unclassified_derivatives.length} 筆衍生品類型待確認，未列入分類合計。</p>` : "";
    root.innerHTML = `<div class="holdings-asof">${escapeHtml(asof)}</div>${incomplete}<div class="holdings-categories">
      <section class="holdings-category" aria-label="期權持倉"><div class="holdings-category-heading"><div><span class="holdings-category-index">01</span><h3>期權</h3></div><span>${options.groups.length} 組持倉</span></div><p class="holdings-category-caption">相同行權條件跨帳戶合併，多空分開列示。</p><div class="holdings-card-grid">${options.groups.length ? options.groups.map(optionCard).join("") : '<div class="holdings-empty">沒有未平倉期權。</div>'}</div>${optionTotals}</section>
      <section class="holdings-category" aria-label="合約持倉"><div class="holdings-category-heading"><div><span class="holdings-category-index">02</span><h3>合約</h3></div><span>${futures.groups.length} 組持倉</span></div><p class="holdings-category-caption">名義代表曝險，不加入資產淨值。</p><div class="holdings-card-grid">${futures.groups.length ? futures.groups.map(futureCard).join("") : '<div class="holdings-empty">沒有未平倉合約。</div>'}</div>${futureTotals}</section>
      <section class="holdings-category" aria-label="現貨及餘額"><div class="holdings-category-heading"><div><span class="holdings-category-index">03</span><h3>現貨</h3></div><span>${spot.groups.length} 種主要資產</span></div><p class="holdings-category-caption">含現貨、現金、抵押及放貸餘額；估值達 10 美元才逐項列出。</p><div class="holdings-card-grid">${spot.groups.length ? spot.groups.map(spotCard).join("") : '<div class="holdings-empty">沒有估值達 10 美元的餘額。</div>'}</div>${spotTotals}${omittedNote}</section>
      </div>${unknown}<p class="holdings-note holdings-final-note">期權市值及合約浮盈虧已計入各戶淨值。三類使用不同口徑，合約名義不可與期權市值、現貨估值相加。</p>`;
  }

  window.portfolioHoldings = Object.freeze({ render, aggregate });
})();
