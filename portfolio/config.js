// Ciphertext locator only. No decryption key or asset data.
window.PORTFOLIO_CIPHERTEXT_GIST_ID = 'd703432afb0f42755872ac1e3fdd9831';
/* PORTFOLIO_UPGRADE_START */
(() => {
  const current='20261114c';
  if(location.hostname!=='www.jacktrader.xyz'||document.querySelector('script[src*="vault-'+current+'.js"]'))return;
  const marker='portfolio-cache-upgrade-'+current;
  if(Date.now()-Number(sessionStorage.getItem(marker)||0)<300000)return;
  sessionStorage.setItem(marker,String(Date.now()));
  const url=new URL(location.href);
  url.searchParams.set('pv',current);
  location.replace(url.href);
})();
/* PORTFOLIO_UPGRADE_END */
