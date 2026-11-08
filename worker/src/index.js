// CardCheck eBay proxy — Cloudflare Worker (module syntax, plain JS, no dependencies).
//   GET /                       → health check: { name, ok, configured }
//   GET /ebay?q=<keywords>[&graded=1] → EbaySummary (see src/lib/types.ts in the app)
// The browser cannot call the eBay Browse API itself (no CORS, and the client secret must stay private).
const TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const SEARCH_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search";
const SCOPE = "https://api.ebay.com/oauth/api_scope";
const CATEGORY = "183454"; // Toys & Hobbies > Collectible Card Games > CCG Individual Cards
const CACHE_TTL = 600; // seconds
const MAX_ITEMS = 5;

let tokenCache = { value: null, exp: 0 }; // per isolate
const memCache = new Map(); // caches.default is a no-op on *.workers.dev, so keep a per-isolate copy too

const JUNK =
  /\b(proxy|custom|replica|fan ?art|digital|code card|online code|ptcgl|ptcgo|lot|bulk|bundle|choose|pick your|you pick|select your|set of|empty|sleeve|binder|case only|playmat|metal card|orica)\b/i;
// Not "ace"/"tag": ACE SPEC and TAG TEAM are real card types.
const GRADED = /\b(psa|bgs|cgc|sgc|beckett|graded|gem mint 10)\b/i;

/** ALLOWED_ORIGIN: "*" or a comma-separated list, e.g. "https://kid.github.io,http://localhost:5173". */
function cors(request, env) {
  const allowed = (env.ALLOWED_ORIGIN || "*").split(",").map((s) => s.trim()).filter(Boolean);
  const origin = request.headers.get("Origin");
  const allowOrigin = allowed.includes("*") ? "*" : allowed.includes(origin) ? origin : allowed[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    ...(allowOrigin === "*" ? {} : { Vary: "Origin" }),
  };
}

function json(request, env, body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors(request, env), ...extra },
  });
}

async function getToken(env) {
  const now = Date.now();
  if (tokenCache.value && now < tokenCache.exp) return tokenCache.value;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + btoa(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`),
    },
    body: `grant_type=client_credentials&scope=${encodeURIComponent(SCOPE)}`,
  });
  if (!res.ok) throw new Error(`token ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const t = await res.json(); // { access_token, expires_in: 7200, token_type }
  tokenCache = { value: t.access_token, exp: now + (t.expires_in - 300) * 1000 };
  return tokenCache.value;
}

async function search(env, token, q, buyingOption, sort, retried = false) {
  const u = new URL(SEARCH_URL);
  u.searchParams.set("q", q);
  u.searchParams.set("category_ids", CATEGORY);
  u.searchParams.set("filter", `buyingOptions:{${buyingOption}}`);
  u.searchParams.set("sort", sort);
  u.searchParams.set("limit", "20");
  const res = await fetch(u, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": env.MARKETPLACE || "EBAY_US",
      // eBay recommends a delivery location when sorting by price (shipping is part of the sort).
      "X-EBAY-C-ENDUSERCTX": "contextualLocation=country%3DUS%2Czip%3D10001",
      "Accept-Language": "en-US",
    },
  });
  if (res.status === 401 && !retried) {
    // Token revoked or expired early: fetch a fresh one once.
    tokenCache = { value: null, exp: 0 };
    return search(env, await getToken(env), q, buyingOption, sort, true);
  }
  if (!res.ok) throw new Error(`browse ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json(); // { total, itemSummaries: [...] }
}

const money = (m) => (m && m.value != null && Number.isFinite(Number(m.value)) ? Number(m.value) : null);

/** eBay item → EbayListing. Optional strings are omitted (not null) to match the app's types. */
function compact(it, isAuction) {
  return {
    title: it.title,
    price: isAuction ? money(it.currentBidPrice) ?? money(it.price) : money(it.price),
    currency: (isAuction ? it.currentBidPrice?.currency : null) || it.price?.currency || "USD",
    shipping: money(it.shippingOptions?.[0]?.shippingCost),
    bidCount: isAuction ? it.bidCount ?? 0 : undefined,
    endsAt: it.itemEndDate || undefined,
    url: it.itemWebUrl,
    image: it.image?.imageUrl || it.thumbnailImages?.[0]?.imageUrl || undefined,
    condition: it.condition || null,
    graded: GRADED.test(it.title),
  };
}

function listings(items, isAuction, includeGraded) {
  return (items || [])
    .filter((it) => it.title && it.itemWebUrl && !JUNK.test(it.title) && (includeGraded || !GRADED.test(it.title)))
    // FIXED_PRICE results include auctions that also offer Buy It Now; keep only pure Buy It Now there.
    .filter((it) => isAuction || !(it.buyingOptions || []).includes("AUCTION"))
    .map((it) => compact(it, isAuction))
    .filter((it) => it.price != null);
}

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = s.length >> 1;
  return +(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2).toFixed(2);
}

const searchUrl = (q, extra = "") =>
  `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}&_sacat=${CATEGORY}${extra}`;

async function summarize(env, q, includeGraded) {
  const token = await getToken(env);
  const [auc, bin] = await Promise.all([
    search(env, token, q, "AUCTION", "endingSoonest"),
    search(env, token, q, "FIXED_PRICE", "price"),
  ]);
  const aucItems = listings(auc.itemSummaries, true, includeGraded);
  const binItems = listings(bin.itemSummaries, false, includeGraded);
  const binPrices = binItems.map((i) => i.price);
  return {
    query: q,
    fetchedAt: new Date().toISOString(),
    // count is eBay's total before junk filtering: "about this many listings".
    auctions: { count: auc.total ?? aucItems.length, items: aucItems.slice(0, MAX_ITEMS) },
    buyNow: {
      count: bin.total ?? binItems.length,
      lowest: binPrices.length ? Math.min(...binPrices) : null,
      median: median(binPrices),
      items: binItems.slice(0, MAX_ITEMS),
    },
    searchUrl: searchUrl(q),
    soldUrl: searchUrl(q, "&LH_Sold=1&LH_Complete=1&_sop=13"),
  };
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(request, env) });
    const url = new URL(request.url);
    const configured = Boolean(env.EBAY_CLIENT_ID && env.EBAY_CLIENT_SECRET);
    if (request.method === "GET" && url.pathname === "/") {
      return json(request, env, { name: "cardcheck-ebay", ok: true, configured });
    }
    if (request.method !== "GET" || url.pathname !== "/ebay") return json(request, env, { error: "not_found" }, 404);

    const q = (url.searchParams.get("q") || "").trim().replace(/\s+/g, " ").slice(0, 100);
    if (q.length < 2) return json(request, env, { error: "missing_q" }, 400);
    if (!configured) {
      return json(request, env, { error: "not_configured", detail: "Set EBAY_CLIENT_ID and EBAY_CLIENT_SECRET with `wrangler secret put`.", searchUrl: searchUrl(q) }, 500);
    }
    const includeGraded = url.searchParams.get("graded") === "1";

    const key = new URL("https://cache.internal/ebay");
    key.searchParams.set("q", q.toLowerCase());
    key.searchParams.set("g", includeGraded ? "1" : "0");
    const cacheKey = new Request(key.toString(), { method: "GET" });
    const cacheHeaders = { "Cache-Control": `public, max-age=${CACHE_TTL}` };

    const mem = memCache.get(key.toString());
    if (mem && mem.exp > Date.now()) return json(request, env, mem.body, 200, { ...cacheHeaders, "X-Cache": "MEM" });
    const hit = await caches.default.match(cacheKey);
    if (hit) return json(request, env, await hit.json(), 200, { ...cacheHeaders, "X-Cache": "HIT" });

    try {
      const body = await summarize(env, q, includeGraded);
      memCache.set(key.toString(), { body, exp: Date.now() + CACHE_TTL * 1000 });
      if (memCache.size > 500) memCache.delete(memCache.keys().next().value);
      const toCache = new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json", ...cacheHeaders } });
      ctx.waitUntil(caches.default.put(cacheKey, toCache));
      return json(request, env, body, 200, { ...cacheHeaders, "X-Cache": "MISS" });
    } catch (e) {
      return json(request, env, { error: "ebay_unavailable", detail: String(e?.message || e), searchUrl: searchUrl(q) }, 502);
    }
  },
};
