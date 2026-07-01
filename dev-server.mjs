// 本地开发服务器：同时服务静态文件 + /api/llm 代理（模拟边缘函数）
// 用法：DEEPSEEK_KEY=sk-xxx GEMINI_KEY=AIza-xxx node dev-server.mjs [port]
// 仅本地测试用，keys 从环境变量读，不写盘、不进 git。
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const PORT = Number(process.argv[2] || 8788);
const ROOT = new URL(".", import.meta.url).pathname;
const ENV = {
  DEEPSEEK_KEY: process.env.DEEPSEEK_KEY || "",
  GEMINI_KEY: process.env.GEMINI_KEY || "",
  GEMINI_MODEL: process.env.GEMINI_MODEL || "gemini-2.0-flash",
  ZHIPU_KEY: process.env.ZHIPU_KEY || "",
  ZHIPU_MODEL: process.env.ZHIPU_MODEL || "glm-4.5v",
};
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/api/llm") return handleLLM(req, res);
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

async function handleLLM(req, res) {
  const send = (obj, status = 200) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(obj));
  };
  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return send({ error: "bad json" }, 400); }
  const { system, userText, images } = body || {};
  if (!system || typeof userText !== "string") return send({ error: "missing fields", ready: !!(ENV.DEEPSEEK_KEY || ENV.ZHIPU_KEY) }, 400);
  const hasImg = Array.isArray(images) && images.length > 0;
  try {
    let text;
    if (hasImg && ENV.ZHIPU_KEY) text = await callZhipu(ENV.ZHIPU_KEY, ENV.ZHIPU_MODEL, system, userText, images);
    else if (hasImg && ENV.GEMINI_KEY) text = await callGemini(ENV.GEMINI_KEY, ENV.GEMINI_MODEL, system, userText, images);
    else { if (!ENV.DEEPSEEK_KEY) throw new Error("missing DEEPSEEK_KEY"); text = await callDeepseek(ENV.DEEPSEEK_KEY, "deepseek-chat", system, userText); }
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
