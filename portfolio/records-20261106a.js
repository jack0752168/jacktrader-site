(() => {
  'use strict';
  let selected = null;
  const money = new Intl.NumberFormat('en-US', {style:'currency', currency:'USD', maximumFractionDigits:2});
  const signed = new Intl.NumberFormat('en-US', {style:'currency', currency:'USD', maximumFractionDigits:2, signDisplay:'exceptZero'});
  const pct = new Intl.NumberFormat('en-US', {maximumFractionDigits:2, minimumFractionDigits:2, signDisplay:'exceptZero'});
  const btc = new Intl.NumberFormat('en-US', {maximumFractionDigits:6, minimumFractionDigits:4});
  const when = new Intl.DateTimeFormat('zh-TW', {timeZone:'Asia/Shanghai', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false});
  const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = v => typeof v === 'number' && Number.isFinite(v);
  const usd = v => num(v) ? money.format(v) : '—';
  const change = v => num(v) ? signed.format(v) : '—';
  const percent = v => num(v) ? pct.format(v*100)+'%' : '—';
  const tone = v => num(v) && v < 0 ? 'rec-down' : num(v) && v > 0 ? 'rec-up' : '';
  const time = v => v ? when.format(new Date(v)) : '—';

  function render(snapshot) {
    const el = document.getElementById('dailyRecords');
    if (!el) return;
    const data = snapshot?.daily_records;
    if (data?.status !== 'ok' || !data.rows?.length) {
      el.innerHTML = '<p class="rec-note">'+esc(data?.reason || '等待完整每日資金記錄；舊快照尚未包含本功能。')+'</p>';
      return;
    }
    const today = data.rows[0], dd = data.drawdown || {};
    if (!data.rows.some(r=>r.date===selected)) selected=today.date;
    const row=data.rows.find(r=>r.date===selected);
    const range=data.full_30_days ? '近 30 天' : '已記錄 '+data.window_days.toFixed(1)+' 天';
    const card=(label,value,note,cls='')=>`<div class="rec-stat"><span>${label}</span><strong class="${cls}">${value}</strong><small>${note}</small></div>`;
    const accounts = [...row.accounts].sort((a,b)=>(a.pnl_usd??Infinity)-(b.pnl_usd??Infinity));
    const scale=Math.max(1,...accounts.filter(a=>num(a.pnl_usd)).map(a=>Math.abs(a.pnl_usd)));
    const bars=accounts.map(a=>`<div class="rec-bar-row"><span>${esc(a.name)}</span><div class="rec-bar-track" aria-hidden="true"><i class="${tone(a.pnl_usd)}" style="width:${num(a.pnl_usd)?Math.abs(a.pnl_usd)/scale*100:0}%"></i></div><b class="${tone(a.pnl_usd)}">${change(a.pnl_usd)}</b></div>`).join('');
    const detail=accounts.map(a=>`<tr><th scope="row">${esc(a.name)}</th><td>${percent(a.return)}</td><td class="${tone(a.pnl_usd)}">${change(a.pnl_usd)}</td><td>${usd(a.usd)}</td></tr>`).join('');
    const days=data.rows.map(r=>`<tr class="${r.date===selected?'rec-selected':''}"><th scope="row"><button type="button" data-record-date="${esc(r.date)}" aria-pressed="${r.date===selected}">${esc(r.date)}${r===today?' · 今日':''}</button><small>${r.status==='partial'?'缺少 08:00 基準':r.status==='live'?'進行中':'已結算'}${r.interpolated?' · 基準估算':''}</small></th><td>${usd(r.total_usd)}<small>${num(r.total_btc)?btc.format(r.total_btc)+' BTC':'—'}</small></td><td class="${tone(r.pnl_usd)}">${change(r.pnl_usd)}<small>${percent(r.return)}</small></td><td class="${tone(r.pnl_btc)}">${num(r.pnl_btc)?(r.pnl_btc>0?'+':'')+btc.format(r.pnl_btc):'—'}</td><td>${change(r.net_flow_usd)}</td><td class="${tone(r.cumulative_pnl_usd)}">${change(r.cumulative_pnl_usd)}</td></tr>`).join('');
    el.innerHTML=`<div class="rec-stats">
      ${card('五戶總淨值',usd(snapshot.total_usd),'資料截止 '+esc(time(data.asof)))}
      ${card('今日盈虧',percent(today.return),change(today.pnl_usd)+' · 北京 08:00 起',tone(today.pnl_usd))}
      ${card(range+'最大回撤',percent(dd.percent),change(dd.usd)+' · 高點至其後低點',tone(dd.percent))}
      ${card(range+'收益曲線高點',usd(dd.high_usd),esc(time(dd.high_at))+' · 已校正本金')}
      </div><p class="rec-note">統計從 ${esc(time(data.window_start))} 至 ${esc(time(data.asof))}。${data.full_30_days?'':'歷史不足 30 天，未補造較早數據。'}最大回撤是期間高點到其後低點；目前距高點 ${percent(dd.current_drawdown_percent)}（${change(dd.current_drawdown_usd)}）。${data.snapshot_gap_count?'期間有 '+data.snapshot_gap_count+' 段採集缺口，回撤僅按已記錄快照估算。':''}</p>
      <h3>每日資金記錄</h3><p class="rec-note">每天北京時間 08:00 結算；點日期查看下方五戶明細。今日持續更新。</p>
      <div class="rec-scroll" tabindex="0" role="region" aria-label="每日資金記錄，可左右捲動"><table class="rec-table rec-daily"><thead><tr><th>日期</th><th>結算／目前淨值</th><th>當日盈虧 USD</th><th>盈虧 BTC</th><th>識別到的本金淨流入</th><th>自首筆記錄累計盈虧</th></tr></thead><tbody>${days}</tbody></table></div>
      <div class="rec-detail"><h3>${esc(row.date)}${row===today?' 今日':''} · 五戶盈虧</h3><p class="rec-note">截止 ${esc(time(row.asof))} · 按實際帳戶淨值變動扣除已識別本金，不把現有持倉倒推成過去損益。</p>
      <div class="rec-bars">${bars}</div><div class="rec-scroll" tabindex="0" role="region" aria-label="五戶每日盈虧明細"><table class="rec-table rec-accounts"><thead><tr><th>帳戶</th><th>當日盈虧率</th><th>盈虧 USD</th><th>實際淨值 USD</th></tr></thead><tbody>${detail}<tr class="rec-total"><th>五戶合計</th><td>${percent(row.return)}</td><td class="${tone(row.pnl_usd)}">${change(row.pnl_usd)}</td><td>${usd(row.total_usd)}</td></tr></tbody></table></div></div>
      <p class="rec-note">已排除識別到的入金、提現與五戶互轉本金，費用仍計入。OKX 現貨戶為人工基數，Bitfinex 尚無完整流水；未識別資金流仍可能影響結果。當日盈虧率＝校正本金後盈虧 ÷ 當日期初實際淨值，不是時間加權收益率。歷史從 ${esc(time(data.history_start))} 開始，首日不冒充完整一天。08:00 基準僅在前後 10 分鐘有完整快照時內插。高點與回撤屬校正本金的收益曲線，不能當作可提取餘額。</p>`;
    el.querySelectorAll('[data-record-date]').forEach(b=>b.addEventListener('click',()=>{selected=b.dataset.recordDate;render(snapshot);}));
  }
  window.portfolioRecords={render};
})();
