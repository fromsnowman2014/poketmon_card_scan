# cardcheck-ebay — eBay 실시간 가격 워커 (선택 사항)

[English below](#english)

CardCheck 앱은 이 워커 **없이도** 잘 동작해요. 워커가 없으면 eBay 버튼은 eBay 검색 페이지(경매 · 즉시구매 · 팔린 가격)를 열어 줘요.
워커를 한 번 설치해 두면, 앱 안에서 바로 **즉시구매 최저가, 경매 개수, 현재 입찰가**를 볼 수 있어요.

- 비용: **무료** (eBay 개발자 계정 무료, Cloudflare Workers 무료 플랜: 하루 10만 요청)
- 소요 시간: 약 20–30분 (eBay 계정 승인 대기 시간 제외)
- 필요한 것: 컴퓨터 1대(Windows / Mac), 이메일 주소

> 왜 워커가 필요한가요? eBay API는 브라우저(아이폰 앱)에서 직접 부를 수 없고, eBay 비밀 키를 앱에 넣으면 누구나 볼 수 있어요.
> 그래서 비밀 키는 Cloudflare에 안전하게 보관하고, 앱은 워커에게만 물어봐요.

## 1단계 — eBay 개발자 계정 만들기

1. <https://developer.ebay.com> 에 접속해서 **Register**(가입)를 눌러요. 일반 eBay 계정과 별개예요.
2. 이메일 인증을 마치면 계정이 활성화돼요. (승인에 시간이 걸릴 수 있어요.)

## 2단계 — Production(실제 서비스용) 키 만들기

1. 로그인 후 오른쪽 위 이름 메뉴 → **Application Keysets**로 가요.
2. Application Title에 `cardcheck` 처럼 아무 이름이나 적어요.
3. **Production** 쪽에서 **Create a keyset**을 눌러요. (Sandbox 키는 테스트용이라 실제 상품이 안 나와요.)

## 3단계 — "계정 삭제 알림" 면제 신청 (꼭 해야 키가 켜져요)

eBay는 Production 키를 켜기 전에 *Marketplace Account Deletion* 알림을 받을지, 면제받을지 정하라고 해요.
이 워커는 eBay 사용자 정보를 저장하지 않으니 **면제**를 고르면 돼요.

1. Production 키 옆에 보이는 안내(또는 **Alerts & Notifications**)를 눌러요.
2. **Marketplace account deletion** 항목에서 **Exempted from Marketplace Account Deletion**(면제)를 켜요.
3. 이유로 **"I do not persist eBay data"**(eBay 데이터를 저장하지 않음)를 고르고 제출해요.
4. Application Keysets 화면으로 돌아오면 Production 키가 켜져 있어요.
   - 계속 꺼져 있으면 잠시 뒤 새로고침하고, 그래도 안 되면 eBay 개발자 지원에 문의하세요.

## 4단계 — 키 2개 복사해 두기

Production 키 화면에서 두 값을 메모장에 복사해 둬요.

| eBay 화면 이름 | 워커 이름 | 모양 |
|---|---|---|
| **App ID (Client ID)** | `EBAY_CLIENT_ID` | `이름-cardchec-PRD-…` |
| **Cert ID (Client Secret)** | `EBAY_CLIENT_SECRET` | `PRD-…` |

> ⚠️ Cert ID는 비밀번호예요. 앱 설정, 채팅, GitHub에 **붙여넣지 마세요.** 아래 5단계에서 Cloudflare에만 넣어요.

## 5단계 — Cloudflare 계정 만들고 워커 올리기

1. <https://dash.cloudflare.com/sign-up> 에서 무료 계정을 만들어요. (카드 등록 필요 없음)
2. 컴퓨터에 **Node.js LTS**를 설치해요: <https://nodejs.org>
3. 터미널(Mac: 터미널 / Windows: PowerShell)을 열고 한 줄씩 실행해요.

```bash
git clone https://github.com/fromsnowman2014/poketmon_card_scan.git
cd poketmon_card_scan/worker

npx wrangler@4 login        # 브라우저가 열리면 Cloudflare 로그인 → Allow
npx wrangler@4 deploy       # 워커 올리기
```

- git이 없다면 GitHub 저장소 페이지에서 **Code → Download ZIP**으로 받고 압축을 푼 뒤 `worker` 폴더에서 실행해도 돼요.
- 처음 올릴 때 *workers.dev 서브도메인*을 정하라고 하면 아무 영어 이름(예: 가족 이름)을 입력해요.
- 끝나면 `https://cardcheck-ebay.<내이름>.workers.dev` 같은 **주소**가 나와요. 복사해 두세요.

4. 이제 비밀 키 2개를 넣어요. 실행하면 값을 물어보는데, 4단계에서 복사한 값을 붙여넣고 Enter를 눌러요.

```bash
npx wrangler@4 secret put EBAY_CLIENT_ID       # App ID 붙여넣기
npx wrangler@4 secret put EBAY_CLIENT_SECRET   # Cert ID 붙여넣기
```

## 6단계 — 잘 되는지 확인

사파리나 크롬에서 워커 주소를 열어 봐요.

- `https://cardcheck-ebay.<내이름>.workers.dev/` → `{"name":"cardcheck-ebay","ok":true,"configured":true}` 가 보이면 성공!
- `https://cardcheck-ebay.<내이름>.workers.dev/ebay?q=Pikachu` → 경매 / 즉시구매 목록(JSON)이 보여요.

## 7단계 — 앱에 주소 붙여넣기

아이폰의 CardCheck → **설정(⚙️)** → **eBay 워커 주소**에 워커 주소를 붙여넣어요.
이제 카드 결과 화면에서 eBay 실시간 가격이 보여요. 🎉

### (선택) 우리 앱에서만 쓰도록 잠그기

`wrangler.toml`의 `ALLOWED_ORIGIN = "*"`를 `"https://fromsnowman2014.github.io"`로 바꾸고 `npx wrangler@4 deploy`를 다시 실행해요.
여러 개는 쉼표로 적어요: `"https://fromsnowman2014.github.io,http://localhost:5173"`.

## 문제 해결

| 증상 | 해결 |
|---|---|
| `"configured":false` | 5단계의 `secret put` 두 줄을 다시 실행해요. |
| `ebay_unavailable` + `token 401` | 키가 틀렸거나 Production 키가 꺼져 있어요. 3·4단계를 확인해요. Sandbox 키(`SBX`)는 안 돼요. |
| `ebay_unavailable` + `browse 403`/`429` | eBay 쪽 권한 또는 하루 호출 한도 문제예요. 잠시 뒤 다시 해 봐요. |
| 앱에서 eBay 가격이 안 보여요 | 설정의 주소에 오타가 없는지, 6단계 주소가 사파리에서 열리는지 확인해요. 앱은 실패해도 eBay 검색 링크를 보여 줘요. |
| 코드를 업데이트하고 싶어요 | `git pull` 후 `worker` 폴더에서 `npx wrangler@4 deploy` |
| 워커를 지우고 싶어요 | `npx wrangler@4 delete` |

## 알아 두면 좋은 점

- 같은 검색은 10분 동안 저장해 두고 다시 써서 eBay 호출을 아껴요.
- 그레이딩 카드(PSA, BGS, CGC…)와 프록시 · 묶음(lot) 판매는 빼고 보여 줘요. `&graded=1`을 붙이면 그레이딩 카드도 포함돼요.
- eBay에는 "팔린 가격" API가 무료로 열려 있지 않아요. 팔린 가격은 앱의 **팔린 가격** 링크(eBay 검색)로 확인해요.
- 이 워커는 개인정보를 저장하지 않아요.

## API

| 요청 | 응답 |
|---|---|
| `GET /` | `{ name, ok, configured }` |
| `GET /ebay?q=<검색어>[&graded=1]` | `EbaySummary` (`src/lib/types.ts`): `{ query, fetchedAt, auctions: { count, items }, buyNow: { count, lowest, median, items }, searchUrl, soldUrl }` |
| 오류 | `400 missing_q`, `404 not_found`, `500 not_configured`, `502 ebay_unavailable` (+ `searchUrl`) |

테스트(인터넷 필요 없음): `node worker/test.mjs`

---

## English

CardCheck works fine **without** this worker: the eBay buttons open eBay searches (auctions, Buy It Now, sold).
With the worker, the app shows the **lowest Buy It Now price, auction count and current bids** right on the card screen.
It is **free** (eBay developer account + Cloudflare Workers free plan, 100k requests/day) and takes about 20–30 minutes.

Why a worker? The eBay Browse API can't be called from a browser (no CORS), and the eBay secret must not ship inside the app.

1. **eBay developer account** — register at <https://developer.ebay.com> (separate from a normal eBay account) and confirm your email.
2. **Production keyset** — account menu → **Application Keysets** → enter a title (e.g. `cardcheck`) → **Production → Create a keyset**.
3. **Account-deletion exemption** — eBay keeps the Production keyset disabled until you handle *Marketplace Account Deletion*.
   Open **Alerts & Notifications**, turn on **Exempted from Marketplace Account Deletion**, choose **"I do not persist eBay data"**, and submit.
4. **Copy the keys** — **App ID (Client ID)** → `EBAY_CLIENT_ID`, **Cert ID (Client Secret)** → `EBAY_CLIENT_SECRET`. Never paste the Cert ID into the app.
5. **Cloudflare + deploy** — create a free account at <https://dash.cloudflare.com/sign-up>, install Node.js LTS, then:

   ```bash
   git clone https://github.com/fromsnowman2014/poketmon_card_scan.git
   cd poketmon_card_scan/worker
   npx wrangler@4 login
   npx wrangler@4 deploy                         # prints https://cardcheck-ebay.<you>.workers.dev
   npx wrangler@4 secret put EBAY_CLIENT_ID      # paste the App ID
   npx wrangler@4 secret put EBAY_CLIENT_SECRET  # paste the Cert ID
   ```

   If asked to pick a *workers.dev subdomain* on the first deploy, type any name.
6. **Check** — open `https://cardcheck-ebay.<you>.workers.dev/`; you should see `"configured":true`. Try `/ebay?q=Pikachu`.
7. **Paste the URL in the app** — CardCheck → **Settings** → **eBay worker URL**.

Optional: set `ALLOWED_ORIGIN` in `wrangler.toml` to `"https://fromsnowman2014.github.io"` (comma-separate several) and redeploy.

Troubleshooting: `configured:false` → re-run the two `secret put` commands. `ebay_unavailable` with `token 401` → wrong keys, Sandbox keys,
or the Production keyset is still disabled (step 3). The app always falls back to plain eBay search links.

Notes: results are cached for 10 minutes; graded slabs, proxies and lots are filtered out (`&graded=1` keeps graded); sold prices have no free
eBay API, so the app links to eBay's sold search instead. The worker stores no personal data. Offline test: `node worker/test.mjs`.
