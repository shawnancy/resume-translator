// POST /api/pay/notify  ← XorPay 付款成功异步回调(form-urlencoded)
// 验签 → 幂等给对应 token 加次数 → 返回 "success"
import { notifySign } from "../../utils/xorpay.js";

export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  let p = {};
  try {
    const form = await request.formData();
    p = Object.fromEntries(form.entries());
  } catch {
    return new Response("bad form", { status: 400 });
  }
  // 验签: md5(aoid+order_id+pay_price+pay_time+app_secret)
  const expect = notifySign(p, env.XORPAY_SECRET || "");
  if (!p.sign || expect !== p.sign) return new Response("sign error", { status: 400 });
  if (!env.RT_KV) return new Response("no kv", { status: 500 });

  const key = "o:" + p.order_id;
  const oStr = await env.RT_KV.get(key);
  if (oStr) {
    const o = JSON.parse(oStr);
    if (o.status !== "paid") {
      // 幂等: 只在首次标记 paid 时加次数
      o.status = "paid";
      await env.RT_KV.put(key, JSON.stringify(o), { expirationTtl: 86400 });
      const ck = "c:" + o.token;
      const free = parseInt(env.FREE_CREDITS || "2", 10);
      const cur = parseInt((await env.RT_KV.get(ck)) ?? String(free), 10);
      await env.RT_KV.put(ck, String(cur + (o.credits || 0)));
    }
  }
  return new Response("success", { status: 200 });
}
