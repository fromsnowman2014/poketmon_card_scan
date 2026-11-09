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
3. **코드 받기:** GitHub 저장소 페이지에서 초록색 **Code** 버튼 → **Download ZIP** → 받은 파일의 압축을 풀어요.
   (`poketmon_card_scan-main` 폴더가 생기고, 그 안에 `worker` 폴더가 있어요.)
   - 먼저 [앱 README의 "처음 배포하기" 1단계](../README.md#처음-배포하기-저장소-관리자용)로 작업 내용을 `main`에 합쳐 두세요. 안 그러면 ZIP 안에 `worker` 폴더가 없어요.
   - 비공개 저장소는 GitHub에 로그인한 브라우저에서만 받을 수 있어요. `git clone`은 비공개 저장소에서 따로 로그인 설정이 필요해서 ZIP이 더 쉬워요.
4. **`worker` 폴더에서 터미널 열기:**
   - **Windows:** 파일 탐색기에서 `worker` 폴더를 열고 → 위쪽 **주소창**을 클릭 → `cmd` 라고 쓰고 Enter.
     그 폴더에서 **명령 프롬프트(cmd)** 가 열려요. ⚠️ **PowerShell 말고 명령 프롬프트**를 쓰세요. PowerShell은 기본 설정에서 `npx`를 막아요.
   - **Mac:** **터미널** 앱을 열고 `cd ` (cd 뒤에 한 칸 띄우기)를 쓴 다음, Finder의 `worker` 폴더를 터미널 창에 끌어다 놓고 Enter.
5. 한 줄씩 실행해요. (`#` 뒤는 설명이라 안 써도 돼요.)

```bash
npx wrangler@4 login        # 브라우저가 열리면 Cloudflare 로그인 → Allow
npx wrangler@4 deploy       # 워커 올리기
```

- `Need to install the following packages ... Ok to proceed? (y)` 가 나오면 `y` 를 누르고 Enter.
- 처음 올릴 때 *workers.dev 서브도메인*을 정하라고 하면 아무 영어 이름(예: 가족 이름)을 입력해요.
- 끝나면 `https://cardcheck-ebay.<내이름>.workers.dev` 같은 **주소**가 나와요. 복사해 두세요.

6. 이제 비밀 키 2개를 넣어요. 실행하면 값을 물어보는데, 4단계에서 복사한 값을 붙여넣고 Enter를 눌러요. (붙여넣어도 화면에 안 보이는 게 정상이에요.)

```bash
npx wrangler@4 secret put EBAY_CLIENT_ID       # App ID 붙여넣기
npx wrangler@4 secret put EBAY_CLIENT_SECRET   # Cert ID 붙여넣기
```

> git을 쓰는 분: `git clone https://github.com/fromsnowman2014/poketmon_card_scan.git` 후 `cd poketmon_card_scan/worker`.
> 비공개 저장소라면 GitHub에 로그인된 git(예: GitHub Desktop)이 필요해요.

## 6단계 — 잘 되는지 확인

사파리나 크롬에서 워커 주소를 열어 봐요.

- `https://cardcheck-ebay.<내이름>.workers.dev/` → `{"name":"cardcheck-ebay","ok":true,"configured":true}` 가 보이면 성공!
- `https://cardcheck-ebay.<내이름>.workers.dev/ebay?q=Pikachu` → 경매 / 즉시구매 목록(JSON)이 보여요.
- 한국에 산다면 `…/ebay?q=Pikachu&country=KR` → `"shipTo":"KR"`이 보이면 한국 배송비로 계산하는 새 버전이에요.

## 7단계 — 앱에 주소 붙여넣기

아이폰의 CardCheck → **설정(⚙️)** → **eBay 워커 주소**에 워커 주소를 붙여넣어요.
이제 카드 결과 화면에서 eBay 실시간 가격이 보여요. 🎉

### 워커 주소는 우리 가족만 알기

워커 주소를 아는 사람은 누구나 워커에 물어볼 수 있어요. 그래서 **워커 주소는 다른 사람에게 알려 주거나 인터넷에 올리지 마세요.**
대신 워커는 같은 인터넷 주소(IP)에서 **1분에 30번**까지만 답해요. 누가 주소를 알아내도 eBay 하루 한도를 한꺼번에 다 써 버리지 못해요.
(아이가 쓸 때는 30번에 닿을 일이 없어요. `wrangler.toml`의 `RATE_LIMIT_PER_MIN`으로 바꿀 수 있어요.)

### (선택) 다른 웹사이트에서 못 쓰게 하기

`wrangler.toml`의 `ALLOWED_ORIGIN = "*"`를 앱 주소로 바꾸고 `npx wrangler@4 deploy`를 다시 실행해요.

- GitHub Pages: `"https://fromsnowman2014.github.io"` · Cloudflare Pages: `"https://<프로젝트 이름>.pages.dev"`
- 여러 개는 쉼표로 적어요: `"https://fromsnowman2014.github.io,http://localhost:5173"`.

> 이 설정은 **다른 웹사이트가 브라우저에서** 워커를 쓰는 것만 막아요. 프로그램이나 스크립트(curl 등)는 막지 못하니, 주소는 계속 비밀로 해 주세요.

## 문제 해결

| 증상 | 해결 |
|---|---|
| `npx.ps1 ... 스크립트를 실행할 수 없으므로` / `running scripts is disabled on this system` | PowerShell이 `npx`를 막았어요. **명령 프롬프트(cmd)** 를 열어서 다시 해요 (5단계 4번). PowerShell을 계속 쓰려면 `npx` 대신 `npx.cmd` 라고 쓰거나, `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` 를 한 번 실행해요. |
| `'npx'은(는) 내부 또는 외부 명령 … 이 아닙니다` / `command not found: npx` | Node.js를 설치한 뒤 터미널 창을 닫고 다시 열어요. |
| `"configured":false` | 5단계의 `secret put` 두 줄을 다시 실행해요. |
| `ebay_unavailable` + `token 401` | 키가 틀렸거나 Production 키가 꺼져 있어요. 3·4단계를 확인해요. Sandbox 키(`SBX`)는 안 돼요. |
| `ebay_unavailable` + `browse 403`/`429` | eBay 쪽 권한 또는 하루 호출 한도 문제예요. 잠시 뒤 다시 해 봐요. |
| `rate_limited` (429) | 1분에 30번 넘게 물어봤어요. 1분 뒤에 다시 돼요. |
| `origin_not_allowed` (403) | `ALLOWED_ORIGIN`에 앱 주소가 빠졌어요. 쉼표로 추가하고 다시 deploy 해요. |
| 한국에 사는데 eBay 칸에 "미국 eBay 가격이에요 · 한국으로 받으면 배송비가 더 들어요"가 계속 보여요 | 워커가 예전 버전이라 한국 배송비를 몰라요. 아래 "코드를 업데이트하고 싶어요"처럼 다시 deploy 하면 "배송비는 한국까지 기준이에요"로 바뀌어요. |
| 앱에서 eBay 가격이 안 보여요 | 설정의 주소에 오타가 없는지, 6단계 주소가 사파리에서 열리는지 확인해요. 앱은 실패해도 eBay 검색 링크를 보여 줘요. |
| 코드를 업데이트하고 싶어요 | 새 ZIP을 받아 그 `worker` 폴더에서 `npx wrangler@4 deploy` (git을 쓰면 `git pull` 후). `ALLOWED_ORIGIN`을 바꿨었다면 새 `wrangler.toml`에도 다시 적어요. 비밀 키는 다시 넣을 필요 없어요. |
| 워커를 지우고 싶어요 | `npx wrangler@4 delete` |

## 알아 두면 좋은 점

- 같은 검색은 10분 동안 저장해 두고 다시 써서 eBay 호출을 아껴요.
- 즉시구매 **최저가와 보통 가격은 배송비를 더한 값**이에요. 0.99달러 카드에 배송비 4.50달러면 5.49달러로 쳐요.
- 배송비는 **아이가 사는 곳** 기준이에요 (앱 설정의 나라). 미국이면 미국 주소(뉴욕 10001)까지,
  한국이면 앱이 `&country=KR`을 붙여서 서울(우편번호 04524)까지 배송비로 계산하고, **한국으로 배송되는 매물만** 보여 줘요.
  eBay가 한국 배송비를 알려 주지 않는 매물(계산 배송)은 앱에 "배송비 별도"로 보여요. 해외 배송비가 공짜인 경우는 거의 없으니
  배송비를 아는 매물이 3개 이상이면 "최저가"와 "보통 가격"은 그 매물들로만 계산해요. 미국과 한국 결과는 따로 저장해요.
- 보통 가격은 즉시구매 매물 최대 50개의 가운데 값이에요. 매물이 50개보다 많은 인기 카드는 eBay 추천순 50개로 한 번 더 찾아서 계산해요.
  (가장 싼 50개만 보면 "보통"이 너무 낮게 나와서요.)
- 그레이딩 카드(PSA, BGS, CGC…)와 프록시 · 커스텀 · 묶음(lot) · "설명 꼭 읽으세요" 같은 매물은 빼고 보여 줘요.
  검색어에 PSA 같은 말이 있거나 `&graded=1`을 붙이면 그레이딩 카드도 포함돼요.
- eBay에는 "팔린 가격" API가 무료로 열려 있지 않아요. 팔린 가격은 앱의 **팔린 가격** 링크(eBay 검색)로 확인해요.
- 이 워커는 개인정보를 저장하지 않아요.

## API

| 요청 | 응답 |
|---|---|
| `GET /` | `{ name, ok, configured }` |
| `GET /ebay?q=<검색어>[&graded=1][&country=KR]` | `EbaySummary` (`src/lib/types.ts`): `{ query, shipTo, fetchedAt, auctions: { count, items }, buyNow: { count, lowest, median, lowestShipping, items }, searchUrl, soldUrl }`. `lowest`/`median`은 배송비 포함 합계(USD), `lowestShipping`은 최저가 매물의 배송비(0 = 무료, `null` = 모름). `items`는 합계가 싼 순서. `country`는 `KR`(대소문자 상관없음)만 알아듣고, 없거나 다른 값이면 `US`예요. `shipTo`는 실제로 쓴 나라(`"US"` / `"KR"`). |
| 오류 | `400 missing_q`, `400 q_too_long` (공백 정리 후 120자 초과), `403 origin_not_allowed`, `404 not_found`, `429 rate_limited` (+ `Retry-After`), `500 not_configured`, `502 ebay_unavailable` (오류에는 대부분 `searchUrl` 포함) |

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
5. **Cloudflare + deploy** — create a free account at <https://dash.cloudflare.com/sign-up> and install Node.js LTS.
   Get the code with the green **Code** button on the GitHub repo page → **Download ZIP**, and unzip it (merge the work into `main` first,
   see the app README's "First deploy" step 1, or the ZIP has no `worker` folder). `git clone` needs a signed-in git for a private repo, so the ZIP is easier.
   Open a terminal **in the `worker` folder**: on **Windows** open the folder in File Explorer, click the address bar, type `cmd` and press Enter
   (use **Command Prompt, not PowerShell**: PowerShell's default policy blocks `npx`); on a **Mac** open Terminal, type `cd `, drag the `worker`
   folder onto the window and press Enter. Then run:

   ```bash
   npx wrangler@4 login
   npx wrangler@4 deploy                         # prints https://cardcheck-ebay.<you>.workers.dev
   npx wrangler@4 secret put EBAY_CLIENT_ID      # paste the App ID
   npx wrangler@4 secret put EBAY_CLIENT_SECRET  # paste the Cert ID
   ```

   Answer `y` if npx asks to install wrangler. If asked to pick a *workers.dev subdomain* on the first deploy, type any name.
6. **Check** — open `https://cardcheck-ebay.<you>.workers.dev/`; you should see `"configured":true`. Try `/ebay?q=Pikachu`
   (and `/ebay?q=Pikachu&country=KR`, which should say `"shipTo":"KR"`).
7. **Paste the URL in the app** — CardCheck → **Settings** → **eBay worker URL**.

**Keep the worker address private.** Anyone who knows it can query it. The worker answers at most **30 requests per minute per IP address**
(`RATE_LIMIT_PER_MIN` in `wrangler.toml`), so a leaked address can't burn the whole eBay daily quota at once; a kid never gets near that limit.

Optional: set `ALLOWED_ORIGIN` in `wrangler.toml` to your app's address, e.g. `"https://fromsnowman2014.github.io"` or `"https://<project>.pages.dev"`
(comma-separate several), and redeploy. This only stops **other websites in a browser**; scripts such as curl ignore it, which is why the address should stay private.

Troubleshooting: `npx.ps1 cannot be loaded … running scripts is disabled` → use Command Prompt (cmd) instead of PowerShell, or type `npx.cmd`,
or run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once. `configured:false` → re-run the two `secret put` commands.
`ebay_unavailable` with `token 401` → wrong keys, Sandbox keys, or the Production keyset is still disabled (step 3). `rate_limited` (429) → wait a minute.
`origin_not_allowed` (403) → add the app's address to `ALLOWED_ORIGIN`. To update the worker, download a new ZIP and run `npx wrangler@4 deploy`
in its `worker` folder (re-apply your `ALLOWED_ORIGIN`; secrets stay). The app always falls back to plain eBay search links.

Notes: results are cached for 10 minutes. Buy It Now `lowest` and `median` are **totals including shipping** (a $0.99 card with $4.50 shipping
counts as $5.49), and `lowestShipping` is the shipping part of the lowest one (0 = free, null = unknown).
Shipping goes to **where the kid lives** (the app's country setting): a US address (New York 10001) by default; for a kid in Korea the app adds
`&country=KR`, and the worker prices shipping to Seoul (postcode 04524) and keeps **only listings that ship to Korea** (eBay's `deliveryCountry`
filter). Listings without a Korean shipping price (calculated shipping) show as "+ shipping". Once at least 3 listings have a known price to
Korea, those sort first and alone set the lowest and typical price (international shipping is rarely free); with fewer, listings are ranked by price. `country` only understands `KR` (any case); anything
else is `US`. The response echoes it as `shipTo` (`"US"` / `"KR"`; older workers leave it out and the app treats that as US), and US and Korean
results are cached separately. A Korean kid with an older worker sees "Prices from eBay US · Shipping to Korea costs extra": redeploy to fix it.
The median uses up to 50 Buy It Now listings; for popular cards with more than 50, it comes from a second, Best Match sample so it isn't just the
cheapest few. Graded slabs, proxies, customs, lots and "read description" listings are filtered out (a query that names PSA etc., or `&graded=1`,
keeps graded). Sold prices have no free eBay API, so the app links to eBay's sold search instead. The worker stores no personal data.
API: `GET /ebay?q=<keywords>[&graded=1][&country=KR]` → `{ query, shipTo, fetchedAt, auctions, buyNow, searchUrl, soldUrl }`.
Errors: `400 missing_q` / `q_too_long` (over 120 characters), `403 origin_not_allowed`, `404 not_found`, `429 rate_limited` (+ `Retry-After`),
`500 not_configured`, `502 ebay_unavailable`. Offline test: `node worker/test.mjs`.
