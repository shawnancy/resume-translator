// 3D 简历模板 —— 把生成的中英双语简历变成可分享的 3D 动效单文件网页
// 灵感来源(日常收集·AI简历模板39资源): Figma暗色玻璃拟态 → 星空玻璃; Jesse Zhou赛博拉面店 → 赛博霓虹;
// Henry Heffernan复古电脑桌 → 复古终端。全部纯 CSS3D + canvas 粒子, 零外部依赖(国内打开快, 可当个人主页部署)。
// 输出页特性: 按访客浏览器语言自动显示中/英, 右上角可手动切换(记住选择)。

export const TEMPLATES_3D = [
  {
    id: "glass",
    name: "星空玻璃",
    desc: "暗夜星空 · 玻璃拟态悬浮卡",
    cfg: { tilt: true, tiltMax: 7, fx: "stars", typing: false },
  },
  {
    id: "neon",
    name: "赛博霓虹",
    desc: "透视网格 · 霓虹辉光",
    cfg: { tilt: true, tiltMax: 5, fx: "rise", typing: false },
  },
  {
    id: "terminal",
    name: "复古终端",
    desc: "CRT 扫描线 · 打字机",
    cfg: { tilt: false, tiltMax: 0, fx: "rain", typing: true },
  },
];

// ================= 简历 HTML → 结构化数据 =================
// 不依赖模型输出的具体 DOM 结构：抽"叶子块"文本行 → 按标题/联系方式/日期规则归类。
// 解析不出结构时兜底为单节全文，保证永不空白。

const ZH_SECTION_RE =
  /^(求职意向|个人信息|基本信息|联系方式|个人简介|自我评价|自我介绍|个人总结|个人优势|优势亮点|教育背景|教育经历|工作经历|工作经验|职业经历|实习经历|项目经历|项目经验|主要项目|专业技能|技能特长|技能清单|技能|技能证书|证书|资格证书|荣誉奖项|所获奖项|获奖情况|奖项荣誉|奖项|校园经历|社团经历|语言能力|语言水平|语言|兴趣爱好|科研经历|论文发表|发表论文|培训经历|作品集|作品|其他信息|附加信息)$/;
const EN_SECTION_RE =
  /^(career objective|job objective|objectives?|job intention|desired position|expected position|summary|professional summary|personal summary|career summary|executive summary|profile|personal profile|personal statement|about me|about|work experience|professional experience|experience|employment history|employment|work history|career history|education|educational background|academic background|skills?|technical skills|professional skills|core skills|key skills|skill set|skills & tools|core competencies|competencies|projects?|project experience|selected projects|key projects|internships?|internship experience|certifications?|certificates|licenses & certifications|awards|honors|awards & honors|honors & awards|achievements|key achievements|languages?|language proficiency|publications?|research experience|research|activities|extracurricular activities|campus experience|volunteer experience|volunteering|leadership|training|interests|hobbies|self[- ]?assessment|self[- ]?evaluation|strengths?|core strengths|additional information|references|portfolio|others?)$/i;
// 通用兜底: ≤4 个词的短行、含典型节标题 token、无句读 → 视为节标题(覆盖模型的非常规措辞)
const EN_SECTION_TOKEN_RE =
  /\b(skills?|experience|education|projects?|summary|objective|certifications?|awards?|honors?|languages?|assessment|evaluation|internships?|activities|strengths?|publications?|profile)\b/i;
function looseEnHeading(t) {
  if (t.length > 34 || /[.。,，;；·|｜:：()（）]/.test(t)) return false;
  if (/(19|20)\d{2}/.test(t)) return false;
  const words = t.split(/\s+/);
  return words.length <= 4 && EN_SECTION_TOKEN_RE.test(t);
}
const CONTACT_RE =
  /(@|(\+?\d[\d ()\-]{7,}\d)|电话|手机|邮箱|微信|籍贯|出生|年龄|婚姻|现居|居住地|求职意向[:：]|意向岗位|期望薪资|E-?mail|Tel\b|Phone|Mobile|WeChat|GitHub|LinkedIn|Blog|Portfolio|Website)/i;
const DATE_RANGE_RE =
  /((19|20)\d{2})\s*[年./\-]?\s*\d{0,2}\s*月?\s*(日)?\s*[-–—~〜至到]{1,3}\s*((19|20)\d{2}|至今|现在|Present|Now|Current|Date)/i;

const BLOCK_TAGS = new Set([
  "P","LI","H1","H2","H3","H4","H5","H6","TD","TH","TR","UL","OL","TABLE","TBODY","THEAD",
  "DIV","SECTION","ARTICLE","HEADER","FOOTER","MAIN","ASIDE","BLOCKQUOTE","DL","DT","DD",
]);

function docOf(input) {
  if (typeof input === "string") return new DOMParser().parseFromString(input, "text/html");
  return input; // 已是 Document(iframe.contentDocument, 含用户编辑)
}

// 收集"叶子块"文本行：只取没有块级子元素的元素文本，避免嵌套重复
function collectLines(doc) {
  const lines = [];
  const walk = (el) => {
    const kids = el.children ? Array.from(el.children) : [];
    for (const child of kids) {
      const tag = child.tagName;
      if (tag === "STYLE" || tag === "SCRIPT" || tag === "TITLE" || tag === "HEAD") continue;
      const hasBlockChild = Array.from(child.children).some((c) => BLOCK_TAGS.has(c.tagName));
      if (hasBlockChild) walk(child);
      else {
        const t = (child.textContent || "").replace(/\s+/g, " ").trim();
        if (t && t !== "__PHOTO_0__" && lines.length < 400) lines.push({ text: t, tag });
      }
    }
  };
  const body = doc.body || doc.documentElement;
  if (body) walk(body);
  // 去掉相邻重复(表格里同文案双份)
  const out = [];
  for (const l of lines) if (!out.length || out[out.length - 1].text !== l.text) out.push(l);
  return out;
}

const normHead = (t) => t.replace(/^[\s>•·\-–—*◆●■□▪#\[\]0-9.、()（）]+/, "").replace(/[:：\s]+$/, "").trim();
const stripBullet = (t) => t.replace(/^[\s•·▪●○◦\-–—*]+\s*/, "").trim();

function parseOne(doc, isZh) {
  const lines = collectLines(doc);
  const re = isZh ? ZH_SECTION_RE : EN_SECTION_RE;
  const maxNameLen = isZh ? 14 : 36;

  const isSectionHead = (l) => {
    const n = normHead(l.text);
    if (!n || n.length > (isZh ? 14 : 44)) return false;
    if (re.test(n)) return true;
    if (!isZh && looseEnHeading(n)) return true;
    // 自定义小节：模型用了 h2/h3/h4 且很短、无日期、非联系方式
    if (/^H[2-4]$/.test(l.tag) && n.length <= (isZh ? 10 : 30) && !DATE_RANGE_RE.test(l.text) && !CONTACT_RE.test(l.text))
      return true;
    return false;
  };

  // 名字：前几行里的 H1，否则第一条短且非联系方式的行
  let nameIdx = -1;
  for (let i = 0; i < Math.min(lines.length, 6); i++) {
    if (lines[i].tag === "H1" && lines[i].text.length <= 40) { nameIdx = i; break; }
  }
  if (nameIdx < 0) {
    for (let i = 0; i < Math.min(lines.length, 5); i++) {
      const t = lines[i].text;
      if (t.length <= maxNameLen && !CONTACT_RE.test(t) && !isSectionHead(lines[i])) { nameIdx = i; break; }
    }
  }
  let name = nameIdx >= 0 ? lines[nameIdx].text : (isZh ? "我的简历" : "My Resume");
  name = name.replace(/(的简历|个人简历|简历)$/,"").replace(/('s)?\s*(Resume|CV)$/i, "").trim() || name;

  // 第一节标题的位置
  let firstSec = lines.length;
  for (let i = 0; i < lines.length; i++) if (isSectionHead(lines[i])) { firstSec = i; break; }

  // 名字与第一节之间：联系方式 chips + 一句话 tagline
  const contacts = [];
  let tagline = "";
  const preLines = [];
  for (let i = 0; i < firstSec; i++) {
    if (i === nameIdx) continue;
    const t = lines[i].text;
    if (CONTACT_RE.test(t)) {
      t.split(/\s*[|｜•·丨/]\s*|\s{2,}/).forEach((p) => {
        const s = p.trim();
        if (s && s.length <= 60 && contacts.length < 8 && !contacts.includes(s)) contacts.push(s);
      });
    } else if (!tagline && t.length <= (isZh ? 40 : 80)) tagline = t;
    else preLines.push(stripBullet(t));
  }

  // 分节（先收集每节原始行，再配对合并"职位行+日期行"，最后组条目）
  const rawSections = [];
  let curRaw = null;
  for (let i = firstSec; i < lines.length; i++) {
    const l = lines[i];
    if (isSectionHead(l)) {
      curRaw = { title: normHead(l.text), lines: [] };
      rawSections.push(curRaw);
    } else if (curRaw) curRaw.lines.push(l);
  }
  // 日期独立成行时(模型常把 公司·职位 与 日期 分开排), 与相邻的短标题行合并成一个条目头
  const isDateOnly = (t) =>
    DATE_RANGE_RE.test(t) && t.replace(DATE_RANGE_RE, "").replace(/[\s·|｜，,。.\-–—:：()（）]/g, "").length <= 2;
  const isShortTitle = (l) =>
    l && l.tag !== "LI" && l.text.length <= 56 && !/[。；;!！?？]/.test(l.text) && !DATE_RANGE_RE.test(l.text) && !/^[•·▪\-–—*]/.test(l.text);
  const sections = rawSections.map((rs) => {
    const merged = [];
    for (let i = 0; i < rs.lines.length; i++) {
      const l = rs.lines[i];
      if (isDateOnly(l.text)) {
        const prev = merged[merged.length - 1];
        if (prev && !prev.isHead && isShortTitle(prev)) {
          merged[merged.length - 1] = { text: prev.text + "　" + l.text, tag: prev.tag, isHead: true };
          continue;
        }
        if (isShortTitle(rs.lines[i + 1])) {
          merged.push({ text: rs.lines[i + 1].text + "　" + l.text, tag: l.tag, isHead: true });
          i++;
          continue;
        }
      }
      merged.push({ ...l });
    }
    const sec = { title: rs.title, items: [] };
    let curItem = null;
    const pushItem = (head) => { curItem = { head, lines: [] }; sec.items.push(curItem); };
    for (const l of merged) {
      const t = l.text;
      const isItemHead = l.isHead || DATE_RANGE_RE.test(t) || (/^H[3-5]$/.test(l.tag) && t.length <= 60);
      if (isItemHead) pushItem(t);
      else {
        if (!curItem) pushItem(null);
        const s = stripBullet(t);
        if (s && curItem.lines.length < 40) curItem.lines.push(s);
      }
    }
    return sec;
  });
  if (preLines.length) sections.unshift({ title: isZh ? "简介" : "Profile", items: [{ head: null, lines: preLines }] });

  // 兜底：一节都没解析出来 → 全文单节
  if (!sections.length) {
    const rest = lines.filter((_, i) => i !== nameIdx).map((l) => stripBullet(l.text)).filter(Boolean);
    sections.push({ title: isZh ? "简历内容" : "Resume", items: [{ head: null, lines: rest.slice(0, 120) }] });
  }
  return { name, tagline, contacts, sections };
}

// zhInput / enInput: HTML 字符串或 iframe.contentDocument；photo: dataURL 或 null
export function buildResumeData(zhInput, enInput, photo) {
  const data = { photo: photo || null, zh: null, en: null };
  try { if (zhInput) data.zh = parseOne(docOf(zhInput), true); } catch (e) { console.warn("解析中文简历失败", e); }
  try { if (enInput) data.en = parseOne(docOf(enInput), false); } catch (e) { console.warn("解析英文简历失败", e); }
  if (!data.zh && !data.en) throw new Error("没有可用的简历内容");
  // 英文名字兜底用中文的(反之亦然)，保证两种语言都能展示
  if (!data.zh) data.zh = data.en;
  if (!data.en) data.en = data.zh;
  return data;
}

// ================= 分享链接（零存储：数据压缩后编进 URL 锚点） =================
// 锚点格式: #g<base64url(gzip(json))> 或 #r<base64url(json)>(老浏览器降级)。
// json = { t: 模板id, m: 语言模式, d: 简历数据 }。数据只活在链接里, 不存任何服务器。

function b64urlEncode(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function encodeShareHash(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  if (typeof CompressionStream !== "undefined") {
    const cs = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
    const buf = new Uint8Array(await new Response(cs).arrayBuffer());
    return "g" + b64urlEncode(buf);
  }
  return "r" + b64urlEncode(bytes);
}

export async function decodeShareHash(hash) {
  const s = (hash || "").replace(/^#/, "");
  if (!s) throw new Error("链接里没有简历数据");
  const kind = s[0];
  let bytes;
  try {
    bytes = b64urlDecode(s.slice(1));
  } catch {
    throw new Error("链接不完整（可能被聊天工具截断了），请让对方重新完整复制整段链接");
  }
  let jsonBytes;
  if (kind === "g") {
    if (typeof DecompressionStream === "undefined") throw new Error("当前浏览器版本过旧，请换 Chrome / Edge / Safari 新版打开");
    try {
      const ds = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
      jsonBytes = new Uint8Array(await new Response(ds).arrayBuffer());
    } catch {
      throw new Error("链接不完整（可能被聊天工具截断了），请让对方重新完整复制整段链接");
    }
  } else if (kind === "r") jsonBytes = bytes;
  else throw new Error("链接格式不对（可能被聊天工具截断，请完整复制整段链接）");
  try {
    return JSON.parse(new TextDecoder().decode(jsonBytes));
  } catch {
    throw new Error("链接不完整（可能被聊天工具截断了），请让对方重新完整复制整段链接");
  }
}

// ================= 生成的 3D 页面 =================
// 注意：以下运行时 JS/CSS 是"产物页"的代码，刻意不用反引号，方便包在模板字符串里。

const SHARED_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{min-height:100vh;overflow-x:hidden;-webkit-font-smoothing:antialiased;line-height:1.65}
#fx{position:fixed;inset:0;z-index:0;pointer-events:none}
.scene{position:relative;z-index:4;perspective:1300px;max-width:860px;margin:0 auto;padding:72px 22px 46px}
.stage{transform-style:preserve-3d;will-change:transform;transition:opacity .22s,filter .22s}
body.switching .stage{opacity:0;filter:blur(4px)}
#langBtn{position:fixed;top:16px;right:16px;z-index:9;cursor:pointer;font:600 13px/1 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;padding:9px 14px;border-radius:22px;transition:.2s;letter-spacing:.03em}
#langBtn:hover{transform:translateY(-1px)}
.hero{text-align:center;margin-bottom:44px}
.avatar{display:flex;justify-content:center;margin-bottom:18px}
.avatar img{width:96px;height:96px;object-fit:cover}
.name{font-size:clamp(30px,6vw,52px);letter-spacing:.02em;line-height:1.2}
.tagline{margin-top:10px;font-size:clamp(14px,2.4vw,17px);opacity:.85}
.chips{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:18px}
.chip{font-size:12.5px;padding:5px 12px;border-radius:20px;word-break:break-all}
.card{margin-bottom:22px;padding:26px 28px;opacity:0;transform:translateY(36px) rotateX(10deg);transition:transform .7s cubic-bezier(.2,.7,.2,1),opacity .7s}
.card.in{opacity:1;transform:none}
.sec-t{font-size:17px;display:flex;align-items:center;gap:10px;margin-bottom:14px;letter-spacing:.04em}
.sec-i{font-size:12px;opacity:.7;font-weight:400}
.item{margin-bottom:14px}
.item:last-child{margin-bottom:0}
.i-head{font-weight:650;font-size:14.5px;margin-bottom:5px}
.i-lines{list-style:none;font-size:13.5px}
.i-lines li{padding-left:16px;position:relative;margin-bottom:4px;opacity:.9}
.i-lines li:before{content:"▸";position:absolute;left:0;opacity:.55;font-size:11px;top:2px}
.foot{text-align:center;font-size:12px;opacity:.5;margin-top:36px}
@media(max-width:640px){.scene{padding:60px 14px 34px}.card{padding:20px 17px}.name{letter-spacing:0}}
@media(prefers-reduced-motion:reduce){.card{transition:none;opacity:1;transform:none}}
`;

const TPL_CSS = {
  glass: `
body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB",sans-serif;color:#eef0ff;
background:radial-gradient(1100px 750px at 72% -12%,#3b2f78 0%,rgba(59,47,120,0) 55%),
radial-gradient(950px 700px at 6% 108%,#14406b 0%,rgba(20,64,107,0) 60%),#0b1026}
.orb{position:fixed;border-radius:50%;filter:blur(70px);opacity:.35;z-index:1;pointer-events:none;animation:drift 16s ease-in-out infinite alternate}
.orb.a{width:340px;height:340px;background:#635bff;top:-90px;left:-70px}
.orb.b{width:280px;height:280px;background:#0ea5e9;bottom:-60px;right:-40px;animation-delay:-8s}
@keyframes drift{to{transform:translate(46px,30px) scale(1.12)}}
#langBtn{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.22);color:#fff;backdrop-filter:blur(10px)}
.avatar img{border-radius:50%;border:2px solid rgba(255,255,255,.35);box-shadow:0 0 0 6px rgba(139,147,255,.18),0 12px 40px rgba(0,0,0,.45)}
.name{font-weight:760;background:linear-gradient(115deg,#fff 30%,#aab4ff 75%,#7dd3fc);-webkit-background-clip:text;background-clip:text;color:transparent}
.chip{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16);color:#dfe3ff;backdrop-filter:blur(8px)}
.card{background:rgba(255,255,255,.065);border:1px solid rgba(255,255,255,.14);border-radius:22px;backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);box-shadow:0 18px 50px rgba(2,6,32,.45),inset 0 1px 0 rgba(255,255,255,.12)}
.sec-t{color:#c7cdff}.sec-i{color:#8b93ff}
.i-head{color:#fff}.i-lines li:before{color:#8b93ff}
.tagline{color:#b8c0ea}
`,
  neon: `
body{font-family:"Avenir Next",-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#d9faff;background:#05060d}
.grid-floor{position:fixed;left:-55%;right:-55%;bottom:-12vh;height:62vh;z-index:1;pointer-events:none;
background-image:linear-gradient(rgba(34,225,255,.25) 1px,transparent 1px),linear-gradient(90deg,rgba(34,225,255,.25) 1px,transparent 1px);
background-size:46px 46px;transform:perspective(420px) rotateX(63deg);
-webkit-mask-image:linear-gradient(transparent 4%,#000 46%);mask-image:linear-gradient(transparent 4%,#000 46%);
animation:gridmove 2.4s linear infinite}
@keyframes gridmove{to{background-position:0 46px,0 0}}
.sun{position:fixed;left:50%;bottom:26vh;width:230px;height:230px;margin-left:-115px;border-radius:50%;z-index:0;pointer-events:none;
background:radial-gradient(circle at 50% 38%,#ff3ea5,#7b2ff7 68%,transparent 72%);filter:blur(6px);opacity:.32}
#langBtn{background:rgba(5,10,20,.7);border:1px solid rgba(34,225,255,.5);color:#22e1ff;box-shadow:0 0 14px rgba(34,225,255,.35)}
.avatar img{border-radius:12px;border:1px solid rgba(34,225,255,.65);box-shadow:0 0 18px rgba(34,225,255,.5),0 0 46px rgba(255,62,165,.25)}
.name{font-weight:800;color:#fff;text-transform:uppercase;letter-spacing:.06em;
text-shadow:0 0 8px rgba(34,225,255,.9),0 0 26px rgba(34,225,255,.55),0 0 64px rgba(123,47,247,.55);animation:flicker 4.2s linear infinite}
@keyframes flicker{0%,93%,95.5%,100%{opacity:1}94%,95%{opacity:.55}}
.tagline{color:#8fd8e8;letter-spacing:.14em;text-transform:uppercase;font-size:13px}
.chip{border:1px solid rgba(34,225,255,.4);color:#a9ecf7;background:rgba(34,225,255,.06)}
.card{background:rgba(8,12,24,.78);border:1px solid rgba(34,225,255,.32);border-radius:14px;position:relative;
box-shadow:0 0 22px rgba(34,225,255,.13),inset 0 0 32px rgba(34,225,255,.05)}
.card:after{content:"";position:absolute;top:-1px;left:18px;right:18px;height:1px;background:linear-gradient(90deg,transparent,#22e1ff,transparent);opacity:.7}
.sec-t{color:#ff3ea5;text-transform:uppercase;letter-spacing:.12em;font-size:14.5px;text-shadow:0 0 12px rgba(255,62,165,.5)}
.sec-i{color:#22e1ff}
.i-head{color:#eafcff}.i-lines li:before{color:#22e1ff;content:"◆";font-size:8px;top:5px}
`,
  terminal: `
body{font-family:ui-monospace,"SF Mono",Menlo,Consolas,"Courier New",monospace;color:#4ade80;background:#040804}
.scan{position:fixed;inset:0;z-index:6;pointer-events:none;background:repeating-linear-gradient(0deg,rgba(0,0,0,.24) 0 1px,transparent 1px 3px)}
.vig{position:fixed;inset:0;z-index:6;pointer-events:none;background:radial-gradient(ellipse at center,transparent 52%,rgba(0,0,0,.55))}
#langBtn{background:#06120a;border:1px solid rgba(74,222,128,.55);color:#4ade80;border-radius:6px;font-family:inherit}
.scene{max-width:780px}
.hero{text-align:left;border:1px solid rgba(74,222,128,.4);border-radius:10px;padding:24px 26px;background:rgba(6,18,10,.72);box-shadow:0 0 26px rgba(74,222,128,.1),inset 0 0 40px rgba(74,222,128,.05)}
.hero:before{content:"visitor@resume:~$ whoami";display:block;font-size:12px;opacity:.6;margin-bottom:12px}
.avatar{justify-content:flex-start}
.avatar img{border-radius:6px;border:1px solid rgba(74,222,128,.55);filter:grayscale(1) sepia(1) hue-rotate(66deg) saturate(2.6) brightness(.95)}
.name{font-weight:700;color:#a7f3c0;text-shadow:0 0 12px rgba(74,222,128,.65)}
.name:after{content:"▍";margin-left:6px;animation:blink 1s steps(1) infinite;color:#4ade80}
@keyframes blink{50%{opacity:0}}
.tagline{color:#86efac;opacity:.9}
.chips{justify-content:flex-start}
.chip{border:1px solid rgba(74,222,128,.35);color:#86efac;border-radius:6px;background:rgba(74,222,128,.05)}
.card{background:rgba(6,18,10,.72);border:1px solid rgba(74,222,128,.32);border-radius:10px;box-shadow:0 0 18px rgba(74,222,128,.07)}
.card{transform:translateY(26px);}
.sec-t{color:#bbf7d0;text-shadow:0 0 10px rgba(74,222,128,.5)}
.sec-t:before{content:"> "}
.sec-i{color:#4ade80;opacity:.6}
.i-head{color:#d1fae5}
.i-lines li{color:#86efac}
.i-lines li:before{content:"-";top:0;font-size:13px}
.foot{color:#4ade80}
`,
};

const TPL_DECOR = {
  glass: '<div class="orb a"></div><div class="orb b"></div>',
  neon: '<div class="sun"></div><div class="grid-floor"></div>',
  terminal: '<div class="scan"></div><div class="vig"></div>',
};

// 产物页运行时（ES5 风格、无反引号）：语言自动检测+切换 / 渲染 / 3D tilt / 粒子 / 进场动画 / 打字机
const RUNTIME_JS = `
(function(){
  var body=document.body,stage=document.getElementById('stage');
  var single=!(DATA.zh&&DATA.en); // 只带一种语言(仅中文/仅英文版) → 不显示切换按钮
  var lang=null;try{lang=localStorage.getItem('r3d_lang')}catch(e){}
  if(lang!=='zh'&&lang!=='en'){lang=((navigator.language||navigator.userLanguage||'en')+'').toLowerCase().indexOf('zh')===0?'zh':'en'}
  if(!DATA[lang])lang=DATA.zh?'zh':'en';
  if(single)document.getElementById('langBtn').style.display='none';
  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
  var IO=('IntersectionObserver' in window)?new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');IO.unobserve(e.target)}})},{threshold:.1}):null;
  function render(){
    var d=DATA[lang];
    document.documentElement.lang=lang==='zh'?'zh-CN':'en';
    document.title=d.name+(lang==='zh'?' · 3D 简历':' · Interactive Resume');
    var h='';
    if(DATA.photo)h+='<div class="avatar"><img src="'+DATA.photo+'" alt=""></div>';
    h+='<h1 class="name" id="bigName">'+esc(d.name)+'</h1>';
    if(d.tagline)h+='<p class="tagline">'+esc(d.tagline)+'</p>';
    if(d.contacts&&d.contacts.length)h+='<div class="chips">'+d.contacts.map(function(c){return '<span class="chip">'+esc(c)+'</span>'}).join('')+'</div>';
    document.getElementById('hero').innerHTML=h;
    var out='';
    d.sections.forEach(function(s,i){
      out+='<section class="card" style="transition-delay:'+(i*70)+'ms"><h2 class="sec-t"><span class="sec-i">'+((i<9?'0':'')+(i+1))+'</span>'+esc(s.title)+'</h2>';
      s.items.forEach(function(it){
        out+='<div class="item">';
        if(it.head)out+='<div class="i-head">'+esc(it.head)+'</div>';
        if(it.lines&&it.lines.length)out+='<ul class="i-lines">'+it.lines.map(function(l){return '<li>'+esc(l)+'</li>'}).join('')+'</ul>';
        out+='</div>'});
      out+='</section>'});
    document.getElementById('secs').innerHTML=out;
    document.getElementById('foot').textContent=lang==='zh'?('由「简历翻译器」生成'+(single?'':' · 中英文自动切换')):('Made with Resume Translator'+(single?'':' · bilingual auto-switch'));
    document.getElementById('langBtn').textContent=lang==='zh'?'EN':'中文';
    var cards=document.querySelectorAll('.card');
    if(IO){cards.forEach(function(c){IO.observe(c)})}else{cards.forEach(function(c){c.classList.add('in')})}
    if(CFG.typing)typeName();
  }
  document.getElementById('langBtn').addEventListener('click',function(){
    lang=lang==='zh'?'en':'zh';
    try{localStorage.setItem('r3d_lang',lang)}catch(e){}
    body.classList.add('switching');
    setTimeout(function(){render();body.classList.remove('switching')},230);
  });
  var fine=window.matchMedia&&matchMedia('(pointer:fine)').matches&&window.innerWidth>760;
  if(CFG.tilt&&fine){
    var rx=0,ry=0,tx=0,ty=0;
    document.addEventListener('mousemove',function(e){
      ty=((e.clientX/window.innerWidth)-.5)*CFG.tiltMax;
      tx=-((e.clientY/window.innerHeight)-.5)*CFG.tiltMax;
    });
    (function loop(){rx+=(tx-rx)*.06;ry+=(ty-ry)*.06;
      stage.style.transform='rotateX('+rx.toFixed(3)+'deg) rotateY('+ry.toFixed(3)+'deg)';
      requestAnimationFrame(loop)})();
  }
  var typeTimer=null;
  function typeName(){
    var el=document.getElementById('bigName');if(!el)return;
    var full=el.textContent;el.textContent='';
    if(typeTimer)clearInterval(typeTimer);
    var i=0;typeTimer=setInterval(function(){el.textContent=full.slice(0,++i);
      if(i>=full.length)clearInterval(typeTimer)},80);
  }
  var cv=document.getElementById('fx'),ctx=cv.getContext('2d'),W,H,ps=[];
  function rs(){W=cv.width=window.innerWidth;H=cv.height=window.innerHeight}
  rs();window.addEventListener('resize',function(){rs();init()});
  function chars(){var s='01<>/{}$#*+=-;';return s.charAt(Math.floor(Math.random()*s.length))}
  function mk(seed){
    if(CFG.fx==='rain')return{x:Math.random()*W,y:Math.random()*H,v:1.6+Math.random()*3.4,ch:chars()};
    if(CFG.fx==='rise')return{x:Math.random()*W,y:seed?Math.random()*H:H+12,r:1+Math.random()*2.4,v:.28+Math.random()*.8,hue:Math.random()<.5?187:318,a:.14+Math.random()*.4};
    return{x:Math.random()*W,y:Math.random()*H,r:Math.random()*1.4+.3,tw:Math.random()*6.28,ts:.008+Math.random()*.03,vx:(Math.random()-.5)*.07,vy:(Math.random()-.5)*.07};
  }
  function init(){ps=[];var n=CFG.fx==='rain'?Math.floor(W/15):(CFG.fx==='rise'?64:Math.min(170,Math.floor(W/8)));for(var i=0;i<n;i++)ps.push(mk(true))}
  function tick(){
    ctx.clearRect(0,0,W,H);
    if(CFG.fx==='stars'){ps.forEach(function(p){p.tw+=p.ts;p.x+=p.vx;p.y+=p.vy;
      if(p.x<0)p.x=W;if(p.x>W)p.x=0;if(p.y<0)p.y=H;if(p.y>H)p.y=0;
      ctx.fillStyle='rgba(255,255,255,'+(.22+Math.abs(Math.sin(p.tw))*.55).toFixed(2)+')';
      ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,6.29);ctx.fill()})}
    else if(CFG.fx==='rise'){ps.forEach(function(p,i){p.y-=p.v;if(p.y<-14)ps[i]=mk(false);
      ctx.fillStyle='hsla('+p.hue+',95%,62%,'+p.a.toFixed(2)+')';ctx.shadowColor='hsla('+p.hue+',95%,62%,.9)';ctx.shadowBlur=8;
      ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,6.29);ctx.fill();ctx.shadowBlur=0})}
    else{ctx.font='12px monospace';ps.forEach(function(p){p.y+=p.v;
      if(p.y>H+14){p.y=-14;p.x=Math.random()*W;p.ch=chars()}
      ctx.fillStyle='rgba(74,222,128,.13)';ctx.fillText(p.ch,p.x,p.y)})}
    requestAnimationFrame(tick);
  }
  init();tick();render();
})();
`;

// langMode: "auto"(双语自动切换) | "zh"(仅中文) | "en"(仅英文)
export function build3DHtml(templateId, data, langMode = "auto") {
  const tpl = TEMPLATES_3D.find((t) => t.id === templateId) || TEMPLATES_3D[0];
  const d = {
    photo: data.photo || null,
    zh: langMode === "en" ? null : data.zh,
    en: langMode === "zh" ? null : data.en,
  };
  const json = JSON.stringify(d).replace(/</g, "\\u003c");
  const cfg = JSON.stringify(tpl.cfg);
  const title = (d.zh?.name || d.en?.name || "Resume") + (langMode === "en" ? " · Resume" : " · 简历");
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title.replace(/</g, "")}</title>
<meta name="description" content="Interactive 3D resume, bilingual (中/EN) auto-switch.">
<style>${SHARED_CSS}${TPL_CSS[tpl.id]}</style>
</head>
<body class="tpl-${tpl.id}">
<canvas id="fx" aria-hidden="true"></canvas>
${TPL_DECOR[tpl.id]}
<button id="langBtn" type="button" title="中文 / English"></button>
<div class="scene"><div class="stage" id="stage">
<header class="hero" id="hero"></header>
<main id="secs"></main>
<footer class="foot" id="foot"></footer>
</div></div>
<script>
var DATA=${json};
var CFG=${cfg};
${RUNTIME_JS}
</script>
</body>
</html>`;
}
