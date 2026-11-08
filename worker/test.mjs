// Offline test for the worker: fake eBay (token + Browse API) and a no-op Cache API.
// Run: node worker/test.mjs
import assert from "node:assert/strict";

globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };

const AUCTIONS = [
  { title: "Hawlucha 084/187 sv8a Japanese Pokemon", price: { value: "1.00", currency: "USD" }, currentBidPrice: { value: "2.50", currency: "USD" }, bidCount: 3, itemEndDate: "2026-11-09T01:00:00.000Z", buyingOptions: ["AUCTION"], itemWebUrl: "https://www.ebay.com/itm/1", image: { imageUrl: "https://i.ebayimg.com/a.jpg" }, condition: "Ungraded" },
  { title: "Pokemon card LOT 50 Japanese", price: { value: "9.00", currency: "USD" }, currentBidPrice: { value: "9.00", currency: "USD" }, bidCount: 0, buyingOptions: ["AUCTION"], itemWebUrl: "https://www.ebay.com/itm/4" },
  { title: "PSA 10 Hawlucha 084/187", price: { value: "40.00", currency: "USD" }, currentBidPrice: { value: "40.00", currency: "USD" }, bidCount: 5, buyingOptions: ["AUCTION"], itemWebUrl: "https://www.ebay.com/itm/5" },
  { title: "Hawlucha 084/187 no price", buyingOptions: ["AUCTION"], itemWebUrl: "https://www.ebay.com/itm/6" },
];
const BUY_NOW = [
  { title: "Hawlucha sv8a 084/187 NM", price: { value: "0.99", currency: "USD" }, buyingOptions: ["FIXED_PRICE"], itemWebUrl: "https://www.ebay.com/itm/2", shippingOptions: [{ shippingCost: { value: "1.25", currency: "USD" } }] },
  { title: "Hawlucha 084/187 Terastal Festival", price: { value: "1.99", currency: "USD" }, buyingOptions: ["FIXED_PRICE", "BEST_OFFER"], itemWebUrl: "https://www.ebay.com/itm/3" },
  { title: "Hawlucha 084/187 auction w/ BIN", price: { value: "5.00", currency: "USD" }, buyingOptions: ["AUCTION", "FIXED_PRICE"], itemWebUrl: "https://www.ebay.com/itm/7" },
  { title: "Hawlucha proxy card custom", price: { value: "0.50", currency: "USD" }, buyingOptions: ["FIXED_PRICE"], itemWebUrl: "https://www.ebay.com/itm/8" },
];

/** Installs a fake eBay. `failToken`: token endpoint returns 401; `expireOnce`: first search returns 401. */
function fakeEbay({ failToken = false, expireOnce = false } = {}) {
  const calls = { token: 0, search: 0 };
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
    const items = url.searchParams.get("filter").includes("AUCTION") ? AUCTIONS : BUY_NOW;
    return Response.json({ total: items.length, itemSummaries: items });
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
const get = (worker, path, { env = ENV, origin = "https://kid.github.io", method = "GET" } = {}) =>
  worker.fetch(new Request(`https://cardcheck-ebay.example.workers.dev${path}`, { method, headers: { Origin: origin } }), env, ctx);

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
  assert.deepEqual(Object.keys(body).sort(), ["auctions", "buyNow", "fetchedAt", "query", "searchUrl", "soldUrl"]);
  assert.equal(body.query, "Hawlucha sv8a 084/187 Japanese");
  assert.equal(body.auctions.count, 4);
  assert.deepEqual(body.auctions.items, [
    { title: AUCTIONS[0].title, price: 2.5, currency: "USD", shipping: null, bidCount: 3, endsAt: "2026-11-09T01:00:00.000Z", url: "https://www.ebay.com/itm/1", image: "https://i.ebayimg.com/a.jpg", condition: "Ungraded", graded: false },
  ]);
  assert.deepEqual(body.buyNow.items.map((i) => i.price), [0.99, 1.99]);
  assert.deepEqual(body.buyNow.items[0], { title: BUY_NOW[0].title, price: 0.99, currency: "USD", shipping: 1.25, url: "https://www.ebay.com/itm/2", condition: null, graded: false });
  assert.equal(body.buyNow.lowest, 0.99);
  assert.equal(body.buyNow.median, 1.49);
  assert.equal(body.searchUrl, "https://www.ebay.com/sch/i.html?_nkw=Hawlucha%20sv8a%20084%2F187%20Japanese&_sacat=183454");
  assert.equal(body.soldUrl, `${body.searchUrl}&LH_Sold=1&LH_Complete=1&_sop=13`);
  assert.deepEqual(calls, { token: 1, search: 2 });

  const again = await get(worker, "/ebay?q=hawlucha%20%20SV8A%20084/187%20japanese");
  assert.equal(again.headers.get("x-cache"), "MEM");
  assert.deepEqual(calls, { token: 1, search: 2 }, "cached: no new eBay calls");

  const graded = await (await get(worker, "/ebay?q=Hawlucha%20sv8a%20084/187%20Japanese&graded=1")).json();
  assert.equal(graded.auctions.items.length, 2);
  assert.equal(graded.auctions.items[1].graded, true);
  assert.deepEqual(calls, { token: 1, search: 4 }, "token reused");
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
  assert.deepEqual(calls, { token: 0, search: 0 });
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

console.log("all worker tests passed");
