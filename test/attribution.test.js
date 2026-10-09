import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectAttribution, buildAppUrl } from '../funnel.js';

const APP_URL = 'https://cadence-green-ten.vercel.app/';

test('collectAttribution picks campaign params and click ids, ignores everything else', () => {
  const picked = collectAttribution(
    '?utm_source=newsletter&utm_medium=email&utm_campaign=pr3&utm_content=hero&gclid=abc123&foo=bar'
  );
  assert.deepEqual(picked, {
    utm_source: 'newsletter',
    utm_medium: 'email',
    utm_campaign: 'pr3',
    utm_content: 'hero',
    gclid: 'abc123',
  });
});

test('collectAttribution returns empty for a page without campaign params', () => {
  assert.deepEqual(collectAttribution(''), {});
});

test('attribution is captured in memory only — no storage keys are written', () => {
  // Privacy gate: the page gains zero storage keys. If anything ever tried to
  // persist, this stub throws and the test fails.
  let writeAttempted = false;
  const throwingStorage = {
    setItem: () => {
      writeAttempted = true;
      throw new Error('no storage allowed');
    },
    getItem: () => {
      throw new Error('no storage allowed');
    },
  };
  globalThis.sessionStorage = throwingStorage;
  try {
    const picked = collectAttribution('?utm_source=test&utm_campaign=pr3');
    assert.deepEqual(picked, { utm_source: 'test', utm_campaign: 'pr3' });
    assert.equal(writeAttempted, false); // nothing tried to persist
  } finally {
    delete globalThis.sessionStorage;
  }
});

test('buildAppUrl appends captured attribution onto the app URL', () => {
  const url = buildAppUrl({ utm_source: 'test', utm_campaign: 'pr3', gclid: 'abc' });
  const parsed = new URL(url);
  assert.equal(parsed.origin + parsed.pathname, APP_URL);
  assert.equal(parsed.searchParams.get('utm_source'), 'test');
  assert.equal(parsed.searchParams.get('utm_campaign'), 'pr3');
  assert.equal(parsed.searchParams.get('gclid'), 'abc');
});

test('buildAppUrl appends the landing ref contract for a known placement', () => {
  const parsed = new URL(buildAppUrl({}, 'landing-hero'));
  assert.equal(parsed.searchParams.get('ref'), 'landing-hero');
});

test('buildAppUrl combines attribution and ref in one handoff URL', () => {
  const parsed = new URL(buildAppUrl({ utm_source: 'newsletter' }, 'landing-nav'));
  assert.equal(parsed.searchParams.get('utm_source'), 'newsletter');
  assert.equal(parsed.searchParams.get('ref'), 'landing-nav');
});

test('an explicit ref in attribution wins over the placement default', () => {
  const parsed = new URL(buildAppUrl({ ref: 'landing-campaign-x' }, 'landing-nav'));
  assert.equal(parsed.searchParams.get('ref'), 'landing-campaign-x');
});

test('buildAppUrl hands off unchanged with no attribution and no ref', () => {
  assert.equal(buildAppUrl({}), APP_URL);
});
