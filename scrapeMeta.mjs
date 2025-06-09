#!/usr/bin/env node
/**
 * scrapeMeta.mjs
 * --------------
 * Scrape one or many URLs for { title, previewImage }.
 *
 * 1. Cheap fetch + Cheerio         (fast path)
 * 2. Headless Chrome (Puppeteer)   (fallback)
 *
 * Usage
 * -----
 *   # single URL
 *   node scrapeMeta.mjs https://example.com
 *
 *   # many URLs (one per line in urls.txt)
 *   node scrapeMeta.mjs --file urls.txt
 *   node scrapeMeta.mjs -f urls.txt
 */

import { argv, exit } from 'node:process';
import { promises as fs } from 'node:fs';
import { load } from 'cheerio';
import { URL } from 'node:url';
import puppeteer from 'puppeteer';

/* ╔══════════════════════════════════════════════════════════════════╗ */
/* ║             1.  Parse CLI arguments (url or --file)             ║ */
/* ╚══════════════════════════════════════════════════════════════════╝ */
const args = argv.slice(2);
let filePath = null;
const urls = [];

// crude arg parser: -f foo.txt  |  --file foo.txt  |  bare URLs
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '-f' || a === '--file') {
    filePath = args[++i];           // next arg is filename
  } else {
    urls.push(a);
  }
}

if (filePath) {
  try {
    const txt = await fs.readFile(filePath, 'utf8');
    txt.split(/\r?\n/).forEach((line) => {
      const u = line.trim();
      if (u) urls.push(u);
    });
  } catch (err) {
    console.error(`❌  Cannot read file "${filePath}":`, err.message);
    exit(1);
  }
}

if (!urls.length) {
  console.error('Usage:\n  node scrapeMeta.mjs <url>\n  node scrapeMeta.mjs --file urls.txt');
  exit(1);
}

/* ╔══════════════════════════════════════════════════════════════════╗ */
/* ║                       2.  Shared helpers                         ║ */
/* ╚══════════════════════════════════════════════════════════════════╝ */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/125.0.0.0 Safari/537.36';

const normalizeTitle = (raw = '') =>
  raw.includes('|') ? raw.split('|')[0].trim() : raw.trim() || null;

const absolutize = (src, base) => {
  if (!src || /^https?:\/\//i.test(src)) return src;
  try {
    return new URL(src, base).href;
  } catch {
    return src;
  }
};

const extractCheerio = (html, baseUrl) => {
  const $ = load(html);

  const title = normalizeTitle($('title').first().text());

  const selectors = [
    'meta[property="og:image"]',
    'meta[name="og:image"]',
    'meta[name="twitter:image"]',
    'meta[itemprop="image"]',
    'link[rel="image_src"]',
    'img[src]',
  ];

  let img = null;
  for (const sel of selectors) {
    const val = $(sel).attr('content') ?? $(sel).attr('href') ?? $(sel).attr('src');
    if (val) {
      img = absolutize(val, baseUrl);
      break;
    }
  }

  return { title, previewImage: img };
};

/* ╔══════════════════════════════════════════════════════════════════╗ */
/* ║                3.  Scrape function (fast + fallback)            ║ */
/* ╚══════════════════════════════════════════════════════════════════╝ */
let browser = null;           // lazily launched only if needed

async function scrapeOne(targetUrl) {
  /* fast path */
  const res = await fetch(targetUrl, {
    redirect: 'follow',
    headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9' },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const html = await res.text();

  let { title, previewImage } = extractCheerio(html, targetUrl);

  /* fallback with Puppeteer */
  if (!title && !previewImage) {
    if (!browser) browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    ({ title, previewImage } = await page.evaluate(() => {
      const abs = (u) => { try { return new URL(u, location.href).href; } catch { return u; } };
      const attr = (sel, a) => document.querySelector(sel)?.getAttribute(a);

      let candidate =
        attr('meta[property="og:image:secure_url"]', 'content') ||
        attr('meta[property="og:image"]', 'content') ||
        attr('meta[name="og:image"]', 'content') ||
        attr('meta[name="twitter:image"]', 'content') ||
        attr('meta[itemprop="image"]', 'content') ||
        attr('link[rel="image_src"]', 'href') ||
        null;

      const looksBad = (src) =>
        !src || src.endsWith('.svg') || /sprite|icon/i.test(src);

      if (!candidate || looksBad(candidate)) {
        const imgs = Array.from(document.images)
          .map((img) => ({
            src: img.currentSrc || img.src,
            area: img.naturalWidth * img.naturalHeight,
            w: img.naturalWidth,
            h: img.naturalHeight,
          }))
          .filter((o) => o.w >= 200 && o.h >= 200 && !o.src.endsWith('.svg'))
          .sort((a, b) => b.area - a.area);
        if (imgs.length) candidate = imgs[0].src;
      }

      if (candidate) candidate = abs(candidate);

      let ttl = document.title || null;
      if (ttl?.includes('|')) ttl = ttl.split('|')[0].trim();

      return { title: ttl, previewImage: candidate || null };
    }));

    await page.close();
  }

  return { url: targetUrl, title, previewImage };
}

/* ╔══════════════════════════════════════════════════════════════════╗ */
/* ║                     4.  Iterate & output                        ║ */
/* ╚══════════════════════════════════════════════════════════════════╝ */
(async () => {
  try {
    const results = [];
    for (const url of urls) {
      try {
        results.push(await scrapeOne(url));
      } catch (err) {
        results.push({ url, error: err.message });
      }
    }
    if (browser) await browser.close();

    /* pretty-print */
    console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
  } catch (err) {
    console.error('❌  Unexpected failure:', err.message);
    if (browser) await browser.close();
    exit(1);
  }
})();