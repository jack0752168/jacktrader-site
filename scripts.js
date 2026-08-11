/* JackTrader site scripts: mobile nav, savings calculator, lang memory */
(function () {
  "use strict";

  // ---------- Mobile nav ----------
  var navToggle = document.querySelector(".nav-toggle");
  var siteNav = document.querySelector(".site-nav");
  if (navToggle && siteNav) {
    navToggle.addEventListener("click", function () {
      var open = siteNav.classList.toggle("open");
      navToggle.setAttribute("aria-expanded", String(open));
    });
    siteNav.addEventListener("click", function (e) {
      if (e.target.tagName === "A") {
        siteNav.classList.remove("open");
        navToggle.setAttribute("aria-expanded", "false");
      }
    });
  }

  // ---------- Net-fee / savings calculator ----------
  var input = document.getElementById("volumeInput");
  var slider = document.getElementById("volumeSlider");
  var savingsEl = document.getElementById("savingsAmount");
  var yearEl = document.getElementById("yearSavings");
  var grossEl = document.getElementById("grossRate");
  var netEl = document.getElementById("netRate");
  var card = document.getElementById("calcCard");

  if (input && slider && savingsEl && yearEl) {
    // fee tables (decimal) as [maker, taker] by exchange + market
    var FEES = {
      binance: { futures: [0.0002, 0.0005], spot: [0.001, 0.001] },
      okx: { futures: [0.0002, 0.0005], spot: [0.0008, 0.001] }
    };
    var META = {
      binance: { rebate: 0.4, link: "https://www.bsmkweb.cc/join?ref=MPZQWSDC", btn: "btn-binance" },
      okx: { rebate: 0.4, link: "https://www.promooboost.com/join/TRADERJACK", btn: "btn-okx" }
    };
    // share of volume executed as maker by trading style
    var MAKER_RATIO = { maker: 0.8, mixed: 0.5, taker: 0.2 };

    var current = "binance";
    var market = "futures";
    var style = "maker";
    var cta = document.getElementById("calcCta");

    function fmt(n) { return "$" + Math.round(n).toLocaleString("en-US"); }
    function pct(x) { return (x * 100).toFixed(3) + "%"; }

    function calc(vol) {
      var fees = FEES[current][market];
      var mr = MAKER_RATIO[style];
      var eff = mr * fees[0] + (1 - mr) * fees[1];
      var rebate = META[current].rebate;
      var monthly = vol * eff * rebate;
      savingsEl.textContent = fmt(monthly);
      yearEl.textContent = fmt(monthly * 12);
      if (grossEl) grossEl.textContent = pct(eff);
      if (netEl) netEl.textContent = pct(eff * (1 - rebate));
    }

    function readVol() {
      var raw = (input.value || "").replace(/[^0-9]/g, "");
      return parseInt(raw, 10) || 0;
    }

    slider.addEventListener("input", function () {
      var v = parseInt(slider.value, 10);
      input.value = v.toLocaleString("en-US");
      calc(v);
    });

    input.addEventListener("input", function () {
      var v = readVol();
      input.value = v.toLocaleString("en-US");
      slider.value = Math.min(Math.max(v, 0), parseInt(slider.max, 10));
      calc(v);
    });

    // exchange tabs
    var tabs = document.querySelectorAll(".calc-tab");
    Array.prototype.forEach.call(tabs, function (tab) {
      tab.addEventListener("click", function () {
        current = tab.getAttribute("data-ex");
        Array.prototype.forEach.call(tabs, function (t) { t.classList.remove("active"); });
        tab.classList.add("active");
        slider.classList.toggle("okx", current === "okx");
        if (card) card.classList.toggle("okx-active", current === "okx");
        if (cta) {
          var c = META[current];
          cta.setAttribute("href", c.link);
          cta.classList.remove("btn-binance", "btn-okx");
          cta.classList.add(c.btn);
        }
        calc(readVol());
      });
    });

    // segmented controls (market / style)
    var segs = document.querySelectorAll(".calc-seg");
    Array.prototype.forEach.call(segs, function (seg) {
      var group = seg.getAttribute("data-group");
      var btns = seg.querySelectorAll(".calc-seg-btn");
      Array.prototype.forEach.call(btns, function (btn) {
        btn.addEventListener("click", function () {
          var val = btn.getAttribute("data-val");
          if (group === "market") { market = val; }
          else if (group === "style") { style = val; }
          Array.prototype.forEach.call(btns, function (b) { b.classList.remove("active"); });
          btn.classList.add("active");
          calc(readVol());
        });
      });
    });

    calc(readVol());
  }

  // ---------- CTA conversion tracking (Vercel Web Analytics, cookieless) ----------
  // Fires a custom event when a visitor clicks a money CTA — the closest on-site
  // proxy for "this SEO visitor is converting". Read in Vercel → Analytics → Events.
  function track(name, data) {
    if (typeof window.va === "function") { window.va("event", { name: name, data: data }); }
    if (typeof window.gtag === "function") { window.gtag("event", name, data); }
  }
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    var href = a.getAttribute("href") || "";
    var page = location.pathname;
    // 换绑(rebind)链接也在 bsmkweb.cc 域下，必须先判它，否则会被计成普通注册
    if (href.indexOf("bind-ref") > -1) track("cta_rebind_binance", { page: page });
    else if (href.indexOf("bsmkweb.cc") > -1) track("cta_register_binance", { page: page });
    else if (href.indexOf("promooboost.com") > -1) track("cta_register_okx", { page: page });
    else if (href.indexOf("t.me/") > -1) track("cta_telegram", { page: page });
  }, true);
})();
