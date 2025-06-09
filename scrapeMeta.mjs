#!/usr/bin/env node
/**
 * Usage:  node scrapeMeta.mjs <url>
 *
 * Returns: { ogimage: string|null, title: string|null }
 */

import { argv, exit } from 'node:process';
import { load } from 'cheerio';

if (argv.length < 3) {
  console.error('❌  Please pass a URL:  node scrapeMeta.mjs https://example.com');
  exit(1);
}

const targetUrl = argv[2];

try {
  // Fetch the page
  const res = await fetch(targetUrl, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  const html = await res.text();

  // Parse the HTML
  const $ = load(html);

  // --- Extract OG image ---
  const ogimage =
     $('meta[property="og:image"]').attr('content') ??
     $('meta[name="og:image"]').attr('content') ??
     $('meta[name="twitter:image"]').attr('content') ??
     $('meta[itemprop="image"]').attr('content') ??
     $('link[rel="image_src"]').attr('href') ??
     null;

  // --- Extract <title> ---
  let title = $('title').first().text().trim() || null;
  if (title && title.includes('|')) {
    title = title.split('|')[0].trim();
  }

  // Output the result object
  console.log(JSON.stringify({ ogimage, title }, null, 2));
} catch (err) {
  console.error(`❌  Failed to scrape ${targetUrl}:`, err.message);
  exit(1);
}