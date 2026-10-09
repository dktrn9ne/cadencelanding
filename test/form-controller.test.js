import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFormController, isEmail } from '../funnel.js';

const ENDPOINT = 'https://formspree.io/f/mojgkzay';

function makeController({ fetchFn, events = [], states = [] } = {}) {
  return createFormController({
    endpoint: ENDPOINT,
    track: (event, params = {}) => events.push({ event, params }),
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
  assert.deepEqual(events, [{ event: 'form_success', params: { form: 'signup' } }]);
  assert.deepEqual(states, ['sending', 'success']);
});

test('an already-successful email is suppressed as a duplicate without a second POST or event', async () => {
  const calls = [];
  const events = [];
  const controller = makeController({ events, fetchFn: async () => (calls.push(1), { ok: true, status: 200 }) });

  await controller.submit('maurice@thecompany.io');
  const second = await controller.submit('maurice@thecompany.io');

  assert.deepEqual(second, { ok: false, reason: 'duplicate' });
  assert.equal(controller.state, 'duplicate');
  assert.equal(calls.length, 1); // no second request
  // The dedupe is a local refusal, not a funnel failure — no event fires and
  // the reason enum (validation|network|provider_error) stays closed.
  assert.deepEqual(events, [{ event: 'form_success', params: { form: 'signup' } }]);
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
  assert.deepEqual(events, [
    { event: 'form_failure', params: { form: 'signup', reason: 'validation' } },
  ]);
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

test('a provider failure is retryable and retry succeeds with exactly one request per attempt', async () => {
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
  assert.deepEqual(events[events.length - 1], {
    event: 'form_failure',
    params: { form: 'signup', reason: 'provider_error' },
  });

  const retried = await controller.submit('retry@thecompany.io');
  assert.deepEqual(retried, { ok: true });
  assert.equal(controller.state, 'success');
  assert.equal(calls.length, 2); // exactly one request per attempt — no double POST
});

test('a network failure reports reason network and stays retryable', async () => {
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
  assert.deepEqual(events[events.length - 1], {
    event: 'form_failure',
    params: { form: 'signup', reason: 'network' },
  });
});

test('a failed attempt records nothing — the retry re-runs the same safe POST', async () => {
  const events = [];
  let fail = true;
  const controller = makeController({
    events,
    fetchFn: async () => {
      if (fail) {
        fail = false;
        return { ok: false, status: 503 };
      }
      return { ok: true, status: 200 };
    },
  });

  await controller.submit('retry@thecompany.io'); // fails
  const retried = await controller.submit('retry@thecompany.io'); // same email — not treated as duplicate
  assert.deepEqual(retried, { ok: true });
  // Only the failed attempt's form_failure and the retry's form_success.
  assert.equal(events.filter((e) => e.event === 'form_failure').length, 1);
  assert.equal(events.filter((e) => e.event === 'form_success').length, 1);
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

test('every emitted event is in the locked vocabulary with allowlisted keys', async () => {
  const events = [];
  let fail = true;
  const controller = makeController({
    events,
    fetchFn: async () => (fail ? ((fail = false), { ok: false, status: 500 }) : { ok: true, status: 200 }),
  });

  await controller.submit('not-an-email'); // form_failure validation
  await controller.submit('retry@thecompany.io'); // form_failure provider_error
  await controller.submit('retry@thecompany.io'); // form_success

  const VOCAB = {
    form_start: ['form'],
    form_success: ['form'],
    form_failure: ['form', 'reason'],
  };
  for (const { event, params } of events) {
    assert.ok(VOCAB[event], `unexpected event name: ${event}`);
    assert.deepEqual(Object.keys(params).sort(), VOCAB[event].slice().sort(), event);
  }
  assert.deepEqual(events[0], { event: 'form_failure', params: { form: 'signup', reason: 'validation' } });
  assert.deepEqual(events[1], { event: 'form_failure', params: { form: 'signup', reason: 'provider_error' } });
  assert.deepEqual(events[2], { event: 'form_success', params: { form: 'signup' } });
});
