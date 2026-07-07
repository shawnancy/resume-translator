// 3D 简历模板 —— 把生成的中英双语简历变成可分享的 3D 动效单文件网页
// 灵感来源(日常收集·AI简历模板39资源): Figma暗色玻璃拟态 → 星空玻璃; Jesse Zhou赛博拉面店 → 赛博霓虹;
// Henry Heffernan复古电脑桌 → 复古终端。全部纯 CSS3D + canvas 粒子, 零外部依赖(国内打开快, 可当个人主页部署)。
// 输出页特性: 按访客浏览器语言自动显示中/英, 右上角可手动切换(记住选择)。

export const TEMPLATES_3D = [
  {
    id: "game",
    name: "横版闯关",
    desc: "游戏世界 · 走路小人 · 简历当关卡",
    cfg: { tilt: false, tiltMax: 0, fx: "none", typing: false, layout: "game" },
  },
  {
    id: "orbit",
    name: "旋转展廊",
    desc: "3D 旋转木马 · 滚动转环",
    cfg: { tilt: false, tiltMax: 0, fx: "stars", typing: false, layout: "orbit" },
  },
  {
    id: "terminal",
    name: "复古电脑",
    desc: "3D 电脑开机 · 走进屏幕",
    cfg: { tilt: false, tiltMax: 0, fx: "rain", typing: true, intro: "computer" },
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
  /(@|(\+?\d[\d ()\-]{7,}\d)|电话|手机|邮箱|微信|籍贯|出生|年龄|婚姻|现居|居住地|求职意向[:：]|意向岗位|期望薪资|E-?mail|Tel\b|Phone|Mobile|WeChat|GitHub|LinkedIn|Blog|Portfolio|Website|Location|Address|Based in|City)/i;
// 支持: 2022.04-至今 / 2020.06 - 2022.03 / Apr 2022 - Present / Jun 2020 - Mar 2022
const MONTH_PFX = "(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\\.?\\s+)?";
const YM = "((19|20)\\d{2})(?:\\s*[年./\\-]\\s*\\d{1,2})?(?:\\s*月)?(?:\\s*\\d{1,2}\\s*日)?";
const DATE_RANGE_RE = new RegExp(
  MONTH_PFX + YM + "\\s*[-–—~〜至到]{1,3}\\s*(" + MONTH_PFX + YM + "|至今|现在|Present|Now|Current|Date)","i");

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

// 节类型 → 模板可差异化排版(时间线/标签墙/段落)。识别不了归 other, 永不失败。
function classifyKind(title) {
  const t = (title || "").toLowerCase();
  if (/(工作|职业|实习|任职|employment|work|professional experience|career history|internship)/.test(t)) return "work";
  if (/(项目|project)/.test(t)) return "project";
  if (/(教育|学历|学术|education|academic)/.test(t)) return "edu";
  if (/(技能|技术栈|语言能力|语言水平|skill|competenc|technical|languages)/.test(t)) return "skill";
  if (/(荣誉|奖|证书|资格|award|honor|certific|license)/.test(t)) return "honor";
  if (/(简介|评价|总结|自我|求职意向|意向|优势|summary|profile|objective|about|strength)/.test(t)) return "profile";
  return "other";
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
      t.split(/\s*[|｜•·丨]\s*|\s{2,}/).forEach((p) => {
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
    const sec = { title: rs.title, kind: classifyKind(rs.title), items: [] };
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
  if (preLines.length) sections.unshift({ title: isZh ? "简介" : "Profile", kind: "profile", items: [{ head: null, lines: preLines }] });

  // 兜底：一节都没解析出来 → 全文单节
  if (!sections.length) {
    const rest = lines.filter((_, i) => i !== nameIdx).map((l) => stripBullet(l.text)).filter(Boolean);
    sections.push({ title: isZh ? "简历内容" : "Resume", kind: "other", items: [{ head: null, lines: rest.slice(0, 120) }] });
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
  game: `
body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;color:#2B3A4A;overflow-x:hidden;
background:linear-gradient(#6FC3EF,#A8DCF5 52%,#DDF1FB 76%,#EAF7FD)}
.scene{display:none}
#game{position:relative}
body.switching #game{opacity:0;filter:blur(4px)}
#game{transition:opacity .22s,filter .22s}
#langBtn{background:#fff;border:3px solid #2E5F8A;color:#2E5F8A;border-radius:12px;font-weight:800}
.g-sun{position:fixed;top:7vh;right:11vw;width:104px;height:104px;border-radius:50%;z-index:1;pointer-events:none;
background:radial-gradient(circle at 42% 40%,#FFEDB0,#FFCF4D 66%);box-shadow:0 0 70px rgba(255,214,90,.8)}
.g-layer{position:fixed;top:0;left:0;height:44vh;width:100%;z-index:1;pointer-events:none;will-change:transform}
.g-cloud{position:absolute;width:132px;height:38px;background:#fff;border-radius:30px;opacity:.95}
.g-cloud:before{content:"";position:absolute;left:20px;top:-20px;width:54px;height:44px;background:#fff;border-radius:50%}
.g-cloud:after{content:"";position:absolute;right:22px;top:-12px;width:40px;height:32px;background:#fff;border-radius:50%}
.g-hills{position:fixed;left:0;bottom:96px;height:210px;width:calc(100% + 1500px);z-index:1;pointer-events:none;background-repeat:repeat-x;will-change:transform}
.g-hills.hA{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='720' height='210'%3E%3Cellipse cx='170' cy='250' rx='260' ry='150' fill='%238FCF7E'/%3E%3Cellipse cx='540' cy='260' rx='300' ry='170' fill='%238FCF7E'/%3E%3C/svg%3E")}
.g-hills.hB{bottom:88px;height:170px;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='170'%3E%3Cellipse cx='140' cy='215' rx='230' ry='130' fill='%2367B25C'/%3E%3Cellipse cx='470' cy='225' rx='260' ry='150' fill='%2367B25C'/%3E%3C/svg%3E")}
.g-trees{position:fixed;left:0;bottom:92px;height:140px;width:100%;z-index:2;pointer-events:none;will-change:transform}
.g-tree{position:absolute;bottom:0;width:56px;height:130px}
.g-tree:after{content:"";position:absolute;left:24px;bottom:0;width:9px;height:52px;background:#8A5B33;border-radius:3px}
.g-tree:before{content:"";position:absolute;left:0;top:0;width:56px;height:88px;background:#3E8E4E;border-radius:50% 50% 46% 46%;box-shadow:inset -8px -10px 0 rgba(0,0,0,.09)}
.g-tree.bush{height:44px}
.g-tree.bush:after{display:none}
.g-tree.bush:before{top:auto;bottom:0;height:40px;width:64px;background:#57A84F;border-radius:26px}
.g-ground{position:fixed;left:0;right:0;bottom:0;height:96px;z-index:3;
background:linear-gradient(#6DBE5B 0 20px,#E4CE92 20px 24px,#D9B36A 24px 100%)}
.g-ground:after{content:"";position:absolute;left:0;right:0;top:52px;height:6px;opacity:.85;
background:repeating-linear-gradient(90deg,#FFF6DC 0 34px,transparent 34px 88px);background-position-x:var(--rx,0px)}
.gworld{position:fixed;left:0;top:0;bottom:96px;z-index:4;will-change:transform}
.gn{position:absolute;bottom:34px;opacity:0;transform:translateY(50px);transition:transform .55s cubic-bezier(.2,.8,.3,1.25),opacity .5s}
.gn.in{opacity:1;transform:none}
.g-start{bottom:auto;top:13vh}
.g-eye{font-weight:800;letter-spacing:.2em;font-size:11px;color:#2E7DB2;margin:0 0 12px}
.g-name{font-size:clamp(40px,7vw,66px);font-weight:900;color:#1F4E79;line-height:1.05;margin:0;
text-shadow:0 3px 0 #fff,0 7px 0 rgba(31,78,121,.18)}
.g-tag{margin:12px 0 0;font-size:15px;font-weight:600;color:#33607F}
.g-chips{margin-top:14px}
.gchip{background:#fff;border:2px solid #2E5F8A;color:#2E5F8A;border-radius:20px;padding:4px 12px;font-size:12px;font-weight:700;display:inline-block;margin:3px 5px 3px 0}
.g-go{font-weight:800;color:#E5533C;margin-top:16px;animation:gbob 1.1s ease-in-out infinite alternate}
@keyframes gbob{to{transform:translateY(7px)}}
.g-level{text-align:center}
.flagpole{width:6px;height:150px;background:#8A5B33;margin:0 auto;border-radius:3px;box-shadow:2px 0 0 rgba(0,0,0,.08)}
.flag{position:absolute;top:-2px;left:50%;background:#E5533C;color:#fff;font-weight:900;font-size:14px;letter-spacing:.04em;
padding:7px 16px 7px 10px;clip-path:polygon(0 0,100% 0,84% 50%,100% 100%,0 100%)}
.lv-t{display:table;margin:10px auto 0;font-weight:800;font-size:14px;color:#2E5F8A;background:#fff;border:2px solid #2E5F8A;border-radius:10px;padding:4px 12px;box-shadow:0 3px 0 rgba(46,95,138,.2)}
.g-board{background:#FFF9EC;border:3px solid #7A5230;border-radius:14px;padding:18px 20px 15px;box-shadow:0 6px 0 rgba(90,60,30,.28)}
.g-board:before,.g-board:after{content:"";position:absolute;bottom:-34px;width:10px;height:34px;background:#8A5B33;z-index:-1}
.g-board:before{left:16%}
.g-board:after{right:16%}
.b-plate{display:flex;gap:9px 12px;align-items:baseline;flex-wrap:wrap;margin-bottom:8px}
.b-date{font-weight:800;font-size:11.5px;background:#FFD44D;border:2px solid #7A5230;border-radius:8px;padding:2px 9px;color:#5A3A18;white-space:nowrap}
.b-t{font-weight:800;font-size:15.5px;color:#3B2A14}
.i-lines li{font-size:13px;color:#4A3A22;padding-left:15px;margin-bottom:4px}
.i-lines li:before{content:"•";color:#C97B2A;top:0}
.g-tags .gtag{display:inline-block;background:#FFE9B3;border:2px solid #C99433;color:#6B4A12;border-radius:9px;padding:3px 10px;font-size:12px;font-weight:700;margin:3px 5px 3px 0;transform:rotate(-1deg)}
.g-tags .gtag:nth-child(2n){transform:rotate(1.4deg);background:#D9F0C8;border-color:#6FA653;color:#33591F}
.g-fin{font-size:clamp(30px,5vw,44px);font-weight:900;color:#1F4E79;margin:0;text-shadow:0 3px 0 #fff}
.g-char{position:fixed;left:13vw;bottom:88px;width:46px;height:100px;z-index:5;animation:cbob 2.6s ease-in-out infinite}
@keyframes cbob{50%{transform:translateY(-3px)}}
.c-head{position:absolute;top:0;left:9px;width:28px;height:28px;background:#F7C6A0;border-radius:50%}
.c-head:before{content:"";position:absolute;top:-4px;left:-2px;right:-2px;height:15px;background:#2B2B2B;border-radius:14px 14px 5px 5px}
.c-body{position:absolute;top:26px;left:7px;width:32px;height:38px;background:#E5533C;border-radius:9px;box-shadow:inset -6px 0 0 rgba(0,0,0,.08)}
.c-arm{position:absolute;top:30px;left:20px;width:8px;height:28px;background:#D8452F;border-radius:5px;transform-origin:4px 3px;animation:cswing .46s ease-in-out infinite alternate;animation-play-state:paused}
.c-leg{position:absolute;top:62px;width:9px;height:34px;background:#31537A;border-radius:5px;transform-origin:4px 3px;animation:cstep .4s ease-in-out infinite alternate;animation-play-state:paused}
.c-leg.l1{left:12px}
.c-leg.l2{left:25px;animation-direction:alternate-reverse}
@keyframes cstep{from{transform:rotate(26deg)}to{transform:rotate(-26deg)}}
@keyframes cswing{from{transform:rotate(-20deg)}to{transform:rotate(20deg)}}
.g-char.walk .c-leg,.g-char.walk .c-arm{animation-play-state:running}
.g-hud{position:fixed;top:16px;left:16px;z-index:9;background:#fff;border:3px solid #2E5F8A;color:#2E5F8A;border-radius:12px;padding:7px 15px;font-weight:900;font-size:13px;letter-spacing:.05em;box-shadow:0 4px 0 rgba(46,95,138,.22)}
.g-hint{position:fixed;bottom:14px;left:50%;transform:translateX(-50%);z-index:9;background:rgba(255,255,255,.9);border-radius:20px;padding:5px 15px;font-size:11.5px;font-weight:700;color:#33607F;letter-spacing:.08em}
.foot{display:none}
@media(max-width:640px){.g-char{left:7vw}.g-hud{font-size:11.5px;padding:6px 11px}.g-sun{width:74px;height:74px}}
@media(prefers-reduced-motion:reduce){.g-char,.g-go{animation:none}}
`,
  dossier: `
body{font-family:"Helvetica Neue",Helvetica,Arial,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;color:#16140F;background:#FBF6EA;
background-image:linear-gradient(rgba(22,20,15,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(22,20,15,.04) 1px,transparent 1px);background-size:56px 56px}
.d-eye,.d-spec,.chip,.ch-i,.tl-date,.tag,#langBtn{font-family:ui-monospace,"SF Mono",Menlo,Consolas,"Courier New",monospace}
#prog{position:fixed;top:0;left:0;height:3px;background:#0A48E0;z-index:12;width:0}
.scene{max-width:820px;perspective:none;padding-top:60px}
#langBtn{background:#FBF6EA;border:1px solid #16140F;color:#16140F;border-radius:4px;letter-spacing:.1em}
#langBtn:hover{background:#16140F;color:#FBF6EA;transform:none}
.hero{text-align:left;margin-bottom:56px;border-bottom:2px solid #16140F;padding-bottom:30px}
.d-eye{font-size:11px;letter-spacing:.26em;color:#0A48E0;margin:0 0 24px}
.d-hrow{display:flex;gap:28px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap}
.d-hmain{flex:1;min-width:240px}
.name{font-size:clamp(36px,7vw,62px);font-weight:800;letter-spacing:-.02em;line-height:1.08;text-transform:uppercase}
.tagline{margin-top:13px;font-size:15px;color:#57503F}
.chips{justify-content:flex-start;margin-top:18px;gap:7px}
.chip{border:1px solid #D8CFB8;border-radius:3px;font-size:11px;color:#57503F;background:#FFFDF6;padding:4px 9px}
.d-photo{border:1px solid #E4DCC8;padding:5px;background:#FFFDF6;transform:rotate(1.5deg);box-shadow:2px 3px 0 rgba(22,20,15,.08)}
.d-photo img{width:100px;height:124px;object-fit:cover;border:1px solid #16140F;display:block}
.d-spec{margin:24px 0 0;font-size:10.5px;letter-spacing:.16em;color:#8D8570}
.card{background:transparent;border:none;padding:0;margin-bottom:48px;transform:translateY(26px);border-radius:0}
.ch-head{display:flex;align-items:baseline;gap:14px;border-bottom:1px solid #16140F;padding-bottom:10px;margin-bottom:20px}
.ch-i{font-size:12px;color:#0A48E0;letter-spacing:.12em}
.sec-t{font-size:13px;letter-spacing:.24em;text-transform:uppercase;font-weight:750;margin:0;color:#16140F}
.tl{position:relative;padding-left:24px}
.tl:before{content:"";position:absolute;left:3px;top:8px;bottom:8px;width:1px;background:#D8CFB8}
.tl-it{position:relative;margin-bottom:24px}
.tl-it:last-child{margin-bottom:0}
.tl-it:before{content:"";position:absolute;left:-24px;top:7px;width:7px;height:7px;background:#0A48E0}
.tl-head{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:baseline;margin-bottom:7px}
.tl-date{font-size:11px;color:#0A48E0;letter-spacing:.04em;border:1px solid rgba(10,72,224,.35);padding:2px 8px;border-radius:3px;background:rgba(10,72,224,.06);white-space:nowrap}
.tl-title{font-weight:750;font-size:15px}
.i-head{color:#16140F;font-size:14.5px}
.i-lines li{color:#3E3A2E}
.i-lines li:before{content:"–";color:#0A48E0;font-size:13px;top:0}
.tags{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px}
.tag{border:1px solid #16140F;padding:5px 12px;font-size:12px;background:#FFFDF6;border-radius:3px}
.foot{border-top:1px solid #D8CFB8;padding-top:16px;color:#8D8570;text-align:left;font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:10.5px;letter-spacing:.14em}
@media(max-width:640px){.d-photo{order:-1}.hero{margin-bottom:40px}.card{margin-bottom:36px}}
`,
  orbit: `
body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB",sans-serif;color:#eef0ff;overflow-x:hidden;
background:radial-gradient(1100px 750px at 72% -12%,#3b2f78 0%,rgba(59,47,120,0) 55%),
radial-gradient(950px 700px at 6% 108%,#14406b 0%,rgba(20,64,107,0) 60%),#0b1026}
.scene{display:none}
#langBtn{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.25);color:#fff;backdrop-filter:blur(10px)}
.o-hero{position:fixed;top:6vh;left:0;right:0;text-align:center;z-index:6;pointer-events:none;padding:0 16px}
.o-hero .name{font-size:clamp(28px,4.5vw,44px);font-weight:760;line-height:1.15;
background:linear-gradient(115deg,#fff 30%,#aab4ff 75%,#7dd3fc);-webkit-background-clip:text;background-clip:text;color:transparent}
.o-hero .tagline{margin-top:6px;font-size:13.5px;color:#b8c0ea}
.o-hero .chips{display:flex;flex-wrap:wrap;gap:7px;justify-content:center;margin-top:10px}
.o-hero .chip{font-size:11.5px;padding:4px 11px;border-radius:20px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16);color:#dfe3ff}
.o-stage{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;perspective:1500px;z-index:4}
.o-car{position:relative;width:0;height:0;transform-style:preserve-3d}
.op{position:absolute;left:0;top:0;backface-visibility:hidden;-webkit-backface-visibility:hidden}
.op-in{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.15);border-radius:20px;
backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);padding:22px 24px;max-height:56vh;overflow-y:auto;
box-shadow:0 18px 50px rgba(2,6,32,.5),inset 0 1px 0 rgba(255,255,255,.12);
opacity:.34;filter:saturate(.7);transition:opacity .4s,filter .4s,box-shadow .4s}
.op.on .op-in{opacity:1;filter:none;box-shadow:0 18px 60px rgba(2,6,32,.6),0 0 40px rgba(139,147,255,.22),inset 0 1px 0 rgba(255,255,255,.16)}
.op-t{font-size:15.5px;color:#c7cdff;display:flex;align-items:center;gap:9px;margin:0 0 12px;letter-spacing:.04em}
.op-i{font-size:11px;color:#8b93ff;font-family:ui-monospace,Menlo,monospace}
.i-head{color:#fff;font-size:14px}
.i-lines li{color:#d5daf5;opacity:.92;font-size:13px}
.i-lines li:before{color:#8b93ff}
.tl{position:relative;padding-left:18px}
.tl:before{content:"";position:absolute;left:2px;top:6px;bottom:6px;width:1px;background:rgba(139,147,255,.35)}
.tl-it{position:relative;margin-bottom:16px}
.tl-it:before{content:"";position:absolute;left:-18px;top:7px;width:6px;height:6px;border-radius:50%;background:#8b93ff}
.tl-head{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:baseline;margin-bottom:5px}
.tl-date{font-size:10.5px;color:#a5b4fc;border:1px solid rgba(139,147,255,.4);border-radius:4px;padding:1px 7px;font-family:ui-monospace,Menlo,monospace;white-space:nowrap}
.tl-title{font-weight:700;font-size:14px;color:#fff}
.tags{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:8px}
.tag{border:1px solid rgba(139,147,255,.45);color:#c7cdff;border-radius:6px;padding:3px 10px;font-size:11.5px;background:rgba(139,147,255,.08)}
.o-count{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:6;
font-family:ui-monospace,Menlo,monospace;font-size:12px;letter-spacing:.3em;color:#8b93ff}
.o-hint{position:fixed;bottom:44px;left:50%;transform:translateX(-50%);z-index:6;font-size:11px;letter-spacing:.14em;color:rgba(223,227,255,.5);animation:ohint 1.4s ease-in-out infinite alternate}
@keyframes ohint{to{opacity:.4;transform:translateX(-50%) translateY(4px)}}
.foot{display:none}
@media(max-width:640px){.o-hero{top:4vh}.op-in{max-height:52vh;padding:17px 16px}}
@media(prefers-reduced-motion:reduce){.o-hint{animation:none}}
`,
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
/* --- 开机场景 --- */
.pc-scene{position:fixed;inset:0;z-index:60;overflow:hidden;display:flex;align-items:center;justify-content:center;
transform-origin:50% 42%;transition:transform 1.5s cubic-bezier(.65,.02,.35,1),opacity 1.2s ease .3s}
.pc-scene.zoom{transform:scale(8);opacity:0;pointer-events:none}
.pc-room{position:absolute;inset:0;background:radial-gradient(1000px 600px at 50% 30%,#2A1E4E 0%,#181031 55%,#0C0819 100%)}
.pc-desk{position:absolute;left:-6%;right:-6%;bottom:0;height:24vh;
background:linear-gradient(#7A5634,#5A3D22 60%,#452E18);border-top:5px solid #8D6740;
box-shadow:0 -18px 50px rgba(0,0,0,.5)}
.pc-set{position:relative;transform:rotateY(-4deg);perspective:800px;margin-bottom:6vh}
.pc-monitor{position:relative;width:min(560px,84vw);background:linear-gradient(160deg,#E2DACA,#C6BBA3 70%,#B0A489);
border-radius:22px;padding:24px 24px 42px;box-shadow:14px 20px 0 rgba(0,0,0,.35),inset 0 3px 0 rgba(255,255,255,.55),inset 0 -6px 12px rgba(0,0,0,.15)}
.pc-crt{position:relative;aspect-ratio:4/3;background:#050805;border-radius:16px;overflow:hidden;
box-shadow:inset 0 0 70px rgba(0,0,0,.95),inset 0 0 10px #000,0 0 0 4px #3A342A}
.pc-crt.lit{box-shadow:inset 0 0 70px rgba(0,30,0,.9),inset 0 0 10px #000,0 0 0 4px #3A342A,0 0 46px rgba(74,222,128,.24);
animation:pcflick .12s linear 2}
@keyframes pcflick{50%{filter:brightness(2.4)}}
.pc-boot{position:absolute;inset:0;padding:7% 8%;font-family:ui-monospace,Menlo,monospace;font-size:clamp(11px,1.8vw,16px);
line-height:2;color:#4ade80;text-shadow:0 0 9px rgba(74,222,128,.75);white-space:pre-wrap}
.pc-boot:after{content:"\\258d";animation:blink 1s steps(1) infinite}
.pc-glass{position:absolute;inset:0;pointer-events:none;
background:radial-gradient(120% 90% at 22% 12%,rgba(255,255,255,.14),transparent 46%),repeating-linear-gradient(0deg,rgba(0,0,0,.22) 0 1px,transparent 1px 3px);
border-radius:16px}
.pc-badge{position:absolute;left:34px;bottom:13px;font-family:ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:.2em;color:#6E6350}
.pc-pwr{position:absolute;right:36px;bottom:14px;width:15px;height:15px;border-radius:50%;background:#3A352C;box-shadow:inset 0 2px 3px #000}
.pc-pwr.on{background:#5CFF7E;box-shadow:0 0 12px #5CFF7E,inset 0 1px 2px rgba(0,0,0,.4)}
.pc-kb{width:min(430px,64vw);height:44px;margin:16px auto 0;border-radius:8px;
background:linear-gradient(#D8CFBC,#BCB097);transform:perspective(300px) rotateX(38deg);
box-shadow:0 10px 0 rgba(0,0,0,.3),inset 0 2px 0 rgba(255,255,255,.5);
background-image:repeating-linear-gradient(90deg,rgba(0,0,0,.13) 0 2px,transparent 2px 26px),repeating-linear-gradient(0deg,rgba(0,0,0,.13) 0 2px,transparent 2px 12px)}
.pc-note{position:absolute;left:12vw;bottom:13vh;width:86px;height:86px;background:#FFE873;transform:rotate(-7deg);
padding:12px 10px;font-weight:800;font-size:13px;color:#6B5A10;box-shadow:3px 5px 0 rgba(0,0,0,.3);font-family:inherit}
.pc-mug{position:absolute;right:13vw;bottom:14vh;width:54px;height:62px;background:linear-gradient(#B33A3A,#8E2B2B);border-radius:6px 6px 10px 10px;box-shadow:4px 6px 0 rgba(0,0,0,.35)}
.pc-mug:after{content:"";position:absolute;right:-20px;top:12px;width:22px;height:30px;border:7px solid #8E2B2B;border-left:none;border-radius:0 14px 14px 0}
.pc-cta{position:absolute;bottom:5vh;left:50%;transform:translateX(-50%);
background:#0A0F0A;color:#5CFF7E;border:2px solid #5CFF7E;border-radius:12px;padding:12px 26px;
font:800 15px ui-monospace,Menlo,monospace;letter-spacing:.12em;cursor:pointer;
box-shadow:0 0 22px rgba(92,255,126,.35);animation:ctapulse 1.4s ease-in-out infinite alternate}
@keyframes ctapulse{to{box-shadow:0 0 40px rgba(92,255,126,.65);transform:translateX(-50%) translateY(-3px)}}
@media(max-width:640px){.pc-note{left:4vw;width:66px;height:66px;font-size:11px}.pc-mug{right:5vw;transform:scale(.8)}}
`,
};

const TPL_DECOR = {
  game: "",
  orbit: "",
  dossier: '<div id="prog"></div>',
  glass: '<div class="orb a"></div><div class="orb b"></div>',
  neon: '<div class="sun"></div><div class="grid-floor"></div>',
  terminal: '<div class="scan"></div><div class="vig"></div>',
};

// 产物页运行时（ES5 风格、无反引号）：语言自动检测+切换 / 渲染 / 3D tilt / 粒子 / 进场动画 / 打字机
const RUNTIME_JS = `
(function(){
  var body=document.body,stage=document.getElementById('stage');
  var single=!(DATA.zh&&DATA.en);
  var lang=null;try{lang=localStorage.getItem('r3d_lang')}catch(e){}
  if(lang!=='zh'&&lang!=='en'){lang=((navigator.language||navigator.userLanguage||'en')+'').toLowerCase().indexOf('zh')===0?'zh':'en'}
  if(!DATA[lang])lang=DATA.zh?'zh':'en';
  if(single)document.getElementById('langBtn').style.display='none';
  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
  function pad(n){return(n<10?'0':'')+n}
  var MP='(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\\\\.?\\\\s+)?';
  var YMR='((19|20)\\\\d{2})(?:\\\\s*[年./\\\\-]\\\\s*\\\\d{1,2})?(?:\\\\s*月)?(?:\\\\s*\\\\d{1,2}\\\\s*日)?';
  var DR=new RegExp(MP+YMR+'\\\\s*[-–—~〜至到]{1,3}\\\\s*('+MP+YMR+'|至今|现在|Present|Now|Current)','i');
  function splitDate(head){var m=String(head||'').match(DR);if(!m)return{date:'',title:head};
    var t=String(head).replace(m[0],' ').replace(/^[\\s·|｜\\-–—,，.]+|[\\s·|｜\\-–—,，.]+$/g,'').trim();
    return{date:m[0].trim(),title:t||head}}
  var IO=('IntersectionObserver' in window)?new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');IO.unobserve(e.target)}})},{threshold:.08}):null;

  function linesHtml(arr){return '<ul class="i-lines">'+arr.map(function(l){return '<li>'+esc(l)+'</li>'}).join('')+'</ul>'}
  function plainBody(s){var o='';s.items.forEach(function(it){o+='<div class="item">';
    if(it.head)o+='<div class="i-head">'+esc(it.head)+'</div>';
    if(it.lines&&it.lines.length)o+=linesHtml(it.lines);o+='</div>'});return o}
  function timelineBody(s){var o='<div class="tl">';
    s.items.forEach(function(it){o+='<div class="tl-it">';
      if(it.head){var sd=splitDate(it.head);
        o+='<div class="tl-head">'+(sd.date?'<span class="tl-date">'+esc(sd.date)+'</span>':'')+'<span class="tl-title">'+esc(sd.title)+'</span></div>'}
      if(it.lines&&it.lines.length)o+=linesHtml(it.lines);
      o+='</div>'});
    return o+'</div>'}
  function skillBody(s){var tags=[],rest=[];
    s.items.forEach(function(it){if(it.head)rest.push(it.head);
      (it.lines||[]).forEach(function(l){
        var parts=l.split(/[、，,;；/｜|]+/).map(function(x){return x.trim()}).filter(Boolean);
        var shorts=parts.filter(function(p){return p.length<=26});
        if(shorts.length>=2){shorts.forEach(function(p){tags.push(p)});
          parts.forEach(function(p){if(p.length>26)rest.push(p)})}
        else rest.push(l)})});
    if(!tags.length)return plainBody(s);
    var o='<div class="tags">'+tags.map(function(t){return '<span class="tag">'+esc(t)+'</span>'}).join('')+'</div>';
    if(rest.length)o+=linesHtml(rest);
    return o}

  function renderClassic(d){
    var h='';
    if(DATA.photo)h+='<div class="avatar"><img src="'+DATA.photo+'" alt=""></div>';
    h+='<h1 class="name" id="bigName">'+esc(d.name)+'</h1>';
    if(d.tagline)h+='<p class="tagline">'+esc(d.tagline)+'</p>';
    if(d.contacts&&d.contacts.length)h+='<div class="chips">'+d.contacts.map(function(c){return '<span class="chip">'+esc(c)+'</span>'}).join('')+'</div>';
    document.getElementById('hero').innerHTML=h;
    var out='';
    d.sections.forEach(function(s,i){
      out+='<section class="card" style="transition-delay:'+(i*70)+'ms"><h2 class="sec-t"><span class="sec-i">'+pad(i+1)+'</span>'+esc(s.title)+'</h2>'+plainBody(s)+'</section>'});
    document.getElementById('secs').innerHTML=out;
  }
  function renderDossier(d){
    var h='<p class="d-eye">'+(lang==='zh'?'求职档案 · CANDIDATE DOSSIER':'CANDIDATE DOSSIER · 求职档案')+'</p>';
    h+='<div class="d-hrow"><div class="d-hmain">';
    h+='<h1 class="name" id="bigName">'+esc(d.name)+'</h1>';
    if(d.tagline)h+='<p class="tagline">'+esc(d.tagline)+'</p>';
    if(d.contacts&&d.contacts.length)h+='<div class="chips">'+d.contacts.map(function(c){return '<span class="chip">'+esc(c)+'</span>'}).join('')+'</div>';
    h+='</div>';
    if(DATA.photo)h+='<div class="d-photo"><img src="'+DATA.photo+'" alt=""></div>';
    h+='</div>';
    h+='<p class="d-spec">FILE: RESUME&nbsp;&nbsp;·&nbsp;&nbsp;SECTIONS: '+pad(d.sections.length)+'&nbsp;&nbsp;·&nbsp;&nbsp;LANG: '+(single?(DATA.zh?'ZH':'EN'):'ZH / EN')+'&nbsp;&nbsp;·&nbsp;&nbsp;STATUS: OPEN</p>';
    document.getElementById('hero').innerHTML=h;
    var out='';
    d.sections.forEach(function(s,i){
      out+='<section class="card ch" style="transition-delay:'+(i*60)+'ms"><div class="ch-head"><span class="ch-i">'+pad(i+1)+'</span><h2 class="sec-t">'+esc(s.title)+'</h2></div>';
      if(s.kind==='skill')out+=skillBody(s);
      else if(s.kind==='work'||s.kind==='project'||s.kind==='edu')out+=timelineBody(s);
      else out+=plainBody(s);
      out+='</section>'});
    document.getElementById('secs').innerHTML=out;
  }
  // ===== 横版闯关(rleonardi 式): 页面滚动=世界横移, 简历节=关卡旗+路牌 =====
  var gNodes=[],gHuds=[],gBound=false,gWalkT=null;
  function renderGame(d){
    var g=document.getElementById('game');
    if(!g){g=document.createElement('div');g.id='game';document.body.appendChild(g)}
    var vw=window.innerWidth;
    var BW=Math.min(470,Math.floor(vw*0.78));
    var x=Math.max(110,Math.floor(vw*0.1));
    gNodes=[];gHuds=[];
    var html='';
    function node(cls,w,inner,hud){
      html+='<div class="gn '+cls+'" style="left:'+x+'px;width:'+w+'px">'+inner+'</div>';
      gNodes.push(x);
      if(hud)gHuds.push({x:x,label:hud});
      x+=w+Math.max(480,Math.floor(vw*0.58));
    }
    var chips=(d.contacts||[]).map(function(c){return '<span class="gchip">'+esc(c)+'</span>'}).join('');
    node('g-start',Math.min(540,Math.floor(vw*0.82)),
      '<p class="g-eye">'+(lang==='zh'?'一份可以走进去的简历':'A RESUME YOU CAN WALK THROUGH')+'</p>'+
      '<h1 class="g-name" id="bigName">'+esc(d.name)+'</h1>'+
      (d.tagline?'<p class="g-tag">'+esc(d.tagline)+'</p>':'')+
      (chips?'<div class="g-chips">'+chips+'</div>':'')+
      '<p class="g-go">'+(lang==='zh'?'▼ 向下滚动，开始旅程':'▼ SCROLL TO START')+'</p>',
      lang==='zh'?'出发':'START');
    d.sections.forEach(function(s,i){
      var hud='LV.'+pad(i+1)+' · '+s.title;
      node('g-level',210,
        '<div class="flag">LV.'+pad(i+1)+'</div><div class="flagpole"></div><div class="lv-t">'+esc(s.title)+'</div>',hud);
      if(s.kind==='work'||s.kind==='project'||s.kind==='edu'){
        s.items.forEach(function(it){
          var sd=splitDate(it.head||'');
          node('g-board',BW,
            '<div class="b-plate">'+(sd.date?'<span class="b-date">'+esc(sd.date)+'</span>':'')+
            '<span class="b-t">'+esc(sd.title||s.title)+'</span></div>'+
            (it.lines&&it.lines.length?linesHtml(it.lines):''));
        });
      }else if(s.kind==='skill'){
        var tags=[],rest=[];
        s.items.forEach(function(it){if(it.head)rest.push(it.head);
          (it.lines||[]).forEach(function(l){
            var parts=l.split(/[、，,;；/｜|]+/).map(function(p){return p.trim()}).filter(Boolean);
            var shorts=parts.filter(function(p){return p.length<=26});
            if(shorts.length>=2){shorts.forEach(function(p){tags.push(p)});
              parts.forEach(function(p){if(p.length>26)rest.push(p)})}
            else rest.push(l)})});
        var inner='<div class="b-plate"><span class="b-t">'+esc(s.title)+'</span></div>';
        if(tags.length)inner+='<div class="g-tags">'+tags.map(function(t){return '<span class="gtag">'+esc(t)+'</span>'}).join('')+'</div>';
        if(rest.length)inner+=linesHtml(rest);
        node('g-board',BW,inner);
      }else{
        var ls=[];
        s.items.forEach(function(it){if(it.head)ls.push(it.head);(it.lines||[]).forEach(function(l){ls.push(l)})});
        node('g-board',BW,'<div class="b-plate"><span class="b-t">'+esc(s.title)+'</span></div>'+linesHtml(ls));
      }
    });
    node('g-end',Math.min(540,Math.floor(vw*0.82)),
      '<h2 class="g-fin">'+(lang==='zh'?'旅程到这里就结束了':'THE END')+'</h2>'+
      '<p class="g-tag">'+(lang==='zh'?'期待与你聊聊。':'I would love to talk.')+'</p>'+
      (chips?'<div class="g-chips">'+chips+'</div>':''),
      lang==='zh'?'终点':'THE END');
    var worldW=x+Math.floor(vw*0.6);
    var clouds='';
    for(var ci=0;ci<14;ci++){
      clouds+='<div class="g-cloud" style="left:'+((ci*617)%Math.max(1200,Math.floor(worldW*0.4)))+'px;top:'+(((ci*97)%170)+18)+'px;transform:scale('+(0.6+(ci%3)*0.35)+')"></div>';
    }
    var trees='';
    for(var ti=0;ti<Math.floor(worldW*0.95/460)+2;ti++){
      trees+='<div class="g-tree'+(ti%3===2?' bush':'')+'" style="left:'+(240+ti*460+(ti%2)*130)+'px"></div>';
    }
    g.innerHTML=
      '<div class="g-sun"></div>'+
      '<div class="g-layer" id="glc">'+clouds+'</div>'+
      '<div class="g-hills hA" id="glhA"></div>'+
      '<div class="g-hills hB" id="glhB"></div>'+
      '<div class="g-trees" id="glt">'+trees+'</div>'+
      '<div class="g-ground" id="ggr"></div>'+
      '<div class="gworld" id="gworld" style="width:'+worldW+'px">'+html+'</div>'+
      '<div class="g-char" id="gchar"><div class="c-head"></div><div class="c-body"></div><div class="c-arm"></div><div class="c-leg l1"></div><div class="c-leg l2"></div></div>'+
      '<div class="g-hud" id="ghud"></div>'+
      '<div class="g-hint">'+(lang==='zh'?'滚动 / 方向键 前进':'SCROLL / ARROW KEYS')+'</div>'+
      '<div style="height:'+worldW+'px"></div>';
    if(!gBound){gBound=true;window.addEventListener('scroll',gTick,{passive:true});window.addEventListener('resize',function(){if(CFG.layout==='game')renderGame(DATA[lang])})}
    window.scrollTo(0,0);
    gTick();
  }
  function gTick(){
    if(CFG.layout!=='game')return;
    var sx=window.scrollY||document.documentElement.scrollTop||0;
    var vw=window.innerWidth;
    var el=document.getElementById('gworld');if(!el)return;
    el.style.transform='translateX('+(-sx)+'px)';
    document.getElementById('glc').style.transform='translateX('+(-sx*0.22)+'px)';
    document.getElementById('glhA').style.transform='translateX('+(-(sx*0.35)%720)+'px)';
    document.getElementById('glhB').style.transform='translateX('+(-(sx*0.55)%640)+'px)';
    document.getElementById('glt').style.transform='translateX('+(-sx*0.85)+'px)';
    document.getElementById('ggr').style.setProperty('--rx',(-sx)+'px');
    var ch=document.getElementById('gchar');
    ch.classList.add('walk');
    if(gWalkT)clearTimeout(gWalkT);
    gWalkT=setTimeout(function(){ch.classList.remove('walk')},160);
    var nodes=document.querySelectorAll('.gn');
    for(var i=0;i<gNodes.length;i++){
      if(gNodes[i]<sx+vw*1.02)nodes[i].classList.add('in');
    }
    var label='';
    for(var j=0;j<gHuds.length;j++){if(gHuds[j].x<=sx+vw*0.38)label=gHuds[j].label}
    document.getElementById('ghud').textContent=label||gHuds[0].label;
  }
  // ===== 3D 旋转展廊: 简历节=环形玻璃面板, 滚动旋转, 正面点亮 =====
  var oN=0,oBound=false;
  function renderOrbit(d){
    var g=document.getElementById('orbit');
    if(!g){g=document.createElement('div');g.id='orbit';document.body.appendChild(g)}
    var secs=d.sections;oN=secs.length;
    var vw=window.innerWidth;
    var pw=Math.min(440,Math.floor(vw*0.8));
    var R=Math.round((pw/2)/Math.tan(Math.PI/Math.max(oN,3)))+110;
    var panels='';
    secs.forEach(function(s,i){
      var body='';
      if(s.kind==='skill')body=skillBody(s);
      else if(s.kind==='work'||s.kind==='project'||s.kind==='edu')body=timelineBody(s);
      else body=plainBody(s);
      panels+='<div class="op" style="width:'+pw+'px;transform:translate(-50%,-50%) rotateY('+(i*360/oN)+'deg) translateZ('+R+'px)">'+
        '<div class="op-in"><h2 class="op-t"><span class="op-i">'+pad(i+1)+'</span>'+esc(s.title)+'</h2>'+body+'</div></div>';
    });
    var chips=(d.contacts||[]).map(function(c){return '<span class="chip">'+esc(c)+'</span>'}).join('');
    g.innerHTML='<div class="o-hero"><h1 class="name" id="bigName">'+esc(d.name)+'</h1>'+
      (d.tagline?'<p class="tagline">'+esc(d.tagline)+'</p>':'')+
      (chips?'<div class="chips">'+chips+'</div>':'')+'</div>'+
      '<div class="o-stage"><div class="o-car" id="ocar">'+panels+'</div></div>'+
      '<div class="o-hint">'+(lang==='zh'?'滚动 · 旋转展廊':'SCROLL TO ROTATE')+'</div>'+
      '<div class="o-count" id="ocount"></div>'+
      '<div style="height:'+(oN*900+window.innerHeight)+'px"></div>';
    if(!oBound){oBound=true;window.addEventListener('scroll',oTick,{passive:true})}
    window.scrollTo(0,0);
    oTick();
  }
  function oTick(){
    if(CFG.layout!=='orbit'||!oN)return;
    var sx=window.scrollY||document.documentElement.scrollTop||0;
    var car=document.getElementById('ocar');if(!car)return;
    car.style.transform='rotateY('+(-(sx/900)*(360/oN))+'deg)';
    var idx=Math.min(oN-1,Math.max(0,Math.round(sx/900)));
    var ops=document.querySelectorAll('.op');
    for(var i=0;i<ops.length;i++)ops[i].classList.toggle('on',i===idx%oN);
    var c=document.getElementById('ocount');if(c)c.textContent=pad(idx+1)+' / '+pad(oN);
  }
  function render(){
    var d=DATA[lang];
    document.documentElement.lang=lang==='zh'?'zh-CN':'en';
    document.title=d.name+(lang==='zh'?' · 简历':' · Resume');
    if(CFG.layout==='game')renderGame(d);
    else if(CFG.layout==='orbit')renderOrbit(d);
    else if(CFG.layout==='dossier')renderDossier(d);else renderClassic(d);
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
  // 顶部滚动进度条(dossier)
  var pr=document.getElementById('prog');
  if(pr){var upd=function(){var d=document.documentElement;var m=d.scrollHeight-d.clientHeight;
    pr.style.width=(m>0?(d.scrollTop||body.scrollTop)/m*100:0)+'%'};
    window.addEventListener('scroll',upd,{passive:true});upd()}
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
  var cv=document.getElementById('fx');
  if(CFG.fx&&CFG.fx!=='none'&&cv){
    var ctx=cv.getContext('2d'),W,H,ps=[];
    var rs=function(){W=cv.width=window.innerWidth;H=cv.height=window.innerHeight};
    rs();window.addEventListener('resize',function(){rs();init()});
    var chars=function(){var s='01<>/{}$#*+=-;';return s.charAt(Math.floor(Math.random()*s.length))};
    var mk=function(seed){
      if(CFG.fx==='rain')return{x:Math.random()*W,y:Math.random()*H,v:1.6+Math.random()*3.4,ch:chars()};
      if(CFG.fx==='rise')return{x:Math.random()*W,y:seed?Math.random()*H:H+12,r:1+Math.random()*2.4,v:.28+Math.random()*.8,hue:Math.random()<.5?187:318,a:.14+Math.random()*.4};
      return{x:Math.random()*W,y:Math.random()*H,r:Math.random()*1.4+.3,tw:Math.random()*6.28,ts:.008+Math.random()*.03,vx:(Math.random()-.5)*.07,vy:(Math.random()-.5)*.07};
    };
    var init=function(){ps=[];var n=CFG.fx==='rain'?Math.floor(W/15):(CFG.fx==='rise'?64:Math.min(170,Math.floor(W/8)));for(var i=0;i<n;i++)ps.push(mk(true))};
    var tick=function(){
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
    };
    init();tick();
  }
  // ===== 复古电脑开机场景(henryheffernan 式: 书桌CRT→按电源→BIOS自检→镜头冲进屏幕) =====
  function pcIntro(){
    var ov=document.createElement('div');ov.className='pc-scene';ov.id='pcov';
    ov.innerHTML='<div class="pc-room"></div><div class="pc-desk"></div>'+
      '<div class="pc-set"><div class="pc-monitor"><div class="pc-crt"><div class="pc-boot" id="pcboot"></div><div class="pc-glass"></div></div>'+
      '<div class="pc-badge">RESUME·TRON 2000</div><div class="pc-pwr" id="pcpwr"></div></div>'+
      '<div class="pc-kb"></div></div>'+
      '<div class="pc-note">'+(lang==='zh'?'看我简历!':'MY RESUME!')+'</div>'+
      '<div class="pc-mug"></div>'+
      '<button class="pc-cta" id="pccta" type="button">'+(lang==='zh'?'\u25b8 按下电源 POWER':'\u25b8 PRESS POWER')+'</button>';
    document.body.appendChild(ov);
    var started=false;
    function boot(){
      if(started)return;started=true;
      document.getElementById('pcpwr').classList.add('on');
      var cta=document.getElementById('pccta');if(cta)cta.style.display='none';
      var crt=ov.querySelector('.pc-crt');crt.classList.add('lit');
      var lines=['RESUME-TRON 2000 BIOS v2.6','MEM CHECK ........ 640K OK','DISK 0: RESUME.EXE FOUND','LOADING \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588 100%','ENTERING SCREEN...'];
      var b=document.getElementById('pcboot'),li=0;
      var t=setInterval(function(){
        b.textContent+=lines[li]+'\\n';li++;
        if(li>=lines.length){clearInterval(t);
          setTimeout(function(){ov.classList.add('zoom');
            setTimeout(function(){ov.remove()},1500)},430)}
      },360);
    }
    ov.addEventListener('click',boot);
    document.addEventListener('keydown',function(e){boot()},{once:true});
  }
  render();
  if(CFG.intro==='computer'&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches)pcIntro();
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
