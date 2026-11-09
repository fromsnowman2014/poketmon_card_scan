# CardCheck 카드체크

**포켓몬 카드를 찍으면 시세를 알려주는 무료 앱** — 아이들이 혼자서도 쓸 수 있게 크고 단순하게 만들었어요.

👉 **https://fromsnowman2014.github.io/poketmon_card_scan/**

> 주소가 아직 안 열리면(404) 저장소 관리자가 **[처음 배포하기](#처음-배포하기-저장소-관리자용)** 를 한 번 해야 해요.

[English below](#english)

## 무엇을 하나요?

1. 📸 카드를 **사진으로 찍으면** (또는 이름 · 번호를 입력하면)
2. 🔎 어떤 카드인지 찾아서
3. 💰 **시세 · 최저가 · 최고가**를 크게 보여 줘요. (미국에 살면 달러, 한국에 살면 원)
4. 🛒 **eBay 경매 중 · 즉시구매 · 팔린 가격**을 버튼 하나로 바로 볼 수 있어요.
5. 🗂️ 마음에 드는 카드는 **내 카드**에 모아서 전체 가치를 볼 수 있어요.

- **완전 무료**, 가입 · 로그인 · 광고 없음. 내 카드 목록은 내 폰에만 저장돼요. ([어디에 저장되나요?](#내-카드는-어디에-저장되나요))
- **일본어 · 한국어 · 영어 카드** 모두 지원해요. (한국 카드는 같은 세트 코드를 쓰는 일본판 데이터로 찾아요.)
- 카드 글자 읽기(OCR)는 폰 안에서 처리돼요. 사진을 서버로 보내지 않아요.

## 미국 어린이는 달러, 한국 어린이는 원

- 앱이 **사는 곳**을 스스로 알아내서 그 나라 돈으로 가격을 보여 줘요. 폰의 **시간대**(서울 → 한국, 미국 시간대 → 미국)를
  먼저 보고, 그다음 폰 언어의 지역(`ko-KR`, `en-US`)을 봐요. 화면 언어와는 따로예요.
  - 미국에 사는 한국어 어린이는 **한국어 화면 + 달러($)**, 한국에 있는 영어 폰은 **영어 화면 + 원(₩)** 이에요.
  - 폰이 힌트를 주지 않으면(예: 다른 나라 시간대) 처음 한 번만 **"어디에 살아요? 🇺🇸 / 🇰🇷"** 하고 물어봐요.
- 바꾸고 싶으면 **설정 → 사는 곳**에서 🇰🇷 한국 / 🇺🇸 미국을 골라요. 돈 단위와 검색 언어가 그 나라에 맞게 같이 바뀌어요.
  **돈 단위**만 따로 바꿀 수도 있어요. (예: 한국에 살면서 달러로 보기)
- 가격 등급(동전 · 과자값 · 용돈 · 귀한 · 보물 카드)도 그 돈에 맞춰요. 원은 1,000원 · 5,000원 · 30,000원 · 150,000원, 달러는 $1 · $5 · $25 · $100 기준이에요.
- (선택) eBay 워커를 쓰면 배송비를 **사는 나라까지** 계산해요. 한국에 살면 서울까지의 배송비로, 한국으로 보낼 수 있는 물건만 보여 줘요.
  예전에 설치한 워커는 **새 버전으로 다시 배포**해야 해요 ([worker/README.md](worker/README.md)). 설정의 **연결 테스트**가 알려 줘요.

## 아이폰에 설치하기 (홈 화면에 추가)

1. 아이폰 **사파리(Safari)** 로 <https://fromsnowman2014.github.io/poketmon_card_scan/> 을 열어요.
2. 아래쪽 **공유 버튼**(네모에서 화살표가 나오는 아이콘)을 눌러요.
3. **홈 화면에 추가**를 누르고 → 오른쪽 위 **추가**.
4. 홈 화면의 **CardCheck** 아이콘으로 열면 앱처럼 전체 화면으로 열려요.
5. 처음 카드를 찍을 때 **카메라 허용**을 눌러 주세요.

> 다른 앱(카카오톡 등) 안에서 열린 브라우저에서는 "홈 화면에 추가"가 안 보일 수 있어요. 꼭 사파리로 열어 주세요.
> 안드로이드는 크롬 메뉴(⋮) → **홈 화면에 추가 / 앱 설치**.

### 내 카드는 어디에 저장되나요?

**이 폰의 이 앱 안에만** 저장돼요. (서버나 계정에 올라가지 않아요.) 그래서 알아 둘 점이 있어요.

- 📲 **홈 화면 앱과 사파리는 저장 공간이 따로예요.** 사파리에서 모은 카드는 홈 화면 앱으로 옮겨지지 않아요.
  → **먼저 홈 화면에 추가하고, 그 앱에서 카드를 모아요.**
- 🗓️ 홈 화면 앱은 사파리의 **"7일 동안 안 열면 지우기" 규칙을 받지 않아요.** 사파리 탭으로만 쓰면 7일 넘게 안 열었을 때 카드가 지워질 수 있어요.
- 🧹 아이폰 **설정 → (앱 →) Safari → 방문 기록 및 웹사이트 데이터 지우기**를 하면 **내 카드도 지워져요.**
- 🗑️ 홈 화면에서 앱 아이콘을 삭제해도 그 앱의 내 카드가 같이 지워져요. 폰을 바꾸면 새 폰으로 옮겨지지 않아요.

## 카드 잘 찍는 요령 (어린이용)

- 💡 **밝은 곳**에서 찍어요. 그림자가 지지 않게!
- 🖼️ 카드가 **네모 칸에 꽉 차게** 맞춰요.
- ✨ **반짝이 반사**가 없게 살짝 기울여요. 슬리브(카드 비닐)는 빼면 더 잘 읽혀요.
- 🔢 앱은 카드 **왼쪽 아래의 작은 글자**를 읽어요. 예: `sv8a 084/187` (영어 카드는 `MEW EN 199/165`). 이 부분이 또렷하게 나오게 찍어요.
- 🙋 못 찾으면 **이름이나 번호를 직접 입력**해도 돼요. (`루차불`, `ルチャブル`, `Hawlucha`, `084/187` 모두 OK)

## 가격은 어디서 오나요?

- 카드 정보와 가격은 [TCGdex](https://tcgdex.dev) 에서 가져와요. **매일 업데이트**돼요.
  - **TCGplayer** (미국, 달러) — 주로 영어 카드
  - **Cardmarket** (유럽, 유로) — 일본 카드 포함. 원(또는 달러)으로 바꿔서 **약** 표시와 함께 보여 줘요. (예: `약 4,760원`, `약 $3.50`. 영어 화면은 `≈ $3.50`)
- 환율은 [open.er-api.com](https://open.er-api.com) (실패하면 Frankfurter)에서 가져와요.
- **eBay**: 버튼을 누르면 eBay 검색 결과(경매 마감 임박순 · 즉시구매 최저가순 · 최근 팔린 순)가 열려요.

### 솔직한 한계

- 무료로 쓸 수 있는 **"실제 팔린 가격" API는 없어요.** 팔린 가격은 eBay 링크로 직접 확인해야 해요.
- 앱의 가격은 **예상 가격**이에요. 카드 상태(흠집, 휘어짐)나 그레이딩(PSA 등)에 따라 실제 가격은 많이 달라요.
- 일본 카드는 가격 정보가 없는 경우도 있어요. 그럴 땐 eBay 링크를 눌러 보세요.
- 👨‍👩‍👧 **카드를 사고팔 땐 꼭 어른과 함께 해요!**

### (선택) eBay 실시간 가격

무료 Cloudflare 워커를 한 번 설치하면 앱 안에서 **즉시구매 최저가와 경매 현황**을 바로 볼 수 있어요.
(즉시구매 가격과 경매 현재가 모두 **사는 나라까지의 배송비 포함** 가격이에요: 미국이면 미국 안, 한국이면 서울까지. 배송비를 모르는 물건은 "배송비 별도"라고 보여 줘요.)
부모님용 단계별 안내: **[worker/README.md](worker/README.md)**

## 처음 배포하기 (저장소 관리자용)

아이폰에서 앱 주소가 열리려면 **딱 한 번** 아래 순서대로 해 주세요. 컴퓨터 브라우저로 <https://github.com> 에 로그인해서 하면 되고, 프로그램 설치는 필요 없어요.

**1단계 — 만든 내용을 `main` 브랜치에 합치기**

1. 저장소 페이지 위쪽 **Pull requests** 탭 → **New pull request**.
2. **base: `main`** ← **compare: `claude/happy-shannon-b3any5`** 를 고르고 **Create pull request** 를 두 번 눌러요.
3. 자동 검사(초록 ✓)가 끝나면 **Merge pull request** → **Confirm merge**.

**2단계 — 무료로 인터넷에 올리기 (A, B 중 하나만)**

GitHub 무료 플랜에서는 **비공개(private) 저장소에 GitHub Pages를 쓸 수 없어요.** (GitHub Pro 같은 유료 플랜이면 비공개여도 돼요. 그럼 A의 2번부터 하세요.)

*A. 저장소를 공개로 바꾸고 GitHub Pages 쓰기 (추천, 가장 간단)*

1. **Settings → General** → 맨 아래 **Danger Zone → Change visibility → Change to public** → 안내대로 확인해요.
   - 왜 공개해야 하나요? GitHub Pages를 무료로 쓰는 조건이 "공개 저장소"이기 때문이에요.
   - 괜찮을까요? 이 저장소에는 **비밀번호나 비밀 키가 없어요.** 앱은 원래 누구나 여는 웹 페이지라 코드가 보여도 안전해요.
     (eBay 비밀 키는 저장소가 아니라 Cloudflare에만 넣어요.)
2. **Settings → Pages** → **Build and deployment → Source: GitHub Actions** 를 골라요.
3. **Actions** 탭 → 왼쪽 **Build & Deploy** → 오른쪽 **Run workflow** → 초록 **Run workflow** 버튼.
   (1단계에서 합칠 때 자동으로 돌았던 실행은 Pages가 꺼져 있어서 배포를 건너뛰었어요. 그래서 한 번 다시 실행해요.)
4. 2–3분 뒤 초록 ✓ 가 뜨면 완성! 👉 **https://fromsnowman2014.github.io/poketmon_card_scan/**
   - 주소 모양: `https://<GitHub 사용자 이름>.github.io/<저장소 이름>/`
   - 이후에는 `main` 이 바뀔 때마다 자동으로 테스트 → 빌드 → 배포돼요. 저장소 이름을 바꾸거나 개인 도메인을 붙여도 설정은 그대로 두면 돼요.
   - 빨간 ✗ 가 뜨면 실행을 눌러 맨 위 오류 문장을 읽어요. "GitHub Pages source is not GitHub Actions" 이면 2번에서 **GitHub Actions** 를 골랐는지 확인하고 3번을 다시 해요.
     노란 "Not deployed to GitHub Pages" 경고만 있으면 Pages가 아직 꺼져 있다는 뜻이에요 (2번부터).

*B. 비공개로 두고 Cloudflare Pages로 무료 배포하기*

1. <https://dash.cloudflare.com/sign-up> 에서 무료 계정을 만들어요. (eBay 워커를 쓴다면 같은 계정이면 돼요.)
2. **Workers & Pages → Create → Pages → Connect to Git** → GitHub 연결 화면에서 **이 저장소(`poketmon_card_scan`)만** 골라 허용해요.
3. 아래처럼 적고 **Save and Deploy**:

   | 항목 | 값 |
   |---|---|
   | Production branch | `main` |
   | Framework preset | `None` |
   | Build command | `npm run build` |
   | Build output directory | `dist` |
   | Environment variables | `BASE_PATH` = `/` 그리고 `NODE_VERSION` = `22` (20 이상이면 돼요) |

4. 몇 분 뒤 `https://<프로젝트 이름>.pages.dev/` 주소가 나와요. (예: `https://poketmon-card-scan.pages.dev/`) 이 주소를 아이폰에서 열어요.
   - 이후 `main` 이 바뀔 때마다 Cloudflare가 자동으로 다시 배포해요.
   - GitHub Actions는 테스트만 하고 "Not deployed to GitHub Pages" 경고를 보여 줘요. 이 경우엔 정상이에요.

**3단계 — 아이폰에 설치하기**

아이폰 **사파리**로 2단계의 주소를 열고 → **공유** 버튼 → **홈 화면에 추가** → **추가**. ([자세한 설명](#아이폰에-설치하기-홈-화면에-추가))

> Pull Request에서는 타입 검사 · 테스트 · 빌드만 실행하고 배포하지 않아요. 설정 파일: [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)

## 개발

Node.js 22를 권장해요 (20 이상이면 동작해요).

```bash
npm i                  # 패키지 설치
npm run dev            # 개발 서버 (http://localhost:5173/poketmon_card_scan/)
npm test               # 단위 테스트 (Vitest)
npm run build          # 타입 검사 + 배포용 빌드 (dist/)
npm run preview        # 빌드 결과 미리 보기
npm run names          # 포켓몬 이름 데이터(EN/KO/JA) 다시 만들기 — PokeAPI
npm run en-sets        # 영어 세트 약어 데이터 다시 만들기 — TCGdex
node worker/test.mjs   # eBay 워커 테스트 (인터넷 필요 없음)
```

- 구조와 모듈 설명: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 기본 경로는 `/poketmon_card_scan/` 이에요. GitHub Actions 배포는 Pages 설정에서 경로를 자동으로 가져와 `BASE_PATH` 로 넘겨요.
  루트(`/`)에서 서비스하는 곳(Cloudflare Pages 등)은 `BASE_PATH=/ npm run build`.
- 아이폰 카메라는 HTTPS(또는 localhost)에서만 켜져요. 폰에서 테스트할 땐 배포된 주소를 쓰는 게 가장 쉬워요.

## 데이터 출처 · 감사

- [TCGdex](https://tcgdex.dev) — 카드 데이터, 이미지, TCGplayer · Cardmarket 가격
- [PokeAPI](https://pokeapi.co) — 포켓몬 이름 (영어 · 한국어 · 일본어)
- [Tesseract.js](https://tesseract.projectnaptha.com) — 폰 안에서 동작하는 글자 인식(OCR)
- [open.er-api.com](https://www.exchangerate-api.com) · [Frankfurter](https://frankfurter.dev) — 환율

## 알림

이 앱은 팬이 만든 비공식 무료 앱이에요. **Nintendo, The Pokémon Company, Creatures, GAME FREAK, eBay와 관련이 없어요.**
Pokémon 및 포켓몬 이름은 각 소유자의 상표예요. 카드 이미지와 가격 정보의 권리는 각 제공자에게 있어요.

---

## English

**CardCheck** is a free, kid-friendly Pokémon card scanner and price checker.
Open **https://fromsnowman2014.github.io/poketmon_card_scan/**, take a photo of a card (or type its name or number), and see its
**market price, low and high**, plus one-tap **eBay auctions, Buy It Now and sold listings**. Save cards to **My Cards** to watch the
total value. Free, no account, no ads; your collection stays on your phone. Japanese, Korean and English cards are supported, and OCR runs on-device.

If the link still shows 404, the repo owner has to do the one-time [first deploy](#first-deploy-repo-owner) below.

**Install on iPhone:** open the link in **Safari** → **Share** → **Add to Home Screen** → **Add**. Launch it from the home-screen icon and allow the camera.

**Dollars for US kids, won for Korean kids:** the app works out where the kid lives and shows prices in that country's money —
first from the phone's time zone (Seoul → Korea, a US time zone → US), then from the region in the phone's language (`ko-KR`, `en-US`),
separately from the screen language. A Korean-speaking kid in Los Angeles gets Korean screens with dollars; an English phone in Seoul gets won.
If the phone gives no hint, the app asks once: "Where do you live? 🇺🇸 / 🇰🇷". To change it, open **Settings → Where you live**: the money and
the search language switch with it, and **Money** can still be changed on its own. Price tiers follow the money ($1 / $5 / $25 / $100, or
1,000 / 5,000 / 30,000 / 150,000원). With the optional eBay worker, shipping is estimated to the kid's country (for Korea: to Seoul, and only
listings that ship to Korea). A worker deployed before this needs a redeploy; Settings' **Test connection** tells you.

**Where My Cards are saved:** only inside this app on this phone (no server, no account). The **Home Screen app and Safari keep
separate data**: cards saved in a Safari tab do not move to the Home Screen app, so **add it to the Home Screen first and collect cards there.**
Home Screen apps are not subject to Safari's 7-day storage limit (a Safari tab left unopened for 7+ days can lose its cards).
**Settings → (Apps →) Safari → Clear History and Website Data deletes My Cards**, and so does deleting the Home Screen icon. Cards don't move to a new phone.

**Scanning tips:** good light, fill the frame with the card, tilt to avoid glare (take it out of the sleeve if you can), and make sure the
small code at the bottom-left — like `MEW EN 199/165` (Korean and Japanese cards: `sv8a 084/187`) — is sharp. You can always type the name or number instead.

**Where prices come from:** [TCGdex](https://tcgdex.dev), updated daily — TCGplayer (USD) and Cardmarket (EUR, converted and shown as approximate: "≈ $3.50", or "약 4,760원" / "약 $3.50" in the Korean UI).
**Honest limits:** there is no free sold-price API (use the eBay "Sold" link), prices are estimates that depend on condition and grading,
and some Japanese cards have no price data. **Ask a grown-up before buying or selling.**

**Optional live eBay prices:** deploy the free Cloudflare worker — step-by-step guide in [worker/README.md](worker/README.md).
Buy It Now prices and current auction bids there include shipping to the kid's country (within the US, or to Seoul for Korea; unknown shipping says "+ shipping").

### First deploy (repo owner)

Do this once, in a browser signed in to <https://github.com>; nothing to install.

1. **Merge the work into `main`:** **Pull requests → New pull request**, base **`main`** ← compare **`claude/happy-shannon-b3any5`**,
   **Create pull request** (twice), wait for the green check, then **Merge pull request → Confirm merge**.
2. **Publish it for free — pick one.** On GitHub's Free plan, **GitHub Pages does not work for private repos** (GitHub Pro and other paid plans allow it; then start at A2).
   - **A. Make the repo public and use GitHub Pages (recommended).**
     1. **Settings → General → Danger Zone → Change visibility → Change to public.** Free Pages requires a public repo. The repo contains
        no passwords or secret keys, and the app is a public web page anyway (the eBay secret lives only in Cloudflare).
     2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
     3. **Actions → Build & Deploy → Run workflow.** The run started by the merge skipped the deploy because Pages was still off.
     4. After the green check (2–3 min) the app is live at **https://fromsnowman2014.github.io/poketmon_card_scan/**
        (pattern: `https://<github-user>.github.io/<repo-name>/`). Every later change to `main` is tested, built and deployed automatically;
        the base path is read from the Pages settings, so renaming the repo or adding a custom domain needs no change.
        A red ✗ names the problem at the top of the run: "GitHub Pages source is not GitHub Actions" means step A2 still says
        "Deploy from a branch" (fix it, then repeat A3). A yellow "Not deployed to GitHub Pages" warning means Pages is still off (start at A2).
   - **B. Keep it private and use Cloudflare Pages (free).** Create a free account at <https://dash.cloudflare.com/sign-up> →
     **Workers & Pages → Create → Pages → Connect to Git**, allow access to this repo only, then set: production branch `main`,
     framework preset `None`, build command `npm run build`, build output directory `dist`, environment variables `BASE_PATH` = `/` and
     `NODE_VERSION` = `22` (20+ works) → **Save and Deploy**. The app is served at `https://<project-name>.pages.dev/`
     (e.g. `https://poketmon-card-scan.pages.dev/`) and redeploys on every change to `main`. GitHub Actions then only runs the tests and
     shows a "Not deployed to GitHub Pages" warning, which is expected.
3. **Install on iPhone:** open that address in **Safari → Share → Add to Home Screen → Add**.

Pull requests run type-check, tests and build only. Local builds default to the base path `/poketmon_card_scan/`; use `BASE_PATH=/ npm run build` for hosts that serve from the root.

### Development & credits

**Development** (Node 22 recommended, 20+ works): `npm i`, `npm run dev`, `npm test`, `npm run build`, `npm run names` (regenerate Pokémon names from PokeAPI),
`npm run en-sets` (regenerate English set abbreviations from TCGdex), `node worker/test.mjs`. Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

**Credits:** [TCGdex](https://tcgdex.dev) (cards, images, prices), [PokeAPI](https://pokeapi.co) (names),
[Tesseract.js](https://tesseract.projectnaptha.com) (OCR), open.er-api.com and Frankfurter (exchange rates).

**Disclaimer:** unofficial fan project, not affiliated with or endorsed by Nintendo, The Pokémon Company, Creatures, GAME FREAK or eBay.
Pokémon and Pokémon character names are trademarks of their respective owners.
