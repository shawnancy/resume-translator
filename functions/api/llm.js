// 边缘函数代理（Cloudflare Pages Functions / EdgeOne Pages Functions 通用）
// 作用：把 LLM API Key 藏在服务端环境变量里，浏览器永远拿不到。
// 路由：POST /api/llm   body: { system, userText, images?:[dataURL] }
// 环境变量（在 CF/EdgeOne 控制台或 wrangler secret 配置）：
//   DEEPSEEK_KEY  —— DeepSeek key（纯文本简历）
//   GEMINI_KEY    —— Gemini key（图片/PDF 简历，视觉保真复刻）
//   GEMINI_MODEL  —— 可选，默认 gemini-2.0-flash
//   ALLOW_ORIGIN  —— 可选，限制来源域名（防被当免费 LLM 网关白嫖），如 https://xxx.edgeone.cool

export async function onRequest(context) {
  const { request } = context;
  // key 来源(优先级低→高): 内置key文件(_keys.js, gitignore不进仓库) < process.env(EdgeOne makers=Node) < context.env(CF Pages)
  let fileKeys = {};
  try { fileKeys = (await import("../_keys.js")).KEYS || {}; } catch {} // 开源部署无此文件 → 忽略
  const env = { ...fileKeys, ...(typeof process !== "undefined" && process.env ? process.env : {}), ...(context.env || {}) };
  if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }), env);
  if (request.method !== "POST") return cors(json({ error: "POST only" }, 405), env);

  // 来源校验（弱防护，够挡随手白嫖）
  if (env.ALLOW_ORIGIN) {
    const o = request.headers.get("Origin") || "";
    if (o && o !== env.ALLOW_ORIGIN) return cors(json({ error: "forbidden origin" }, 403), env);
  }

  let body;
  try { body = await request.json(); } catch { return cors(json({ error: "bad json" }, 400), env); }
  const { system, userText, images, token } = body || {};
  // ready = 服务端是否配了 key。前端探测用: 没配则自动切"用户自带 key"模式
  if (!system || typeof userText !== "string")
    return cors(json({ error: "missing fields", ready: !!(env.DEEPSEEK_KEY || env.ZHIPU_KEY) }, 400), env);

  // 次数门禁: 仅当绑定了 KV(付费部署)才生效。开源/无KV部署不限次。
  const gating = !!env.RT_KV;
  const free = parseInt(env.FREE_CREDITS || "2", 10);
  if (gating) {
    if (!token) return cors(json({ error: "缺少 token" }, 400), env);
    const v = await env.RT_KV.get("c:" + token);
    const credits = v === null || v === undefined ? free : parseInt(v, 10);
    if (credits <= 0) return cors(json({ error: "need_payment", credits: 0 }, 402), env);
  }

  const hasImg = Array.isArray(images) && images.length > 0;
  const zhipuKey = env.ZHIPU_KEY;
  const geminiKey = env.GEMINI_KEY;
  const deepseekKey = env.DEEPSEEK_KEY;

  try {
    let text;
    if (hasImg && zhipuKey) {
      // 有图 + 智谱 key → GLM 视觉。glm-4v-plus ~5s(扛住EdgeOne 25s超时); glm-4.5v要40s+必超时。max_tokens上限2048。
      text = await callZhipu(zhipuKey, env.ZHIPU_MODEL || "glm-4v-plus", system, userText, images, 2048);
    } else if (hasImg && geminiKey) {
      text = await callGemini(geminiKey, env.GEMINI_MODEL || "gemini-2.0-flash", system, userText, images);
    } else if (deepseekKey) {
      text = await callDeepseek(deepseekKey, "deepseek-chat", system, userText);
    } else if (zhipuKey) {
      // 无 DeepSeek key → 文本也走智谱(glm-4-flash 快且免费额度大)
      text = await callZhipu(zhipuKey, env.ZHIPU_TEXT_MODEL || "glm-4-flash", system, userText, [], 4095);
    } else {
      throw new Error("server missing LLM key");
    }
    // 生成成功才扣 1 次
    if (gating) {
      const v = await env.RT_KV.get("c:" + token);
      const cur = v === null || v === undefined ? free : parseInt(v, 10);
      await env.RT_KV.put("c:" + token, String(Math.max(0, cur - 1)));
    }
    return cors(json({ text }), env);
  } catch (e) {
    // 让前端能识别 429/失败 → 触发其 OCR 回退逻辑
    return cors(json({ error: String((e && e.message) || e) }, 502), env);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
function cors(resp, env) {
  const h = new Headers(resp.headers);
  h.set("Access-Control-Allow-Origin", env.ALLOW_ORIGIN || "*");
  h.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  h.set("Access-Control-Allow-Headers", "Content-Type");
  return new Response(resp.body, { status: resp.status, headers: h });
}

async function callDeepseek(key, model, system, userText) {
  const r = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userText },
      ],
      temperature: 0.3,
      max_tokens: 8192,
      stream: false,
    }),
  });
  if (!r.ok) throw new Error(`DeepSeek ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  const out = d?.choices?.[0]?.message?.content || "";
  if (!out) throw new Error("DeepSeek empty");
  return out;
}

async function callZhipu(key, model, system, userText, images, maxTokens) {
  const imgs = (images || []).slice(0, 4);
  // 视觉模型吃 content 数组; 纯文本模型必须传字符串(传数组会被无视指令、答非所问)
  let content;
  if (imgs.length) {
    content = [{ type: "text", text: system + "\n\n" + userText }];
    for (const img of imgs) content.push({ type: "image_url", image_url: { url: img } });
  } else {
    content = system + "\n\n" + userText;
  }
  const r = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content }],
      temperature: 0.3,
      max_tokens: maxTokens || 4095, // glm-4v-plus上限2048/glm-4-flash上限4095, 超限报400
      thinking: { type: "disabled" }, // 关推理提速
    }),
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
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { temperature: 0.3, maxOutputTokens: 8192 } }),
    }
  );
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  const out = d?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  if (!out) throw new Error("Gemini empty");
  return out;
}
