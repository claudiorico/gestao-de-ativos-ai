import { handleGetPriceHistory } from "./get-price-history";
import { handleGetQuotes } from "./get-quotes";

type WorkerEnv = Record<string, string | undefined>;

const CACHE_VERSION = "2026-08-04-history-price-parser";

const JSON_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, x-api-key, content-type",
  "Content-Type": "application/json",
};

const CACHE_TTL_SECONDS: Record<string, number> = {
  "/get-quotes": 300,
  "/get-price-history": 3600,
};

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      ...JSON_HEADERS,
      ...(init.headers ?? {}),
    },
  });
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(JSON_HEADERS)) {
    if (!headers.has(key)) headers.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function dispatch(request: Request, env: WorkerEnv): Promise<Response> {
  const path = new URL(request.url).pathname.replace(/\/+$/, "") || "/";

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: JSON_HEADERS });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await request.text();
  const cacheTtl = CACHE_TTL_SECONDS[path] ?? 0;
  const cacheKey = cacheTtl
    ? new Request(`https://cofre-worker-cache.local${path}?v=${CACHE_VERSION}&sha=${await sha256Hex(body)}`)
    : null;

  if (cacheKey) {
    const cached = await (caches as any).default.match(cacheKey);
    if (cached) return withCors(cached);
  }

  const forwarded = new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body,
  });

  const response =
    path === "/get-quotes"
      ? await handleGetQuotes(forwarded, env)
      : path === "/get-price-history"
        ? await handleGetPriceHistory(forwarded, env)
        : json({ error: "Not found" }, { status: 404 });

  if (cacheKey && response.ok) {
    const cached = new Response(response.clone().body, response);
    cached.headers.set("Cache-Control", `public, max-age=${cacheTtl}`);
    await (caches as any).default.put(cacheKey, cached.clone());
    return cached;
  }

  return withCors(response);
}

export default {
  async fetch(request: Request, env: WorkerEnv) {
    try {
      return await dispatch(request, env);
    } catch (error) {
      console.error("[worker] Unhandled error", error);
      return json({ error: "Internal worker error" }, { status: 500 });
    }
  },
};
