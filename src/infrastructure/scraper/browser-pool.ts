/**
 * Browser Pool
 *
 * Shared Playwright browser lifecycle management. Instead of each
 * scraper module launching and closing its own browser, they share
 * a pooled instance with reference counting.
 *
 * Usage:
 *   const browser = await acquireBrowser();
 *   try {
 *     const context = await browser.newContext({ ... });
 *     // ... use context ...
 *   } finally {
 *     await releaseBrowser();
 *   }
 */

import type { Browser } from "playwright";

let browser: Browser | null = null;
let refCount = 0;

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Rotating user agent pool — used by all scrapers for anti-detection
const USER_AGENT_POOL = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0",
];

/** Pick a random user agent from the pool. */
export function randomUserAgent(): string {
  return USER_AGENT_POOL[Math.floor(Math.random() * USER_AGENT_POOL.length)];
}

/**
 * Get proxy config from environment variables.
 * Set PROXY_URL to enable (e.g. "http://user:pass@proxy.example.com:port").
 */
export function getProxyConfig(): { server: string; username?: string; password?: string } | undefined {
  const proxyUrl = process.env.PROXY_URL;
  if (!proxyUrl) return undefined;

  try {
    const parsed = new URL(proxyUrl);
    const config: { server: string; username?: string; password?: string } = {
      server: `${parsed.protocol}//${parsed.host}`,
    };
    if (parsed.username) config.username = decodeURIComponent(parsed.username);
    if (parsed.password) config.password = decodeURIComponent(parsed.password);
    return config;
  } catch {
    console.error(`[BROWSER POOL] Invalid PROXY_URL: ${proxyUrl}`);
    return undefined;
  }
}

/**
 * Acquire a shared browser instance. Launches Chromium on first call.
 * Increments the reference count. Uses PROXY_URL env var if set.
 */
export async function acquireBrowser(): Promise<Browser> {
  // Fix #2: Log pool wait time to detect pool exhaustion
  const waitStart = Date.now();
  if (!browser || !browser.isConnected()) {
    const { chromium } = await import("playwright");
    const proxy = getProxyConfig();
    if (proxy) {
      console.log(`[BROWSER POOL] Launching with proxy: ${proxy.server}`);
    }
    browser = await chromium.launch({
      headless: true,
      ...(proxy ? { proxy } : {}),
    });
  }
  const waitMs = Date.now() - waitStart;
  if (waitMs > 2000) {
    console.warn(`[BROWSER POOL] waited ${waitMs}ms to acquire browser — pool may be saturated (refCount=${refCount})`);
  }
  refCount++;
  return browser;
}

/**
 * Release a browser reference. When the last reference is released,
 * the browser is closed. Safe to call multiple times.
 */
export async function releaseBrowser(): Promise<void> {
  refCount = Math.max(0, refCount - 1);
  if (refCount <= 0 && browser) {
    try {
      await browser.close();
    } catch {
      // Browser may already be closed or crashed.
    }
    browser = null;
    refCount = 0;
  }
}

/**
 * Force-close the browser regardless of reference count.
 * Use for cleanup on process shutdown or test teardown.
 */
export async function forceCloseBrowser(): Promise<void> {
  if (browser) {
    try {
      await browser.close();
    } catch {
      // Already closed.
    }
    browser = null;
    refCount = 0;
  }
}

/**
 * Get the current reference count (for diagnostics).
 */
export function getBrowserRefCount(): number {
  return refCount;
}

/**
 * Check if a browser is currently active.
 */
export function isBrowserActive(): boolean {
  return browser !== null && browser.isConnected();
}

/** Default user agent string for scraping contexts. */
export { DEFAULT_USER_AGENT };
export { USER_AGENT_POOL };
