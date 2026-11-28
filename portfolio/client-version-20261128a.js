(() => {
  'use strict';
  const CURRENT='20261128a';
  window.PORTFOLIO_CLIENT_VERSION=CURRENT;
  const clean=new URL(location.href);
  if(clean.searchParams.has('pv')||clean.searchParams.has('rt')) {
    clean.searchParams.delete('pv');clean.searchParams.delete('rt');
    history.replaceState(null,'',clean.pathname+clean.search+clean.hash);
  }
  let checking=false,visibleSince=Date.now();
  function stored(key){try{return Number(sessionStorage.getItem(key)||0)}catch{return 0}}
  function remember(key){try{sessionStorage.setItem(key,String(Date.now()))}catch{}}
  function navigate(version,repair=false){
    const marker=(repair?'portfolio-repair-':'portfolio-upgrade-')+version;
    if(Date.now()-stored(marker)<300000)return;
    remember(marker);const url=new URL(location.href);url.searchParams.set('pv',version);
    if(repair)url.searchParams.set('rt',String(Date.now()));
    location.replace(url.href);
  }
  async function check(){
    if(checking||document.hidden)return;
    checking=true;const controller=new AbortController();let timer;
    try{
      const work=(async()=>{const r=await fetch('./release.json?t='+Date.now(),{cache:'no-store',signal:controller.signal});if(!r.ok)return null;return r.json()})();
      const release=await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('release timeout'))},5000)})]);
      if(release&&/^[0-9a-z]{6,24}$/.test(release.version)&&release.version>CURRENT)navigate(release.version);
    }catch{}finally{clearTimeout(timer);checking=false;}
  }
  function watchdog(){
    if(document.hidden)return;
    const cutoff=Date.parse(document.documentElement.dataset.portfolioCutoff||'');
    if(Number.isFinite(cutoff)&&Date.now()+Number(document.documentElement.dataset.portfolioClockOffset||0)-cutoff>180000&&Date.now()-visibleSince>125000){
      window.portfolioVault?.reconnect?.();navigate(CURRENT,true);
    }
  }
  setInterval(check,60000);setInterval(watchdog,15000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){visibleSince=Date.now();check()}});
  window.addEventListener('pageshow',()=>{visibleSince=Date.now();check()});
  check();
})();
