# url-preview

A tiny command‑line tool that fetches a page’s **title** and a best‑guess **preview image** (Open Graph/Twitter card or hero bitmap). It uses a *two‑step* strategy:

1. **Fast pass** – simple `fetch` + Cheerio (≈ 50 ms on most sites)
2. **Fallback** – headless Chrome via Puppeteer when the tags are client‑rendered

```bash
$ node scrapeMeta.mjs https://example.com
{
  "url": "https://example.com",
  "title": "Example Domain",
  "previewImage": "https://example.com/og-image.jpg"
}
```

---

## Features

- Title extraction – Strips everything after the first vertical bar, so "News | My Site" becomes "News".
- Smart image pick – Prefers OG/Twitter/JSON‑LD images; otherwise grabs the largest non‑SVG bitmap that’s at least 200 × 200 px.
- Bulk mode – Add -f urls.txt to scrape a list of URLs (one per line) and get back a single JSON array.
- Single Chrome session – Reuses one headless browser instance for all fallback scrapes, keeping runs fast.
- No secrets needed – Pure public scraping—no API keys, tokens, or accounts required.


## Prerequisites

* **Node 18+** (for built‑in `fetch`)
* macOS, Linux, or WSL‑enabled Windows

The first `npm install` downloads a \~130 MB Chromium binary for Puppeteer.

> **Tip for CI / serverless** – set `PUPPETEER_SKIP_DOWNLOAD=1` at **build time** and supply your own Chromium layer/runtime.

---

## Installation

```bash
# 1  Clone
git clone https://github.com/SeanPlusPlus/url-preview.git
cd url-preview

# 2  Install deps
npm install            # or pnpm / yarn

# 3  (Optionally) make it global‑ish
npm link               # lets you run `url-preview` anywhere
```

---

## Usage

### Single URL

```bash
node scrapeMeta.mjs https://disney.com
```

### Bulk file

```bash
# urls.txt contains one URL per line
node scrapeMeta.mjs --file urls.txt
# …or shorter
node scrapeMeta.mjs -f urls.txt
```

`urls.txt` is **git‑ignored** by default so you can keep private research lists.

### Output shape

* **Single URL** → single JSON object
* **Multiple URLs** → JSON array

```jsonc
[
  {
    "url": "https://disney.com",
    "title": "Disney: The Official Home Page",
    "previewImage": "https://disney.com/og/home.jpg"
  },
  {
    "url": "https://example.com",
    "title": "Example Domain",
    "previewImage": null,
    "error": "404 Not Found"      // present only on failure
  }
]
```

---

## CLI Flags

| Flag            | Alias | Description                           |
| --------------- | ----- | ------------------------------------- |
| `--file <path>` | `-f`  | Read URLs from a file (one per line). |

Anything not recognised as a flag is treated as a direct URL.

---

## Contributing / TODOs

* [ ] Parallel‑scrape with controllable concurrency
* [ ] Optional CSV output
* [ ] Unit tests (Jest)

PRs welcome—open an issue first if it’s non‑trivial!

---

## License

MIT © Sean Stephenson
