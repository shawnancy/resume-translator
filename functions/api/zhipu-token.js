// POST /api/zhipu-token → { token, exp }
// 服务端用智谱 key(id.secret) 签一个短时 JWT 给浏览器, 浏览器拿它直连智谱(Bearer 同样接受 JWT)。
// 为什么: EdgeOne 函数 ~25s 硬超时, 而完整简历生成要 1-2 分钟, 代理转发必 504;
// 浏览器直连无时限, 且真 key 永不出服务器 —— JWT 泄露也只有 TTL 内有效。
const TTL_MS = 15 * 60 * 1000;

export async function onRequest(context) {
  const { request } = context;
  let fileKeys = {};
  try { fileKeys = (await import("../_keys.js")).KEYS || {}; } catch {}
  const env = { ...fileKeys, ...(typeof process !== "undefined" && process.env ? process.env : {}), ...(context.env || {}) };

  const h = { "Content-Type": "application/json", "Access-Control-Allow-Origin": env.ALLOW_ORIGIN || "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
  if (request.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: h });
  if (env.ALLOW_ORIGIN) {
    const o = request.headers.get("Origin") || "";
    if (o && o !== env.ALLOW_ORIGIN) return new Response(JSON.stringify({ error: "forbidden origin" }), { status: 403, headers: h });
  }

  const raw = env.ZHIPU_KEY || "";
  const dot = raw.indexOf(".");
  if (dot < 1) return new Response(JSON.stringify({ error: "no server key" }), { status: 503, headers: h });
  const id = raw.slice(0, dot), secret = raw.slice(dot + 1);

  const now = Date.now();
  const exp = now + TTL_MS;
  const header = b64url(JSON.stringify({ alg: "HS256", sign_type: "SIGN" }));
  const payload = b64url(JSON.stringify({ api_key: id, exp, timestamp: now }));
  const sig = await hmacB64url(secret, header + "." + payload);
  return new Response(JSON.stringify({ token: `${header}.${payload}.${sig}`, exp }), { status: 200, headers: h });
}

function b64url(input) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function hmacB64url(secret, data) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return b64url(new Uint8Array(sig));
}
