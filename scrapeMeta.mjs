#!/usr/bin/env node
/**
 * scrapeMeta.mjs
 * --------------
 * Scrape a URL for { previewImage, title }.
 *
 * 1. Try cheap fetch + Cheerio.
 * 2. If both values are still null → spin up headless Chrome (Puppeteer).
 *
 * Usage:
 *   node scrapeMeta.mjs https://example.com
 *
 * Prints prettified JSON to stdout (or exits non-zero on failure).
 */

import { argv, exit } from 'node:process';
import { load } from 'cheerio';
import { URL } from 'node:url';
import puppeteer from 'puppeteer';

if (argv.length < 3) {
  console.error('Usage: node scrapeMeta.mjs <url>');
  exit(1);
}

const targetUrl = argv[2];

/* ---------- constants ---------- */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/125.0.0.0 Safari/537.36';

/* ---------- helpers ---------- */
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

  /* grab title */
  const title = normalizeTitle($('title').first().text());

  /* grab image */
  const selectors = [
    'meta[property="og:image"]',
    'meta[name="og:image"]',
    'meta[name="twitter:image"]',
    'meta[itemprop="image"]',
    'link[rel="image_src"]',
    'img[src]', // fallback – first image in markup
  ];

  let img = null;
  for (const sel of selectors) {
    const val = $(sel).attr('content') ?? $(sel).attr('href') ?? $(sel).attr('src');
    if (val) {
      img = absolutize(val, baseUrl);
      break;
    }
  }

  return { previewImage: img, title };
};

/* ---------- main flow ---------- */
(async () => {
  try {
    /* 1️⃣  fast path ------------------------------------------------------- */
    const res = await fetch(targetUrl, {
      redirect: 'follow',
      headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9' },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const html = await res.text();

    let { previewImage, title } = extractCheerio(html, targetUrl);

    /* 2️⃣  escalate if nothing found -------------------------------------- */
    if (!previewImage && !title) {
      const browser = await puppeteer.launch({ headless: 'new' });
      const page = await browser.newPage();
      await page.setUserAgent(UA);
      await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });

      /* evaluate in page context */
      ({ previewImage, title } = await page.evaluate(() => {
        /* helpers inside browser */
        const abs = (u) => { try { return new URL(u, location.href).href; } catch { return u; } };
        const attr = (sel, a) => document.querySelector(sel)?.getAttribute(a);

        /* 1. meta-declared candidate ------------------------------------- */
        let candidate =
          attr('meta[property="og:image:secure_url"]', 'content') ||
          attr('meta[property="og:image"]', 'content') ||
          attr('meta[name="og:image"]', 'content') ||
          attr('meta[name="twitter:image"]', 'content') ||
          attr('meta[itemprop="image"]', 'content') ||
          attr('link[rel="image_src"]', 'href') ||
          null;

        const looksBad = (src) =>
          !src ||
          src.endsWith('.svg') ||                      // usually an icon
          /sprite|icon/i.test(src);                    // smells like UI chrome

        /* 2. if missing or looks bad → choose largest real bitmap ------- */
        if (!candidate || looksBad(candidate)) {
          const imgs = Array.from(document.images)
            .map((img) => ({
              src: img.currentSrc || img.src,
              area: img.naturalWidth * img.naturalHeight,
              w: img.naturalWidth,
              h: img.naturalHeight,
            }))
            .filter((o) => o.w >= 200 && o.h >= 200 && !o.src.endsWith('.svg'))
            .sort((a, b) => b.area - a.area);          // biggest first

          if (imgs.length) candidate = imgs[0].src;
        }

        if (candidate) candidate = abs(candidate);

        /* title (trim “| …”) */
        let ttl = document.title || null;
        if (ttl?.includes('|')) ttl = ttl.split('|')[0].trim();

        return { previewImage: candidate || null, title: ttl };
      }));

      await browser.close();
    }

    console.log(JSON.stringify({ previewImage, title }, null, 2));
  } catch (err) {
    console.error(`❌ Failed to scrape ${targetUrl}:`, err.message);
    exit(1);
  }
})();