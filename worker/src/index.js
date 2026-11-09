// CardCheck eBay proxy — Cloudflare Worker (module syntax, plain JS, no dependencies).
//   GET /                       → health check: { name, ok, configured }
//   GET /ebay?q=<keywords>[&graded=1] → EbaySummary (see src/lib/types.ts in the app)
// The browser cannot call the eBay Browse API itself (no CORS, and the client secret must stay private).
// Abuse limits: q is at most MAX_Q chars, and each IP gets RATE_LIMIT_PER_MIN /ebay requests per minute.
const TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const SEARCH_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search";
const SCOPE = "https://api.ebay.com/oauth/api_scope";
const CATEGORY = "183454"; // Toys & Hobbies > Collectible Card Games > CCG Individual Cards
const CACHE_TTL = 600; // seconds
const MAX_ITEMS = 5;
const MAX_Q = 120; // characters; the app's queries are ~20-60
const AUCTION_LIMIT = 20;
// Buy It Now sample size: enough for a meaningful median once junk is filtered out.
const BIN_LIMIT = 50;
const RATE_LIMIT_PER_MIN = 30; // default; override with the RATE_LIMIT_PER_MIN var in wrangler.toml
const RATE_WINDOW_MS = 60_000;

let tokenCache = { value: null, exp: 0 }; // per isolate
const memCache = new Map(); // caches.default is a no-op on *.workers.dev, so keep a per-isolate copy too
const rateHits = new Map(); // ip → { start, n }, per isolate (best effort: Cloudflare may run several isolates)

// Listings that are not "one copy of this card": lots, proxies/fakes, accessories, mystery packs, "read description" traps.
const JUNK =
  /\b(proxy|custom|replica|fan ?art|fake|not real|unofficial|digital|code card|online code|ptcgl|ptcgo|lot|lots|bulk|bundle|bundles|playset|choose|pick your|you pick|select your|set of|complete set|mystery|random|repack|empty|sleeve|binder|case only|playmat|metal card|orica|read desc(ription)?|see desc(ription)?|please read)\b/i;
// Not "ace"/"tag": ACE SPEC and TAG TEAM are real card types.
const GRADED = /\b(psa|bgs|cgc|sgc|beckett|graded|gem mint 10|slab|slabbed)\b/i;

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

/** `sort` "" = eBay Best Match (relevance, not price), used as an unbiased sample for the median. */
async function search(env, token, q, buyingOption, sort, limit, retried = false) {
  const u = new URL(SEARCH_URL);
  u.searchParams.set("q", q);
  u.searchParams.set("category_ids", CATEGORY);
  u.searchParams.set("filter", `buyingOptions:{${buyingOption}}`);
  if (sort) u.searchParams.set("sort", sort);
  u.searchParams.set("limit", String(limit));
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
    return search(env, await getToken(env), q, buyingOption, sort, limit, true);
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

/** Price + shipping (shipping counts as 0 when eBay doesn't say, e.g. calculated shipping). */
const total = (it) => +(it.price + (it.shipping ?? 0)).toFixed(2);

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
    search(env, token, q, "AUCTION", "endingSoonest", AUCTION_LIMIT),
    // eBay's "price" sort is price + shipping to the delivery location set in search().
    search(env, token, q, "FIXED_PRICE", "price", BIN_LIMIT),
  ]);
  const aucItems = listings(auc.itemSummaries, true, includeGraded);
  const cheapest = listings(bin.itemSummaries, false, includeGraded);
  // When there are more listings than one page, the cheapest 50 say little about a typical price:
  // take the median from a Best Match sample instead (one extra eBay call, only for popular cards).
  const morePages = (bin.total ?? 0) > (bin.itemSummaries || []).length;
  const sample = morePages
    ? listings((await search(env, token, q, "FIXED_PRICE", "", BIN_LIMIT)).itemSummaries, false, includeGraded)
    : cheapest;
  const medianOf = sample.length >= 3 || !morePages ? sample : cheapest;
  // Cheapest first by total cost; de-duplicated because a listing can be in both samples.
  const seen = new Set();
  const binItems = [...cheapest, ...(morePages ? sample : [])]
    .filter((it) => !seen.has(it.url) && seen.add(it.url))
    .sort((a, b) => total(a) - total(b));
  const best = binItems[0];
  return {
    query: q,
    fetchedAt: new Date().toISOString(),
    // count is eBay's total before junk filtering: "about this many listings".
    auctions: { count: auc.total ?? aucItems.length, items: aucItems.slice(0, MAX_ITEMS) },
    buyNow: {
      count: bin.total ?? cheapest.length,
      // TOTAL costs (price + shipping), what a buyer actually pays in the US.
      lowest: best ? total(best) : null,
      median: median(medianOf.map(total)),
      lowestShipping: best ? best.shipping ?? null : null,
      items: binItems.slice(0, MAX_ITEMS),
    },
    searchUrl: searchUrl(q),
    soldUrl: searchUrl(q, "&LH_Sold=1&LH_Complete=1&_sop=13"),
  };
}

/** Fixed one-minute window per IP. Returns seconds to wait, or 0 when the request may go ahead. */
function rateLimit(ip, limit, now = Date.now()) {
  let h = rateHits.get(ip);
  if (!h || now - h.start >= RATE_WINDOW_MS) {
    h = { start: now, n: 0 };
    rateHits.set(ip, h);
    if (rateHits.size > 2000) {
      for (const [k, v] of rateHits) if (now - v.start >= RATE_WINDOW_MS) rateHits.delete(k);
    }
  }
  h.n++;
  return h.n > limit ? Math.max(1, Math.ceil((h.start + RATE_WINDOW_MS - now) / 1000)) : 0;
}

/** Only browsers send Origin, so this keeps other websites out; scripts (curl) are held back by the rate limit. */
function originAllowed(request, env) {
  const allowed = (env.ALLOWED_ORIGIN || "*").split(",").map((s) => s.trim()).filter(Boolean);
  const origin = request.headers.get("Origin");
  return allowed.includes("*") || !origin || allowed.includes(origin);
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

    const q = (url.searchParams.get("q") || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().replace(/\s+/g, " ");
    if (q.length < 2) return json(request, env, { error: "missing_q" }, 400);
    if (q.length > MAX_Q) return json(request, env, { error: "q_too_long", detail: `q must be at most ${MAX_Q} characters.` }, 400);
    if (!originAllowed(request, env)) return json(request, env, { error: "origin_not_allowed", searchUrl: searchUrl(q) }, 403);
    if (!configured) {
      return json(request, env, { error: "not_configured", detail: "Set EBAY_CLIENT_ID and EBAY_CLIENT_SECRET with `wrangler secret put`.", searchUrl: searchUrl(q) }, 500);
    }
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const wait = rateLimit(ip, Number(env.RATE_LIMIT_PER_MIN) > 0 ? Number(env.RATE_LIMIT_PER_MIN) : RATE_LIMIT_PER_MIN);
    if (wait) {
      return json(request, env, { error: "rate_limited", detail: `Too many requests. Try again in ${wait} s.`, searchUrl: searchUrl(q) }, 429, {
        "Retry-After": String(wait),
        "Cache-Control": "no-store",
      });
    }
    // Graded slabs are left out unless asked for (graded=1) or the search itself names a grader ("PSA 10").
    const includeGraded = url.searchParams.get("graded") === "1" || GRADED.test(q);

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
