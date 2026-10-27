(function () {
  'use strict';
  var qa = new URLSearchParams(location.search).get('qa') === '1';
  function track(name, data) {
    if (!qa && typeof window.jtTrack === 'function') window.jtTrack(name, data || {});
  }
  document.querySelectorAll('[data-copy-ref]').forEach(function (button) {
    button.addEventListener('click', function () {
      var status = button.parentElement.querySelector('[role="status"]');
      navigator.clipboard.writeText('MPZQWSDC').then(function () {
        if (status) status.textContent = document.documentElement.lang === 'en' ? 'Copied MPZQWSDC' : '已複製 MPZQWSDC';
        track('referral_code_copy', {placement: button.dataset.copyRef});
      }).catch(function () {
        if (status) status.textContent = document.documentElement.lang === 'en' ? 'Select and copy MPZQWSDC above.' : '請選取上方 MPZQWSDC 複製。';
      });
    });
  });
  document.querySelectorAll('[data-late-check]').forEach(function (form) {
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var eligible = Array.from(form.querySelectorAll('input[type="checkbox"]')).every(function (input) { return input.checked; });
      var en = document.documentElement.lang === 'en';
      form.querySelector('[role="status"]').textContent = eligible
        ? (en ? 'Your answers match this initial checklist. Binance makes the final decision. Open its binding page, enter MPZQWSDC if asked, and review before confirming.' : '你的回答符合這份初步清單；最終由幣安審核。開啟官方綁定頁，按要求輸入 MPZQWSDC，確認前核對推薦人。')
        : (en ? 'This checklist does not establish eligibility. Check the other official routes below; do not close or duplicate an account.' : '目前無法依這份清單確認資格。請看下方其他官方路線，不要為換碼註銷或重複開戶。');
      track('referral_eligibility_check', {route: 'late_binding', outcome: eligible ? 'self_reported_match' : 'not_confirmed'});
    });
  });
  document.querySelectorAll('iframe[data-fee-tool]').forEach(function (frame) {
    if (qa) frame.src += (frame.src.indexOf('?') < 0 ? '?' : '&') + 'qa=1';
  });
  window.addEventListener('message', function (event) {
    if (event.origin !== location.origin || !event.data || event.data.type !== 'jt-fee-tool') return;
    var frame = Array.from(document.querySelectorAll('iframe[data-fee-tool]')).find(function (item) { return item.contentWindow === event.source; });
    if (!frame) return;
    if (Number.isFinite(event.data.height)) frame.style.height = Math.max(600, Math.min(1800, event.data.height)) + 'px';
    if (event.data.action === 'calculate') track('fee_calculator_used', {product: event.data.product === 'spot' ? 'spot' : 'custom'});
    if (event.data.action === 'register') track('cta_register_binance', {placement: 'fee_tool'});
    if (event.data.action === 'copy') track('referral_code_copy', {placement: 'fee_tool'});
  });
})();
