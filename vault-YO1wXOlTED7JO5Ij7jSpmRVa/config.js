// Ciphertext locator only. No decryption key or asset data.
window.PORTFOLIO_CIPHERTEXT_GIST_ID = 'd703432afb0f42755872ac1e3fdd9831';
/* PORTFOLIO_UPGRADE_START */
(() => {
  const current='20261114g';
  const active=Array.from(document.scripts).map(s=>(s.src.match(/vault-(\d{8}[a-z]+)\.js/)||[])[1]).filter(Boolean).sort().at(-1);
  if(location.hostname!=='www.jacktrader.xyz'||(active&&active>=current))return;
  const marker='portfolio-cache-upgrade-'+current;
  if(Date.now()-Number(sessionStorage.getItem(marker)||0)<300000)return;
  sessionStorage.setItem(marker,String(Date.now()));
  const url=new URL(location.href);
  url.searchParams.set('pv',current);
  location.replace(url.href);
})();
/* PORTFOLIO_UPGRADE_END */
