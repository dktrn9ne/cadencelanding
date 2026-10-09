// Shared test helpers (PR 8).
export const APP_URL = 'https://cadence-green-ten.vercel.app/';

/**
 * Blocks the cross-origin app handoff so a CTA click never leaves the page.
 * Three layers, because an aborted navigation still swaps the document for a
 * chrome-error page (which destroys the JS context and any captured events),
 * and CTAs open in a new tab (target=_blank) whose requests bypass page.route:
 *   1. capture-phase preventDefault — navigation never starts;
 *   2. context.route — egress to the app origin is blocked for the page AND
 *      any popup it opens.
 */
export async function blockAppNavigation(page) {
  await preventAppNavigationInit(page);
  await page.context().route(APP_URL + '**', route => route.abort());
}

/**
 * Just the capture-phase preventDefault layer, for tests that need their own
 * route handler (e.g. to record the intercepted request).
 */
export async function preventAppNavigationInit(page) {
  await page.addInitScript(appUrl => {
    window.addEventListener('click', e => {
      const a = e.target && e.target.closest && e.target.closest(`a[href^="${appUrl}"]`);
      if (a) e.preventDefault();
    }, true);
  }, APP_URL);
}
