import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectAttribution, buildAppUrl } from '../funnel.js';

const APP_URL = 'https://cadence-green-ten.vercel.app/';

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
  };
}

test('collectAttribution picks campaign params and click ids, ignores everything else', () => {
  delete globalThis.sessionStorage;
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

test('collectAttribution persists to sessionStorage when available', () => {
  const storage = memoryStorage();
  globalThis.sessionStorage = storage;
  collectAttribution('?utm_source=test&utm_campaign=pr3');
  const stored = JSON.parse(storage.getItem('cadence:attribution'));
  assert.deepEqual(stored, { utm_source: 'test', utm_campaign: 'pr3' });
  delete globalThis.sessionStorage;
});

test('collectAttribution returns empty for a page without campaign params', () => {
  const storage = memoryStorage();
  globalThis.sessionStorage = storage;
  const picked = collectAttribution('');
  assert.deepEqual(picked, {});
  assert.equal(storage.getItem('cadence:attribution'), null); // nothing stored
  delete globalThis.sessionStorage;
});

test('collectAttribution degrades to click-time params when storage throws', () => {
  globalThis.sessionStorage = {
    getItem: () => {
      throw new Error('SecurityError');
    },
    setItem: () => {
      throw new Error('SecurityError');
    },
  };
  const picked = collectAttribution('?utm_source=test');
  assert.deepEqual(picked, { utm_source: 'test' }); // capture still works
  delete globalThis.sessionStorage;
});

test('buildAppUrl appends captured attribution onto the app URL', () => {
  delete globalThis.sessionStorage;
  const url = buildAppUrl({ utm_source: 'test', utm_campaign: 'pr3', gclid: 'abc' });
  const parsed = new URL(url);
  assert.equal(parsed.origin + parsed.pathname, APP_URL);
  assert.equal(parsed.searchParams.get('utm_source'), 'test');
  assert.equal(parsed.searchParams.get('utm_campaign'), 'pr3');
  assert.equal(parsed.searchParams.get('gclid'), 'abc');
});

test('buildAppUrl falls back to the visit’s stored attribution when nothing was captured', () => {
  const storage = memoryStorage();
  globalThis.sessionStorage = storage;
  collectAttribution('?utm_source=newsletter&utm_campaign=launch');
  const parsed = new URL(buildAppUrl({}));
  assert.equal(parsed.searchParams.get('utm_source'), 'newsletter');
  assert.equal(parsed.searchParams.get('utm_campaign'), 'launch');
  delete globalThis.sessionStorage;
});

test('buildAppUrl hands off unchanged with no attribution anywhere', () => {
  delete globalThis.sessionStorage; // nothing captured, nothing stored
  assert.equal(buildAppUrl({}), APP_URL);
});

test('captured attribution wins over whatever the visit stored earlier', () => {
  const storage = memoryStorage();
  globalThis.sessionStorage = storage;
  collectAttribution('?utm_source=newsletter');
  const parsed = new URL(buildAppUrl({ utm_source: 'direct' }));
  assert.equal(parsed.searchParams.get('utm_source'), 'direct');
  delete globalThis.sessionStorage;
});
