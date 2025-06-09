#!/usr/bin/env node
/**
 * Scrape <title> and open-graph image for any URL.
 *
 * Usage:
 *   node scrapeMeta.mjs https://example.com
 *
 * Output (pretty-printed JSON):
 *   {
 *     "ogimage": "https://…/some-image.jpg",
 *     "title":   "Example Domain"
 *   }
 */

import { argv, exit } from 'node:process';
import { load } from 'cheerio';
import { URL } from 'node:url';

if (argv.length < 3) {
  console.error('❌  Please pass a URL:  node scrapeMeta.mjs https://example.com');
  exit(1);
}

const targetUrl = argv[2];

/**
 * Make a fetch request that looks like a real browser.
 * Some sites strip meta tags for “generic” user-agents.
 */
async function fetchHtml(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      // Chrome 125 UA string, adjust when needed
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
        'AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/125.0.0.0 Safari/537.36',
      'accept-language': 'en-US,en;q=0.9',
    },
  });

  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
}

/**
 * Pick the best image candidate from the parsed DOM.
 */
function extractImage($) {
  const selectors = [
    'meta[property="og:image"]',
    'meta[name="og:image"]',
    'meta[name="twitter:image"]',
    'meta[itemprop="image"]',
    'link[rel="image_src"]',
  ];

  for (const sel of selectors) {
    const content =
      $(sel).attr('content') ??
      $(sel).attr('href'); // for <link rel="image_src" href="...">
    if (content) return content;
  }

  // --- OPTIONAL fallback: first <img> on the page ---
  const firstImg = $('img[src]').first().attr('src');
  return firstImg ?? null;
}

(async () => {
  try {
    const html = await fetchHtml(targetUrl);
    const $ = load(html);

    // ---- title ----
    let title = $('title').first().text().trim() || null;
    if (title && title.includes('|')) title = title.split('|')[0].trim();

    // ---- og image ----
    let ogimage = extractImage($);

    // Resolve relative URLs to absolute
    if (ogimage && !/^https?:\/\//i.test(ogimage)) {
      try {
        ogimage = new URL(ogimage, targetUrl).href;
      } catch {
        // ignore bad URL resolution — leave as-is
      }
    }

    console.log(JSON.stringify({ ogimage, title }, null, 2));
  } catch (err) {
    console.error(`❌  Failed to scrape ${targetUrl}:`, err.message);
    exit(1);
  }
})();