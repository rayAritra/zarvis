// Zarvis proxy (Cloudflare Worker). Holds the real API key so users never need one.
// Secrets/vars (set with wrangler): OPENROUTER_KEY (secret), MODEL (e.g. poolside/laguna-s-2.1:free).

const UPSTREAM = "https://openrouter.ai/api/v1/chat/completions";
const MAX_BODY = 1_000_000; // bytes
const MAX_OUTPUT_TOKENS = 4096;

const json = (obj, status) => new Response(JSON.stringify({ error: { message: obj } }), { status, headers: { "content-type": "application/json" } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") return new Response("zarvis proxy ok");
    if (request.method !== "POST" || url.pathname !== "/v1/chat/completions") return json("Not found", 404);

    // Per-IP rate limit, so one person can't burn the shared quota.
    const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
    const { success } = await env.RL.limit({ key: ip });
    if (!success) return json("Too many requests, slow down.", 429);

    const text = await request.text();
    if (text.length > MAX_BODY) return json("Request too large.", 413);
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return json("Invalid JSON.", 400);
    }

    // The server decides the model and the output cap; the client's choice is ignored.
    body.model = env.MODEL;
    body.max_tokens = Math.min(body.max_tokens ?? MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS);

    const upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.OPENROUTER_KEY}` },
      body: JSON.stringify(body),
    });
    return new Response(upstream.body, { status: upstream.status, headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" } });
  },
};
