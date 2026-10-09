// Form journey spec (PR 8): fetch-based submission with inline states.
// Formspree responses are mocked — no network call ever reaches the provider
// from CI (a real POST would land in the inbox; exactly one is done manually,
// documented in the PR).

import { test, expect } from '@playwright/test';

const FORMSPREE = 'https://formspree.io/f/mojgkzay';

test.describe('signup form states', () => {
  test('invalid email is blocked inline before any fetch', async ({ page }) => {
    await page.goto('/');
    await page.fill('#access-email', 'not-an-email');

    const requests = [];
    page.on('request', req => {
      if (req.url().includes('formspree')) requests.push(req.url());
    });

    await page.click('#access-submit');
    await page.waitForTimeout(400);

    // Inline validation: status message, focus returns, nothing sent.
    await expect(page.locator('#form-status')).toHaveText('Enter a valid email address.');
    expect(requests).toEqual([]);
    expect(await page.inputValue('#access-email')).toBe('not-an-email');
    const valid = await page.evaluate(() => document.querySelector('#access-email').checkValidity());
    expect(valid).toBe(false);
  });

  test('valid email reaches Formspree and success state renders inline', async ({ page }) => {
    await page.route(FORMSPREE, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    );
    await page.goto('/');
    await page.fill('#access-email', 'candidate@example.com');
    await page.click('#access-submit');

    await page.waitForFunction(() => !document.getElementById('form-success').hidden);

    await expect(page.locator('#form-success')).toContainText("You're in — we'll reach out soon.");
    // No navigation away from the page.
    expect(page.url()).toMatch(/localhost:4173/);
    // Status region is cleared; success panel replaces it.
    await expect(page.locator('#form-status')).toHaveText('');
  });

  test('provider error renders the retryable error state and preserves the input', async ({ page }) => {
    await page.route(FORMSPREE, route =>
      route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ errors: [{ message: 'x' }] }) })
    );
    await page.goto('/');
    await page.fill('#access-email', 'candidate@example.com');
    await page.click('#access-submit');

    await page.waitForFunction(() =>
      document.getElementById('form-status').textContent.includes("didn't go through")
    );

    await expect(page.locator('#form-status.is-error')).toBeVisible();
    // Input preserved, button re-enabled — recovery, not a dead end.
    expect(await page.inputValue('#access-email')).toBe('candidate@example.com');
    expect(await page.isEnabled('#access-submit')).toBe(true);

    // Retry hits the same mocked provider, now succeeding.
    await page.unroute(FORMSPREE);
    await page.route(FORMSPREE, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    );
    await page.click('#access-submit');
    await page.waitForFunction(() => !document.getElementById('form-success').hidden);
  });

  test('network failure surfaces reason: network in the failure event', async ({ page }) => {
    await page.addInitScript(() => {
      window.CADENCE_ANALYTICS_ID = 'test-site-id';
      window.__events = [];
      window.umami = { track: (name, props) => window.__events.push({ name, props: props || {} }) };
    });
    await page.route(FORMSPREE, route => route.abort('connectionrefused'));
    await page.goto('/');
    await page.fill('#access-email', 'candidate@example.com');
    await page.click('#access-submit');

    await page.waitForFunction(() =>
      document.getElementById('form-status').textContent.includes("didn't go through")
    );
    const events = await page.evaluate(() => window.__events);
    const failure = events.find(e => e.name === 'form_failure');
    expect(failure).toBeTruthy();
    expect(failure.props).toEqual({ form: 'signup', reason: 'network' });
    await expect(page.locator('#form-status.is-error')).toBeVisible();
  });
});
