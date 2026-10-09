// Form journey spec (PR 8): fetch-based submission with inline states.
// Formspree responses are mocked — no network call ever reaches the provider
// from CI (a real POST would land in the inbox; exactly one is done manually,
// documented in the PR).

import { test, expect } from '@playwright/test';

const FORMSPREE = 'https://formspree.io/f/mojgkzay';

test.describe('signup form states', () => {
  test('invalid email is blocked natively before any fetch', async ({ page }) => {
    await page.goto('/');
    await page.fill('#signup-email', 'not-an-email');

    const requests = [];
    page.on('request', req => {
      if (req.url().includes('formspree')) requests.push(req.url());
    });

    await page.click('button[type="submit"]');
    await page.waitForTimeout(400);

    // Native validation blocks submission: state untouched, nothing sent.
    expect(await page.getAttribute('form[data-form="signup"]', 'data-form-state')).toBe('idle');
    expect(requests).toEqual([]);
    const valid = await page.evaluate(() => document.querySelector('#signup-email').checkValidity());
    expect(valid).toBe(false);
  });

  test('valid email reaches Formspree and success state renders inline', async ({ page }) => {
    await page.route(FORMSPREE, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    );
    await page.goto('/');
    await page.fill('#signup-email', 'candidate@example.com');
    await page.click('button[type="submit"]');

    await page.waitForFunction(() =>
      document.querySelector('form[data-form="signup"]').getAttribute('data-form-state') === 'success'
    );

    const form = page.locator('form[data-form="signup"]');
    await expect(form.locator('.form-status.success')).toBeVisible();
    await expect(page.getByText("Thanks — you're in")).toBeVisible();
    // No navigation away from the page.
    expect(page.url()).toMatch(/localhost:4173/);
  });

  test('provider error renders the retryable error state and preserves the input', async ({ page }) => {
    await page.route(FORMSPREE, route =>
      route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ errors: [{ message: 'x' }] }) })
    );
    await page.goto('/');
    await page.fill('#signup-email', 'candidate@example.com');
    await page.click('button[type="submit"]');

    await page.waitForFunction(() =>
      document.querySelector('form[data-form="signup"]').getAttribute('data-form-state') === 'error'
    );

    const form = page.locator('form[data-form="signup"]');
    await expect(form.locator('.form-status.error')).toBeVisible();
    await expect(page.getByText('Something went wrong — try again.')).toBeVisible();
    // Input preserved, button re-enabled — recovery, not a dead end.
    expect(await page.inputValue('#signup-email')).toBe('candidate@example.com');
    expect(await page.isEnabled('button[type="submit"]')).toBe(true);

    // Retry hits the same mocked provider, now succeeding.
    await page.unroute(FORMSPREE);
    await page.route(FORMSPREE, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    );
    await page.click('button[type="submit"]');
    await page.waitForFunction(() =>
      document.querySelector('form[data-form="signup"]').getAttribute('data-form-state') === 'success'
    );
  });

  test('network failure surfaces reason: network in the failure event', async ({ page }) => {
    await page.addInitScript(() => {
      window.CADENCE_ANALYTICS_ID = 'test-site-id';
      window.__events = [];
      window.umami = { track: (name, props) => window.__events.push({ name, props: props || {} }) };
    });
    await page.route(FORMSPREE, route => route.abort('connectionrefused'));
    await page.goto('/');
    await page.fill('#signup-email', 'candidate@example.com');
    await page.click('button[type="submit"]');

    await page.waitForFunction(() =>
      document.querySelector('form[data-form="signup"]').getAttribute('data-form-state') === 'error'
    );
    const events = await page.evaluate(() => window.__events);
    const failure = events.find(e => e.name === 'form_failure');
    expect(failure).toBeTruthy();
    expect(failure.props).toEqual({ form: 'signup', reason: 'network' });
    await expect(page.locator('form[data-form="signup"] .form-status.error')).toBeVisible();
  });
});
