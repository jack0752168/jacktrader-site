'use strict';
(async()=>{
 const isLocal=['127.0.0.1','localhost'].includes(location.hostname);
 const isWatch=Boolean(document.getElementById('position-desk'));
 const main=document.querySelector('main');if(!main)return;
 const nav=document.createElement('nav');nav.className='private-workspace-nav';nav.setAttribute('aria-label','私人工作台導航');
 const account=document.createElement('a'),watch=document.createElement('a');account.textContent='帳戶匯總';watch.textContent='實盤觀察';
 for(const link of [account,watch])link.referrerPolicy='no-referrer';
 (isWatch?watch:account).className='current';nav.append(account,watch);main.prepend(nav);
 if(isLocal){account.href='http://127.0.0.1:8765/';watch.href='http://127.0.0.1:8792/';return;}
 const keyPart=new URLSearchParams(location.hash.slice(1)).get('k');
 if(!keyPart){nav.setAttribute('aria-label','請從原私人書籤開啟');return;}
 try{
  let encoded=keyPart.replace(/-/g,'+').replace(/_/g,'/');while(encoded.length%4)encoded+='=';
  const key=await crypto.subtle.importKey('raw',Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)),'AES-GCM',false,['decrypt']);
  const seed=document.getElementById('workspaceNavigation');
  let envelope;if(seed){envelope=JSON.parse(seed.textContent);}else{const r=await fetch('./navigation.enc.json',{cache:'no-store'});if(!r.ok)throw Error('navigation unavailable');envelope=await r.json();}
  const iv=Uint8Array.from(atob(envelope.iv),c=>c.charCodeAt(0)),data=Uint8Array.from(atob(envelope.data),c=>c.charCodeAt(0));
  const decoded=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('jacktrader-navigation-v1')},key,data);
  const links=JSON.parse(new TextDecoder().decode(decoded));
  // Preserve a return route only for a session opened from the private account page.
  const returnName='jack-private-workspace-return',aad=new TextEncoder().encode('jacktrader-navigation-v1');
  if(!isWatch){
   const targetPart=new URLSearchParams(new URL(links.watch).hash.slice(1)).get('k');
   let t=targetPart.replace(/-/g,'+').replace(/_/g,'/');while(t.length%4)t+='=';
   const targetKey=await crypto.subtle.importKey('raw',Uint8Array.from(atob(t),c=>c.charCodeAt(0)),'AES-GCM',false,['encrypt']);
   const nonce=crypto.getRandomValues(new Uint8Array(12));
   const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce,additionalData:aad},targetKey,new TextEncoder().encode(links.portfolio)));
   const savedReturn=JSON.stringify({iv:btoa(String.fromCharCode(...nonce)),data:btoa(String.fromCharCode(...cipher))});
   try{sessionStorage.setItem(returnName,savedReturn);}catch(storageError){sessionStorage.removeItem('smart-cipher');try{sessionStorage.setItem(returnName,savedReturn);}catch(ignore){}}
  }else{
   let previous=null;try{previous=sessionStorage.getItem(returnName);}catch(ignore){}
   if(previous){const saved=JSON.parse(previous);const bytes=Uint8Array.from(atob(saved.data),c=>c.charCodeAt(0));const nonce=Uint8Array.from(atob(saved.iv),c=>c.charCodeAt(0));links.portfolio=new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:nonce,additionalData:aad},key,bytes));}
  }

  for(const [link,value] of [[account,links.portfolio],[watch,links.watch]]){
   const url=new URL(value);if(url.origin!==location.origin)throw Error('unexpected navigation origin');link.href=url.href;
  }
 }catch(e){nav.dataset.navigationError=e.name+': '+e.message;const note=document.createElement('small');note.textContent='導航暫未連線，重新整理後重試';nav.append(note);}
})();
