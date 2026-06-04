/**
 * Culver's Flavor of the Day — single Worker
 *
 * Serves the static front-end (public/index.html) via Workers Static Assets
 * AND proxies the Culver's API/site at /proxy so the browser can call it
 * without hitting CORS or the public-proxy WAF block.
 *
 * Routing:
 *   GET /                -> static asset (handled automatically, Worker not invoked)
 *   GET /proxy?quest=URL -> server-side fetch of an allowed culvers.com URL
 *   everything else      -> falls back to static assets (404 if missing)
 */

// Only allow proxying to Culver's so this can't be abused as an open proxy.
const ALLOWED_HOSTS = new Set(["www.culvers.com", "culvers.com", "cdn.culvers.com"]);

// Look like a normal browser so the upstream WAF doesn't flag us.
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/json,*/*",
  "Accept-Language": "en-US,en;q=0.9",
};

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function handleProxy(request) {
  if (request.method !== "GET") return jsonError(405, "Method not allowed");

  const quest = new URL(request.url).searchParams.get("quest");
  if (!quest) return jsonError(400, "Missing ?quest= parameter");

  let target;
  try {
    target = new URL(quest);
  } catch {
    return jsonError(400, "Invalid quest URL");
  }

  if (target.protocol !== "https:" || !ALLOWED_HOSTS.has(target.hostname)) {
    return jsonError(403, `Host not allowed: ${target.hostname}`);
  }

  try {
    const upstream = await fetch(target.toString(), {
      headers: BROWSER_HEADERS,
      redirect: "follow",
    });

    const headers = new Headers();
    headers.set(
      "Content-Type",
      upstream.headers.get("Content-Type") || "application/octet-stream"
    );
    headers.set("Cache-Control", "no-store");
    // Same-origin in production, but allow * so local testing also works.
    headers.set("Access-Control-Allow-Origin", "*");

    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (err) {
    return jsonError(502, "Upstream fetch failed: " + String(err));
  }
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname === "/proxy") {
      return handleProxy(request);
    }

    // Anything that isn't the proxy is a static asset request.
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response("Not found", { status: 404 });
  },
};
