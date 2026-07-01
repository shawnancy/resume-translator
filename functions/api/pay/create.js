// POST /api/pay/create  body:{token, method:"wechat"|"alipay"}
// 生成订单 → 调 XorPay 下单 → 存订单到 KV → 返回二维码内容 qr
import { createOrder } from "../../utils/xorpay.js";

export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  let body = {};
  try { body = await request.json(); } catch {}
  const token = String(body.token || "").slice(0, 64);
  const method = body.method === "alipay" ? "alipay" : "native"; // native = 微信扫码
  if (!token) return j({ error: "缺少 token" }, 400);
  if (!env.XORPAY_AID || !env.XORPAY_SECRET) return j({ error: "支付未配置(缺 XORPAY_AID/SECRET)" }, 503);
  if (!env.RT_KV) return j({ error: "存储未配置(缺 KV 绑定 RT_KV)" }, 503);

  const price = env.PRICE || "5.00";
  const pack = parseInt(env.PACK_CREDITS || "2", 10);
  const order_id = "rt" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  const notify_url = env.NOTIFY_URL || new URL(request.url).origin + "/api/pay/notify";

  const res = await createOrder({
    aid: env.XORPAY_AID, secret: env.XORPAY_SECRET,
    name: `简历翻译 +${pack}次`, pay_type: method, price, order_id, notify_url, expire: 1800,
  });
  if (!res.ok) return j({ error: "下单失败", detail: res.raw }, 502);

  await env.RT_KV.put("o:" + order_id, JSON.stringify({ token, credits: pack, status: "new" }), { expirationTtl: 3600 });
  return j({ order_id, qr: res.qr, aoid: res.aoid, price, credits: pack });
}

function j(o, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
}
