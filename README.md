# 简历翻译器 Resume Translator

把**任意格式的中文简历**（PDF / Word / 图片 / 粘贴文本）翻译成**专业英文简历**，中英双语对照可编辑，一键导出 PDF / Word。纯前端，开源免费，自带 API Key。

在线体验 · 开源自部署皆可。

## 特性
- **任意输入**：PDF / Word(docx) / 图片(拍照·截图) / 直接粘贴文本
- **看图复刻版式**：图片/PDF 走视觉模型（智谱 GLM-4.5V），照着原版式重排；PDF 里的证件照也会保留
- **中英双语**：一次生成中英两份，`英文 / 中文 / 对照` 三视图切换，两份都能直接点进去改字
- **导出**：PDF（浏览器打印）+ Word（真 .docx）
- **🧊 3D 简历（三步引导）**：选风格（星空玻璃 / 赛博霓虹 / 复古终端）→ 选语言（双语自动切换 / 仅中文 / 仅英文）→ **一键生成网页链接，发给 HR 直接打开**。零存储：简历数据 gzip 压缩后装在链接锚点里，浏览器本地还原渲染，不经过任何服务器；也可下载单文件 HTML（零外部依赖）当个人主页
- **向导式 2 步**，手机自适应
- **纯前端零后端**（自带 Key 模式），也支持部署带后端代理隐藏 Key

## 两种运行模式（同一套代码自动切换）
| | 自带 Key（开源默认） | 后端代理（自部署可选） |
|---|---|---|
| Key 存哪 | 用户浏览器本地 | 服务端环境变量 |
| 部署 | GitHub Pages / 任意静态托管 | CF Pages / EdgeOne Pages（含 `functions/`）|
| 判定 | `/api/llm` 不存在或未配 Key | `/api/llm` 已配 Key |

前端启动时探测 `/api/llm`：配了 Key 就走代理；否则让用户在 ⚙️ 里填自己的 Key 直连。

## 用哪些模型
- **DeepSeek**（`deepseek-chat`）：文本 / 文字型 PDF 简历，便宜快
- **智谱 GLM-4.5V**：图片简历看图复刻版式（新用户送 2000 万免费 tokens）
- 图片简历若视觉不可用会自动 OCR 回退到 DeepSeek 文字模式

## 自带 Key（开源版使用）
1. 打开网页 → 右上角 ⚙️
2. 填 **DeepSeek Key**（[platform.deepseek.com](https://platform.deepseek.com/api_keys)）和/或 **智谱 Key**（[bigmodel.cn](https://bigmodel.cn)）
3. Key 只存浏览器 localStorage，不上传

## 本地运行 / 带后端代理
```bash
# 纯静态（自带 Key 模式）
python3 -m http.server 8080

# 带后端代理（隐藏 Key，模拟部署版）
DEEPSEEK_KEY=<你的key> ZHIPU_KEY=<你的key> node dev-server.mjs 8080
```
部署到 CF/EdgeOne Pages 时，把 `DEEPSEEK_KEY` / `ZHIPU_KEY` 配到环境变量即可（`functions/api/llm.js` 会自动用）。

### 付费模式（可选，XorPay 收款）
配齐后自动开启"免费 N 次 → 扫码付费加次数"（用服务端 KV 记次，防绕过）：
- 绑定 **KV** 命名空间为 `RT_KV`（Cloudflare KV / EdgeOne KV）
- 环境变量：`XORPAY_AID`、`XORPAY_SECRET`（XorPay 后台）、`PRICE`(默认5.00)、`FREE_CREDITS`(默认2)、`PACK_CREDITS`(默认2)、`NOTIFY_URL`(默认自动=站点/api/pay/notify)
- 端点：`/api/pay/create`(下单出码)、`/api/pay/notify`(XorPay回调)、`/api/pay/status`(轮询)
- 未绑 KV = 不限次（开源默认）。本地测试：`GATING=1 FREE_CREDITS=0 node dev-server.mjs`（无 XorPay key 时走 mock，可 `POST /api/pay/_mockpay?order_id=X` 模拟付款）

## 文件
- `index.html` / `style.css` / `app.js` — 前端全部
- `functions/api/llm.js` — 边缘函数代理（CF/EdgeOne 通用，可选）
- `dev-server.mjs` — 本地开发服务器（静态 + 代理）
- 依赖走 CDN：PDF.js · mammoth · html2canvas · html-docx-js · Tesseract.js

## License
MIT
