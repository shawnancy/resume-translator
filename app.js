// 简历翻译器 —— 任意格式中文简历 → 保留版式的英文简历
// 多引擎可插拔：DeepSeek（文字型，OpenAI 兼容）/ Gemini（多模态可看图）
// 管线：输入 → {图像[], 文本} → LLM 翻译+重建 HTML → 预览/导出
import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs";
import { TEMPLATES_3D, buildResumeData, build3DHtml, encodeShareHash } from "./templates3d.js?v=20260707g";
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

// ===== 免翻译直通道(07-07 大王: 可以不翻译直接进简历模块) =====
// 原文简历(粘贴/PDF/docx/图片OCR) → 结构化HTML挂中文栏 → 直接开3D向导(默认仅中文)。
// 之后想要英文版, 用编辑页的「改完中文重新翻译」即可。
function textToHtml(text) {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const body = lines.map((l, i) => (i === 0 ? `<h1>${escapeHtml(l)}</h1>` : `<p>${escapeHtml(l)}</p>`)).join("\n");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    @page{size:A4;margin:0}body{font-family:'PingFang SC','Microsoft YaHei',sans-serif;width:794px;padding:40px;font-size:14px;line-height:1.7;color:#222}
    h1{font-size:26px;margin:0 0 10px}p{margin:0 0 8px}
  </style></head><body>${body}</body></html>`;
}
$("skipBtn").addEventListener("click", async () => {
  if (!current) return alert("请先上传或粘贴简历");
  try {
    let t = current.text;
    if (!t && current.images?.length) t = await ocrImages(current.images);
    if (!t || t.replace(/\s/g, "").length < 20) throw new Error("没读到足够的简历文字，请换清晰一点的文件或直接粘贴文本");
    const zhHtml = injectPhoto(textToHtml(t), current.photo || null);
    mountEditable($("zhFrame"), zhHtml);
    $("enFrame").removeAttribute("srcdoc");
    $("bilingual").className = "bilingual view-zh";
    document.querySelectorAll(".vt").forEach((x) => x.classList.toggle("active", x.dataset.view === "zh"));
    goStep(2);
    // 未翻译 → 3D 默认仅中文
    langMode3d = "zh";
    document.querySelectorAll("#langPills .lp").forEach((x) => x.classList.toggle("selected", x.dataset.lm === "zh"));
    setTimeout(open3dWizard, 350);
  } catch (e) {
    alert(e.message);
  } finally {
    hideOverlay();
  }
});

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
    showOverlay(`正在生成中英双语简历（约 1–2 分钟，长简历更久，请勿关闭页面）…`);
    let result;
    try {
      result = await generateBoth(input, currentOpts());
    } catch (e) {
      if (e.needPayment) throw e; // 次数用完 → 直接弹付费, 不做OCR回退
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
    // 生成完成后询问要不要做 3D 简历网页(用户自主选, 大王 07-07 定)
    setTimeout(() => $("ask3d").classList.remove("hidden"), 450);
  } catch (err) {
    console.error(err);
    if (err.needPayment) { hideOverlay(); return showPaywall(); }
    alert("生成失败：" + err.message);
  } finally {
    hideOverlay();
  }
}

// ---- Prompt 组装 ----
function sharedRules(hasPhoto) {
  const imgRule = hasPhoto
    ? "Do NOT include any <img> tag or photo placeholder — the candidate photo is inserted programmatically at the top-right of the header afterwards. Keep the top-right area of the header free of long text so a 96px-wide photo fits beside it."
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
- TRANSLATE EVERY VISIBLE STRING into ${lang}: all section headings (求职意向→Career Objective, 教育背景→Education, 工作经历→Work Experience, 项目经历→Projects, 技能→Skills), all labels (熟练→Proficient, 了解→Familiar with, 至今→Present), and EVERY bullet/sentence. The final HTML must contain ZERO Chinese characters — leaving any Chinese untranslated is a hard failure.
Output ONLY the HTML document (start with <!DOCTYPE html>), no fences, no commentary.

${styleBlock(template)}

${sharedRules(hasPhoto)}`;
}

// 照片确定性注入(07-07 大王实测模型摆位必翻车: 曾贴在 Skills 标题旁) —— 不再信模型:
// 清掉任何残留占位, 由我们把照片以 float:right 插在第一个 <h1>(名字)前 → 恒定出现在页眉右上。
function injectPhoto(html, photo) {
  if (!photo || !html) return html;
  let s = html.split("__PHOTO_0__").join("");
  const block =
    `<div style="float:right;width:96px;margin:0 0 10px 16px"><img src="${photo}" alt="photo" ` +
    `style="width:96px;height:auto;display:block;border-radius:0"></div>`;
  if (/<h1[\s>]/i.test(s)) return s.replace(/(<h1[\s>])/i, block + "$1");
  if (/<body[^>]*>/i.test(s)) return s.replace(/(<body[^>]*>)/i, "$1" + block);
  return block + s;
}

// ---- 生成：中英两份 / 仅英文 ----
async function generateBoth(input, opts) {
  const userText = input.text
    ? "Resume content (Chinese, line breaks preserved):\n\n" + input.text.slice(0, 16000)
    : "The resume is in the attached image(s). Transcribe and use it.";
  const sys = bothSystem({ ...opts, hasPhoto: !!input.photo });
  const raw = await callLLM({ system: sys, userText, images: input.images });
  // 健壮解析: 模型输出会漂(分隔符放开头/出现两次/文档顺序颠倒/DOCTYPE后插```围栏),
  // 天真的"按第一个SPLIT切一刀"会切出空英文=白屏。改为: 按<!DOCTYPE切出所有文档, 按中文占比认领中/英。
  const docs = extractDocs(raw);
  let en = "", zh = "";
  if (docs.length >= 2) {
    const sorted = docs.map((d) => ({ d, r: cjkRatio(d) })).sort((a, b) => a.r - b.r);
    en = sorted[0].d;                  // 中文占比最低的 = 英文版
    zh = sorted[sorted.length - 1].d;  // 最高的 = 中文版
  } else if (docs.length === 1) {
    if (cjkRatio(docs[0]) > 0.05) zh = docs[0];
    else en = docs[0];
  }
  if (!en) throw new Error("模型这次没有输出英文版（偶发），请再点一次生成");
  return { enHtml: injectPhoto(en, input.photo), zhHtml: injectPhoto(zh, input.photo) };
}
// 从模型原始输出里切出所有完整 HTML 文档(容忍围栏/分隔符残留/顺序漂移)
function extractDocs(raw) {
  let s = String(raw || "")
    .replace(/```html/gi, "").replace(/```/g, "")
    .replace(/<\|begin_of_box\|>|<\|end_of_box\|>/g, ""); // glm 偶发盒子标记
  const idx = [];
  const re = /<!DOCTYPE\s+html/gi;
  let m;
  while ((m = re.exec(s))) idx.push(m.index);
  if (!idx.length) { const i = s.search(/<html[\s>]/i); if (i >= 0) idx.push(i); }
  const docs = [];
  for (let k = 0; k < idx.length; k++) {
    let seg = s.slice(idx[k], k + 1 < idx.length ? idx[k + 1] : undefined);
    seg = seg.split(SPLIT).join("").trim(); // 去掉粘在文档尾部的分隔符
    if (seg.length > 100) docs.push(seg);
  }
  return docs;
}
// 去标签后中文字符占比(用于判断哪份是中文版)
function cjkRatio(html) {
  const t = String(html || "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]*>/g, "");
  const c = (t.match(/[一-鿿]/g) || []).length;
  return c / Math.max(t.length, 1);
}
async function generateEnOnly(zhText, opts) {
  // glm-4.5v 对"仅英文"任务会偷懒只翻专有名词(实测必现) → 输出验中文占比, 超标重试一次
  const sys = enOnlySystem({ ...opts, hasPhoto: !!opts.photo });
  const userText = "Resume content (Chinese):\n\n" + zhText.slice(0, 16000);
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await callLLM({ system: sys, userText, images: [] });
    const html = cleanHtml(raw);
    if (cjkRatio(html) < 0.02) return injectPhoto(html, opts.photo);
    console.warn(`重新翻译第 ${attempt + 1} 次输出仍含中文(占比 ${cjkRatio(html).toFixed(3)}), ${attempt === 0 ? "重试" : "放弃"}`);
  }
  throw new Error("模型没把内容翻全（输出仍含中文），请再点一次重新翻译");
}

// ---- 统一 LLM 调用（双模式）----
// 后端模式: 先向 /api/zhipu-token 要短时JWT, 浏览器直连智谱(生成要1-2分钟, 走服务器代理会被~25s硬超时掐死→504)。
//          JWT拿不到时才回退老代理路(/api/llm, 只适合短输出)。
// 自带 key 模式(开源静态站): 用用户在设置里填的 key 直连。
let _srvJwt = null; // { token, exp }
async function getServerJwt() {
  if (_srvJwt && Date.now() < _srvJwt.exp - 60000) return _srvJwt.token;
  const r = await fetch("/api/zhipu-token", { method: "POST" });
  if (!r.ok) throw new Error("token endpoint " + r.status);
  const d = await r.json();
  if (!d.token) throw new Error("no token");
  _srvJwt = d;
  return d.token;
}
async function callLLM(args) {
  if (backendMode) {
    try {
      const jwt = await getServerJwt();
      return await zhipuDirect(jwt, args.system, args.userText, args.images || []);
    } catch (e) {
      if (e.needPayment) throw e;
      console.warn("JWT直连失败, 回退代理:", e.message);
      return callViaProxy(args);
    }
  }
  return callDirect(args);
}

async function callViaProxy({ system, userText, images }) {
  const resp = await fetch("/api/llm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, userText, images: images || [], token: getToken() }),
  });
  let data = {};
  try { data = await resp.json(); } catch {}
  if (resp.status === 402) {
    const e = new Error("need_payment");
    e.needPayment = true;
    throw e;
  }
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
  if (!hasImg && deepseek) return deepseekDirect(deepseek, system, userText);
  if (!hasImg && zhipu) return zhipuDirect(zhipu, system, userText, []); // 只填了智谱key → 文本也走智谱
  throw new Error(hasImg ? "图片简历需要智谱 Key，请点右上角「Key」按钮填入" : "请点右上角「Key」按钮填入 DeepSeek 或智谱 Key");
}

// SSE 流式读取(OpenAI 兼容 delta 格式)。
// 为什么必须流式: 手机 webview(微信/iOS Safari) fetch 空闲超时~60s, 完整生成要 40-90s,
// 非流式一次性等结果在手机上必被掐死→回退代理又撞 EdgeOne 25s 硬超时→空内容/白屏。
// SSE 持续有数据到达不算空闲, 手机也能等完整个生成。
async function readSSEText(r) {
  let out = "";
  const feed = (line) => {
    const s = line.trim();
    if (!s.startsWith("data:")) return;
    const payload = s.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    try {
      const j = JSON.parse(payload);
      out += j?.choices?.[0]?.delta?.content ?? j?.choices?.[0]?.message?.content ?? "";
      updateOverlayProgress(out.length);
    } catch {}
  };
  if (r.body && r.body.getReader) {
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      lines.forEach(feed);
    }
    feed(buf);
  } else {
    (await r.text()).split("\n").forEach(feed); // 老内核无流读兜底: 整包解析(不防超时但不坏功能)
  }
  return out;
}

async function deepseekDirect(key, system, userText) {
  const r = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [{ role: "system", content: system }, { role: "user", content: userText }],
      temperature: 0.3, max_tokens: 8192, stream: true,
    }),
  });
  if (!r.ok) {
    if (r.status === 401) throw new Error("DeepSeek Key 无效或欠费（401）");
    if (r.status === 402) throw new Error("DeepSeek 余额不足（402）");
    throw new Error(`DeepSeek ${r.status}: ${(await r.text()).slice(0, 160)}`);
  }
  const out = await readSSEText(r);
  if (!out) throw new Error("模型没有返回内容");
  return out;
}

async function zhipuDirect(key, system, userText, images) {
  const content = [{ type: "text", text: system + "\n\n" + userText }];
  for (const img of images.slice(0, 4)) content.push({ type: "image_url", image_url: { url: img } });
  const r = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({ model: "glm-4.5v", messages: [{ role: "user", content }], temperature: 0.3, max_tokens: 16384, thinking: { type: "disabled" }, stream: true }),
  });
  if (!r.ok) {
    if (r.status === 401) throw new Error("智谱 Key 无效（401）");
    throw new Error(`智谱 ${r.status}: ${(await r.text()).slice(0, 160)}`);
  }
  const out = await readSSEText(r);
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
// 简历页固定 A4 宽 794px, 手机/对照双栏塞不下 → 把 iframe 整体缩放到容器宽, 横向一次看全
const PAGE_W = 794;
function fitFrame(frame) {
  const clip = frame.parentElement;
  if (!clip || !clip.classList.contains("frame-clip") || clip.offsetParent === null) return;
  const w = clip.clientWidth;
  const h = clip.clientHeight;
  if (!w || !h) return;
  const scale = Math.min(1, w / PAGE_W);
  if (scale >= 0.999) {
    frame.style.width = "100%"; frame.style.height = "100%"; frame.style.transform = "";
  } else {
    frame.style.width = PAGE_W + "px";
    frame.style.height = Math.round(h / scale) + "px";
    frame.style.transform = `scale(${scale})`;
  }
}
function fitAllFrames() { document.querySelectorAll(".pane iframe").forEach(fitFrame); }
window.addEventListener("resize", fitAllFrames);

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
      fitFrame(frame);
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
    if (e.needPayment) { hideOverlay(); return showPaywall(); }
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
    fitAllFrames(); // 切视图后栏宽变了, 重算缩放
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
// 模板固定「自动」= 忠实复刻原简历版式(大王 07-07 定: 撤掉普通模板选择器, 风格只在 3D 简历里选)
function getTemplate() {
  return "auto";
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
// ================= 3D 简历 =================
// 灵感取自日常收集「AI简历模板39资源」: 玻璃拟态 / 赛博霓虹 / 复古终端。
// 产物 = 零依赖单文件 HTML, 内嵌中英双份数据, 打开按浏览器语言自动切换, 可下载分享/当个人主页。
const LS_3D = "rt_3dtpl";
function get3dTpl() {
  const id = localStorage.getItem(LS_3D);
  return TEMPLATES_3D.some((t) => t.id === id) ? id : TEMPLATES_3D[0].id;
}
function render3dGrid() {
  const grid = $("grid3d");
  const sel = get3dTpl();
  grid.innerHTML = TEMPLATES_3D.map(
    (t) => `<div class="tpl3d ${t.id === sel ? "selected" : ""}" data-t3d="${t.id}">
      <div class="t3d-thumb t3d-${t.id}">${thumb3d(t.id)}</div>
      <div class="t3d-meta"><div class="tpl-name">${t.name}</div><div class="tpl-desc">${t.desc}</div></div>
      <div class="tpl-check">✓</div>
    </div>`
  ).join("");
  grid.querySelectorAll("[data-t3d]").forEach((c) =>
    c.addEventListener("click", () => {
      localStorage.setItem(LS_3D, c.dataset.t3d);
      grid.querySelectorAll(".tpl3d").forEach((x) => x.classList.toggle("selected", x === c));
    })
  );
}
function thumb3d(id) {
  if (id === "game")
    return `<div class="gm-sun"></div><div class="gm-cloud"></div><div class="gm-flag"></div>
      <div class="gm-board"><i></i><i class="w60"></i></div><div class="gm-char"></div><div class="gm-ground"></div>`;
  if (id === "orbit")
    return `<div class="ob-star s1"></div><div class="ob-star s2"></div>
      <div class="ob-ring"><div class="ob-p p1"><i></i><i class="w60"></i></div><div class="ob-p p2"></div><div class="ob-p p3"></div></div>`;
  return `<div class="t-lines"><span>$ whoami</span><span class="t-g">&gt; resume --lang auto</span><span class="t-g">&gt; loading ▍</span></div>`;
}
function build3dData() {
  const zhDoc = $("zhFrame").contentDocument;
  const enDoc = $("enFrame").contentDocument;
  const zhOk = zhDoc?.body && zhDoc.body.textContent.trim().length > 20;
  const enOk = enDoc?.body && enDoc.body.textContent.trim().length > 20;
  if (!zhOk && !enOk) throw new Error("请先生成简历，再制作 3D 版");
  return buildResumeData(zhOk ? zhDoc : null, enOk ? enDoc : null, current?.photo || null);
}
// 语言模式: auto=双语自动切 / zh=仅中文 / en=仅英文
let langMode3d = "auto";
document.querySelectorAll("#langPills .lp").forEach((b) =>
  b.addEventListener("click", () => {
    langMode3d = b.dataset.lm;
    document.querySelectorAll("#langPills .lp").forEach((x) => x.classList.toggle("selected", x === b));
  })
);
function open3dWizard() {
  render3dGrid();
  $("pubResult").classList.add("hidden");
  $("modal3d").classList.remove("hidden");
}
$("open3dBtn").addEventListener("click", open3dWizard);
$("ask3dNo").addEventListener("click", () => $("ask3d").classList.add("hidden"));
$("ask3dGo").addEventListener("click", () => {
  $("ask3d").classList.add("hidden");
  open3dWizard();
});
$("close3dBtn").addEventListener("click", () => $("modal3d").classList.add("hidden"));
$("prev3dBtn").addEventListener("click", () => {
  try {
    const html = build3DHtml(get3dTpl(), build3dData(), langMode3d);
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    alert(e.message);
  }
});
$("dl3dBtn").addEventListener("click", () => {
  try {
    const data = build3dData();
    const html = build3DHtml(get3dTpl(), data, langMode3d);
    const name = (data.zh?.name || data.en?.name || "Resume").replace(/[\\/:*?"<>|\s]+/g, "_");
    downloadBlob(new Blob([html], { type: "text/html" }), `简历网页_${name}.html`);
    flash($("dl3dBtn"), "✓ 已下载");
  } catch (e) {
    alert(e.message);
  }
});
// 一键发布: 简历数据压缩后装进 view.html 的链接锚点 —— 零服务器存储, 链接本身就是简历
$("pub3dBtn").addEventListener("click", async () => {
  const btn = $("pub3dBtn");
  try {
    btn.disabled = true;
    btn.textContent = "正在生成链接…";
    const data = build3dData();
    const payload = {
      t: get3dTpl(),
      m: langMode3d,
      d: {
        photo: data.photo || null,
        zh: langMode3d === "en" ? null : data.zh,
        en: langMode3d === "zh" ? null : data.en,
      },
    };
    let hash = await encodeShareHash(payload);
    let note = "";
    // 带照片可能让链接过长(聊天工具发不动) → 超限自动去掉照片重编
    if (payload.d.photo && hash.length > 24000) {
      payload.d.photo = null;
      hash = await encodeShareHash(payload);
      note = "照片体积较大，链接版已自动省略照片（下载的网页文件里包含照片）。";
    }
    const link = new URL("view.html", location.href).href + "#" + hash;
    $("pubLink").value = link;
    $("pubResult").classList.remove("hidden");
    if (note) $("pubNote").textContent = note + " " + $("pubNote").dataset.base;
    $("pubResult").scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (e) {
    alert("生成链接失败：" + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "一键生成网页链接";
  }
});
$("copyLinkBtn").addEventListener("click", async () => {
  const v = $("pubLink").value;
  try {
    await navigator.clipboard.writeText(v);
  } catch {
    $("pubLink").select();
    document.execCommand("copy");
  }
  flash($("copyLinkBtn"), "✓ 已复制");
});
$("openLinkBtn").addEventListener("click", () => window.open($("pubLink").value, "_blank"));
$("pubNote").dataset.base = $("pubNote").textContent;

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
  if (n === 2) requestAnimationFrame(fitAllFrames); // 面板刚显示出来才有真实宽度, 下一帧再算缩放
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

// ================= 付费门禁（后端模式: 服务端 KV 记次 + XorPay 收款；BYO 模式: 不限次） =================
// 设备令牌: 次数按此绑定(服务端), 持久在本地
function getToken() {
  let t = localStorage.getItem("rt_token");
  if (!t) {
    t = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
    localStorage.setItem("rt_token", t);
  }
  return t;
}
// 次数改由服务端权威判定(402), 前端不预扣; BYO 模式不限次
function hasCredit() {
  return true;
}
function consumeCredit() {
  refreshCredit(); // 服务端已扣, 这里只刷新徽章
}
async function refreshCredit() {
  const b = $("creditBadge");
  if (!b) return;
  if (!backendMode) {
    b.classList.add("hidden");
    return;
  }
  try {
    const r = await fetch(`/api/pay/status?token=${encodeURIComponent(getToken())}`);
    const d = await r.json();
    if (!d.gating) { b.classList.add("hidden"); return; } // 没开门禁=不限次, 不显示次数
    b.classList.remove("hidden");
    b.textContent = d.credits > 0 ? `剩余 ${d.credits} 次` : "次数用完";
    b.style.color = d.credits > 0 ? "" : "var(--warn)";
  } catch {}
}
function updateCredit() {
  refreshCredit();
}

// ---- XorPay 收款流程 ----
let payTimer = null;
function showPaywall() {
  $("payQrBox").classList.add("hidden");
  $("payQr").innerHTML = "";
  $("paywallModal").classList.remove("hidden");
}
async function startPay(method) {
  $("payQrBox").classList.remove("hidden");
  $("payQr").innerHTML = "";
  $("payStatus").textContent = "正在发起支付…";
  try {
    const r = await fetch("/api/pay/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: getToken(), method }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "下单失败 " + r.status);
    new window.QRCode($("payQr"), { text: d.qr, width: 180, height: 180 });
    $("payStatus").textContent = d.mock
      ? "本地模拟：POST /api/pay/_mockpay?order_id=" + d.order_id + " 完成付款"
      : "请用" + (method === "alipay" ? "支付宝" : "微信") + "扫码支付 " + d.price + " 元";
    pollPay(d.order_id);
  } catch (e) {
    $("payStatus").textContent = "发起支付失败：" + e.message;
  }
}
function pollPay(order_id) {
  clearInterval(payTimer);
  payTimer = setInterval(async () => {
    try {
      const r = await fetch(`/api/pay/status?order_id=${order_id}&token=${encodeURIComponent(getToken())}`);
      const d = await r.json();
      if (d.paid) {
        clearInterval(payTimer);
        $("payStatus").textContent = "✓ 支付成功，已到账！";
        refreshCredit();
        setTimeout(() => $("paywallModal").classList.add("hidden"), 1400);
      }
    } catch {}
  }, 2500);
}
document.querySelectorAll(".pay-m").forEach((b) => b.addEventListener("click", () => startPay(b.dataset.method)));
$("closePaywallBtn").addEventListener("click", () => {
  clearInterval(payTimer);
  $("paywallModal").classList.add("hidden");
});

// ================= overlay =================
function showOverlay(t) {
  overlayText.textContent = t || "处理中…";
  overlayText.dataset.base = t || "处理中…";
  overlay.classList.remove("hidden");
}
// 流式生成时把已收到的字符数刷到遮罩上, 让手机用户知道没卡死
function updateOverlayProgress(n) {
  if (overlay.classList.contains("hidden") || !n) return;
  overlayText.textContent = (overlayText.dataset.base || "生成中") + `（已生成 ${n} 字…）`;
}
function hideOverlay() {
  overlay.classList.add("hidden");
}

// ================= 初始化 =================
detectMode(); // 探测是否有后端代理，决定"内置key+付费" vs "自带key开源"模式
