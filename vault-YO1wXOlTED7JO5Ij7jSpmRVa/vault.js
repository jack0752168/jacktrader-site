(() => {
  "use strict";

  const FILENAME = "portfolio.enc.json";
  const AAD = new TextEncoder().encode("jacktrader-btc-portfolio-v1");
  const CACHE_MS = 150_000;
  let cached = null;
  let lastFetchAt = 0;
  let pending = null;

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

  async function fetchPayload() {
    if (cached && Date.now() - lastFetchAt < CACHE_MS) return cached;
    if (pending) return pending;
    pending = (async () => {
      const gistId = window.PORTFOLIO_CIPHERTEXT_GIST_ID;
      if (!/^[0-9a-f]{20,64}$/i.test(gistId || "")) {
        throw new Error("資料入口尚未完成設定");
      }
      const key = keyFromLink();
      const bucket = Math.floor(Date.now() / CACHE_MS);
      const url = `https://api.github.com/gists/${gistId}?v=${bucket}`;
      const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/vnd.github+json" } });
      if (!response.ok) throw new Error(`加密資料暫時無法取得（${response.status}）`);
      const gist = await response.json();
      const file = gist?.files?.[FILENAME];
      if (!file || file.truncated || typeof file.content !== "string") {
        throw new Error("加密快照不存在或超出 Gist API 大小限制");
      }
      let envelope;
      try {
        envelope = JSON.parse(file.content);
      } catch {
        throw new Error("加密快照格式無效");
      }
      const result = await decryptEnvelope(envelope, key);
      cached = result;
      lastFetchAt = Date.now();
      return result;
    })();
    try {
      return await pending;
    } finally {
      pending = null;
    }
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
    const payload = await fetchPayload();
    if (request.pathname === "/api/latest") {
      const latest = { ...payload.latest, remote: {} };
      if (latest.quality === "complete" && Date.now() - Date.parse(latest.timestamp) > 5 * 60_000) {
        latest.quality = "stale";
      }
      return latest;
    }
    if (request.pathname === "/api/history") {
      return { points: historyForRange(payload.history.points, request.searchParams.get("range") || "7d") };
    }
    throw new Error("未支援的資料路徑");
  }

  window.portfolioVault = { getJson, decryptEnvelope, keyFromLink };
})();
