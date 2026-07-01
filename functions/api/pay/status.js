// GET /api/pay/status?order_id=X&token=Y  前端轮询: 返回 {paid, credits}
export async function onRequestGet(ctx) {
  const { request, env } = ctx;
  const url = new URL(request.url);
  const order_id = url.searchParams.get("order_id");
  const token = url.searchParams.get("token");
  const free = parseInt(env.FREE_CREDITS || "2", 10);

  let paid = false;
  if (order_id && env.RT_KV) {
    const oStr = await env.RT_KV.get("o:" + order_id);
    if (oStr) paid = JSON.parse(oStr).status === "paid";
  }
  let credits = free;
  if (token && env.RT_KV) {
    const v = await env.RT_KV.get("c:" + token);
    credits = v === null || v === undefined ? free : parseInt(v, 10);
  }
  return new Response(JSON.stringify({ paid, credits }), {
    status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}
