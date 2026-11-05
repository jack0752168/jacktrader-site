(() => {
  "use strict";

  const state = { snapshot: null, model: null, root: null };
  const boundRoots = new WeakSet();
  const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const signedUsd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0, signDisplay: "exceptZero" });
  const dateFormat = new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Singapore", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

  const finite = (value) => typeof value === "number" && Number.isFinite(value);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const signClass = (value) => value < -0.005 ? "scenario-down" : value > 0.005 ? "scenario-up" : "";

  // Normal CDF approximation; maximum absolute error is below 7.5e-8.
  function normalCdf(value) {
    if (value <= -10) return 0;
    if (value >= 10) return 1;
    const x = Math.abs(value);
    const t = 1 / (1 + 0.2316419 * x);
    const polynomial = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    const upper = 0.3989422804014327 * Math.exp(-0.5 * x * x) * polynomial;
    return value >= 0 ? 1 - upper : upper;
  }

  function optionBtcPrice(target, option) {
    const forward = target * option.forward_spot_ratio;
    const strikeRatio = option.strike / forward;
    const put = option.option_type === "P";
    const sigmaRootTime = option.volatility * Math.sqrt(option.years_to_expiry);
    if (sigmaRootTime <= 0) return put ? Math.max(strikeRatio - 1, 0) : Math.max(1 - strikeRatio, 0);
    const d1 = (Math.log(forward / option.strike) + 0.5 * sigmaRootTime * sigmaRootTime) / sigmaRootTime;
    const d2 = d1 - sigmaRootTime;
    const value = put
      ? strikeRatio * normalCdf(-d2) - normalCdf(-d1)
      : normalCdf(d1) - strikeRatio * normalCdf(d2);
    return Math.max(0, value);
  }

  function calculate(model, target) {
    if (!finite(target) || target < 1000 || target > 1000000) {
      throw new RangeError("請輸入 1,000～1,000,000 美元之間的有效 BTC 價格。");
    }
    if (!model || model.status !== "ready") throw new Error("目前沒有完整的情境估值資料。");
    if (!finite(model.spot_usd) || model.spot_usd <= 0 || !finite(model.current_usd)
      || !Array.isArray(model.accounts) || !model.accounts.length || !Array.isArray(model.options)) {
      throw new Error("情境資料不完整，暫時無法估算。");
    }
    const accounts = model.accounts.map((account) => {
      if (!account || typeof account.id !== "string" || !account.id || !finite(account.usd)
        || !finite(account.spot_btc) || !finite(account.linear_delta_btc)) throw new Error("帳戶估值資料不完整。");
      return { id: account.id, name: String(account.name || account.id), current_usd: account.usd,
        estimated_usd: account.usd + (account.spot_btc + account.linear_delta_btc) * (target - model.spot_usd) };
    });
    const byId = new Map(accounts.map((account) => [account.id, account]));
    if (byId.size !== accounts.length) throw new Error("情境帳戶資料重複，暫時無法估算。");
    const currentSum = accounts.reduce((sum, account) => sum + account.current_usd, 0);
    if (Math.abs(currentSum - model.current_usd) > 0.10) throw new Error("帳戶合計尚未對上目前淨值，暫時無法估算。");
    const unchanged = target === model.spot_usd;
    for (const option of model.options) {
      if (!option || !byId.has(option.account) || !finite(option.quantity) || !finite(option.strike) || option.strike <= 0
        || !finite(option.volatility) || option.volatility < 0 || !finite(option.forward_spot_ratio) || option.forward_spot_ratio <= 0
        || !finite(option.years_to_expiry) || option.years_to_expiry < 0 || !finite(option.mark_calibration) || option.mark_calibration <= 0
        || !finite(option.current_value_usd) || !["C", "P"].includes(option.option_type)) {
        throw new Error("期權重估資料不完整，暫時無法估算。");
      }
      const projected = unchanged ? option.current_value_usd
        : option.quantity * optionBtcPrice(target, option) * option.mark_calibration * target;
      if (!Number.isFinite(projected)) throw new Error("目標價格無法完成期權重估。");
      byId.get(option.account).estimated_usd += projected - option.current_value_usd;
    }
    for (const account of accounts) account.change_usd = account.estimated_usd - account.current_usd;
    // Keep the cents-level reconciliation residual, without treating it as a holding.
    const total = unchanged ? model.current_usd
      : accounts.reduce((sum, account) => sum + account.estimated_usd, 0) + model.current_usd - currentSum;
    return { target_usd: target, current_usd: model.current_usd, total_usd: total,
      estimated_usd: total, change_usd: total - model.current_usd, accounts };
  }

  function rootElement() {
    const root = document.getElementById("btcScenarioPanel");
    if (!root) return null;
    state.root = root;
    if (!boundRoots.has(root)) {
      boundRoots.add(root);
      const form = root.querySelector("#btcScenarioForm");
      const input = root.querySelector("#btcScenarioTarget");
      form?.addEventListener("submit", (event) => { event.preventDefault(); updateResult(); });
      input?.addEventListener("input", updateResult);
      root.querySelectorAll("[data-scenario-target]").forEach((button) => {
        button.addEventListener("click", () => {
          if (!input) return;
          const raw = button.dataset.scenarioTarget;
          input.value = raw === "current" ? String(state.model?.spot_usd ?? "") : raw;
          updateResult();
        });
      });
    }
    return root;
  }

  function updateResult() {
    const root = rootElement();
    if (!root) return;
    const input = root.querySelector("#btcScenarioTarget");
    const output = root.querySelector("#btcScenarioResult");
    const error = root.querySelector("#btcScenarioError");
    const currentButton = root.querySelector('[data-scenario-target="current"]');
    if (!input || !output || !error) return;
    const target = input.value.trim() === "" ? NaN : Number(input.value);
    const model = state.model;
    if (currentButton) currentButton.disabled = !model || model.status !== "ready" || !finite(model.spot_usd);
    root.querySelectorAll("[data-scenario-target]").forEach((button) => {
      const value = button.dataset.scenarioTarget === "current" ? model?.spot_usd : Number(button.dataset.scenarioTarget);
      button.setAttribute("aria-pressed", String(finite(target) && value === target));
    });
    error.hidden = true;
    error.textContent = "";
    input.removeAttribute("aria-invalid");
    if (!model || model.status !== "ready") {
      const reason = typeof model?.reason === "string" && model.reason.trim() ? model.reason : "尚未取得完整的期權重估資料，請等待下一筆完整快照。";
      output.innerHTML = `<div class="scenario-unavailable">情境估算暫時不可用。${escapeHtml(reason)}</div>`;
      return;
    }
    try {
      const result = calculate(model, target);
      const change = result.change_usd;
      const percent = model.current_usd > 0 ? `${change > 0 ? "+" : ""}${(change / model.current_usd * 100).toFixed(2)}%` : "—";
      const warning = result.accounts.some((account) => account.estimated_usd < 0)
        ? '<p class="scenario-warning" role="status">部分帳戶模型淨值低於零，可能先觸發強平；此數不代表能持有到目標價。</p>' : "";
      const rows = result.accounts.map((account) => `<tr><td>${escapeHtml(account.name)}</td><td data-label="目前">${usd.format(account.current_usd)}</td><td data-label="估算">${usd.format(account.estimated_usd)}</td><td data-label="差額" class="${signClass(account.change_usd)}">${signedUsd.format(account.change_usd)}</td></tr>`).join("");
      output.innerHTML = `<div class="scenario-headline"><div class="scenario-stat"><span>BTC 到 ${usd.format(target)} 時 · 五戶淨值</span><strong>${usd.format(result.total_usd)}</strong><small>目前五戶淨值 ${usd.format(model.current_usd)}</small></div><div class="scenario-stat"><span>相對目前的美元差額</span><strong class="${signClass(change)}">${signedUsd.format(change)}</strong><small>約 ${percent} · 按目前持倉估算</small></div></div>${warning}<table class="scenario-account-table"><thead><tr><th>帳戶</th><th>目前 USD</th><th>估算 USD</th><th>差額 USD</th></tr></thead><tbody>${rows}</tbody></table><p class="scenario-table-note">金額四捨五入至美元，逐戶相加可能有個位數尾差。</p>`;
    } catch (failure) {
      error.textContent = failure instanceof Error ? failure.message : "目前無法計算此情境。";
      error.hidden = false;
      input.setAttribute("aria-invalid", "true");
      output.innerHTML = '<div class="scenario-unavailable">請修正輸入或等待完整資料後重新估算。</div>';
    }
  }

  function render(snapshot) {
    state.snapshot = snapshot || null;
    state.model = snapshot?.scenario || null;
    const root = rootElement();
    if (!root) return;
    const caption = root.querySelector("#btcScenarioAsOf");
    if (caption) {
      const at = state.model?.asof || snapshot?.timestamp;
      const parsed = at ? new Date(at) : null;
      const stamp = parsed && Number.isFinite(parsed.getTime()) ? `${dateFormat.format(parsed)}（新加坡時間）` : "尚無資料截止時間";
      const spot = finite(state.model?.spot_usd) ? usd.format(state.model.spot_usd) : "—";
      caption.textContent = `資料截止 ${stamp} · 目前 BTC ${spot}`;
    }
    updateResult();
  }

  window.portfolioScenario = Object.freeze({ render, calculate });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => render(state.snapshot), { once: true });
  else render(state.snapshot);
})();
