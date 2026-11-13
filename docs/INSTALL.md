# Install CardCheck — the easy guide

CardCheck is a **web app**. It runs in Safari and can sit on the iPhone Home Screen like a normal app.
That means **no App Store, no Xcode, no Mac and no Apple Developer account** — even for a dev version.

| I want to… | Go to |
|---|---|
| Use the app on my iPhone | [Part 1](#part-1--put-the-app-on-your-iphone-2-minutes) |
| Run the code on my computer | [Part 2](#part-2--run-it-on-your-computer) |
| Try my own (dev) version on my iPhone | [Part 3](#part-3--put-a-dev-version-on-your-iphone) |
| Update or remove it | [Part 4](#part-4--update-or-remove) |
| Fix a problem | [Troubleshooting](#troubleshooting) |

---

## Part 1 — Put the app on your iPhone (2 minutes)

You need the app's web address. Once the repo owner has done the one-time
[first deploy](../README.md#first-deploy-repo-owner), it is **https://fromsnowman2014.github.io/poketmon_card_scan/**
(or your `https://<project>.pages.dev/` address if you used Cloudflare Pages).

1. Open the address in **Safari**. (Not inside another app's browser, such as KakaoTalk or Instagram.)
2. Tap **Share** (the square with an arrow ↑). On iOS 26, tap **•••** first, then **Share**.
3. Scroll down and tap **Add to Home Screen**. Keep **Open as Web App** on if you see it. Tap **Add**.
4. Open **CardCheck** from the Home Screen. The first time you scan, tap **Allow** for the camera.

> **Always collect cards in the Home Screen app.** iPhone keeps a **separate** "My Cards" for each of these:
> the Home Screen app, a Safari tab, a Private tab (erased when the tab closes), and a page opened inside another app
> (KakaoTalk, a chat app, the Claude app…). Removing the icon and adding it again also starts an empty My Cards.
> The app tells you where it is (a note on **My Cards**, and **Settings → Where My Cards is saved**). To move cards
> from one to another: **Settings → Move or back up My Cards** → *Copy backup code* in one, *Paste backup code* in
> the other.

---

## Part 2 — Run it on your computer

### What you need (one time)

- A Mac, Windows or Linux computer.
- **Node.js** version 20 or newer. Download the **LTS** version from <https://nodejs.org> and install it.
  Check it: open **Terminal** (Mac) or **PowerShell** (Windows) and type `node -v`. You should see `v20…` or higher.
- **Git**: <https://git-scm.com/downloads>. Or use **GitHub Desktop** (<https://desktop.github.com>) if you prefer clicking.
- A GitHub account that can see this repo. (The repo is private, so Git will ask you to sign in the first time.)

### Get the code and start it

```bash
git clone https://github.com/fromsnowman2014/poketmon_card_scan.git
cd poketmon_card_scan
npm install          # downloads the parts the app needs (1–2 minutes, first time only)
npm run dev          # starts the app on your computer
```

With GitHub Desktop: **File → Clone repository → poketmon_card_scan**, then open a terminal in that folder
(**Repository → Open in Terminal** on Mac, **Open in Command Prompt** on Windows) and run the last two lines.

Open **http://localhost:5173/poketmon_card_scan/** in your computer's browser. That's the app!
Change a file in `src/` and the page updates by itself. Press **Ctrl + C** in the terminal to stop.

> If port 5173 is busy, the terminal shows a different number (like 5174). Always use the address the terminal prints.

### Other handy commands

| Command | What it does |
|---|---|
| `npm test` | Runs the automatic tests |
| `npm run build` | Makes the finished app in the `dist/` folder (also checks the code for mistakes) |
| `npm run preview` | Shows that finished app at http://localhost:4173/poketmon_card_scan/ |
| `node worker/test.mjs` | Tests the optional eBay helper (no internet needed) |
| `node scripts/build-ja-prices.test.mjs` | Tests the script that builds the Japanese-card price files (no internet needed) |

### Japanese card prices on your computer (optional)

The real app shows **TCGplayer** prices for Japanese and Korean cards. They come from price files that GitHub builds
once a day (from [TCGCSV](https://tcgcsv.com), a free daily copy of TCGplayer's prices) and publishes with the app.
Those files are **not in the repo**, so your local copy shows **Cardmarket** prices for these cards instead, with a `≈`.
That is fine for most work.

To see the same prices as the real app, copy the published files, then stop `npm run dev` (Ctrl + C) and start it again:

```bash
npm run ja-prices -- --prev https://fromsnowman2014.github.io/poketmon_card_scan/data/tcgplayer-ja/all.json --prev-only
```

This only copies from the app's own website into `public/data/` (a folder Git ignores). If it says
`no previous snapshot`, the real app has no price files yet (the repo owner has to deploy once first) or your
internet is off; nothing on your computer is changed then.

> Plain `npm run ja-prices` (without the options) downloads everything from TCGCSV itself: about 900 requests the
> first time. TCGCSV is a free community site, so **please don't run it more than once a day**. You rarely need it:
> the daily GitHub job already does this.

---

## Part 3 — Put a dev version on your iPhone

Your computer runs the app; your iPhone opens it. Pick one:

| Option | Camera? | Good for |
|---|---|---|
| **A. Same Wi‑Fi** | Photos only (no live camera) | A quick look, 1 minute to set up |
| **B. HTTPS link (recommended)** | ✅ Live camera | Real testing of your changes |
| **C. Finished build over HTTPS** | ✅ Live camera, works offline | Checking the real app before you publish it |
| **D. A dev version that stays** | ✅ | Keeping a test app on the Home Screen |

Why the difference? **iPhone only turns on the live camera on secure (`https://`) pages.** Your computer's dev
server is plain `http://`, so options B–D add HTTPS.

### Option A — Same Wi‑Fi (quickest)

1. Put the computer and the iPhone on the **same Wi‑Fi**.
2. On the computer run:

   ```bash
   npm run dev -- --host
   ```

3. The terminal prints a line like `➜  Network: http://192.168.1.23:5173/poketmon_card_scan/`.
   Type that address into **Safari** on the iPhone. (If there are several Network lines, try the one starting with `192.168.` or `10.`.)
4. Everything works except the live camera box, which says **"Can't use the camera"**: tap **Use Camera app** or
   **Photos** instead. Those work fine.

> Mac: if a window asks "Allow incoming network connections?" for `node`, click **Allow**.
> Windows: if Windows Firewall asks about Node.js, allow it on **Private networks**.

### Option B — HTTPS link with the live camera (recommended)

This uses a free **Cloudflare Quick Tunnel**: no account and no sign-up. It gives your computer a temporary
`https://….trycloudflare.com` address. The app is already set up to accept these addresses.

**One time: install `cloudflared`**

- Mac (with [Homebrew](https://brew.sh)): `brew install cloudflared`
- Windows: `winget install --id Cloudflare.cloudflared` (then close and reopen PowerShell)
- Linux or other ways: download it from <https://github.com/cloudflare/cloudflared/releases>

**Every time**

1. Terminal 1: start the app.

   ```bash
   npm run dev
   ```

2. Terminal 2: open the tunnel (use the port number terminal 1 printed).

   ```bash
   cloudflared tunnel --url http://localhost:5173
   ```

3. Terminal 2 prints an address like `https://happy-blue-river-cards.trycloudflare.com`.
   On the iPhone, open that address **plus `/poketmon_card_scan/`** in Safari, for example
   `https://happy-blue-river-cards.trycloudflare.com/poketmon_card_scan/`.
   The iPhone can be on any network, even mobile data.
4. Tap **Scan** and **Allow** the camera. 🎉
5. Optional: **Share → Add to Home Screen**, and rename it **CardCheck Dev** so you can tell it from the real app.
6. Edit code on the computer: the iPhone updates by itself. If it doesn't, pull down on the page or close and reopen it.

Good to know:

- The address is **new every time** you start the tunnel, so yesterday's Home Screen icon won't open. Add the new one.
  A new address also starts with an **empty My Cards** (move test cards with a backup code, see Part 1). Test saving
  cards on the real address (github.io) or a stable preview (option D).
- While the tunnel runs, anyone with the link can open your dev app. Don't share it, and press **Ctrl + C** in both terminals when you're done.

### Option C — Test the finished build (offline mode, updates)

The dev server skips the offline features. To try the app exactly as it will be published:

```bash
npm run build
npm run preview                                  # terminal 1
cloudflared tunnel --url http://localhost:4173   # terminal 2
```

Then open `https://<the-printed-address>.trycloudflare.com/poketmon_card_scan/` on the iPhone, like in option B.

### Option D — A dev version that stays on your Home Screen

If you publish with **Cloudflare Pages** (option B in the README's [first deploy](../README.md#first-deploy-repo-owner)),
Cloudflare also builds **every branch you push** and gives it its own preview address that doesn't change, ending in
`.pages.dev`. Find it under **Workers & Pages → your project → Deployments**.

1. Push your changes to a branch (not `main`).
2. Open that branch's preview address in Safari on the iPhone.
3. **Share → Add to Home Screen**, name it **CardCheck Dev**.

Each push to that branch updates the dev app. The real app (from `main`) stays as it is, and the two keep separate "My Cards".

---

## Part 4 — Update or remove

**Update your computer copy:**

```bash
git pull
npm install
```

**The iPhone app updates itself** after a new version is published: it downloads in the background and switches over
when the app is closed. To get it right away, swipe the app away in the app switcher and open it again.

**Japanese card prices update themselves** once a day: the repo's **Build & Deploy** job on GitHub fetches them at
21:17 UTC (with a second try at 03:17 UTC) and republishes the app. Two things the repo owner should know:

- GitHub **pauses this daily job after 60 days without a commit** and sends an email. Turn it back on under
  **Actions → Build & Deploy → Enable workflow**. Until then the app keeps the last prices for 7 days, then shows
  Cardmarket prices (with a `≈`) for Japanese cards.
- After 3 days without fresh prices the daily job turns red and GitHub emails you. TCGCSV may just be having a
  break, so give it a day or two; if it stays red, open the run and read the error at the top.

**Remove the app:** touch and hold the **CardCheck** icon → choose **Remove** (or **Delete Bookmark**) and confirm.
⚠️ This also deletes the "My Cards" saved in that app. Back up first: **Settings → Move or back up My Cards →
Save as file** (or *Copy backup code*), and load it into the new icon the same way.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `node` or `npm` is "not found" | Install Node.js LTS from <https://nodejs.org>, then close and reopen the terminal. |
| `git clone` asks for a password or says "not found" | The repo is private: sign in with the GitHub account that has access (GitHub Desktop is easiest), or ask the owner to add you. |
| Blank page or "404" | The address must end with **`/poketmon_card_scan/`** (with the slash). |
| iPhone can't open the Wi‑Fi address (option A) | Same Wi‑Fi on both? Allow Node.js in the firewall prompt. Guest or school Wi‑Fi often blocks this: use option B. |
| "Blocked request. This host is not allowed" | You're using a tunnel other than Cloudflare's. Add its host name to `tunnelHosts` in `vite.config.ts`. |
| The camera says "Camera is off" | iPhone **Settings → Apps → Safari → Camera** (under "Settings for Websites") → **Ask** or **Allow** (older iPhones: **Settings → Safari → Camera**), then **Try the camera again**. |
| The camera says "Can't use the camera" | The page isn't `https://`. Use option B or C, or tap **Use Camera app** / **Photos**. |
| No **Add to Home Screen** button | Open the page in **Safari** itself, not inside another app. |
| The Home Screen app still shows the old version | Swipe it away in the app switcher and open it again. |
| My Cards is empty after reopening the app | Open **Settings → Where My Cards is saved** and check the place. Cards stay in the place they were added: always open the **same Home Screen icon** (not a Safari tab, a Private tab, or a link inside KakaoTalk or another app). Cards added elsewhere are still there: open that place, **Settings → Move or back up My Cards → Copy backup code**, then **Paste backup code** in the Home Screen app. If the app said **"Not saved yet"**: iPhone **Settings → Apps → Safari → Advanced** → turn off **Block All Cookies**, and free up some iPhone storage. |
| Prices or pictures don't load | The app needs the internet to look up cards (saved cards still show offline). |
| Japanese cards show `≈` Cardmarket prices, not TCGplayer prices | On your computer: copy the price files ([Part 2](#japanese-card-prices-on-your-computer-optional)) and restart `npm run dev`. In the real app: the daily price job has probably been paused or is failing. Repo owner: **Actions → Build & Deploy → Enable workflow**, then **Run workflow** ([Part 4](#part-4--update-or-remove)). Some cards simply aren't on TCGplayer and always show Cardmarket. |

More details: the [README](../README.md) (deploying, the optional live eBay prices) and [ARCHITECTURE.md](ARCHITECTURE.md) (how the code is organized).
