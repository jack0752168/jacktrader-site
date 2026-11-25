(()=>{'use strict';
const box=document.getElementById('etfReading');
const fmt=new Intl.NumberFormat('en-US',{maximumFractionDigits:0});
function render(snapshot){
 const m=snapshot?.market_indicators?.extra?.etf_30d;
 box.replaceChildren();
 if(!m||!Number.isFinite(m.value)||!Number.isFinite(m.asof)){
  box.textContent='來源讀數暫未取得；可點下方原圖查看。';return;
 }
 const date=new Date(m.asof).toISOString().slice(0,10);
 const title=document.createElement('h2');
 title.className=m.value>0?'positive':m.value<0?'negative':'';
 title.textContent=(m.value>0?'+':'')+fmt.format(m.value)+' BTC';
 const status=document.createElement('p');
 status.textContent=m.value>0?'30D 淨流入 · 零線上方':m.value<0?'30D 淨流出 · 零線下方':'30D 淨流量為零';
 const note=document.createElement('p');note.className='note';
 const delayed=Date.now()+(snapshot.delivery?.clockOffsetMs||0)-m.asof>3*86400000;
 note.textContent='資料日期：'+date+' UTC · Kalsama / BGeometrics · '+(m.status!=='ok'?'本輪讀取失敗，保留上次值':delayed?'來源日期較舊，尚未反映近期全部交易日':'每日資料，非即時行情')+'。單筆正值只代表目前為正；確認「由負翻正」須對照原圖前一筆。';
 box.append(title,status,note);
}
async function read(){try{render(await window.portfolioVault.getJson('/api/latest'));}catch{box.textContent='資料通道暫時不可用，請查看原圖。';}}
read();setInterval(()=>{if(!document.hidden)read();},15000);
document.getElementById('refreshMarket').addEventListener('click',()=>{setTimeout(read,1500);setTimeout(read,35000);});
})();
