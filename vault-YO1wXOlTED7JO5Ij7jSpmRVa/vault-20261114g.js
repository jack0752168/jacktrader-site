(() => {
  "use strict";

  const FILENAME = "portfolio.enc.json";
  const AAD = new TextEncoder().encode("jacktrader-btc-portfolio-v1");
  const CACHE_MS = 5_000;
  const STORAGE_KEY = "portfolio-last-encrypted-snapshot-v1";
  let cached = null;
  let lastFetchAt = 0;
  let pending = null;

  function saveEnvelope(envelope, publishedAt) {
    const encoded = JSON.stringify({ envelope, publishedAt });
    try { sessionStorage.setItem(STORAGE_KEY, encoded); } catch {}
    try { localStorage.setItem(STORAGE_KEY, encoded); } catch {}
  }

  async function getLocalSnapshot() {
    const key = keyFromLink();
    const candidates = [];
    for (const storage of [typeof sessionStorage === "undefined" ? null : sessionStorage,
                            typeof localStorage === "undefined" ? null : localStorage]) {
      try { const v = JSON.parse(storage?.getItem(STORAGE_KEY) || "null"); if (v?.envelope) candidates.push(v); } catch {}
    }
    try { const v = JSON.parse(document.getElementById("portfolioSeed")?.textContent || "null"); if (v?.envelope) candidates.push(v); } catch {}
    let best = null;
    for (const saved of candidates) {
      try {
        const payload = await decryptEnvelope(saved.envelope, key);
        if (!best || Date.parse(payload.latest.timestamp) > Date.parse(best.latest.timestamp)) best = payload;
      } catch {}
    }
    if (best) {
      best.delivery = { mode: "cached", publishedAt: best.latest.timestamp };
      cached = best;
      // An embedded/local snapshot is displayable, never proof of a network update.
      lastFetchAt = 0;
    }
    return best;
  }

  async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const bytes = await response.arrayBuffer();
      return new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
    }
    finally { clearTimeout(timer); }
  }

  function fromBase64Url(value) {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("加密資料格式無效");
    const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  }

  function keyFromLink() {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const encoded = fragment.get("k") || "";
    if (!/^[A-Za-z0-9_-]{43}$/.test(encoded)) {
      throw new Error("私人連結缺少解密金鑰，請從原始 iMessage 連結開啟");
    }
    const raw = fromBase64Url(encoded);
    if (raw.length !== 32) throw new Error("私人連結的金鑰長度不正確");
    return raw;
  }

  async function decryptEnvelope(envelope, rawKey) {
    if (!envelope || envelope.v !== 1 || envelope.alg !== "A256GCM") {
      throw new Error("加密資料版本不支援");
    }
    const iv = fromBase64Url(envelope.iv || "");
    const data = fromBase64Url(envelope.data || "");
    if (iv.length !== 12 || data.length < 17) throw new Error("加密資料損壞");
    let plaintext;
    try {
      const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["decrypt"]);
      plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: AAD }, key, data);
    } catch {
      throw new Error("無法解密：連結金鑰不正確或資料已損壞");
    }
    if (envelope.zip === "gzip") {
      if (typeof DecompressionStream !== "function") throw new Error("請更新瀏覽器以讀取壓縮快照");
      plaintext = await new Response(new Response(plaintext).body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
    }
    let payload;
    try {
      payload = JSON.parse(new TextDecoder().decode(plaintext));
    } catch {
      throw new Error("解密後資料格式無效");
    }
    if (!payload || !payload.latest || !Array.isArray(payload.history?.points)) {
      throw new Error("解密後快照不完整");
    }
    return payload;
  }

  const RELAY = 'https://www.jacktrader.xyz/_portfolio-data';
  const RELAY_BACKUP = 'https://portfolio-data.jacktrader.xyz';
  let relayBase = RELAY;
  let backupSince = 0;
  const toHex = bytes => [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
  async function relayRequest(path, rawKey) {
    if(relayBase===RELAY_BACKUP&&Date.now()-backupSince>60_000)relayBase=RELAY;
    const label = new TextEncoder().encode('portfolio-cloud-relay-viewer-v1\x00');
    const input = new Uint8Array(label.length + rawKey.length);
    input.set(label); input.set(rawKey,label.length);
    const seed = new Uint8Array(await crypto.subtle.digest('SHA-256',input));
    const prefix = Uint8Array.from('302e020100300506032b657004220420'.match(/../g), x=>parseInt(x,16));
    const pkcs8 = new Uint8Array(prefix.length+seed.length); pkcs8.set(prefix);pkcs8.set(seed,prefix.length);
    const signer = await crypto.subtle.importKey('pkcs8',pkcs8,'Ed25519',false,['sign']);
    const ts=Math.floor(Date.now()/1000), nonce=toHex(crypto.getRandomValues(new Uint8Array(16))), data='{}';
    const digest=toHex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(data)));
    const sig=new Uint8Array(await crypto.subtle.sign('Ed25519',signer,new TextEncoder().encode(`${path}:${ts}:${nonce}:${digest}`)));
    const signature=btoa(String.fromCharCode(...sig)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    const options={method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({ts,nonce,data,signature})};
    let response;
    try { response=await fetchWithTimeout(relayBase+path,options,10_000); }
    catch(first) {
      if(relayBase!==RELAY)throw first;
      relayBase=RELAY_BACKUP;
      backupSince=Date.now();
      // A timeout has an unknown outcome. A fresh signed request safely joins
      // the existing durable refresh job instead of replaying its nonce.
      return relayRequest(path,rawKey);
    }
    if(!response.ok)throw new Error(response.status===503?'採集端離線或暫時無法更新；保留原資料截止':`雲端更新未完成（${response.status}）`);
    return response.json();
  }

  async function fetchRelay(rawKey, collect) {
    let packet, completed=false, error='';
    if(collect) {
      try {
        const request=await relayRequest('/refresh',rawKey);
        const deadline=Date.now()+90_000;
        while(Date.now()<deadline) {
          packet=await relayRequest('/snapshot',rawKey);
          if(packet.completed_job===request.job){completed=true;break;}
          await new Promise(resolve=>setTimeout(resolve,2500));
        }
        if(!completed)error='採集逾時；保留原資料截止';
      } catch(e) {error=e.message;}
    }
    packet ||= await relayRequest('/snapshot',rawKey);
    const result=await decryptEnvelope(packet.envelope,rawKey);
    if(cached&&Date.parse(cached.latest.timestamp)>Date.parse(result.latest.timestamp))throw new Error('雲端快照尚未追上已讀資料；保留較新快照');
    const age=Date.now()-Date.parse(result.latest.timestamp);
    if(packet.agent_age_ms>90_000||age>120_000||error)result.latest.quality='stale';
    if(packet.agent_age_ms>90_000)error='Mac mini 採集端離線；顯示雲端保存的最後資料';
    result.latest.direct_url=RELAY;
    result.delivery={mode:'direct',collected:collect&&completed&&result.latest.quality==='complete',publishedAt:result.latest.timestamp,checkedAt:new Date().toISOString(),directError:error||null,transport:'cloud-relay',agentAgeMs:packet.agent_age_ms};
    saveEnvelope(packet.envelope,result.latest.timestamp);
    cached=result;lastFetchAt=Date.now();
    return result;
  }

  async function fetchDirect(baseUrl, rawKey, collect = true) {
    if(baseUrl===RELAY)return fetchRelay(rawKey,collect);
    if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(baseUrl)) throw new Error("即時通道網址無效");
    const action = collect ? "refresh" : "snapshot";
    const ts = Math.floor(Date.now() / 1000);
    const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const hmacKey = await crypto.subtle.importKey("raw", rawKey, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signed = await crypto.subtle.sign("HMAC", hmacKey, new TextEncoder().encode(`${action}:${ts}:${nonce}`));
    const signature = [...new Uint8Array(signed)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    let response;
    try {
      response = await fetchWithTimeout(`${baseUrl}/${action}`, {
        method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ts, nonce, signature }),
      }, collect ? 70_000 : 15_000);
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("即時採集逾時；資料截止未更新");
      throw new Error("即時通道連接失敗（網路或 DNS）；資料截止未更新");
    }
    if (!response.ok) throw new Error(`即時採集未完成（${response.status}）`);
    const body = await response.json();
    const result = await decryptEnvelope(body.envelope, rawKey);
    result.latest.direct_url = baseUrl;
    result.delivery = { mode: "direct", collected: collect && result.latest.quality === "complete", publishedAt: result.latest.timestamp };
    saveEnvelope(body.envelope, result.latest.timestamp);
    cached = result;
    lastFetchAt = Date.now();
    return result;
  }

  async function fetchPayload(forceRefresh = false, forceCollect = false) {
    if (pending) return pending;
    if (!forceRefresh && cached && Date.now() - lastFetchAt < CACHE_MS) return cached;
    pending = (async () => {
      const gistId = window.PORTFOLIO_CIPHERTEXT_GIST_ID;
      if (!/^[0-9a-f]{20,64}$/i.test(gistId || "")) throw new Error("資料入口尚未完成設定");
      const key = keyFromLink();
      const retained = cached;
      let directError = "";
      // Stable cloud transport first: no tunnel discovery or Gist dependency.
      try { return await fetchRelay(key,forceCollect); }
      catch(error) { directError=error?.message||'雲端連線暫時不可用'; }
      let registry = null;
      let registryRead = false;
      const attempted = new Set();
      let bootstrap = null;
      try {
        const seed = JSON.parse(document.getElementById("portfolioSeed")?.textContent || "null");
        if (seed?.envelope) bootstrap = await decryptEnvelope(seed.envelope, key);
      } catch {}
      async function readRegistry() {
        if (registryRead) return registry;
        registryRead = true;
        try {
          const bucket = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
          const response = await fetchWithTimeout(`https://api.github.com/gists/${gistId}?v=${bucket}`, {
            cache: "no-store", headers: { Accept: "application/vnd.github+json" },
          }, 7_000);
          if (!response.ok) throw new Error("密文入口暫時不可用");
          const gist = await response.json();
          const file = gist?.files?.[FILENAME];
          if (!file || file.truncated || typeof file.content !== "string") throw new Error("密文入口格式錯誤");
          const envelope = JSON.parse(file.content);
          registry = { payload: await decryptEnvelope(envelope, key), envelope, mode: "live", publishedAt: gist.updated_at || null };
        } catch {
          try {
            const response = await fetchWithTimeout(`https://gist.githubusercontent.com/jack0752168/${gistId}/raw/${FILENAME}?v=${Date.now()}`, { cache: "no-store" }, 3_000);
            if (!response.ok) throw new Error("備用密文暫時不可用");
            const envelope = await response.json();
            registry = { payload: await decryptEnvelope(envelope, key), envelope, mode: "raw", publishedAt: null };
          } catch {}
        }
        return registry;
      }
      async function tryDirect(candidates) {
        const ordered = candidates.filter(Boolean).sort((a, b) => Date.parse(b.latest?.timestamp || 0) - Date.parse(a.latest?.timestamp || 0));
        for (const candidate of ordered) {
          const url = candidate.latest?.direct_url;
          if (!url || attempted.has(url)) continue;
          attempted.add(url);
          try { return await fetchDirect(url, key, forceCollect); }
          catch (error) { directError = error?.message || "即時通道不可用"; }
        }
        return null;
      }
      // On every fresh page session, discover the current encrypted routing
      // pointer first. Old HTML seeds can reference a tunnel that died days ago.
      if (lastFetchAt === 0) await readRegistry();
      let direct = await tryDirect([registry?.payload, retained, bootstrap]);
      if (direct) return direct;
      await readRegistry();
      direct = await tryDirect([registry?.payload]);
      if (direct) return direct;
      // A fallback is displayable, never a successful on-demand collection.
      // Never replace newer retained equity/history with an older Gist backup.
      let result = registry?.payload || retained || bootstrap;
      let keepRetained = false;
      if (retained && (!result || Date.parse(retained.latest.timestamp) > Date.parse(result.latest.timestamp))) {
        result = retained;
        keepRetained = true;
      }
      if (!result) throw new Error(directError || "暫時無法讀取資料，請稍後重試");
      result.delivery = {
        mode: keepRetained || !registry ? "cached" : registry.mode,
        publishedAt: keepRetained || !registry ? result.latest.timestamp : registry.publishedAt,
        directError: directError || "即時通道尚未就緒",
        collected: false,
      };
      if (registry && !keepRetained) saveEnvelope(registry.envelope, registry.publishedAt);
      cached = result;
      lastFetchAt = Date.now();
      return result;
    })();
    try { return await pending; }
    finally { pending = null; }
  }

  function historyForRange(points, range) {
    const seconds = { "1h": 3600, "24h": 86400, "7d": 604800, "30d": 2592000, "90d": 7776000 }[range];
    if (range === "all") return points;
    if (!seconds) throw new Error("曲線時間區間無效");
    const cutoff = Date.now() - seconds * 1000;
    return points.filter((point) => Date.parse(point.timestamp) >= cutoff);
  }

  async function getJson(path, options) {
    if (options?.method && options.method.toUpperCase() !== "GET") {
      throw new Error("此私人連結為唯讀；請在 Mac 本機頁修改現貨數量");
    }
    const request = new URL(path, window.location.origin);
    const payload = await fetchPayload(Boolean(options?.forceRefresh), Boolean(options?.forceCollect));
    if (request.pathname === "/api/latest") {
      const latest = { ...payload.latest, remote: {}, delivery: payload.delivery || {} };
      if ((payload.delivery?.mode && payload.delivery.mode !== "direct") || (latest.quality === "complete" && Date.now() - Date.parse(latest.timestamp) > 90_000)) {
        latest.quality = "stale";
      }
      return latest;
    }
    if (request.pathname === "/api/history") {
      return { points: historyForRange(payload.history.points, request.searchParams.get("range") || "7d") };
    }
    throw new Error("未支援的資料路徑");
  }

  window.portfolioVault = { getJson, decryptEnvelope, keyFromLink, getLocalSnapshot };
})();
