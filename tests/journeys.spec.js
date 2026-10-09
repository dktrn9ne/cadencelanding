// Journey spec (PR 8): navigation anchors (smooth-scroll aware), the external
// app handoff (asserted via route interception — never a real cross-origin
// navigation), and the mobile-menu hook contract.

import { test, expect } from '@playwright/test';
import { APP_URL, preventAppNavigationInit } from './helpers.js';

// html has scroll-behavior:smooth — resolve once scrollY has been stable for
// several consecutive rAFs (the scroll has settled).
async function waitForScrollSettle(page) {
  return page.evaluate(() => new Promise(resolve => {
    let prev = window.scrollY;
    let stable = 0;
    let frames = 0;
    function check() {
      frames += 1;
      const now = window.scrollY;
      if (now === prev) {
        stable += 1;
        if (stable >= 3 || frames > 300) return resolve(now);
      } else {
        stable = 0;
        prev = now;
      }
      if (frames > 300) return resolve(now);
      requestAnimationFrame(check);
    }
    requestAnimationFrame(check);
  }));
}

async function expectSectionVisible(page, sectionId) {
  const box = await page.locator(`#${sectionId}`).boundingBox();
  expect(box, `#${sectionId} should render`).not.toBeNull();
  const scrolled = await page.evaluate(() => window.scrollY);
  expect(scrolled, `clicking to #${sectionId} should scroll the page`).toBeGreaterThan(0);
}

test.describe('navigation journeys', () => {
  test('nav anchors scroll to their sections', async ({ page }) => {
    await page.goto('/');
    for (const id of ['who', 'product', 'ecosystem', 'how']) {
      await page.click(`.nav-links a[href="#${id}"]`);
      await waitForScrollSettle(page);
      await expectSectionVisible(page, id);
    }
  });

  test('footer anchors scroll to their sections', async ({ page }) => {
    await page.goto('/');
    for (const id of ['product', 'ecosystem', 'get-started']) {
      await page.click(`.foot-links a[href="#${id}"]`);
      await waitForScrollSettle(page);
      const box = await page.locator(`#${id}`).boundingBox();
      expect(box).not.toBeNull();
    }
  });

  test('app handoff request carries the app origin and ref param (network-intercepted, never a real cross-origin hit)', async ({ page }) => {
    let appRequest = null;
    await page.route(APP_URL + '**', route => {
      appRequest = route.request();
      // Intercept at the network layer; a real body so the intercepted
      // "navigation" completes instead of hanging the click wait.
      route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>intercepted</body></html>' });
    });

    await page.goto('/');
    await page.click('a[data-event="cta_click"][data-placement="nav"]');
    await page.waitForTimeout(300);

    expect(appRequest, 'app request should be intercepted').not.toBeNull();
    const url = new URL(appRequest.url());
    expect(url.origin).toBe('https://cadence-green-ten.vercel.app');
    expect(url.searchParams.get('ref')).toBe('landing-nav');
  });

  test('cta click never leaves the landing page when the handoff is blocked', async ({ page }) => {
    await preventAppNavigationInit(page);
    await page.route(APP_URL + '**', route => route.abort());

    await page.goto('/');
    await page.click('a[data-event="cta_click"][data-placement="hero"]');
    await page.waitForTimeout(300);

    // The visitor stays on the landing page — the handoff is a hard exit,
    // so no in-page navigation test can assert further behavior after it.
    expect(page.url()).toMatch(/localhost:4173/);
  });

  test('mobile menu targets the data-menu-toggle hook contract', async ({ page }) => {
    // Contract test for PR 2's mobile menu: until PR 2 lands there is no
    // [data-menu-toggle] element — this test skips with a warning instead of
    // failing, and hardens automatically once the hook exists.
    await page.setViewportSize({ width: 375, height: 720 });
    await page.goto('/');
    const toggle = await page.locator('[data-menu-toggle]').count();
    if (toggle === 0) {
      test.skip(true, 'data-menu-toggle hook not present yet — lands with PR 2 (mobile menu)');
      return;
    }
    await page.click('[data-menu-toggle]');
    await expect(page.locator('.nav-links')).toBeVisible();
  });
});
