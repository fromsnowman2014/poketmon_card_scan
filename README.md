# CardCheck 카드체크

**포켓몬 카드를 찍으면 시세를 알려주는 무료 앱** — 아이들이 혼자서도 쓸 수 있게 크고 단순하게 만들었어요.

👉 **https://fromsnowman2014.github.io/poketmon_card_scan/**

[English below](#english)

## 무엇을 하나요?

1. 📸 카드를 **사진으로 찍으면** (또는 이름 · 번호를 입력하면)
2. 🔎 어떤 카드인지 찾아서
3. 💰 **시세 · 최저가 · 최고가**를 크게 보여 줘요. (달러 / 원화)
4. 🛒 **eBay 경매 중 · 즉시구매 · 팔린 가격**을 버튼 하나로 바로 볼 수 있어요.
5. 🗂️ 마음에 드는 카드는 **내 카드**에 모아서 전체 가치를 볼 수 있어요.

- **완전 무료**, 가입 · 로그인 · 광고 없음. 내 카드 목록은 내 폰에만 저장돼요.
- **일본어 · 한국어 · 영어 카드** 모두 지원해요. (한국 카드는 같은 세트 코드를 쓰는 일본판 데이터로 찾아요.)
- 카드 글자 읽기(OCR)는 폰 안에서 처리돼요. 사진을 서버로 보내지 않아요.

## 아이폰에 설치하기 (홈 화면에 추가)

1. 아이폰 **사파리(Safari)** 로 <https://fromsnowman2014.github.io/poketmon_card_scan/> 을 열어요.
2. 아래쪽 **공유 버튼**(네모에서 화살표가 나오는 아이콘)을 눌러요.
3. **홈 화면에 추가**를 누르고 → 오른쪽 위 **추가**.
4. 홈 화면의 **CardCheck** 아이콘으로 열면 앱처럼 전체 화면으로 열려요.
5. 처음 카드를 찍을 때 **카메라 허용**을 눌러 주세요.

> 다른 앱(카카오톡 등) 안에서 열린 브라우저에서는 "홈 화면에 추가"가 안 보일 수 있어요. 꼭 사파리로 열어 주세요.
> 안드로이드는 크롬 메뉴(⋮) → **홈 화면에 추가 / 앱 설치**.

## 카드 잘 찍는 요령 (어린이용)

- 💡 **밝은 곳**에서 찍어요. 그림자가 지지 않게!
- 🖼️ 카드가 **네모 칸에 꽉 차게** 맞춰요.
- ✨ **반짝이 반사**가 없게 살짝 기울여요. 슬리브(카드 비닐)는 빼면 더 잘 읽혀요.
- 🔢 앱은 카드 **왼쪽 아래의 작은 글자**를 읽어요. 예: `sv8a 084/187`. 이 부분이 또렷하게 나오게 찍어요.
- 🙋 못 찾으면 **이름이나 번호를 직접 입력**해도 돼요. (`루차불`, `ルチャブル`, `Hawlucha`, `084/187` 모두 OK)

## 가격은 어디서 오나요?

- 카드 정보와 가격은 [TCGdex](https://tcgdex.dev) 에서 가져와요. **매일 업데이트**돼요.
  - **TCGplayer** (미국, 달러) — 주로 영어 카드
  - **Cardmarket** (유럽, 유로) — 일본 카드 포함. 달러로 바꿔서 **≈** 표시와 함께 보여 줘요.
- 환율은 [open.er-api.com](https://open.er-api.com) (실패하면 Frankfurter)에서 가져와요.
- **eBay**: 버튼을 누르면 eBay 검색 결과(경매 마감 임박순 · 즉시구매 최저가순 · 최근 팔린 순)가 열려요.

### 솔직한 한계

- 무료로 쓸 수 있는 **"실제 팔린 가격" API는 없어요.** 팔린 가격은 eBay 링크로 직접 확인해야 해요.
- 앱의 가격은 **예상 가격**이에요. 카드 상태(흠집, 휘어짐)나 그레이딩(PSA 등)에 따라 실제 가격은 많이 달라요.
- 일본 카드는 가격 정보가 없는 경우도 있어요. 그럴 땐 eBay 링크를 눌러 보세요.
- 👨‍👩‍👧 **카드를 사고팔 땐 꼭 어른과 함께 해요!**

### (선택) eBay 실시간 가격

무료 Cloudflare 워커를 한 번 설치하면 앱 안에서 **즉시구매 최저가와 경매 현황**을 바로 볼 수 있어요.
부모님용 단계별 안내: **[worker/README.md](worker/README.md)**

## GitHub Pages 배포 (저장소 관리자용)

1. GitHub 저장소 → **Settings → Pages** → **Source: GitHub Actions** 를 선택해요.
2. 이제 `main` 브랜치에 push하면 [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) 이 자동으로 테스트 → 빌드 → 배포해요.
   (Actions 탭에서 **Run workflow** 로 직접 실행할 수도 있어요.)
3. Pull Request에서는 타입 검사 · 테스트 · 빌드만 실행해요.

- 배포 주소: `https://<GitHub 사용자>.github.io/<저장소 이름>/`
- 저장소 이름을 바꾸면 빌드할 때 `BASE_PATH=/<새 이름>/` 을 지정해야 해요. (기본값 `/poketmon_card_scan/`, `vite.config.ts` 참고)

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

**Install on iPhone:** open the link in **Safari** → **Share** → **Add to Home Screen** → **Add**. Launch it from the home-screen icon and allow the camera.

**Scanning tips:** good light, fill the frame with the card, tilt to avoid glare (take it out of the sleeve if you can), and make sure the
small code at the bottom-left — like `sv8a 084/187` — is sharp. You can always type the name or number instead.

**Where prices come from:** [TCGdex](https://tcgdex.dev), updated daily — TCGplayer (USD) and Cardmarket (EUR, converted to USD and shown with ≈).
**Honest limits:** there is no free sold-price API (use the eBay "Sold" link), prices are estimates that depend on condition and grading,
and some Japanese cards have no price data. **Ask a grown-up before buying or selling.**

**Optional live eBay prices:** deploy the free Cloudflare worker — step-by-step guide in [worker/README.md](worker/README.md).

**Deploying:** in the repo, **Settings → Pages → Source: GitHub Actions**. Every push to `main` runs tests, builds and deploys
(`.github/workflows/deploy.yml`); pull requests run type-check, tests and build only. If you rename the repo, build with `BASE_PATH=/<new-name>/`.

**Development** (Node 22 recommended, 20+ works): `npm i`, `npm run dev`, `npm test`, `npm run build`, `npm run names` (regenerate Pokémon names from PokeAPI),
`npm run en-sets` (regenerate English set abbreviations from TCGdex), `node worker/test.mjs`. Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

**Credits:** [TCGdex](https://tcgdex.dev) (cards, images, prices), [PokeAPI](https://pokeapi.co) (names),
[Tesseract.js](https://tesseract.projectnaptha.com) (OCR), open.er-api.com and Frankfurter (exchange rates).

**Disclaimer:** unofficial fan project, not affiliated with or endorsed by Nintendo, The Pokémon Company, Creatures, GAME FREAK or eBay.
Pokémon and Pokémon character names are trademarks of their respective owners.
