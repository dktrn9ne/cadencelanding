// Analytics payload contract (PR 8).
//
// The page's measurement layer no-ops until CADENCE_ANALYTICS_ID and a vendor
// object exist, so the tests install a collector as window.umami — the exact
// payloads the vendor would receive. Every emitted event must carry only the
// spec's allowlisted keys and enum values, must never contain an email- or
// wallet-shaped string, and the page must add no cookies or storage keys.

import { test, expect } from '@playwright/test';
import { blockAppNavigation } from './helpers.js';

// Spec allowlist — closed sets. Anything outside these is a contract breach.
const EVENT_NAMES = ['product_view', 'cta_click', 'app_handoff', 'form_start', 'form_success', 'form_failure'];
const PLACEMENTS = ['nav', 'hero', 'footer'];
const FORMS = ['signup'];
const REASONS = ['validation', 'network', 'provider_error'];

// Email shape: anything with an @ between word chars and a dotted TLD.
// XRPL address shape: r + 24..34 base58 chars.
const EMAIL_SHAPE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const XRPL_SHAPE = /\br[1-9A-HJ-NP-Za-km-z]{24,34}\b/;

async function installCollector(page) {
  await page.addInitScript(() => {
    window.CADENCE_ANALYTICS_ID = 'test-site-id';
    window.__events = [];
    window.umami = {
      track: (name, props) => window.__events.push({ name, props: props || {} }),
    };
  });
}

function assertPayloadShape(events) {
  for (const ev of events) {
    expect(EVENT_NAMES, `unknown event name: ${ev.name}`).toContain(ev.name);
    const keys = Object.keys(ev.props);
    for (const key of keys) {
      expect(['placement', 'form', 'reason', 'ref'], `unexpected property key: ${key} on ${ev.name}`).toContain(key);
    }
    if ('placement' in ev.props) expect(PLACEMENTS).toContain(ev.props.placement);
    if ('form' in ev.props) expect(FORMS).toContain(ev.props.form);
    if ('reason' in ev.props) expect(REASONS).toContain(ev.props.reason);
    if ('ref' in ev.props) {
      expect(ev.props.ref).toMatch(/^landing-(nav|hero|footer)$/);
    }
    const serialized = `${ev.name} ${JSON.stringify(ev.props)}`;
    expect(serialized, `email-shaped value leaked into ${ev.name}`).not.toMatch(EMAIL_SHAPE);
    expect(serialized, `XRPL-address-shaped value leaked into ${ev.name}`).not.toMatch(XRPL_SHAPE);
  }
}

test.describe('analytics payload contract', () => {
  test('cta clicks emit cta_click + app_handoff with allowlisted payloads', async ({ page }) => {
    await installCollector(page);
    // Intercept the cross-origin handoff — never navigate to the app.
    await blockAppNavigation(page);

    await page.goto('/');
    await page.click('header.nav a[data-cta="nav-launch"]');
    await page.waitForTimeout(200);

    const events = await page.evaluate(() => window.__events);
    expect(events.map(e => e.name)).toEqual(['cta_click', 'app_handoff']);
    assertPayloadShape(events);
    expect(events[0].props).toEqual({ placement: 'nav' });
    expect(events[1].props).toEqual({ placement: 'nav', ref: 'landing-nav' });
  });

  test('hero cta carries its own placement in both events', async ({ page }) => {
    await installCollector(page);
    await blockAppNavigation(page);

    await page.goto('/');
    await page.click('.hero-actions a[data-cta="hero-launch"]');
    await page.waitForTimeout(200);

    const events = await page.evaluate(() => window.__events);
    expect(events.map(e => e.name)).toEqual(['cta_click', 'app_handoff']);
    assertPayloadShape(events);
    expect(events[1].props).toEqual({ placement: 'hero', ref: 'landing-hero' });
  });

  test('product links emit product_view with placement enum', async ({ page }) => {
    await installCollector(page);
    await page.goto('/');

    await page.click('.nav-links a[href="#what"]');
    await page.waitForTimeout(200);
    let events = await page.evaluate(() => window.__events);
    expect(events.map(e => e.name)).toEqual(['product_view']);
    expect(events[0].props).toEqual({ placement: 'nav' });
    assertPayloadShape(events);

    await page.click('footer a[href="#capabilities"]');
    await page.waitForTimeout(200);
    events = await page.evaluate(() => window.__events);
    expect(events.map(e => e.name)).toEqual(['product_view', 'product_view']);
    expect(events[1].props).toEqual({ placement: 'footer' });
    assertPayloadShape(events);
  });

  test('form_start binds to focus (once), never to input', async ({ page }) => {
    await installCollector(page);
    await page.goto('/');

    const email = page.locator('#access-email');
    await email.click();
    await page.waitForTimeout(100);
    // Typing must not re-emit or leak the value.
    await email.fill('someone@example.com');

    const events = await page.evaluate(() => window.__events);
    expect(events.map(e => e.name)).toEqual(['form_start']);
    expect(events[0].props).toEqual({ form: 'signup' });
    assertPayloadShape(events);

    // The typed value must never appear in any payload.
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('someone@example.com');
  });

  test('unconfigured analytics (no CADENCE_ANALYTICS_ID) emits nothing and page adds no cookies or storage keys', async ({ page }) => {
    await blockAppNavigation(page); // never leave the page
    await page.goto('/');
    await page.click('header.nav a[data-cta="nav-launch"]');
    await page.click('.nav-links a[href="#what"]');
    await page.waitForTimeout(200);

    const state = await page.evaluate(() => ({
      umamiPresent: Boolean(window.umami),
      cookies: document.cookie,
      local: Object.keys(window.localStorage),
      session: Object.keys(window.sessionStorage),
    }));
    // Vendor snippet is commented out in <head>: no window.umami, no events,
    // and the page must not introduce cookies or storage keys.
    expect(state.umamiPresent).toBe(false);
    expect(state.cookies).toBe('');
    expect(state.local).toEqual([]);
    expect(state.session).toEqual([]);
  });
});
