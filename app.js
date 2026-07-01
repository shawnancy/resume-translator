// 简历翻译器 —— 任意格式中文简历 → 保留版式的英文简历
// 多引擎可插拔：DeepSeek（文字型，OpenAI 兼容）/ Gemini（多模态可看图）
// 管线：输入 → {图像[], 文本} → LLM 翻译+重建 HTML → 预览/导出
import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";

// ---------- 引擎定义 ----------
const PROVIDERS = {
  deepseek: {
    label: "DeepSeek",
    vision: false,
    endpoint: "https://api.deepseek.com/chat/completions",
    models: [
      ["deepseek-chat", "deepseek-chat（V3·快·推荐）"],
      ["deepseek-reasoner", "deepseek-reasoner（R1·更强推理）"],
    ],
    keyHint: "粘贴 sk-... 开头的 DeepSeek key",
    guide: [
      '打开 <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener">DeepSeek 开放平台</a>',
      "创建 API Key，复制（sk- 开头）",
      "粘到下面保存即可",
    ],
  },
  gemini: {
    label: "Gemini",
    vision: true,
    models: [
      ["gemini-2.0-flash", "gemini-2.0-flash（视觉·当前 key 可用）"],
      ["gemini-2.5-flash", "gemini-2.5-flash"],
      ["gemini-2.5-pro", "gemini-2.5-pro"],
    ],
    keyHint: "粘贴 AIza... 开头的 Gemini key",
    guide: [
      '打开 <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a>（免费）',
      '点 "Create API key"，复制',
      "粘到下面保存即可",
    ],
  },
};

const LS = {
  provider: "rt_provider",
  key: (p) => `rt_key_${p}`,
  model: (p) => `rt_model_${p}`,
};

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const dropzone = $("dropzone");
const fileInput = $("fileInput");
const filePreview = $("filePreview");
const overlay = $("overlay");
const overlayText = $("overlayText");

let current = null; // { images:[dataURL], text:string, name, hadImageOnly:bool }

// ================= 输入处理 =================
$("browseBtn").addEventListener("click", () => fileInput.click());
dropzone.addEventListener("click", (e) => {
  if (e.target.closest(".link-btn")) return;
  fileInput.click();
});
["dragenter", "dragover"].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.add("drag");
  })
);
["dragleave", "drop"].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.remove("drag");
  })
);
dropzone.addEventListener("drop", (e) => {
  const f = e.dataTransfer.files?.[0];
  if (f) handleFile(f);
});
fileInput.addEventListener("change", (e) => {
  const f = e.target.files?.[0];
  if (f) handleFile(f);
});

$("pasteGoBtn").addEventListener("click", () => {
  const txt = $("pasteArea").value.trim();
  if (!txt) return alert("请先粘贴简历文字");
  current = { images: [], text: txt, name: "粘贴的文本", hadImageOnly: false };
  showPreview({ kind: "text", text: txt });
  revealOptions();
});

async function handleFile(file) {
  try {
    showOverlay("正在读取文件…");
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    let result;
    if (ext === "pdf") result = await readPdf(file);
    else if (ext === "docx" || ext === "doc") result = await readDocx(file);
    else if (file.type.startsWith("image/") || ["png", "jpg", "jpeg", "webp"].includes(ext))
      result = await readImage(file);
    else throw new Error("暂不支持的格式：" + ext + "（请用 PDF / docx / 图片 / 粘贴文本）");

    current = { ...result, name: file.name };
    showPreview(result.previewMeta);
    revealOptions();
  } catch (err) {
    console.error(err);
    alert("读取失败：" + err.message);
  } finally {
    hideOverlay();
  }
}

// ---- PDF：渲染每页为图像 + 抽取「按行还原」的文本 ----
async function readPdf(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({
    data: buf,
    cMapUrl: "https://unpkg.com/pdfjs-dist@4.4.168/cmaps/", // 中文 PDF 渲染需要 CJK CMaps
    cMapPacked: true,
    standardFontDataUrl: "https://unpkg.com/pdfjs-dist@4.4.168/standard_fonts/",
  }).promise;
  const maxPages = Math.min(pdf.numPages, 4);
  const images = [];
  let text = "";
  let photo = null;
  for (let p = 1; p <= maxPages; p++) {
    showOverlay(`正在渲染 PDF 第 ${p}/${maxPages} 页…`);
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    // 渲染加 6s 超时：某些 PDF 的内嵌图(如证件照)会让 pdf.js 解码器死锁，超时则放弃此页图像走文字路径
    let rendered = false;
    try {
      rendered = await Promise.race([
        page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise.then(() => true),
        new Promise((r) => setTimeout(() => r(false), 6000)),
      ]);
    } catch (e) {
      console.warn("PDF 渲染失败", e);
    }
    if (rendered) images.push(canvas.toDataURL("image/jpeg", 0.82));
    text += extractLines(await page.getTextContent()) + "\n\n";
    if (!photo) {
      try {
        // 3s 硬超时：照片提取卡住也绝不阻塞主流程
        photo = await Promise.race([
          extractPdfPhoto(page, viewport.width / 2),
          new Promise((r) => setTimeout(() => r(null), 3000)),
        ]);
      } catch (e) {
        console.warn("PDF 照片提取失败", e);
      }
    }
  }
  const hadText = text.replace(/\s/g, "").length > 20;
  return {
    images,
    text: text.trim(),
    hadImageOnly: !hadText, // 扫描型 PDF：抽不到文本，需 OCR
    photo: hadText ? photo : null, // 仅文字型 PDF 抠照片(扫描件整页是图不算)
    previewMeta: {
      kind: "doc",
      thumbs: images,
      label: `PDF · ${pdf.numPages} 页${hadText ? "" : " · 疑似扫描件(需OCR)"}${photo && hadText ? " · 含证件照" : ""}`,
    },
  };
}

// 从 PDF 页抠出最像证件照的嵌入图片(返回 dataURL)。pageHalfW 用于排除整页大图。
async function extractPdfPhoto(page, pageHalfW) {
  const opList = await page.getOperatorList();
  const names = [];
  for (let i = 0; i < opList.fnArray.length; i++) {
    if (opList.fnArray[i] === pdfjsLib.OPS.paintImageXObject) names.push(opList.argsArray[i][0]);
  }
  let best = null;
  for (const name of names) {
    const img = await new Promise((res) => {
      let done = false;
      const finish = (v) => {
        if (!done) {
          done = true;
          res(v);
        }
      };
      setTimeout(() => finish(null), 1200); // 防回调不触发导致永久挂起
      try {
        if (page.objs.has && page.objs.has(name)) finish(page.objs.get(name));
        else page.objs.get(name, finish);
      } catch {
        finish(null);
      }
    });
    if (!img) continue;
    const w = img.width || img.bitmap?.width;
    const h = img.height || img.bitmap?.height;
    if (!w || !h) continue;
    if (w > pageHalfW * 1.6) continue; // 排除接近整页宽的大图(背景/扫描)
    const ratio = w / h;
    if (ratio < 0.4 || ratio > 2) continue; // 证件照大致竖向~方形
    const area = w * h;
    if (area < 4000) continue; // 太小的图标跳过
    if (!best || area > best.area) best = { img, w, h, area };
  }
  if (!best) return null;
  return pdfImgToDataURL(best.img, best.w, best.h);
}

function pdfImgToDataURL(img, w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (img.bitmap) ctx.drawImage(img.bitmap, 0, 0);
  else if (typeof ImageBitmap !== "undefined" && img instanceof ImageBitmap) ctx.drawImage(img, 0, 0);
  else if (img.data) {
    const id = ctx.createImageData(w, h);
    const src = img.data;
    const dst = id.data;
    if (src.length === w * h * 4) dst.set(src);
    else if (src.length === w * h * 3) {
      for (let i = 0, j = 0; i < src.length; i += 3, j += 4) {
        dst[j] = src[i];
        dst[j + 1] = src[i + 1];
        dst[j + 2] = src[i + 2];
        dst[j + 3] = 255;
      }
    } else return null;
    ctx.putImageData(id, 0, 0);
  } else return null;
  return c.toDataURL("image/jpeg", 0.92);
}

// 按 y 坐标分行，保留版式结构，给文字型模型更好的线索
function extractLines(tc) {
  const rows = {};
  for (const it of tc.items) {
    if (!it.str) continue;
    const y = Math.round(it.transform[5] / 3) * 3; // 容差分桶
    (rows[y] = rows[y] || []).push({ x: it.transform[4], s: it.str });
  }
  return Object.keys(rows)
    .map(Number)
    .sort((a, b) => b - a) // PDF 坐标自下而上
    .map((y) => rows[y].sort((a, b) => a.x - b.x).map((o) => o.s).join("").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

// ---- docx：转 HTML → 渲染成图像 + 抽取纯文本 ----
async function readDocx(file) {
  const buf = await file.arrayBuffer();
  const { value: html } = await window.mammoth.convertToHtml({ arrayBuffer: buf });
  const { value: rawText } = await window.mammoth.extractRawText({ arrayBuffer: buf });
  const holder = document.createElement("div");
  holder.style.cssText =
    "position:fixed;left:-9999px;top:0;width:794px;padding:48px;background:#fff;" +
    "font-family:'PingFang SC','Microsoft YaHei',sans-serif;font-size:14px;line-height:1.6;color:#000";
  holder.innerHTML = html;
  document.body.appendChild(holder);
  let images = [];
  try {
    const canvas = await window.html2canvas(holder, { scale: 2, backgroundColor: "#fff" });
    images = [canvas.toDataURL("image/jpeg", 0.82)];
  } catch (e) {
    console.warn("docx 截图失败，退化为纯文本", e);
  } finally {
    holder.remove();
  }
  return {
    images,
    text: rawText.trim(),
    hadImageOnly: false,
    previewMeta: { kind: "doc", thumbs: images, label: "Word 文档" },
  };
}

// ---- 图片：留图，文本待 OCR/视觉模型处理 ----
async function readImage(file) {
  const dataURL = await fileToDataURL(file);
  return {
    images: [dataURL],
    text: "",
    hadImageOnly: true,
    previewMeta: { kind: "doc", thumbs: [dataURL], label: "图片（文字型引擎将用 OCR 识别）" },
  };
}

function fileToDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

function showPreview(meta) {
  filePreview.classList.remove("hidden");
  const del = `<button class="chip-del" id="clearInputBtn" title="删除，重新选择">✕ 删除</button>`;
  if (meta.kind === "text") {
    filePreview.innerHTML = `<div class="file-chip">📝 <span>已载入文本</span>
      <span class="meta">${meta.text.length} 字</span>${del}</div>`;
  } else {
    const thumbs = (meta.thumbs || []).map((src) => `<img src="${src}" alt="预览">`).join("");
    filePreview.innerHTML = `<div class="file-chip">📄 <span>${current?.name || "文件"}</span>
      <span class="meta">${meta.label}</span>${del}</div>
      <div class="thumb-row">${thumbs}</div>`;
  }
  $("clearInputBtn").addEventListener("click", clearInput);
}

function clearInput() {
  current = null;
  filePreview.classList.add("hidden");
  filePreview.innerHTML = "";
  fileInput.value = "";
  $("pasteArea").value = "";
  goStep(1);
}

function revealOptions() {
  // 2 步流程：输入就绪后留在步骤1（已显示预览+设置+生成按钮），无需跳转
}

// ================= OCR（文字型引擎处理图片时按需加载） =================
let tesseractLoading = null;
async function ensureTesseract() {
  if (window.Tesseract) return;
  if (!tesseractLoading) {
    tesseractLoading = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
      s.onload = res;
      s.onerror = () => rej(new Error("OCR 库加载失败，请检查网络"));
      document.head.appendChild(s);
    });
  }
  await tesseractLoading;
}

async function ocrImages(images) {
  await ensureTesseract();
  showOverlay("正在 OCR 识别图片文字（首次需下载中文语言包，稍等）…");
  const worker = await window.Tesseract.createWorker(["chi_sim", "eng"]);
  let out = "";
  try {
    for (let i = 0; i < images.length; i++) {
      showOverlay(`OCR 识别中 ${i + 1}/${images.length}…`);
      const { data } = await worker.recognize(images[i]);
      out += data.text + "\n\n";
    }
  } finally {
    await worker.terminate();
  }
  return out.trim();
}

// ================= 翻译生成 =================
const SPLIT = "<!--===SPLIT===-->";
$("translateBtn").addEventListener("click", runTranslate);

function currentOpts() {
  return { lang: $("targetLang").value, tone: $("toneSel").value, template: getTemplate() };
}

async function runTranslate() {
  if (!current) return alert("请先上传或粘贴简历");
  // 自带key模式且没填任何key → 打开设置
  if (!backendMode && !getUserKey("deepseek") && !getUserKey("zhipu")) return openModal();
  if (!hasCredit()) return showPaywall();
  // 有图片/PDF → 先试视觉保真；失败再 OCR 回退 DeepSeek
  const willGemini = current.images?.length > 0;

  try {
    let input = current;
    // 文字型引擎(非视觉) + 仅有图片 → 先 OCR
    if (!willGemini && !input.text && input.images.length) {
      const ocrText = await ocrImages(input.images);
      if (!ocrText) throw new Error("OCR 没识别出文字，请换更清晰的图");
      input = { ...input, text: ocrText };
    }
    showOverlay(`正在生成中英双语简历（约 15–50 秒）…`);
    let result;
    try {
      result = await generateBoth(input, currentOpts());
    } catch (e) {
      // 视觉模型失败(额度 429 等) → OCR 退回 DeepSeek 文字模式, 不让用户卡死
      if (willGemini) {
        console.warn("视觉模型失败，回退 DeepSeek 文字模式：", e.message);
        showOverlay("视觉模型暂不可用（额度/网络），正在改用文字模式…");
        let t = input.text;
        if (!t && input.images.length) t = await ocrImages(input.images);
        if (!t) throw e;
        result = await generateBoth({ ...input, text: t, images: [] }, currentOpts());
      } else throw e;
    }
    renderBilingual(result.zhHtml || fallbackZh(input.text), result.enHtml);
    consumeCredit();
    goStep(2);
  } catch (err) {
    console.error(err);
    alert("生成失败：" + err.message);
  } finally {
    hideOverlay();
  }
}

// ---- Prompt 组装 ----
function sharedRules(hasPhoto) {
  const imgRule = hasPhoto
    ? 'The candidate has a photo. Put the literal placeholder token __PHOTO_0__ (as plain text, NOT an <img> tag, exactly once) at the position where the photo appears in the original (e.g. top-right of the header). Do NOT wrap it in any rounded/circular/oval container and do NOT add border-radius or a mask around it — it will be replaced with a plain rectangular photo. Do not add any other <img>.'
    : "No <img> tags.";
  return `HARD RULES (apply to EACH resume):
- A complete self-contained HTML document starting with <!DOCTYPE html>. All CSS inline in one <style> tag. No external resources, no JavaScript. ${imgRule}
- Include EVERY piece of content from the source — every section, role, bullet, project, date, skill and detail. NEVER omit, shorten, merge or summarize anything. Do not cut corners.
- For any multi-column area, use a BORDERLESS <table> for layout (NOT flexbox/grid) so it converts cleanly to Microsoft Word.
- @page { size: A4; margin: 0 }; body width ~794px with ~40px padding; web-safe fonts. Use as many pages as the content needs — do NOT compress or drop content to fit one page.
- Never fabricate experience, skills, dates, or companies — only what exists in the source.
- Keep emails, phones, URLs, dates and numbers exactly.`;
}
function toneLineOf(tone) {
  return tone === "faithful"
    ? "Translate faithfully and literally, close to the source wording."
    : "Translate into polished, natural, professional resume English with strong action verbs and standard phrasing — never invent facts.";
}
const EN_EXTRA =
  "- Romanize the candidate's OWN name from the resume into pinyin (e.g. a surname 林 → 'Lin'). Use the REAL name shown in the source — never substitute an example name.\n" +
  "- Official English names for companies/schools when well-known (e.g. 字节跳动→ByteDance, 网易→NetEase, 清华大学→Tsinghua University); otherwise pinyin.\n" +
  "- Localize degrees (本科→Bachelor, 硕士→Master, 博士→PhD) and use standard English job titles.";

function bothSystem({ lang, tone, template, hasPhoto }) {
  return `You are an expert bilingual resume specialist and front-end designer. From the Chinese resume content, produce TWO resumes as HTML using the SAME visual template.

OUTPUT FORMAT (critical — follow exactly):
<the full ENGLISH (${lang}) HTML document>
${SPLIT}
<the full CHINESE HTML document>
Output ONLY those two HTML documents and the single separator line between them. No markdown fences, no commentary.

ENGLISH version: ${toneLineOf(tone)}
${EN_EXTRA}
CHINESE version: keep the original Chinese content, just typeset cleanly into the SAME template — DO NOT translate it.

${styleBlock(template)}

${sharedRules(hasPhoto)}`;
}
function enOnlySystem({ lang, tone, template, hasPhoto }) {
  return `You are an expert bilingual resume specialist and front-end designer. Translate the given Chinese resume into ${lang} and produce ONE clean HTML resume. ${toneLineOf(tone)}
${EN_EXTRA}
Output ONLY the HTML document (start with <!DOCTYPE html>), no fences, no commentary.

${styleBlock(template)}

${sharedRules(hasPhoto)}`;
}

// 把 __PHOTO_0__ 占位替换成我完全控制的矩形 <img>(防模型加圆角/椭圆)
function injectPhoto(html, photo) {
  if (!photo || !html) return html;
  const tag = `<img src="${photo}" alt="photo" style="width:92px;height:auto;border-radius:0;object-fit:contain;display:inline-block;vertical-align:top">`;
  return html.split("__PHOTO_0__").join(tag);
}

// ---- 生成：中英两份 / 仅英文 ----
async function generateBoth(input, opts) {
  const userText = input.text
    ? "Resume content (Chinese, line breaks preserved):\n\n" + input.text.slice(0, 16000)
    : "The resume is in the attached image(s). Transcribe and use it.";
  const sys = bothSystem({ ...opts, hasPhoto: !!input.photo });
  const raw = await callLLM({ system: sys, userText, images: input.images });
  const i = raw.indexOf(SPLIT);
  let en, zh;
  if (i === -1) { en = cleanHtml(raw); zh = ""; } // 模型没给分隔符/被截断 → 至少保英文
  else { en = cleanHtml(raw.slice(0, i)); zh = cleanHtml(raw.slice(i + SPLIT.length)); }
  return { enHtml: injectPhoto(en, input.photo), zhHtml: injectPhoto(zh, input.photo) };
}
async function generateEnOnly(zhText, opts) {
  const raw = await callLLM({
    system: enOnlySystem({ ...opts, hasPhoto: !!opts.photo }),
    userText: "Resume content (Chinese):\n\n" + zhText.slice(0, 16000),
    images: [],
  });
  return injectPhoto(cleanHtml(raw), opts.photo);
}

// ---- 统一 LLM 调用（双模式）----
// 后端模式(部署带代理): 走 /api/llm, key 藏服务端。
// 自带 key 模式(开源静态站): 用用户在设置里填的 key 直连。
// 均: 有图→智谱GLM-4.5V视觉; 纯文本→DeepSeek。失败抛错由 runTranslate 回退处理。
async function callLLM(args) {
  return backendMode ? callViaProxy(args) : callDirect(args);
}

async function callViaProxy({ system, userText, images }) {
  const resp = await fetch("/api/llm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, userText, images: images || [] }),
  });
  let data = {};
  try { data = await resp.json(); } catch {}
  if (!resp.ok) throw new Error(data.error || `代理错误 ${resp.status}`);
  if (!data.text) throw new Error("模型没有返回内容");
  return data.text;
}

// 自带 key 直连
async function callDirect({ system, userText, images }) {
  const hasImg = (images || []).length > 0;
  const zhipu = getUserKey("zhipu");
  const deepseek = getUserKey("deepseek");
  if (hasImg && zhipu) return zhipuDirect(zhipu, system, userText, images);
  if (!deepseek) {
    throw new Error(hasImg && !zhipu ? "图片简历需要智谱 Key，请点右上角 ⚙️ 填入" : "请点右上角 ⚙️ 填入 DeepSeek Key");
  }
  return deepseekDirect(deepseek, system, userText);
}

async function deepseekDirect(key, system, userText) {
  const r = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [{ role: "system", content: system }, { role: "user", content: userText }],
      temperature: 0.3, max_tokens: 8192, stream: false,
    }),
  });
  if (!r.ok) {
    if (r.status === 401) throw new Error("DeepSeek Key 无效或欠费（401）");
    if (r.status === 402) throw new Error("DeepSeek 余额不足（402）");
    throw new Error(`DeepSeek ${r.status}: ${(await r.text()).slice(0, 160)}`);
  }
  const d = await r.json();
  const out = d?.choices?.[0]?.message?.content || "";
  if (!out) throw new Error("模型没有返回内容");
  return out;
}

async function zhipuDirect(key, system, userText, images) {
  const content = [{ type: "text", text: system + "\n\n" + userText }];
  for (const img of images.slice(0, 4)) content.push({ type: "image_url", image_url: { url: img } });
  const r = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({ model: "glm-4.5v", messages: [{ role: "user", content }], temperature: 0.3, max_tokens: 16384, thinking: { type: "disabled" } }),
  });
  if (!r.ok) {
    if (r.status === 401) throw new Error("智谱 Key 无效（401）");
    throw new Error(`智谱 ${r.status}: ${(await r.text()).slice(0, 160)}`);
  }
  const d = await r.json();
  const out = d?.choices?.[0]?.message?.content || "";
  if (!out) throw new Error("智谱没有返回内容");
  return out;
}

function cleanHtml(s) {
  s = (s || "").trim();
  s = s.replace(/```html/gi, "").replace(/```/g, "").trim(); // 去掉所有 markdown 代码围栏(HTML 不含 ```)
  const i = s.search(/<!DOCTYPE|<html/i);
  if (i > 0) s = s.slice(i);
  return s.trim();
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}
// 模型没回中文版时，用源文本兜个可编辑的简易中文页，左栏不空
function fallbackZh(text) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    @page{size:A4;margin:0}body{font-family:'PingFang SC','Microsoft YaHei',sans-serif;width:794px;padding:40px;white-space:pre-wrap;font-size:14px;line-height:1.7;color:#222}
  </style></head><body>${escapeHtml(text)}</body></html>`;
}

// ================= 双栏渲染 / 编辑 / 导出 =================
function mountEditable(frame, html) {
  frame.srcdoc = html;
  frame.addEventListener(
    "load",
    () => {
      try {
        frame.contentDocument.designMode = "on";
      } catch (e) {
        console.warn("designMode 开启失败", e);
      }
    },
    { once: true }
  );
}

function renderBilingual(zhHtml, enHtml) {
  mountEditable($("zhFrame"), zhHtml);
  mountEditable($("enFrame"), enHtml);
  // 默认显示英文全宽视图
  $("bilingual").className = "bilingual view-en";
  document.querySelectorAll(".vt").forEach((x) => x.classList.toggle("active", x.dataset.view === "en"));
  // 切到步骤2(对照编辑)由 goStep(2) 负责（runTranslate 调用）
}

// 重新翻译：取左栏（编辑后的中文）→ 仅刷新右栏英文
$("retranslateBtn").addEventListener("click", async () => {
  const zhDoc = $("zhFrame").contentDocument;
  const zhText = (zhDoc?.body?.innerText || "").trim();
  if (!zhText) return alert("左栏没有可用的中文内容");
  if (!hasCredit()) return showPaywall();
  try {
    showOverlay("正在按修改后的中文重新翻译…");
    const en = await generateEnOnly(zhText, { ...currentOpts(), photo: current?.photo });
    mountEditable($("enFrame"), en);
    consumeCredit();
  } catch (e) {
    console.error(e);
    alert("重新翻译失败：" + e.message);
  } finally {
    hideOverlay();
  }
});

// 导出（PDF 走打印 / Word 走 html-docx-js）
function frameFullHtml(frame) {
  const d = frame.contentDocument;
  return "<!DOCTYPE html>\n" + d.documentElement.outerHTML;
}
function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}
// 视图切换：英文 / 中文 / 对照
document.querySelectorAll(".vt").forEach((b) =>
  b.addEventListener("click", () => {
    $("bilingual").className = "bilingual view-" + b.dataset.view;
    document.querySelectorAll(".vt").forEach((x) => x.classList.toggle("active", x === b));
  })
);

document.querySelectorAll("[data-export]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const which = btn.dataset.export; // zh | en
    const fmt = btn.dataset.fmt; // pdf | word
    const frame = which === "zh" ? $("zhFrame") : $("enFrame");
    if (!frame.contentDocument) return;
    const name = which === "zh" ? "简历_中文" : "Resume_EN";
    if (fmt === "pdf") {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    } else {
      try {
        const blob = window.htmlDocx.asBlob(frameFullHtml(frame));
        downloadBlob(blob, name + ".docx");
      } catch (e) {
        console.error(e);
        alert("Word 导出失败：" + e.message);
      }
    }
  });
});
function flash(btn, txt) {
  const o = btn.textContent;
  btn.textContent = txt;
  setTimeout(() => (btn.textContent = o), 1400);
}

// ================= 运行模式 + 自带 Key =================
// backendMode=true : 部署带代理(functions/api/llm.js), key 藏服务端 + 付费门禁
// backendMode=false: 开源静态站, 用户自带 key 直连, 无付费
let backendMode = false;
function getUserKey(p) {
  return localStorage.getItem(LS.key(p)) || "";
}

async function detectMode() {
  try {
    // 代理对空 body 返回 400 + JSON {error:...}; 静态托管返回 404/405/501 且是 HTML → 据此区分
    const r = await fetch("/api/llm", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const t = await r.text();
    let j = null;
    try { j = JSON.parse(t); } catch {}
    backendMode = r.status === 400 && j && j.ready === true; // 后端且配了key才算"付费模式"
  } catch {
    backendMode = false;
  }
  $("settingsBtn").classList.toggle("hidden", backendMode); // 自带key模式才显示⚙️设置
  $("creditBadge").classList.toggle("hidden", !backendMode); // 付费次数仅后端模式
  updateCredit();
}

function openModal() {
  $("deepseekKeyInput").value = getUserKey("deepseek");
  $("zhipuKeyInput").value = getUserKey("zhipu");
  $("settingsModal").classList.remove("hidden");
}
function closeModal() {
  $("settingsModal").classList.add("hidden");
}
$("settingsBtn").addEventListener("click", openModal);
$("closeModalBtn").addEventListener("click", closeModal);
$("saveKeyBtn").addEventListener("click", () => {
  const dk = $("deepseekKeyInput").value.trim();
  const zk = $("zhipuKeyInput").value.trim();
  dk ? localStorage.setItem(LS.key("deepseek"), dk) : localStorage.removeItem(LS.key("deepseek"));
  zk ? localStorage.setItem(LS.key("zhipu"), zk) : localStorage.removeItem(LS.key("zhipu"));
  closeModal();
  flash($("settingsBtn"), "✓ 已保存");
});

// ================= 模板 =================
const TEMPLATES = [
  { id: "auto", name: "自动（推荐）", desc: "AI 自己排 · 干净专业", two: false, auto: true,
    pal: { bg: "#ffffff", text: "#1f2937", muted: "#6b7280", line: "#e5e7eb", primary: "#1f2937", accent: "#635bff" } },
  { id: "classic-blue", name: "经典商务", desc: "灰蓝单栏 · 稳重", two: false,
    pal: { bg: "#ffffff", text: "#0f172a", muted: "#64748b", line: "#e2e8f0", primary: "#1e293b", accent: "#0ea5e9" },
    layout: "Single column. Name large at top-left; contact info right-aligned beside it via a borderless table. Section titles in the primary color with a thin bottom border. Roomy, professional.",
    font: "clean sans-serif (Arial/Helvetica)" },
  { id: "modern-sidebar", name: "现代双栏", desc: "左栏深底 · 信息分区", two: true,
    pal: { bg: "#ffffff", text: "#1c1c1e", muted: "#6e6e73", line: "#e8e8e6", primary: "#4c6b82", accent: "#c97b5a", side: "#4c6b82", sideText: "#ffffff" },
    layout: "Two columns via a borderless table: a colored LEFT sidebar (~33% width, background = primary color, white text) holding contact / skills / education; a wider RIGHT column for the summary and work experience. Name at the top of the right column.",
    font: "clean sans-serif" },
  { id: "minimal-mono", name: "极简黑白", desc: "Geist 风 · 大留白", two: false,
    pal: { bg: "#ffffff", text: "#171717", muted: "#6b7280", line: "#e5e7eb", primary: "#171717", accent: "#171717" },
    layout: "Single column, generous whitespace, grayscale only, hairline dividers, UPPERCASE section labels with wide letter-spacing. Typographic and minimal.",
    font: "clean sans-serif" },
  { id: "tech-indigo", name: "科技靛紫", desc: "Stripe 风 · 现代", two: false,
    pal: { bg: "#ffffff", text: "#0a2540", muted: "#425466", line: "#e3e8ee", primary: "#0a2540", accent: "#635bff" },
    layout: "Single column, modern. Name + role with an accent-colored underline. Navy section headers; indigo accent only on links / key markers.",
    font: "clean sans-serif" },
  { id: "elegant-serif", name: "优雅衬线", desc: "杂志风 · 学术资深", two: false,
    pal: { bg: "#ffffff", text: "#1a1a1a", muted: "#595550", line: "#ddd8cf", primary: "#1a1a1a", accent: "#b23a2e" },
    layout: "Single column, editorial. Serif fonts (Georgia/Times) for the name and section headings. A single restrained red accent (a rule under the name or small markers). Refined and classic.",
    font: "serif headings (Georgia), sans-serif body" },
  { id: "warm-clay", name: "暖陶简约", desc: "暖米底 · 柔和", two: false,
    pal: { bg: "#fbf6f1", text: "#44342b", muted: "#9a8175", line: "#eddfd3", primary: "#c26b4c", accent: "#6b8e7b" },
    layout: "Single column on a warm off-white background. Terracotta primary for section headings; sage-green accent for small highlights. Soft and friendly.",
    font: "clean sans-serif" },
  { id: "two-col-clean", name: "清爽双栏", desc: "右栏浅底 · 现代", two: true,
    pal: { bg: "#ffffff", text: "#0f172a", muted: "#64748b", line: "#e2e8f0", primary: "#334155", accent: "#0ea5e9", side: "#f1f5f9", sideText: "#0f172a" },
    layout: "Two columns via a borderless table: a LIGHT-gray LEFT sidebar (~32%, background #f1f5f9, dark text) for contact / skills / education; a white RIGHT column for experience. Section labels in primary; thin accent underline on the name.",
    font: "clean sans-serif" },
  { id: "rose-quartz", name: "玫瑰石英", desc: "轻奢 · 柔粉", two: false,
    pal: { bg: "#f7f2f2", text: "#3d2f33", muted: "#9c868c", line: "#ebdddf", primary: "#a86b7a", accent: "#c7a17a" },
    layout: "Single column on a soft rose-tinted background. Dusty-rose primary for headings, muted gold accent. Elegant, light, refined.",
    font: "serif headings, sans-serif body" },
  { id: "natural-green", name: "自然有机", desc: "墨绿 · 大气", two: false,
    pal: { bg: "#f4f1ea", text: "#3d3a30", muted: "#847e6e", line: "#e0dbcd", primary: "#6b7c5a", accent: "#c08a4b" },
    layout: "Single column on a warm paper background. Olive-green primary headings with a thin rule; amber accent for small markers. Organic, grounded, premium.",
    font: "clean sans-serif" },
  { id: "noir-gold", name: "极简黑金", desc: "深色 · 高奢", two: false, dark: true,
    pal: { bg: "#0e0e0c", card: "#1a1916", text: "#f0ede4", muted: "#8a8678", line: "#2c2a24", primary: "#c9a24b", accent: "#e3c988" },
    layout: "Single column on a near-black background (#0e0e0c) with light text. Gold primary for the name and section headings; subtle gold dividers. Luxe portfolio feel (note: best for screen / digital sharing, not B/W printing).",
    font: "serif headings (Georgia), sans-serif body" },
  { id: "forest-emerald", name: "墨绿金", desc: "深色 · 私银沉稳", two: false, dark: true,
    pal: { bg: "#0c1a14", card: "#142319", text: "#edf2ec", muted: "#7e8c82", line: "#21372a", primary: "#2f8f6b", accent: "#c9a24b" },
    layout: "Single column on a deep-emerald background with light text. Emerald-green primary headings, gold accent on key markers. Calm, trustworthy, premium (best for screen / digital).",
    font: "clean sans-serif" },
];
const LS_TPL = "rt_template";
function getTemplate() {
  return localStorage.getItem(LS_TPL) || "auto";
}
function styleBlock(id) {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t || t.auto) {
    return `LAYOUT FIDELITY — Reproduce the ORIGINAL resume as faithfully as possible; do NOT redesign it into your own style.
- If you can SEE the original (image/PDF provided): match its EXACT visual layout — same single/two-column arrangement, same section order, same headings, same relative font sizes and emphasis, same alignment, dividers and accent colors. It should look like the same resume, just in English.
- If you only have the extracted TEXT: keep the SAME section order, headings, grouping and bullet structure as the text implies; pick a clean layout that mirrors that structure. Do not invent a fancy different design.
- Reproduce ALL content faithfully (不偷工减料). The Chinese version keeps the original wording; the English version is a faithful, complete translation in the IDENTICAL layout.`;
  }
  const p = t.pal;
  return `TEMPLATE STYLE — apply this EXACT palette and layout to BOTH resumes (identical look, only the language differs):
- Palette: page background ${p.bg}, body text ${p.text}, secondary text ${p.muted}, divider/border ${p.line}, primary (headings/dividers) ${p.primary}, accent ${p.accent}${p.side ? `, sidebar background ${p.side} with ${p.sideText} text` : ""}.
- Layout: ${t.layout}
- Fonts: ${t.font}.
- Keep the accent color under ~10% of the page (markers/links only). Consistent spacing; one page if possible.`;
}
function tplThumb(t) {
  const p = t.pal;
  const barCol = t.dark ? "rgba(255,255,255,.16)" : p.line;
  const bars = (n, light) =>
    Array.from({ length: n })
      .map((_, i) => `<div class="m-bar" style="background:${light || barCol};width:${[92, 78, 86, 68][i % 4]}%"></div>`)
      .join("");
  if (t.auto) {
    return `<div class="mock" style="background:linear-gradient(135deg,#f6f7ff,#eef1ff)">
      <div style="font-size:13px;line-height:1;margin-bottom:8px">✦</div>
      <div class="m-h" style="background:${p.primary}"></div>
      <div class="m-s" style="background:${p.accent}"></div>
      ${bars(5)}
    </div>`;
  }
  if (t.two) {
    return `<div class="mock two" style="background:${p.bg}">
      <div class="m-side" style="background:${p.side}">
        <div class="m-h" style="background:rgba(255,255,255,.9);width:74%"></div>
        ${bars(4, "rgba(255,255,255,.5)")}
      </div>
      <div class="m-main">
        <div class="m-h" style="background:${p.primary}"></div>
        <div class="m-s" style="background:${p.accent}"></div>
        ${bars(5)}
      </div></div>`;
  }
  return `<div class="mock" style="background:${p.bg}">
    <div class="m-h" style="background:${p.primary}"></div>
    <div class="m-s" style="background:${p.accent}"></div>
    ${bars(6)}
  </div>`;
}
function renderTemplates() {
  const grid = $("templateGrid");
  if (!grid) return;
  const sel = getTemplate();
  grid.innerHTML = TEMPLATES.map(
    (t) => `<div class="tpl-card ${t.id === sel ? "selected" : ""}" data-tpl="${t.id}">
      <div class="tpl-thumb">${tplThumb(t)}<div class="tpl-check">✓</div></div>
      <div class="tpl-meta"><div class="tpl-name">${t.name}</div><div class="tpl-desc">${t.desc}</div></div>
    </div>`
  ).join("");
  grid.querySelectorAll("[data-tpl]").forEach((c) =>
    c.addEventListener("click", () => {
      localStorage.setItem(LS_TPL, c.dataset.tpl);
      grid.querySelectorAll(".tpl-card").forEach((x) => x.classList.toggle("selected", x === c));
    })
  );
}

// ================= 步骤导航 =================
let maxStep = 1;
function goStep(n) {
  maxStep = Math.max(maxStep, n);
  document.querySelectorAll(".stage").forEach((s) => s.classList.toggle("hidden", +s.dataset.step !== n));
  document.querySelectorAll(".step-pill").forEach((p) => {
    const k = +p.dataset.go;
    p.classList.toggle("active", k === n);
    p.classList.toggle("done", k < n);
  });
  document.body.classList.toggle("wide-step", n === 2); // 步骤2=对照编辑，宽布局
  window.scrollTo({ top: 0, behavior: "smooth" });
}
document.querySelectorAll(".step-pill").forEach((p) =>
  p.addEventListener("click", () => {
    const k = +p.dataset.go;
    if (k === 1) return goStep(1);
    if (k === 2 && maxStep >= 2) return goStep(2); // 已生成过才能跳到编辑步
  })
);
$("backTo2Btn").addEventListener("click", () => goStep(1)); // 返回上传·设置

// ================= 付费门禁（静态 MVP：localStorage 记次，真验证需后端） =================
const LS_FREE = "rt_free_used";
const LS_PAID = "rt_paid_credits";
function paidCredits() {
  return parseInt(localStorage.getItem(LS_PAID) || "0", 10) || 0;
}
function freeUsed() {
  return localStorage.getItem(LS_FREE) === "1";
}
function availableCredits() {
  return (freeUsed() ? 0 : 1) + paidCredits();
}
function hasCredit() {
  return !backendMode || availableCredits() > 0; // 自带key模式不限次
}
function consumeCredit() {
  if (!backendMode) return; // 自带key模式不扣次
  if (!freeUsed()) localStorage.setItem(LS_FREE, "1");
  else localStorage.setItem(LS_PAID, String(Math.max(0, paidCredits() - 1)));
  updateCredit();
}
function updateCredit() {
  const b = $("creditBadge");
  if (!b) return;
  const n = availableCredits();
  b.textContent = n > 0 ? `剩余 ${n} 次` : "次数用完";
  b.style.color = n > 0 ? "" : "var(--warn)";
}
function showPaywall() {
  $("paywallModal").classList.remove("hidden");
}
$("closePaywallBtn").addEventListener("click", () => $("paywallModal").classList.add("hidden"));
$("paidBtn").addEventListener("click", () => {
  localStorage.setItem(LS_PAID, String(paidCredits() + 2));
  $("paywallModal").classList.add("hidden");
  updateCredit();
  flash($("paidBtn"), "✓ 已解锁 +2 次");
});

// ================= overlay =================
function showOverlay(t) {
  overlayText.textContent = t || "处理中…";
  overlay.classList.remove("hidden");
}
function hideOverlay() {
  overlay.classList.add("hidden");
}

// ================= 初始化 =================
renderTemplates();
detectMode(); // 探测是否有后端代理，决定"内置key+付费" vs "自带key开源"模式
