import { describe, it, expect, afterEach, vi } from "vitest";
import {
  acquireBrowser,
  releaseBrowser,
  forceCloseBrowser,
  getBrowserRefCount,
  isBrowserActive,
} from "@/infrastructure/scraper/browser-pool";

// These tests verify the browser pool's reference counting logic.
// They do NOT launch a real browser — Playwright is mocked.

vi.mock("playwright", () => {
  const mockBrowser = {
    isConnected: vi.fn().mockReturnValue(true),
    close: vi.fn().mockResolvedValue(undefined),
    newContext: vi.fn().mockResolvedValue({
      newPage: vi.fn().mockResolvedValue({}),
      close: vi.fn(),
    }),
  };

  return {
    chromium: {
      launch: vi.fn().mockResolvedValue(mockBrowser),
    },
  };
});

afterEach(async () => {
  await forceCloseBrowser();
});

describe("browser-pool", () => {
  it("starts with refCount 0 and no active browser", () => {
    expect(getBrowserRefCount()).toBe(0);
    expect(isBrowserActive()).toBe(false);
  });

  it("acquires a browser and increments refCount", async () => {
    const browser = await acquireBrowser();
    expect(browser).toBeDefined();
    expect(getBrowserRefCount()).toBe(1);
    expect(isBrowserActive()).toBe(true);
    await releaseBrowser();
  });

  it("reuses same browser on multiple acquires", async () => {
    const b1 = await acquireBrowser();
    const b2 = await acquireBrowser();
    expect(b1).toBe(b2);
    expect(getBrowserRefCount()).toBe(2);
    await releaseBrowser();
    await releaseBrowser();
  });

  it("closes browser when last reference released", async () => {
    await acquireBrowser();
    await acquireBrowser();
    expect(getBrowserRefCount()).toBe(2);

    await releaseBrowser();
    expect(getBrowserRefCount()).toBe(1);
    expect(isBrowserActive()).toBe(true);

    await releaseBrowser();
    expect(getBrowserRefCount()).toBe(0);
    // After close, isBrowserActive returns false
    expect(isBrowserActive()).toBe(false);
  });

  it("forceCloseBrowser resets everything", async () => {
    await acquireBrowser();
    await acquireBrowser();
    expect(getBrowserRefCount()).toBe(2);

    await forceCloseBrowser();
    expect(getBrowserRefCount()).toBe(0);
    expect(isBrowserActive()).toBe(false);
  });

  it("releaseBrowser is safe to call with no active browser", async () => {
    // Should not throw
    await releaseBrowser();
    expect(getBrowserRefCount()).toBe(0);
  });

  it("releaseBrowser never goes below 0", async () => {
    await releaseBrowser();
    await releaseBrowser();
    await releaseBrowser();
    expect(getBrowserRefCount()).toBe(0);
  });
});
