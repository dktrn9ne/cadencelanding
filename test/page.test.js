import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const APP_URL = 'https://cadence-green-ten.vercel.app/';
const PAGE_URL = 'https://cadencelanding.vercel.app/?utm_source=test&utm_campaign=pr3';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, { url: PAGE_URL });

// Browser-like globals BEFORE importing funnel.js so its auto-init wires the page.
global.window = dom.window;
global.document = dom.window.document;
global.sessionStorage = dom.window.sessionStorage;
global.HTMLElement = dom.window.HTMLElement;

// Mock fetch — the ONLY fetch in this environment. Nothing can reach the
// production Formspree endpoint from these tests.
const fetchCalls = [];
let fetchBehavior = async () => ({ ok: true, status: 200 });
global.fetch = async (url, options) => {
  fetchCalls.push({ url: String(url), options });
  return fetchBehavior(url, options);
};

// funnel.js auto-inits against the jsdom document on first import.
await import('../funnel.js');

const doc = dom.window.document;

async function until(condition, label) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > 2000) throw new Error('timed out waiting for: ' + label);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const submitForm = () =>
  doc.getElementById('access-form').dispatchEvent(
    new dom.window.Event('submit', { bubbles: true, cancelable: true })
  );

// --- Static markup contract ----------------------------------------------

test('every app CTA is an identical Launch Cadence anchor with a mainnet disclosure', () => {
  const appCtas = [...doc.querySelectorAll('a.btn-primary')].filter((a) => a.getAttribute('href') === APP_URL);
  assert.equal(appCtas.length, 2, 'expected exactly two app CTAs (nav + hero)');
  assert.deepEqual(appCtas.map((a) => a.dataset.cta).sort(), ['hero-launch', 'nav-launch']);
  for (const cta of appCtas) {
    assert.equal(cta.textContent.trim(), 'Launch Cadence', 'one label, one promise');
    assert.equal(cta.getAttribute('target'), '_blank');
    assert.equal(cta.getAttribute('rel'), 'noopener noreferrer');
    const disclosure = doc.getElementById(cta.getAttribute('aria-describedby'));
    assert.ok(disclosure, 'a disclosure element is wired via aria-describedby');
    const text = disclosure.textContent;
    assert.match(text, /mainnet/i, 'disclosure names the network');
    assert.match(text, /RLUSD/i, 'disclosure names the currency');
    assert.match(text, /real/i, 'disclosure says the funds are real');
  }
  // The hero disclosure carries the full sentence; nav gets the compact line.
  assert.match(doc.getElementById('hero-disclosure').textContent, /XRPL mainnet — real RLUSD, real transactions/);
  // The secondary affordance beside the primary CTA stays in-page — no funnel claim,
  // and no second primary competing with the app CTA.
  assert.equal(doc.querySelectorAll('.hero-actions a.btn-primary').length, 1, 'exactly one primary action');
  const secondary = doc.querySelector('.hero-actions a:not(.btn-primary)');
  assert.ok(secondary, 'an in-page secondary affordance exists beside the primary CTA');
  assert.doesNotMatch(secondary.getAttribute('href'), /^https?:/);
});

test('footer links to the request-access route, and "Get started" is retired', () => {
  const access = doc.querySelector('footer a[data-cta="footer-access"]');
  assert.ok(access, 'footer CTA exists');
  assert.equal(access.textContent.trim(), 'Request access');
  assert.equal(access.getAttribute('href'), '#get-started');
  assert.equal(doc.body.textContent.includes('Get started'), false);
});

test('input inventory is exactly one email field — no credential-shaped inputs', () => {
  const inputs = [...doc.querySelectorAll('input, textarea')];
  assert.equal(inputs.length, 1, 'the page requests no wallet credentials');
  assert.equal(inputs[0].type, 'email');
  assert.equal(inputs[0].name, 'email');
  assert.equal(/seed|mnemonic|private|password|wallet/i.test(inputs[0].name), false);
});

test('the email field has a visible label, a secondary submit, and a privacy note', () => {
  const label = doc.querySelector('label[for="access-email"]');
  assert.ok(label, 'visible label element exists');
  assert.equal(label.textContent.trim(), 'Email address');
  assert.equal(doc.getElementById('access-email').getAttribute('autocomplete'), 'email');

  const submit = doc.getElementById('access-submit');
  assert.equal(submit.textContent.trim(), 'Request access');
  assert.ok(submit.classList.contains('btn-secondary'));
  assert.equal(submit.classList.contains('btn-primary'), false);

  const note = doc.getElementById('form-privacy-note');
  assert.ok(note && note.textContent.trim().length > 0, 'privacy note present');

  const status = doc.getElementById('form-status');
  assert.equal(status.getAttribute('aria-live'), 'polite', 'status region is announced');
});

test('the hero mock no longer presents synthetic data as live', () => {
  const badge = doc.querySelector('.pay-card .live');
  assert.equal(badge.textContent.trim(), 'Demo');
  const card = doc.querySelector('.pay-card');
  assert.match(card.getAttribute('aria-label'), /Demo/i);
  assert.equal(/live/i.test(card.getAttribute('aria-label')), false);
  const caption = doc.querySelector('.demo-caption');
  assert.ok(caption && /illustrative/i.test(caption.textContent), 'illustrative-data caption present');
});

// --- Interaction contract -------------------------------------------------

test('an app CTA click builds the handoff URL from campaign params and tracks app_handoff', () => {
  const heroCta = doc.querySelector('a[data-cta="hero-launch"]');
  heroCta.click();

  const events = dom.window.dataLayer;
  const click = events.find((e) => e.event === 'cta_click' && e.cta_id === 'hero-launch');
  assert.ok(click, 'cta_click tracked');
  assert.equal(click.destination, 'app');

  const handoff = events.find((e) => e.event === 'app_handoff');
  assert.ok(handoff, 'app_handoff tracked after the URL was built');
  assert.equal(handoff.attribution_present, true);
  assert.equal(handoff.had_click_id, false);

  const handoffUrl = new URL(heroCta.href);
  assert.equal(handoffUrl.origin + handoffUrl.pathname, APP_URL);
  assert.equal(handoffUrl.searchParams.get('utm_source'), 'test');
  assert.equal(handoffUrl.searchParams.get('utm_campaign'), 'pr3');
});

test('a form-route CTA click tracks cta_click with destination form', async () => {
  doc.querySelector('a[data-cta="footer-access"]').click();
  const click = dom.window.dataLayer.filter((e) => e.event === 'cta_click').pop();
  assert.equal(click.cta_id, 'footer-access');
  assert.equal(click.destination, 'form');
  // jsdom performs the anchor's fragment navigation asynchronously — let it
  // settle inside this test so it cannot leak into the next one.
  await until(() => dom.window.location.hash === '#get-started', 'fragment navigation');
});

test('form lifecycle: validation, inline success without navigation, duplicate suppression, safe retry', async () => {
  const form = doc.getElementById('access-form');
  const input = doc.getElementById('access-email');
  const status = doc.getElementById('form-status');
  const submitBtn = doc.getElementById('access-submit');
  const successPanel = doc.getElementById('form-success');
  const locationBefore = dom.window.location.href; // fragment clicks from earlier tests may linger

  assert.equal(successPanel.hidden, true, 'starts idle');

  // Validation: invalid email → inline message, focus moves, value preserved, no request.
  input.value = 'not-an-email';
  submitForm();
  await until(() => status.textContent.includes('valid email'), 'validation message');
  assert.ok(input.classList.contains('is-invalid'));
  assert.equal(doc.activeElement, input);
  assert.equal(input.value, 'not-an-email');
  assert.equal(fetchCalls.length, 0);

  // Success: endpoint answers 2xx → inline panel, no navigation, one request.
  input.value = 'maurice@thecompany.io';
  submitForm();
  await until(() => !successPanel.hidden, 'success panel');
  assert.ok(form.classList.contains('is-success'));
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, 'https://formspree.io/f/mojgkzay');
  assert.equal(fetchCalls[0].options.method, 'POST');
  assert.equal(fetchCalls[0].options.headers.Accept, 'application/json');
  assert.deepEqual(JSON.parse(fetchCalls[0].options.body), { email: 'maurice@thecompany.io' });
  // No off-page navigation: origin/path/search unchanged (same-page fragment drift is fine).
  const stripFragment = (href) => href.split('#')[0];
  assert.equal(stripFragment(dom.window.location.href), stripFragment(locationBefore), 'no redirect to Formspree');
  assert.equal(submitBtn.disabled, false, 'button usable again');
  assert.equal(submitBtn.textContent.trim(), 'Request access');

  // Duplicate: the same email again is suppressed with no second POST.
  input.value = 'maurice@thecompany.io';
  submitForm();
  await until(() => status.textContent.includes('already on the list'), 'duplicate message');
  assert.equal(fetchCalls.length, 1);

  // Reset via the success panel, then fail-then-retry on a fresh email.
  doc.getElementById('form-reset').click();
  assert.equal(successPanel.hidden, true);
  assert.equal(form.classList.contains('is-success'), false);

  fetchCalls.length = 0;
  let failuresLeft = 1;
  fetchBehavior = async () => {
    failuresLeft -= 1;
    return failuresLeft >= 0 ? { ok: false, status: 500 } : { ok: true, status: 200 };
  };

  input.value = 'retry@thecompany.io';
  submitForm();
  await until(() => status.textContent.includes("didn't go through"), 'error message');
  assert.equal(submitBtn.disabled, false, 'button recovered after failure');
  assert.equal(input.value, 'retry@thecompany.io', 'typed value preserved for retry');
  assert.equal(fetchCalls.length, 1); // exactly one request per attempt

  fetchBehavior = async () => ({ ok: true, status: 200 });
  submitForm();
  await until(() => !successPanel.hidden, 'success after retry');
  assert.equal(fetchCalls.length, 2); // no double POST
});

test('the event contract holds: every event fired, zero PII anywhere', () => {
  const events = dom.window.dataLayer;
  const names = new Set(events.map((e) => e.event));
  for (const name of ['cta_click', 'app_handoff', 'form_submit', 'form_success', 'form_error']) {
    assert.ok(names.has(name), 'missing event: ' + name);
  }
  const serialized = JSON.stringify(events).toLowerCase();
  assert.equal(serialized.includes('maurice@thecompany.io'), false);
  assert.equal(serialized.includes('retry@thecompany.io'), false);
  assert.equal(serialized.includes('@'), false);
});
