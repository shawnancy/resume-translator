// 本地开发服务器：同时服务静态文件 + /api/llm 代理（模拟边缘函数）
// 用法：DEEPSEEK_KEY=<你的key> ZHIPU_KEY=<你的key> node dev-server.mjs [port]
// 仅本地测试用，keys 从环境变量读，不写盘、不进 git。
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { createOrder, notifySign } from "./functions/utils/xorpay.js";

const PORT = Number(process.argv[2] || 8788);
const ROOT = new URL(".", import.meta.url).pathname;
const ENV = {
  DEEPSEEK_KEY: process.env.DEEPSEEK_KEY || "",
  GEMINI_KEY: process.env.GEMINI_KEY || "",
  GEMINI_MODEL: process.env.GEMINI_MODEL || "gemini-2.0-flash",
  ZHIPU_KEY: process.env.ZHIPU_KEY || "",
  ZHIPU_MODEL: process.env.ZHIPU_MODEL || "glm-4.5v",
  XORPAY_AID: process.env.XORPAY_AID || "",
  XORPAY_SECRET: process.env.XORPAY_SECRET || "",
  NOTIFY_URL: process.env.NOTIFY_URL || "",
  PRICE: process.env.PRICE || "5.00",
  FREE_CREDITS: parseInt(process.env.FREE_CREDITS || "2", 10),
  PACK_CREDITS: parseInt(process.env.PACK_CREDITS || "2", 10),
  GATING: process.env.GATING === "1", // 本地测付费门禁开关
};
// 内存 KV(模拟 Cloudflare/EdgeOne KV), 接口: get(k)->string|null, put(k,v)
const _kv = new Map();
const KV = { async get(k) { return _kv.has(k) ? _kv.get(k) : null; }, async put(k, v) { _kv.set(k, String(v)); } };
const creditsOf = async (t) => { const v = await KV.get("c:" + t); return v === null ? ENV.FREE_CREDITS : parseInt(v, 10); };
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };

const server = http.createServer(async (req, res) => {
  const path = req.url.split("?")[0];
  if (req.method === "POST" && path === "/api/llm") return handleLLM(req, res);
  if (path.startsWith("/api/pay/")) return handlePay(req, res, path);
  // 静态文件
  try {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p === "/") p = "/index.html";
    const file = normalize(join(ROOT, p));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end("forbidden"); return; }
    const data = await readFile(file);
    res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(data);
  } catch {
    res.writeHead(404).end("not found");
  }
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(b));
    req.on("error", reject);
  });
}

// ---- 支付路由(镜像边缘函数, 无真实 XorPay key 时走 mock) ----
async function handlePay(req, res, path) {
  const send = (obj, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
  const url = new URL(req.url, "http://localhost");

  if (path === "/api/pay/create" && req.method === "POST") {
    let body = {}; try { body = JSON.parse(await readBody(req)); } catch {}
    const token = String(body.token || "").slice(0, 64);
    const method = body.method === "alipay" ? "alipay" : "native";
    if (!token) return send({ error: "缺少 token" }, 400);
    const order_id = "rt" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    const notify_url = ENV.NOTIFY_URL || `http://localhost:${PORT}/api/pay/notify`;
    let qr, aoid;
    if (ENV.XORPAY_AID && ENV.XORPAY_SECRET) {
      const r = await createOrder({ aid: ENV.XORPAY_AID, secret: ENV.XORPAY_SECRET, name: `简历翻译 +${ENV.PACK_CREDITS}次`, pay_type: method, price: ENV.PRICE, order_id, notify_url });
      if (!r.ok) return send({ error: "下单失败", detail: r.raw }, 502);
      qr = r.qr; aoid = r.aoid;
    } else {
      qr = "MOCKQR://pay/" + order_id; aoid = "mock_" + order_id; // 本地无真key时的假二维码
    }
    await KV.put("o:" + order_id, JSON.stringify({ token, credits: ENV.PACK_CREDITS, status: "new" }));
    return send({ order_id, qr, aoid, price: ENV.PRICE, credits: ENV.PACK_CREDITS, mock: !ENV.XORPAY_AID });
  }

  if (path === "/api/pay/status" && req.method === "GET") {
    const order_id = url.searchParams.get("order_id"), token = url.searchParams.get("token");
    let paid = false;
    if (order_id) { const o = await KV.get("o:" + order_id); if (o) paid = JSON.parse(o).status === "paid"; }
    const credits = token ? await creditsOf(token) : ENV.FREE_CREDITS;
    return send({ paid, credits });
  }

  if (path === "/api/pay/notify" && req.method === "POST") {
    const raw = await readBody(req); const p = Object.fromEntries(new URLSearchParams(raw));
    if (notifySign(p, ENV.XORPAY_SECRET) !== p.sign) { res.writeHead(400).end("sign error"); return; }
    await markPaid(p.order_id);
    res.writeHead(200).end("success"); return;
  }

  // 本地测试专用: 模拟付款成功(真部署没有这个路由)
  if (path === "/api/pay/_mockpay" && req.method === "POST") {
    await markPaid(url.searchParams.get("order_id"));
    return send({ ok: true });
  }
  res.writeHead(404).end("not found");
}

async function markPaid(order_id) {
  const key = "o:" + order_id; const oStr = await KV.get(key);
  if (!oStr) return;
  const o = JSON.parse(oStr);
  if (o.status === "paid") return; // 幂等
  o.status = "paid"; await KV.put(key, JSON.stringify(o));
  await KV.put("c:" + o.token, String((await creditsOf(o.token)) + (o.credits || 0)));
}

async function handleLLM(req, res) {
  const send = (obj, status = 200) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(obj));
  };
  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return send({ error: "bad json" }, 400); }
  const { system, userText, images, token } = body || {};
  if (!system || typeof userText !== "string") return send({ error: "missing fields", ready: !!(ENV.DEEPSEEK_KEY || ENV.ZHIPU_KEY) }, 400);
  // 次数门禁(本地 GATING=1 开启, 模拟付费部署)
  if (ENV.GATING) {
    if (!token) return send({ error: "缺少 token" }, 400);
    if ((await creditsOf(token)) <= 0) return send({ error: "need_payment", credits: 0 }, 402);
  }
  const hasImg = Array.isArray(images) && images.length > 0;
  try {
    let text;
    if (hasImg && ENV.ZHIPU_KEY) text = await callZhipu(ENV.ZHIPU_KEY, ENV.ZHIPU_MODEL, system, userText, images);
    else if (hasImg && ENV.GEMINI_KEY) text = await callGemini(ENV.GEMINI_KEY, ENV.GEMINI_MODEL, system, userText, images);
    else { if (!ENV.DEEPSEEK_KEY) throw new Error("missing DEEPSEEK_KEY"); text = await callDeepseek(ENV.DEEPSEEK_KEY, "deepseek-chat", system, userText); }
    if (ENV.GATING) await KV.put("c:" + token, String(Math.max(0, (await creditsOf(token)) - 1)));
    send({ text });
  } catch (e) {
    send({ error: String(e.message || e) }, 502);
  }
}

async function callDeepseek(key, model, system, userText) {
  const r = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({ model, messages: [{ role: "system", content: system }, { role: "user", content: userText }], temperature: 0.3, max_tokens: 8192 }),
  });
  if (!r.ok) throw new Error(`DeepSeek ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  const out = d?.choices?.[0]?.message?.content || "";
  if (!out) throw new Error("DeepSeek empty");
  return out;
}
async function callZhipu(key, model, system, userText, images) {
  const content = [{ type: "text", text: system + "\n\n" + userText }];
  for (const img of images.slice(0, 4)) content.push({ type: "image_url", image_url: { url: img } });
  const r = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({ model, messages: [{ role: "user", content }], temperature: 0.3, max_tokens: 16384, thinking: { type: "disabled" } }),
  });
  if (!r.ok) throw new Error(`Zhipu ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  const out = d?.choices?.[0]?.message?.content || "";
  if (!out) throw new Error("Zhipu empty");
  return out;
}
async function callGemini(key, model, system, userText, images) {
  const parts = [{ text: system + "\n\n" + userText }];
  for (const img of images.slice(0, 4)) {
    const m = String(img).match(/^data:(.*?);base64,(.*)$/);
    if (m) parts.push({ inline_data: { mime_type: m[1], data: m[2] } });
  }
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { temperature: 0.3, maxOutputTokens: 8192 } }),
  });
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  const out = d?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  if (!out) throw new Error("Gemini empty");
  return out;
}

server.listen(PORT, () => console.log(`dev-server on http://localhost:${PORT}  (deepseek:${!!ENV.DEEPSEEK_KEY} gemini:${!!ENV.GEMINI_KEY})`));
