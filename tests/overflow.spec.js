// Responsive overflow sweep (PR 8): document.scrollWidth must never exceed
// the viewport across the full sweep, including both breakpoint
// neighborhoods (920px and 600px).

import { test, expect } from '@playwright/test';

const WIDTHS = [320, 375, 414, 600, 768, 920, 1024, 1280];

test.describe('responsive overflow sweep', () => {
  for (const width of WIDTHS) {
    test(`no horizontal overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      await page.waitForTimeout(300); // pattern-dot seeding / animation warmup

      const metrics = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        viewport: window.innerWidth,
      }));

      expect(
        metrics.scrollWidth,
        `document.scrollWidth ${metrics.scrollWidth} exceeds viewport ${width}px`
      ).toBeLessThanOrEqual(metrics.viewport);
      expect(
        metrics.bodyScrollWidth,
        `body.scrollWidth ${metrics.bodyScrollWidth} exceeds viewport ${width}px`
      ).toBeLessThanOrEqual(metrics.viewport);
    });
  }
});
