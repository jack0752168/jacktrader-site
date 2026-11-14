(() => {
  'use strict';
  const CURRENT='20261114f';
  window.PORTFOLIO_CLIENT_VERSION=CURRENT;
  const clean=new URL(location.href);
  if(clean.searchParams.has('pv')) {
    clean.searchParams.delete('pv');
    history.replaceState(null,'',clean.pathname+clean.search+clean.hash);
  }
  let checking=false;
  async function check() {
    if(checking||document.hidden||document.querySelector('#refreshButton')?.getAttribute('aria-busy')==='true')return;
    checking=true;
    try {
      const r=await fetch('./release.json?t='+Date.now(),{cache:'no-store'});
      if(!r.ok)return;
      const release=await r.json();
      if(!/^[0-9a-z]{6,24}$/.test(release.version)||release.version<=CURRENT)return;
      const marker='portfolio-upgrade-'+release.version;
      if(Date.now()-Number(sessionStorage.getItem(marker)||0)<300000)return;
      sessionStorage.setItem(marker,String(Date.now()));
      const url=new URL(location.href);url.searchParams.set('pv',release.version);
      location.replace(url.href);
    } catch {}
    finally {checking=false;}
  }
  setInterval(check,60000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)check()});
  window.addEventListener('pageshow',e=>{if(e.persisted)check()});
  check();
})();
