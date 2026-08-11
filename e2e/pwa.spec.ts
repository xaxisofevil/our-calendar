import { test, expect } from "@playwright/test";

// ARCHITECTURE.md §4 "PWA" / §14 M4: vite-plugin-pwa (Workbox) generates
// manifest.json + a service worker that precaches the app shell (built
// JS/CSS/icons) only — deliberately no runtime caching of /api/* responses
// (see frontend/vite.config.ts's VitePWA() call for the reasoning). These
// tests check everything Lighthouse's installability audit would check
// programmatically (valid manifest served with the right fields/icons, a
// registered service worker, localhost counting as a secure origin) plus
// the app-shell-only caching contract specifically, since that's the one
// place a regression would silently reintroduce stale-data-as-current.
//
// What this suite can't cover (real-device-only, see ARCHITECTURE.md's PWA
// section for the manual checklist): the actual iOS "Add to Home Screen"
// icon/splash rendering, and Fully Kiosk Browser on the tablet.

test.describe("PWA installability", () => {
  test("manifest.json is served with the expected installability fields", async ({ page, baseURL }) => {
    const res = await page.request.get(`${baseURL}/manifest.json`);
    expect(res.ok()).toBeTruthy();
    // vite-plugin-pwa serves it as application/json (browsers/Lighthouse
    // accept this as well as application/manifest+json).
    expect(res.headers()["content-type"]).toContain("json");

    const manifest = await res.json();
    expect(manifest.name).toBe("Our Calendar");
    expect(manifest.short_name).toBe("Our Calendar");
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
    // Paper & Ink skin tokens (frontend/src/styles/tokens.css), light mode.
    expect(manifest.theme_color).toBe("#b0512e");
    expect(manifest.background_color).toBe("#f3ecdd");

    const sizes = manifest.icons.map((icon: { sizes: string }) => icon.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    const maskable = manifest.icons.find((icon: { purpose?: string }) => icon.purpose === "maskable");
    expect(maskable).toBeTruthy();
    expect(maskable.sizes).toBe("512x512");

    // Every icon the manifest references must actually resolve (a broken
    // icon path fails Chrome's installability check even with everything
    // else correct).
    for (const icon of manifest.icons as { src: string }[]) {
      const iconRes = await page.request.get(`${baseURL}/${icon.src}`);
      expect(iconRes.ok(), `icon ${icon.src} should be reachable`).toBeTruthy();
      expect(iconRes.headers()["content-type"]).toBe("image/png");
    }
  });

  test("the page links the manifest and carries iOS home-screen meta tags", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.json");
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#b0512e");
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      "href",
      "/icons/apple-touch-icon.png",
    );
    await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute("content", "yes");
  });

  test("a service worker registers for the page (localhost counts as a secure origin)", async ({ page }) => {
    await page.goto("/");
    const registered = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return false;
      const registration = await navigator.serviceWorker.ready;
      return Boolean(registration.active);
    });
    expect(registered).toBe(true);
  });

  test("the service worker's cache never contains an /api/ entry (app-shell-only caching, ARCHITECTURE.md §4)", async ({
    page,
  }) => {
    await page.goto("/");
    // Give the SW a moment to finish installing/precaching, then also
    // exercise the app normally so any (deliberately absent) runtime
    // caching of API calls would have had a chance to kick in.
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect(page.locator('section[aria-label="Month"]')).toBeVisible();
    await page.waitForTimeout(1000);

    const cachedUrls: string[] = await page.evaluate(async () => {
      const names = await caches.keys();
      const urls: string[] = [];
      for (const name of names) {
        const cache = await caches.open(name);
        const requests = await cache.keys();
        urls.push(...requests.map((r) => r.url));
      }
      return urls;
    });

    const apiEntries = cachedUrls.filter((url) => new URL(url).pathname.startsWith("/api/"));
    expect(apiEntries).toEqual([]);
  });

  test("when the network is unreachable, the app shows a clear error instead of serving stale data as current", async ({
    page,
    context,
  }) => {
    await page.goto("/");
    await expect(page.locator('section[aria-label="Month"]')).toBeVisible();

    // Simulate the WiFi being down: block only /api/* so the shell (already
    // loaded) stays interactive but every data fetch fails.
    await context.route("**/api/**", (route) => route.abort("internetdisconnected"));
    await page.reload();

    // TanStack Query's default retry (3 attempts, exponential backoff)
    // applies before the query settles into isError — give it real room.
    await expect(page.getByText(/couldn.t reach the server/i)).toBeVisible({ timeout: 20_000 });
  });
});
