// funnel.js — Cadence landing funnel behaviors: campaign attribution, the
// request-access form, and the measurement layer.
// Vanilla ES module, no dependencies. It enhances the working markup in
// index.html, which keeps a native-POST fallback for no-JS visitors.
//
// Event vocabulary (locked — structural, copy-independent):
//   product_view  {placement: nav|hero|footer}
//   cta_click     {placement: nav|hero}
//   app_handoff   {placement: nav|hero, ref}
//   form_start    {form: signup}
//   form_success  {form: signup}
//   form_failure  {form: signup, reason: validation|network|provider_error}
// Property values are positions, a form id, or a failure reason — nothing
// typed or pasted by a visitor is ever read into an event, and the page adds
// no cookies, storage keys, or persistent identifiers.

const CONFIG = {
  APP_URL: 'https://cadence-green-ten.vercel.app/',
  FORM_ENDPOINT: 'https://formspree.io/f/mojgkzay',
  // Umami Cloud website id. Empty = dataLayer events only; no vendor script
  // loads. See docs/monitoring.md for the post-merge setup step.
  CADENCE_ANALYTICS_ID: '',
};

const ATTRIBUTION_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'fbclid',
];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(value) {
  return EMAIL_PATTERN.test(value);
}

// Capture campaign parameters from the landing URL once, on load, in memory
// only — they survive anchor scrolls within the visit and are never persisted.
export function collectAttribution(search) {
  const params = new URLSearchParams(search);
  const picked = {};
  for (const key of ATTRIBUTION_KEYS) {
    const value = params.get(key);
    if (value) picked[key] = value;
  }
  return picked;
}

// Build the app handoff URL: captured attribution params plus the landing
// attribution contract (?ref=landing-<placement>) when a placement is known.
// No attribution anywhere means the app URL is handed off with just the ref.
export function buildAppUrl(attribution, ref) {
  const url = new URL(CONFIG.APP_URL);
  for (const [key, value] of Object.entries(attribution)) {
    url.searchParams.set(key, value);
  }
  if (ref && !url.searchParams.has('ref')) {
    url.searchParams.set('ref', ref);
  }
  return url.toString();
}

// Vendor-neutral measurement shim: event objects on window.dataLayer are
// inspectable in any console; when an analytics id is configured (window
// variable wins, then the CONFIG default), the same payloads bridge to Umami
// (cookieless, no persistent visitor ids).
export function track(event, params = {}) {
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event, ...params });
  if (window.CADENCE_ANALYTICS_ID && window.umami) {
    window.umami.track(event, params);
  }
}

function initMeasurement() {
  window.dataLayer = window.dataLayer || [];
  // Runtime id wins so the deploy config can be overridden without a rebuild.
  if (!window.CADENCE_ANALYTICS_ID) window.CADENCE_ANALYTICS_ID = CONFIG.CADENCE_ANALYTICS_ID;
  if (!window.CADENCE_ANALYTICS_ID) return; // dataLayer only; no vendor script.
  // Umami Cloud bootstrap — cookieless, no consent banner required.
  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://cloud.umami.is/script.js';
  script.setAttribute('data-website-id', CONFIG.CADENCE_ANALYTICS_ID);
  document.head.appendChild(script);
}

// Placement vocabulary for events: derived from structure, never from copy.
function derivePlacement(el) {
  if (el.closest('.nav-menu') || el.closest('header.nav')) return 'nav';
  if (el.closest('.hero')) return 'hero';
  if (el.closest('footer')) return 'footer';
  return null; // outside the tracked surfaces — no event, enum stays closed
}

// Small, honest state machine for the access-request form.
// States: idle | validation | sending | success | duplicate | error.
// DOM-free: fetch and tracking are injected, so every transition is
// unit-testable without a browser and without touching the live endpoint.
export function createFormController({ endpoint, track: trackEvent, fetchFn, onStateChange }) {
  let state = 'idle';
  const submitted = new Set(); // this load only — nothing persisted

  function setState(next) {
    state = next;
    if (onStateChange) onStateChange(state);
  }

  async function submit(email) {
    if (state === 'sending') {
      // Duplicate guard: a second click while a request is in flight sends nothing.
      return { ok: false, reason: 'in-flight' };
    }
    if (!isEmail(email)) {
      setState('validation');
      trackEvent('form_failure', { form: 'signup', reason: 'validation' });
      return { ok: false, reason: 'validation' }; // input value preserved for correction
    }
    if (submitted.has(email.toLowerCase())) {
      setState('duplicate');
      return { ok: false, reason: 'duplicate' };
    }
    setState('sending');
    try {
      const res = await fetchFn(endpoint, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error('formspree ' + res.status);
      submitted.add(email.toLowerCase());
      setState('success');
      trackEvent('form_success', { form: 'signup' });
      return { ok: true };
    } catch (err) {
      // Nothing partially written; retry re-runs the same safe POST. The raw
      // error text never leaves this scope — only the coarse reason enum.
      setState('error');
      trackEvent('form_failure', {
        form: 'signup',
        reason: err && err.name === 'TypeError' ? 'network' : 'provider_error',
      });
      return { ok: false, reason: 'retryable' };
    }
  }

  return {
    get state() {
      return state;
    },
    submit,
    reset: () => setState('idle'),
  };
}

// --- DOM wiring (browser only) -------------------------------------------

function wireAppCta(cta, capturedAttribution) {
  cta.addEventListener('click', () => {
    // Build the handoff URL first, then let the browser follow the anchor.
    const placement = derivePlacement(cta) || 'nav';
    const ref = 'landing-' + placement;
    cta.href = buildAppUrl(capturedAttribution, ref);
    track('cta_click', { placement });
    track('app_handoff', { placement, ref });
  });
}

function wireProductViews() {
  // Delegated: one listener covers every current and future product link.
  document.addEventListener('click', (e) => {
    const link = e.target.closest && e.target.closest('a[href="#what"], a[href="#capabilities"]');
    if (!link) return;
    const placement = derivePlacement(link);
    if (!placement) return;
    track('product_view', { placement });
  });
}

function initForm() {
  const form = document.getElementById('access-form');
  if (!form) return;
  form.noValidate = true; // the JS path validates inline; no-JS keeps native validation

  const emailInput = document.getElementById('access-email');
  const submitBtn = document.getElementById('access-submit');
  const statusEl = document.getElementById('form-status');
  const successEl = document.getElementById('form-success');
  const resetBtn = document.getElementById('form-reset');

  const MESSAGES = {
    validation: 'Enter a valid email address.',
    duplicate: 'That email is already on the list.',
    error: "That didn't go through — try again.",
  };

  function renderStatus(kind, message) {
    statusEl.textContent = message;
    statusEl.className = 'form-status' + (kind ? ' is-' + kind : '');
  }

  function setSending(sending) {
    submitBtn.disabled = sending;
    submitBtn.setAttribute('aria-busy', sending ? 'true' : 'false');
    submitBtn.textContent = sending ? 'Requesting access…' : 'Request access';
  }

  const controller = createFormController({
    endpoint: CONFIG.FORM_ENDPOINT,
    track,
    fetchFn: (url, options) =>
      fetch(url, { ...options, signal: AbortSignal.timeout(10000) }), // ~10s timeout
    onStateChange: (next) => {
      if (next === 'sending') {
        setSending(true);
        renderStatus('', '');
        return;
      }
      setSending(false);
      if (next === 'validation') {
        renderStatus('error', MESSAGES.validation);
        emailInput.classList.add('is-invalid');
        emailInput.focus();
      } else if (next === 'duplicate') {
        renderStatus('success', MESSAGES.duplicate);
      } else if (next === 'error') {
        renderStatus('error', MESSAGES.error);
      } else if (next === 'success') {
        // Inline confirmation only — the page never navigates to Formspree.
        form.classList.add('is-success');
        successEl.hidden = false;
        renderStatus('', '');
      } else if (next === 'idle') {
        form.classList.remove('is-success');
        successEl.hidden = true;
        emailInput.classList.remove('is-invalid');
        renderStatus('', '');
      }
    },
  });

  // First focus inside the email field, once per page load (funnel: signup path).
  emailInput.addEventListener(
    'focus',
    () => track('form_start', { form: 'signup' }),
    { once: true }
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault(); // never navigate to Formspree's page
    await controller.submit(emailInput.value.trim());
  });

  emailInput.addEventListener('input', () => emailInput.classList.remove('is-invalid'));

  resetBtn.addEventListener('click', () => controller.reset());
}

function init() {
  initMeasurement();
  const capturedAttribution = collectAttribution(window.location.search);

  document.querySelectorAll('[data-cta]').forEach((el) => {
    if (el.getAttribute('href') === CONFIG.APP_URL) wireAppCta(el, capturedAttribution);
  });

  wireProductViews();
  initForm();
}

// Auto-init only in a browser-like DOM that has the funnel markup; keeps the
// module import side-effect-free for pure-logic tests.
if (typeof window !== 'undefined' && typeof document !== 'undefined' && document.getElementById('access-form')) {
  init();
}
