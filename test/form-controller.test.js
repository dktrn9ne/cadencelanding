import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFormController, isEmail } from '../funnel.js';

const ENDPOINT = 'https://formspree.io/f/mojgkzay';

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
  };
}

function makeController({ fetchFn, storage = memoryStorage(), events = [], states = [] } = {}) {
  return createFormController({
    endpoint: ENDPOINT,
    track: (event, params = {}) => events.push({ event, params }),
    storage,
    fetchFn,
    onStateChange: (next) => states.push(next),
  });
}

const ok200 = () => Promise.resolve({ ok: true, status: 200 });

test('isEmail accepts real addresses and rejects malformed ones', () => {
  assert.equal(isEmail('maurice@thecompany.io'), true);
  assert.equal(isEmail('not-an-email'), false);
  assert.equal(isEmail('missing-tld@thecompany'), false);
  assert.equal(isEmail(''), false);
});

test('a valid email sends exactly one safe POST and lands in success', async () => {
  const calls = [];
  const events = [];
  const states = [];
  const controller = makeController({
    events,
    states,
    fetchFn: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200 };
    },
  });

  const result = await controller.submit('maurice@thecompany.io');

  assert.deepEqual(result, { ok: true });
  assert.equal(controller.state, 'success');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, ENDPOINT);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Accept, 'application/json');
  assert.deepEqual(JSON.parse(calls[0].options.body), { email: 'maurice@thecompany.io' });
  assert.deepEqual(events, [{ event: 'form_success', params: {} }]);
  assert.deepEqual(states, ['sending', 'success']);
});

test('an already-successful email is suppressed as a duplicate without a second POST', async () => {
  const calls = [];
  const events = [];
  const controller = makeController({ events, fetchFn: async () => (calls.push(1), { ok: true, status: 200 }) });

  await controller.submit('maurice@thecompany.io');
  const second = await controller.submit('maurice@thecompany.io');

  assert.deepEqual(second, { ok: false, reason: 'duplicate' });
  assert.equal(controller.state, 'duplicate');
  assert.equal(calls.length, 1); // no second request
  assert.deepEqual(events[events.length - 1], { event: 'form_error', params: { error_type: 'duplicate' } });
});

test('an invalid email lands in validation without any request', async () => {
  const calls = [];
  const events = [];
  const states = [];
  const controller = makeController({
    events,
    states,
    fetchFn: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200 };
    },
  });

  const result = await controller.submit('not-an-email');

  assert.deepEqual(result, { ok: false, reason: 'validation' });
  assert.equal(controller.state, 'validation');
  assert.equal(calls.length, 0); // nothing sent
  assert.deepEqual(events, [{ event: 'form_error', params: { error_type: 'validation' } }]);
  assert.deepEqual(states, ['validation']);
});

test('a second click while in flight sends nothing (duplicate guard)', async () => {
  const calls = [];
  let resolveFetch;
  const controller = makeController({
    fetchFn: (url, options) => {
      calls.push({ url, options });
      return new Promise((resolve) => {
        resolveFetch = resolve;
      });
    },
  });

  const first = controller.submit('maurice@thecompany.io');
  assert.equal(controller.state, 'sending');

  const second = await controller.submit('maurice@thecompany.io');
  assert.deepEqual(second, { ok: false, reason: 'in-flight' }); // suppressed, not queued
  assert.equal(calls.length, 1); // still exactly one request

  resolveFetch({ ok: true, status: 200 });
  assert.deepEqual(await first, { ok: true });
  assert.equal(controller.state, 'success');
});

test('a server failure is retryable and retry succeeds with exactly one request per attempt', async () => {
  const calls = [];
  const events = [];
  let failuresLeft = 1;
  const controller = makeController({
    events,
    fetchFn: async (url, options) => {
      calls.push({ url, options });
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        return { ok: false, status: 500 };
      }
      return { ok: true, status: 200 };
    },
  });

  const failed = await controller.submit('retry@thecompany.io');
  assert.deepEqual(failed, { ok: false, reason: 'retryable' });
  assert.equal(controller.state, 'error');
  assert.deepEqual(events[events.length - 1], { event: 'form_error', params: { error_type: 'server' } });

  const retried = await controller.submit('retry@thecompany.io');
  assert.deepEqual(retried, { ok: true });
  assert.equal(controller.state, 'success');
  assert.equal(calls.length, 2); // exactly one request per attempt — no double POST
});

test('a network failure reports error_type network and stays retryable', async () => {
  const events = [];
  const controller = makeController({
    events,
    fetchFn: async () => {
      throw new TypeError('fetch failed');
    },
  });

  const result = await controller.submit('maurice@thecompany.io');
  assert.deepEqual(result, { ok: false, reason: 'retryable' });
  assert.equal(controller.state, 'error');
  assert.deepEqual(events[events.length - 1], { event: 'form_error', params: { error_type: 'network' } });
});

test('a failed attempt stores no duplicate flag — the retry re-runs the same safe POST', async () => {
  const map = new Map();
  const writes = [];
  const storage = {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      writes.push(key);
      map.set(key, String(value));
    },
  };
  let fail = true;
  const controller = makeController({
    storage,
    fetchFn: async () => {
      if (fail) {
        fail = false;
        return { ok: false, status: 503 };
      }
      return { ok: true, status: 200 };
    },
  });

  await controller.submit('retry@thecompany.io'); // fails
  assert.deepEqual(writes, []); // failure wrote nothing
  const retried = await controller.submit('retry@thecompany.io'); // same email — not treated as duplicate
  assert.deepEqual(retried, { ok: true });
  assert.equal(writes.length, 1); // the flag is stored only on success
});

test('reset returns the controller to idle', async () => {
  const controller = makeController({ fetchFn: ok200 });
  await controller.submit('maurice@thecompany.io');
  assert.equal(controller.state, 'success');
  controller.reset();
  assert.equal(controller.state, 'idle');
});

test('event payloads never contain the email value (no PII)', async () => {
  const events = [];
  const controller = makeController({ events, fetchFn: ok200 });
  await controller.submit('maurice@thecompany.io');

  const serialized = JSON.stringify(events).toLowerCase();
  assert.equal(serialized.includes('maurice@thecompany.io'), false);
  assert.equal(serialized.includes('@'), false); // not even a partial address
});
