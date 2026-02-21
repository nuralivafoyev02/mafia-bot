const crypto = require("crypto");

function parseQueryString(qs) {
  const out = {};
  for (const part of qs.split("&")) {
    const [k, v] = part.split("=");
    if (!k) continue;
    out[decodeURIComponent(k)] = decodeURIComponent(v || "");
  }
  return out;
}

function buildDataCheckString(data) {
  // hash ni olib tashlab, qolganlarini alfavit bo‘yicha sort qilib "k=v" ko‘rinishida "\n" bilan join
  const pairs = Object.keys(data)
    .filter((k) => k !== "hash")
    .sort()
    .map((k) => `${k}=${data[k]}`);
  return pairs.join("\n");
}

function hmacSha256(key, msg) {
  return crypto.createHmac("sha256", key).update(msg).digest();
}

function validateInitData(initDataRaw, botToken, maxAgeSec = 24 * 60 * 60) {
  if (!initDataRaw) return { ok: false, reason: "no_initData" };

  const data = parseQueryString(initDataRaw);
  const hash = data.hash;
  if (!hash) return { ok: false, reason: "no_hash" };

  // secret_key = HMAC_SHA256(bot_token, "WebAppData")  (docs)
  const secretKey = hmacSha256("WebAppData", botToken);
  const dataCheckString = buildDataCheckString(data);
  const computed = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  if (computed !== hash) return { ok: false, reason: "bad_hash" };

  const authDate = Number(data.auth_date || 0);
  const now = Math.floor(Date.now() / 1000);
  if (!authDate || now - authDate > maxAgeSec) return { ok: false, reason: "expired" };

  // user JSON bo‘lishi mumkin
  let user = null;
  try { user = data.user ? JSON.parse(data.user) : null; } catch {}
  return { ok: true, data, user };
}

module.exports = { validateInitData };