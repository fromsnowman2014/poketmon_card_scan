// Offline test for the worker: fake eBay (token + Browse API) and a no-op Cache API.
// Run: node worker/test.mjs
import assert from "node:assert/strict";

// Records the Cache API keys the worker uses (the country must be part of them).
const cacheKeys = { match: [], put: [] };
globalThis.caches = {
  default: {
    match: async (req) => void cacheKeys.match.push(new URL(req.url)),
    put: async (req) => void cacheKeys.put.push(new URL(req.url)),
  },
};

const AUCTIONS = [
  { title: "Hawlucha 084/187 sv8a Japanese Pokemon", price: { value: "1.00", currency: "USD" }, currentBidPrice: { value: "2.50", currency: "USD" }, bidCount: 3, itemEndDate: "2026-11-09T01:00:00.000Z", buyingOptions: ["AUCTION"], itemWebUrl: "https://www.ebay.com/itm/1", image: { imageUrl: "https://i.ebayimg.com/a.jpg" }, condition: "Ungraded" },
  { title: "Pokemon card LOT 50 Japanese", price: { value: "9.00", currency: "USD" }, currentBidPrice: { value: "9.00", currency: "USD" }, bidCount: 0, buyingOptions: ["AUCTION"], itemWebUrl: "https://www.ebay.com/itm/4" },
  { title: "PSA 10 Hawlucha 084/187", price: { value: "40.00", currency: "USD" }, currentBidPrice: { value: "40.00", currency: "USD" }, bidCount: 5, buyingOptions: ["AUCTION"], itemWebUrl: "https://www.ebay.com/itm/5" },
  { title: "Hawlucha 084/187 no price", buyingOptions: ["AUCTION"], itemWebUrl: "https://www.ebay.com/itm/6" },
];
const BUY_NOW = [
  // A 99¢ card with $4.50 shipping costs more than a $1.99 card with free shipping.
  { title: "Hawlucha sv8a 084/187 NM", price: { value: "0.99", currency: "USD" }, buyingOptions: ["FIXED_PRICE"], itemWebUrl: "https://www.ebay.com/itm/2", shippingOptions: [{ shippingCost: { value: "4.50", currency: "USD" } }] },
  { title: "Hawlucha 084/187 Terastal Festival", price: { value: "1.99", currency: "USD" }, buyingOptions: ["FIXED_PRICE", "BEST_OFFER"], itemWebUrl: "https://www.ebay.com/itm/3", shippingOptions: [{ shippingCost: { value: "0.00", currency: "USD" } }] },
  { title: "Hawlucha 084/187 auction w/ BIN", price: { value: "5.00", currency: "USD" }, buyingOptions: ["AUCTION", "FIXED_PRICE"], itemWebUrl: "https://www.ebay.com/itm/7" },
  { title: "Hawlucha proxy card custom", price: { value: "0.50", currency: "USD" }, buyingOptions: ["FIXED_PRICE"], itemWebUrl: "https://www.ebay.com/itm/8" },
  { title: "Hawlucha 084/187 sv8a lots of 4", price: { value: "0.25", currency: "USD" }, buyingOptions: ["FIXED_PRICE"], itemWebUrl: "https://www.ebay.com/itm/9" },
  { title: "Hawlucha 084/187 READ DESCRIPTION", price: { value: "0.10", currency: "USD" }, buyingOptions: ["FIXED_PRICE"], itemWebUrl: "https://www.ebay.com/itm/10" },
  { title: "PSA 9 Hawlucha 084/187 slab", price: { value: "30.00", currency: "USD" }, buyingOptions: ["FIXED_PRICE"], itemWebUrl: "https://www.ebay.com/itm/11", shippingOptions: [{ shippingCost: { value: "5.00", currency: "USD" } }] },
  // No shippingOptions (calculated shipping): counted as price only, lowestShipping would be null.
  { title: "Hawlucha 084/187 Japanese", price: { value: "2.50", currency: "USD" }, buyingOptions: ["FIXED_PRICE"], itemWebUrl: "https://www.ebay.com/itm/12" },
];
// The same search seen from Seoul (deliveryCountry:KR): eBay prices shipping to Korea, sometimes several ways.
const BUY_NOW_KR = [
  { title: "Hawlucha sv8a 084/187 from Japan", price: { value: "1.50", currency: "USD" }, buyingOptions: ["FIXED_PRICE"], itemWebUrl: "https://www.ebay.com/itm/k1", shippingOptions: [{ shippingCost: { value: "9.00", currency: "USD" } }, { shippingCost: { value: "3.00", currency: "USD" } }] },
  { title: "Hawlucha 084/187 Japanese NM", price: { value: "0.99", currency: "USD" }, buyingOptions: ["FIXED_PRICE"], itemWebUrl: "https://www.ebay.com/itm/k2", shippingOptions: [{ shippingCost: { value: "12.00", currency: "USD" } }] },
  // Calculated shipping: eBay gives no cost for Korea, so shipping stays unknown (null), never 0.
  { title: "Hawlucha 084/187 sv8a", price: { value: "2.00", currency: "USD" }, buyingOptions: ["FIXED_PRICE"], itemWebUrl: "https://www.ebay.com/itm/k3", shippingOptions: [{ shippingCostType: "CALCULATED" }] },
  // A cost in another money can't be added to a dollar price: unknown too.
  { title: "Hawlucha 084/187 Terastal", price: { value: "3.00", currency: "USD" }, buyingOptions: ["FIXED_PRICE"], itemWebUrl: "https://www.ebay.com/itm/k4", shippingOptions: [{ shippingCost: { value: "5000", currency: "KRW" } }] },
  { title: "Hawlucha 084/187 SV8a mint", price: { value: "4.00", currency: "USD" }, buyingOptions: ["FIXED_PRICE"], itemWebUrl: "https://www.ebay.com/itm/k5", shippingOptions: [{ shippingCost: { value: "6.00", currency: "USD" } }] },
];

// Best Match sample for a popular card (asked for only when there are more listings than one page).
const BEST_MATCH = [3, 4, 5, 6, 7].map((v, i) => ({
  title: `Hawlucha 084/187 copy ${i}`, price: { value: v.toFixed(2), currency: "USD" }, buyingOptions: ["FIXED_PRICE"],
  itemWebUrl: `https://www.ebay.com/itm/bm${i}`, shippingOptions: [{ shippingCost: { value: "1.00", currency: "USD" } }],
})).concat([{ ...BUY_NOW[1] }, { title: "Hawlucha bulk lot", price: { value: "0.01", currency: "USD" }, buyingOptions: ["FIXED_PRICE"], itemWebUrl: "https://www.ebay.com/itm/bm9" }]);

/**
 * Installs a fake eBay. `failToken`: token endpoint returns 401; `expireOnce`: first search returns 401;
 * `binTotal`: eBay's total for Buy It Now (more than one page triggers the Best Match sample).
 */
function fakeEbay({ failToken = false, expireOnce = false, binTotal, krBuyNow = BUY_NOW_KR } = {}) {
  const calls = { token: 0, search: 0, searches: [], ctx: [], filters: [] };
  let tokens = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/oauth2/token")) {
      calls.token++;
      assert.equal(init.headers.Authorization, "Basic " + btoa("id:sec"));
      if (failToken) return new Response('{"error":"invalid_client"}', { status: 401 });
      return Response.json({ access_token: `TOK${++tokens}`, expires_in: 7200, token_type: "Application Access Token" });
    }
    calls.search++;
    if (expireOnce && calls.search === 1) return new Response("expired", { status: 401 });
    assert.match(init.headers.Authorization, /^Bearer TOK\d$/);
    assert.equal(url.searchParams.get("category_ids"), "183454");
    calls.ctx.push(init.headers["X-EBAY-C-ENDUSERCTX"]);
    calls.filters.push(url.searchParams.get("filter"));
    const korea = init.headers["X-EBAY-C-ENDUSERCTX"].includes("country%3DKR");
    const auction = url.searchParams.get("filter").includes("AUCTION");
    const sort = url.searchParams.get("sort");
    calls.searches.push(`${auction ? "AUCTION" : "FIXED_PRICE"}:${sort ?? "bestMatch"}:${url.searchParams.get("limit")}`);
    if (auction) return Response.json({ total: AUCTIONS.length, itemSummaries: AUCTIONS });
    if (!sort) return Response.json({ total: binTotal, itemSummaries: BEST_MATCH });
    if (korea) return Response.json({ total: krBuyNow.length, itemSummaries: krBuyNow });
    return Response.json({ total: binTotal ?? BUY_NOW.length, itemSummaries: BUY_NOW });
  };
  return calls;
}

let instance = 0;
/** Fresh module instance per case, so the token and memory caches start empty. */
async function loadWorker() {
  const { default: worker } = await import(new URL(`./src/index.js?case=${++instance}`, import.meta.url));
  return worker;
}

const ENV = { EBAY_CLIENT_ID: "id", EBAY_CLIENT_SECRET: "sec", ALLOWED_ORIGIN: "https://kid.github.io, http://localhost:5173" };
const ctx = { waitUntil: () => {} };
const get = (worker, path, { env = ENV, origin = "https://kid.github.io", method = "GET", ip } = {}) =>
  worker.fetch(
    new Request(`https://cardcheck-ebay.example.workers.dev${path}`, {
      method,
      headers: { ...(origin ? { Origin: origin } : {}), ...(ip ? { "CF-Connecting-IP": ip } : {}) },
    }),
    env,
    ctx,
  );

async function test(name, fn) {
  await fn();
  console.log(`ok - ${name}`);
}

await test("summarizes auctions and Buy It Now listings", async () => {
  const calls = fakeEbay();
  const worker = await loadWorker();
  const res = await get(worker, "/ebay?q=Hawlucha%20sv8a%20084/187%20Japanese");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), "https://kid.github.io");
  assert.equal(res.headers.get("vary"), "Origin");
  assert.equal(res.headers.get("x-cache"), "MISS");
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ["auctions", "buyNow", "fetchedAt", "query", "searchUrl", "shipTo", "soldUrl"]);
  assert.equal(body.query, "Hawlucha sv8a 084/187 Japanese");
  assert.equal(body.shipTo, "US", "no country: shipping to the US, as before");
  assert.deepEqual(calls.ctx, Array(2).fill("contextualLocation=country%3DUS%2Czip%3D10001"));
  assert.deepEqual(calls.filters, ["buyingOptions:{AUCTION}", "buyingOptions:{FIXED_PRICE}"], "the US search is not narrowed");
  assert.equal(body.auctions.count, 4);
  assert.deepEqual(body.auctions.items, [
    { title: AUCTIONS[0].title, price: 2.5, currency: "USD", shipping: null, bidCount: 3, endsAt: "2026-11-09T01:00:00.000Z", url: "https://www.ebay.com/itm/1", image: "https://i.ebayimg.com/a.jpg", condition: "Ungraded", graded: false },
  ]);
  // Cheapest TOTAL first: $1.99 + free shipping, $2.50 (shipping unknown), $0.99 + $4.50. Junk, slabs and auctions are out.
  assert.deepEqual(body.buyNow.items.map((i) => i.price), [1.99, 2.5, 0.99]);
  assert.deepEqual(body.buyNow.items[0], { title: BUY_NOW[1].title, price: 1.99, currency: "USD", shipping: 0, url: "https://www.ebay.com/itm/3", condition: null, graded: false });
  assert.equal(body.buyNow.items[1].shipping, null);
  assert.equal(body.buyNow.count, BUY_NOW.length);
  assert.equal(body.buyNow.lowest, 1.99);
  assert.equal(body.buyNow.lowestShipping, 0);
  assert.equal(body.buyNow.median, 2.5, "median of totals 1.99, 2.50, 5.49");
  assert.equal(body.searchUrl, "https://www.ebay.com/sch/i.html?_nkw=Hawlucha%20sv8a%20084%2F187%20Japanese&_sacat=183454");
  assert.equal(body.soldUrl, `${body.searchUrl}&LH_Sold=1&LH_Complete=1&_sop=13`);
  assert.deepEqual(calls.searches, ["AUCTION:endingSoonest:20", "FIXED_PRICE:price:50"], "one page of Buy It Now: no Best Match call");
  assert.equal(calls.token, 1);

  const again = await get(worker, "/ebay?q=hawlucha%20%20SV8A%20084/187%20japanese");
  assert.equal(again.headers.get("x-cache"), "MEM");
  assert.equal(calls.search, 2, "cached: no new eBay calls");

  const graded = await (await get(worker, "/ebay?q=Hawlucha%20sv8a%20084/187%20Japanese&graded=1")).json();
  assert.equal(graded.auctions.items.length, 2);
  assert.equal(graded.auctions.items[1].graded, true);
  assert.deepEqual(graded.buyNow.items.map((i) => i.price), [1.99, 2.5, 0.99, 30]);
  assert.equal(graded.buyNow.items[3].graded, true);
  assert.equal(graded.buyNow.median, 4, "median of totals 1.99, 2.50, 5.49, 35");
  assert.deepEqual({ token: calls.token, search: calls.search }, { token: 1, search: 4 }, "token reused");

  // A search that names a grader keeps slabs without graded=1.
  const psa = await (await get(worker, "/ebay?q=Hawlucha%20084/187%20PSA%209")).json();
  assert.equal(psa.buyNow.items.some((i) => i.graded), true);
});

await test("popular cards: median from a Best Match sample, lowest from both samples", async () => {
  const calls = fakeEbay({ binTotal: 240 });
  const body = await (await get(await loadWorker(), "/ebay?q=Hawlucha%20084/187")).json();
  assert.deepEqual(calls.searches, ["AUCTION:endingSoonest:20", "FIXED_PRICE:price:50", "FIXED_PRICE:bestMatch:50"]);
  assert.equal(body.buyNow.count, 240);
  // Best Match totals (junk dropped): 4, 5, 6, 7, 8 and 1.99 → median (5 + 6) / 2.
  assert.equal(body.buyNow.median, 5.5);
  assert.equal(body.buyNow.lowest, 1.99);
  assert.equal(body.buyNow.lowestShipping, 0);
  const urls = body.buyNow.items.map((i) => i.url);
  assert.equal(new Set(urls).size, urls.length, "a listing found by both searches is shown once");
  assert.deepEqual(body.buyNow.items.map((i) => i.price), [1.99, 2.5, 3, 4, 0.99]);
});

await test("refreshes an expired token once", async () => {
  const calls = fakeEbay({ expireOnce: true });
  const res = await get(await loadWorker(), "/ebay?q=Hawlucha");
  assert.equal(res.status, 200);
  assert.equal(calls.token, 2);
});

await test("reports eBay failures with a fallback search link", async () => {
  fakeEbay({ failToken: true });
  const res = await get(await loadWorker(), "/ebay?q=Hawlucha");
  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.error, "ebay_unavailable");
  assert.match(body.detail, /token 401/);
  assert.equal(body.searchUrl, "https://www.ebay.com/sch/i.html?_nkw=Hawlucha&_sacat=183454");
});

await test("explains missing secrets", async () => {
  const calls = fakeEbay();
  const worker = await loadWorker();
  const res = await get(worker, "/ebay?q=Hawlucha", { env: { ALLOWED_ORIGIN: "*" } });
  assert.equal(res.status, 500);
  assert.equal((await res.json()).error, "not_configured");
  const health = await (await get(worker, "/", { env: {} })).json();
  assert.deepEqual(health, { name: "cardcheck-ebay", ok: true, configured: false });
  assert.deepEqual({ token: calls.token, search: calls.search }, { token: 0, search: 0 });
});

await test("health check, CORS preflight and bad requests", async () => {
  fakeEbay();
  const worker = await loadWorker();
  assert.deepEqual(await (await get(worker, "/")).json(), { name: "cardcheck-ebay", ok: true, configured: true });

  const pre = await get(worker, "/ebay", { method: "OPTIONS", origin: "http://localhost:5173" });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), "http://localhost:5173");
  assert.equal(pre.headers.get("access-control-allow-methods"), "GET, OPTIONS");

  const other = await get(worker, "/", { origin: "https://evil.example" });
  assert.equal(other.headers.get("access-control-allow-origin"), "https://kid.github.io");

  const any = await get(worker, "/", { env: { ...ENV, ALLOWED_ORIGIN: "*" } });
  assert.equal(any.headers.get("access-control-allow-origin"), "*");
  assert.equal(any.headers.get("vary"), null);

  assert.equal((await get(worker, "/prices?q=x")).status, 404);
  assert.equal((await get(worker, "/ebay?q=%20")).status, 400);
});

await test("validates q: trimmed, control characters removed, at most 120 characters", async () => {
  fakeEbay();
  const worker = await loadWorker();
  const tidy = await (await get(worker, "/ebay?q=%20%20Hawlucha%0A%0A084/187%09%20")).json();
  assert.equal(tidy.query, "Hawlucha 084/187");
  const long = await get(worker, `/ebay?q=${"a".repeat(121)}`);
  assert.equal(long.status, 400);
  assert.equal((await long.json()).error, "q_too_long");
  assert.equal((await get(worker, `/ebay?q=${"a".repeat(120)}`)).status, 200);
  assert.equal((await get(worker, `/ebay?q=${"a ".repeat(60)}`)).status, 200, "trailing space trimmed before the length check");
});

await test("blocks other websites when ALLOWED_ORIGIN is set (scripts without Origin are not affected)", async () => {
  const calls = fakeEbay();
  const worker = await loadWorker();
  const evil = await get(worker, "/ebay?q=Hawlucha", { origin: "https://evil.example" });
  assert.equal(evil.status, 403);
  assert.equal((await evil.json()).error, "origin_not_allowed");
  assert.equal(calls.search, 0, "no eBay calls for a blocked origin");
  assert.equal((await get(worker, "/ebay?q=Hawlucha", { origin: null })).status, 200);
  assert.equal((await get(worker, "/ebay?q=Hawlucha", { origin: "http://localhost:5173" })).status, 200);
  const open = await get(worker, "/ebay?q=Hawlucha", { origin: "https://evil.example", env: { ...ENV, ALLOWED_ORIGIN: "*" } });
  assert.equal(open.status, 200);
});

await test("rate limits each IP per minute", async () => {
  const calls = fakeEbay();
  const worker = await loadWorker();
  const env = { ...ENV, RATE_LIMIT_PER_MIN: "3" };
  for (let i = 0; i < 3; i++) assert.equal((await get(worker, `/ebay?q=Hawlucha%20${i}`, { env, ip: "203.0.113.7" })).status, 200);
  const limited = await get(worker, "/ebay?q=Hawlucha%209", { env, ip: "203.0.113.7" });
  assert.equal(limited.status, 429);
  assert.match(limited.headers.get("retry-after"), /^\d+$/);
  assert.ok(Number(limited.headers.get("retry-after")) <= 60);
  const body = await limited.json();
  assert.equal(body.error, "rate_limited");
  assert.equal(body.searchUrl, "https://www.ebay.com/sch/i.html?_nkw=Hawlucha%209&_sacat=183454");
  assert.equal(limited.headers.get("access-control-allow-origin"), "https://kid.github.io", "the app can read the 429");
  assert.equal(calls.search, 6, "the limited request made no eBay calls");
  assert.equal((await get(worker, "/ebay?q=Hawlucha%209", { env, ip: "198.51.100.1" })).status, 200, "other IPs are not affected");
  assert.equal((await get(worker, "/", { env, ip: "203.0.113.7" })).status, 200, "health check is not limited");

  // Default: 30 per minute.
  const fresh = await loadWorker();
  const statuses = [];
  for (let i = 0; i < 31; i++) statuses.push((await get(fresh, "/ebay?q=Hawlucha", { ip: "192.0.2.1" })).status);
  assert.deepEqual([statuses[29], statuses[30]], [200, 429]);
});

await test("country=KR: shipping to Seoul, only listings that ship to Korea, shipTo echoed", async () => {
  const calls = fakeEbay();
  const worker = await loadWorker();
  const res = await get(worker, "/ebay?q=Hawlucha%20sv8a%20084/187%20Japanese&country=KR");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.shipTo, "KR");
  assert.deepEqual(calls.ctx, Array(2).fill("contextualLocation=country%3DKR%2Czip%3D04524"), "Korea uses postcodes: central Seoul");
  assert.deepEqual(calls.filters, ["buyingOptions:{AUCTION},deliveryCountry:KR", "buyingOptions:{FIXED_PRICE},deliveryCountry:KR"]);
  // Totals with shipping to Korea; 3 listings have a known cost, so they come first: 1.50 + 3.00 (the cheaper of two
  // ways), 4.00 + 6.00, 0.99 + 12, then the unknown ones (2.00, 3.00): international shipping is rarely free.
  assert.deepEqual(body.buyNow.items.map((i) => [i.price, i.shipping]), [[1.5, 3], [4, 6], [0.99, 12], [2, null], [3, null]]);
  assert.equal(body.buyNow.lowest, 4.5);
  assert.equal(body.buyNow.lowestShipping, 3);
  assert.equal(body.buyNow.median, 10, "median of the known totals 4.50, 10 and 12.99");
  assert.equal(body.buyNow.items[3].shipping, null, "unknown shipping stays null, not free");
  // The links stay plain eBay US searches.
  assert.equal(body.searchUrl, "https://www.ebay.com/sch/i.html?_nkw=Hawlucha%20sv8a%20084%2F187%20Japanese&_sacat=183454");

  calls.ctx.length = 0;
  assert.equal((await (await get(worker, "/ebay?q=Hawlucha%20084&country=%20kr%20")).json()).shipTo, "KR", "any case, spaces trimmed");
  assert.equal(calls.ctx[0], "contextualLocation=country%3DKR%2Czip%3D04524");
});

await test("country=KR with fewer than 3 known shipping costs: ranked by price, so one pricey listing can't decide", async () => {
  // One listing with known shipping ($80 + $20) and many cheap ones whose shipping to Korea eBay can't price.
  const cheap = Array.from({ length: 6 }, (_, i) => ({
    title: `Hawlucha 084/187 copy ${i}`, price: { value: (3 + i * 0.1).toFixed(2), currency: "USD" }, buyingOptions: ["FIXED_PRICE"],
    itemWebUrl: `https://www.ebay.com/itm/c${i}`, shippingOptions: [{ shippingCostType: "CALCULATED" }],
  }));
  const pricey = { title: "Hawlucha 084/187 sealed", price: { value: "80.00", currency: "USD" }, buyingOptions: ["FIXED_PRICE"], itemWebUrl: "https://www.ebay.com/itm/p1", shippingOptions: [{ shippingCost: { value: "20.00", currency: "USD" } }] };
  fakeEbay({ krBuyNow: [pricey, ...cheap] });
  const body = await (await get(await loadWorker(), "/ebay?q=Hawlucha%20084/187&country=KR")).json();
  assert.equal(body.buyNow.lowest, 3);
  assert.equal(body.buyNow.lowestShipping, null, "shown as + shipping");
  assert.equal(body.buyNow.median, 3.3, "median of 3.00–3.50 and 100");
  assert.equal(body.buyNow.items[0].url, "https://www.ebay.com/itm/c0", "the cheapest first, not the one with known shipping");
});

await test("unknown or garbage country falls back to the US", async () => {
  const calls = fakeEbay();
  const worker = await loadWorker();
  for (const [i, c] of ["US", "us", "JP", "", "KOR", "__proto__", "constructor", "KR,US", "\u0000KR", "toString"].entries()) {
    calls.ctx.length = 0;
    const res = await get(worker, `/ebay?q=Hawlucha%20${i}&country=${encodeURIComponent(c)}`);
    assert.equal(res.status, 200, c);
    assert.equal((await res.json()).shipTo, "US", c);
    assert.deepEqual(calls.ctx, Array(2).fill("contextualLocation=country%3DUS%2Czip%3D10001"), c);
  }
  const repeated = await (await get(worker, "/ebay?q=Hawlucha%20twice&country=KR&country=US")).json();
  assert.equal(repeated.shipTo, "KR", "the first value counts");
});

await test("US and Korean results are cached apart", async () => {
  const calls = fakeEbay();
  const worker = await loadWorker();
  cacheKeys.match.length = 0;
  cacheKeys.put.length = 0;
  const us = await get(worker, "/ebay?q=Hawlucha%20084/187");
  assert.equal(us.headers.get("x-cache"), "MISS");
  const kr = await get(worker, "/ebay?q=Hawlucha%20084/187&country=KR");
  assert.equal(kr.headers.get("x-cache"), "MISS", "a cached US answer is never served to Korea");
  assert.equal(calls.search, 4);
  assert.equal((await kr.json()).shipTo, "KR");

  const usAgain = await get(worker, "/ebay?q=hawlucha%20084/187&country=nope");
  assert.equal(usAgain.headers.get("x-cache"), "MEM");
  assert.equal((await usAgain.json()).shipTo, "US");
  const krAgain = await get(worker, "/ebay?q=HAWLUCHA%20084/187&country=kr");
  assert.equal(krAgain.headers.get("x-cache"), "MEM");
  assert.equal((await krAgain.json()).shipTo, "KR");
  assert.equal(calls.search, 4, "both served from memory");

  // The Cache API keys carry the country too (old keys without it are never read back).
  assert.deepEqual(cacheKeys.put.map((u) => u.searchParams.get("c")), ["US", "KR"]);
  assert.deepEqual(cacheKeys.match.map((u) => u.searchParams.get("c")), ["US", "KR"]);
  assert.notEqual(cacheKeys.put[0].href, cacheKeys.put[1].href);
});

console.log("all worker tests passed");
