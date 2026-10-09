// funnel.js — Cadence landing funnel behaviors: campaign attribution, the
// request-access form, and a vendor-neutral measurement shim.
// Vanilla ES module, no dependencies. It enhances the working markup in
// index.html, which keeps a native-POST fallback for no-JS visitors.

const CONFIG = {
  APP_URL: 'https://cadence-green-ten.vercel.app/',
  FORM_ENDPOINT: 'https://formspree.io/f/mojgkzay',
  MEASUREMENT_ID: '', // GA4 id ("G-…"). Empty = dataLayer events only; no vendor script loads.
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
const STORAGE_KEY = 'cadence:attribution';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(value) {
  return EMAIL_PATTERN.test(value);
}

// Capture campaign parameters from the landing URL once, on load, so they
// survive anchor scrolls and SPA-free navigation within the visit.
export function collectAttribution(search) {
  const params = new URLSearchParams(search);
  const picked = {};
  for (const key of ATTRIBUTION_KEYS) {
    const value = params.get(key);
    if (value) picked[key] = value;
  }
  if (Object.keys(picked).length) {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(picked));
    } catch (_err) {
      // Storage unavailable: degrade to click-time params only.
    }
  }
  return picked;
}

function readStoredAttribution() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_err) {
    return {};
  }
}

// Build the app handoff URL. Explicitly captured attribution wins; otherwise
// fall back to what this visit stored earlier. No attribution anywhere means
// the app URL is handed off unchanged.
export function buildAppUrl(attribution) {
  const url = new URL(CONFIG.APP_URL);
  const picked = Object.keys(attribution).length ? attribution : readStoredAttribution();
  for (const [key, value] of Object.entries(picked)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

// Vendor-neutral measurement: GA4-compatible event objects on window.dataLayer.
// Inspectable today in any console/tag manager; forwarding to GA4 needs only
// CONFIG.MEASUREMENT_ID — no call-site changes. Never include PII in params.
export function track(event, params = {}) {
  const payload = { event, ...params };
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(payload);
}

function initMeasurement() {
  window.dataLayer = window.dataLayer || [];
  if (!CONFIG.MEASUREMENT_ID) return; // dataLayer events only; no vendor script loads.
  // Standard GA4 bootstrap: the same dataLayer feeds gtag.js once an id exists.
  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(CONFIG.MEASUREMENT_ID);
  document.head.appendChild(script);
  window.gtag = function gtag() {
    window.dataLayer.push(arguments);
  };
  window.gtag('js', new Date());
  window.gtag('config', CONFIG.MEASUREMENT_ID);
}

function flagKey(email) {
  return 'cadence:access-requested:' + email.toLowerCase();
}

// Small, honest state machine for the access-request form.
// States: idle | validation | sending | success | duplicate | error.
// DOM-free: storage, fetch, and tracking are injected, so every transition is
// unit-testable without a browser and without touching the live endpoint.
export function createFormController({ endpoint, track: trackEvent, storage, fetchFn, onStateChange }) {
  let state = 'idle';

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
      trackEvent('form_error', { error_type: 'validation' });
      return { ok: false, reason: 'validation' }; // input value preserved for correction
    }
    if (storage.getItem(flagKey(email))) {
      setState('duplicate');
      trackEvent('form_error', { error_type: 'duplicate' });
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
      storage.setItem(flagKey(email), '1');
      setState('success');
      trackEvent('form_success');
      return { ok: true };
    } catch (err) {
      // Nothing partially written; retry re-runs the same safe POST.
      setState('error');
      trackEvent('form_error', { error_type: err && err.name === 'TypeError' ? 'network' : 'server' });
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
    cta.href = buildAppUrl(capturedAttribution);
    const url = new URL(cta.href);
    track('cta_click', { cta_id: cta.dataset.cta, destination: 'app' });
    track('app_handoff', {
      cta_id: cta.dataset.cta,
      attribution_present: [...url.searchParams.keys()].length > 0,
      had_click_id: url.searchParams.has('gclid') || url.searchParams.has('fbclid'),
    });
  });
}

function wireFormRouteCta(link) {
  link.addEventListener('click', () => {
    track('cta_click', { cta_id: link.dataset.cta, destination: 'form' });
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
    storage: sessionStorage,
    fetchFn: (url, options) => fetch(url, options),
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

  form.addEventListener('submit', async (event) => {
    event.preventDefault(); // never navigate to Formspree's page
    track('form_submit', { form_location: 'get-started' });
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
    else wireFormRouteCta(el);
  });

  initForm();
}

// Auto-init only in a browser-like DOM that has the funnel markup; keeps the
// module import side-effect-free for pure-logic tests.
if (typeof window !== 'undefined' && typeof document !== 'undefined' && document.getElementById('access-form')) {
  init();
}
