#!/usr/bin/env node
/**
 * scrapeMeta.mjs
 * --------------
 * Returns { ogimage, title } for any URL.
 * 1. Try fast fetch + Cheerio
 * 2. If still null → Puppeteer (headless Chrome)
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

/* ---------- helpers ---------- */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/125.0.0.0 Safari/537.36';

function normalizeTitle(raw) {
  if (!raw) return null;
  const clean = raw.trim();
  return clean.includes('|') ? clean.split('|')[0].trim() : clean;
}

function absolutize(src, base) {
  if (!src || /^https?:\/\//i.test(src)) return src;
  try {
    return new URL(src, base).href;
  } catch {
    return src;
  }
}

function extractWithCheerio(html, baseUrl) {
  const $ = load(html);

  /* title */
  const title = normalizeTitle($('title').first().text());

  /* og / twitter / first img */
  const selectors = [
    'meta[property="og:image"]',
    'meta[name="og:image"]',
    'meta[name="twitter:image"]',
    'meta[itemprop="image"]',
    'link[rel="image_src"]',
    'img[src]', // last-ditch fallback
  ];

  let ogimage = null;
  for (const sel of selectors) {
    const val = $(sel).attr('content') ?? $(sel).attr('href') ?? $(sel).attr('src');
    if (val) {
      ogimage = absolutize(val, baseUrl);
      break;
    }
  }

  return { ogimage, title };
}

/* ---------- main flow ---------- */
(async () => {
  try {
    /* 1. Fast path */
    const res = await fetch(targetUrl, {
      redirect: 'follow',
      headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9' },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const html = await res.text();
    let { ogimage, title } = extractWithCheerio(html, targetUrl);

    /* If both are null, escalate to Puppeteer */
    if (!ogimage && !title) {
      const browser = await puppeteer.launch({ headless: 'new' });
      const page = await browser.newPage();
      await page.setUserAgent(UA);
      await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });

      /* evaluate in page context */
      ({ ogimage, title } = await page.evaluate(() => {
        const pick = (sel, attr) => document.querySelector(sel)?.getAttribute(attr);
        const abs = (src) => {
          try { return new URL(src, location.href).href; } catch { return src; }
        };

        let img =
          pick('meta[property="og:image"]', 'content') ||
          pick('meta[name="og:image"]', 'content') ||
          pick('meta[name="twitter:image"]', 'content') ||
          pick('meta[itemprop="image"]', 'content') ||
          pick('link[rel="image_src"]', 'href') ||
          pick('img[src]', 'src') ||
          null;

        if (img) img = abs(img);

        let ttl = document.title || null;
        if (ttl && ttl.includes('|')) ttl = ttl.split('|')[0].trim();

        return { ogimage: img, title: ttl };
      }));

      await browser.close();
    }

    console.log(JSON.stringify({ ogimage, title }, null, 2));
  } catch (err) {
    console.error(`❌  Failed to scrape ${targetUrl}:`, err.message);
    exit(1);
  }
})();