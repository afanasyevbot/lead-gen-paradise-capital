/**
 * Test script — verifies scraper error handling against known-failing URLs.
 * Run: node test-scraper.mjs
 */
import { chromium } from "playwright";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const TIMEOUT = 22000;

function isTerminalError(err) {
  return (
    err.includes("ERR_NAME_NOT_RESOLVED") ||
    err.includes("chromewebdata") ||
    err.includes("ERR_ADDRESS_UNREACHABLE") ||
    err.includes("ERR_NAME_RESOLUTION_FAILED") ||
    err.includes("ERR_INTERNET_DISCONNECTED")
  );
}

async function testUrl(browser, url) {
  const context = await browser.newContext({
    userAgent: DEFAULT_USER_AGENT,
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  let finalUrl = url;
  let bodyLen = 0;
  let error = null;
  let terminal = false;

  const loadPage = async (targetUrl) => {
    try {
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: TIMEOUT });
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
      return true;
    } catch (e) {
      const errStr = String(e);
      if (isTerminalError(errStr)) throw e;

      if (errStr.includes("Timeout") || errStr.includes("timeout")) {
        // Check if page has partial content before retrying
        try {
          const partialUrl = page.url();
          if (!partialUrl.startsWith("chrome-error://") && !partialUrl.startsWith("about:")) {
            const len = await page.evaluate(() => document.body?.innerText?.length ?? 0).catch(() => 0);
            if (len > 100) return true; // usable content despite timeout
          }
        } catch { /* ignore */ }

        // Fallback: commit (first byte)
        try {
          await page.goto(targetUrl, { waitUntil: "commit", timeout: TIMEOUT });
          await new Promise((r) => setTimeout(r, 4000));
          return true;
        } catch { /* fall through */ }
      }
      throw e;
    }
  };

  try {
    try {
      await loadPage(url);
    } catch (e) {
      const errStr = String(e);
      if (
        url.startsWith("https://") && !isTerminalError(errStr) &&
        (errStr.includes("ERR_SSL") || errStr.includes("ERR_CERT") ||
         errStr.includes("ERR_CONNECTION_RESET") || errStr.includes("ERR_CONNECTION_REFUSED"))
      ) {
        const httpUrl = url.replace("https://", "http://");
        try {
          await loadPage(httpUrl);
          finalUrl = httpUrl;
        } catch (e2) {
          error = String(e2);
          terminal = isTerminalError(error);
        }
      } else {
        error = String(e);
        terminal = isTerminalError(error);
      }
    }

    if (!error) {
      const currentUrl = page.url();
      if (currentUrl.startsWith("chrome-error://") || currentUrl.startsWith("about:")) {
        error = `Landed on browser error page: ${currentUrl}`;
        terminal = true;
      } else {
        finalUrl = currentUrl;
        bodyLen = await page.evaluate(() => document.body?.innerText?.length ?? 0).catch(() => 0);
      }
    }
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }

  return { url, finalUrl, bodyLen, error, terminal };
}

const TEST_URLS = [
  "https://harphomeservices.com/",
  "https://sinhatech.com/",
  "https://globalassistancenb.com/",
  "https://paragonpackaging.net/",
  "https://kellybike.com/",
  // Known-good control
  "https://example.com/",
];

async function main() {
  console.log("Starting browser...\n");
  const browser = await chromium.launch({ headless: true });

  for (const url of TEST_URLS) {
    process.stdout.write(`Testing ${url} ... `);
    try {
      const result = await testUrl(browser, url);
      if (result.error) {
        const tag = result.terminal ? "[TERMINAL→no_website]" : "[RETRYABLE→scrape_failed]";
        console.log(`FAIL ${tag}\n  ${result.error.slice(0, 120)}`);
      } else {
        console.log(`OK  finalUrl=${result.finalUrl}  bodyLen=${result.bodyLen}`);
      }
    } catch (e) {
      console.log(`ERROR: ${String(e).slice(0, 120)}`);
    }
  }

  await browser.close();
}

main().catch(console.error);
