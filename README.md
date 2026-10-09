# cadencelanding

The Cadence landing page — a single static `index.html` (inline CSS/JS), served
at `https://cadencelanding.vercel.app` via Vercel.

## Local development

```bash
npm install
npm run serve        # serves on http://localhost:4173
```

## Test & quality gates

```bash
npm test             # Playwright: browser journeys, analytics assertions, overflow sweep
npm run test:a11y    # pa11y-ci, WCAG 2 AA
npm run test:lhci    # Lighthouse CI budgets (runs its own server)
npm run test:metadata
```

All gates also run in CI (`.github/workflows/ci.yml`) on every pull request and
on `main`: broken links/anchors (lychee), accessibility (pa11y), browser
journeys (Playwright), Lighthouse budgets (performance ≥ 0.90, accessibility ≥
0.95, best-practices ≥ 0.90, SEO ≥ 0.90, script ≤ 30KB), and metadata presence.

## Analytics

Privacy-clean, cookieless event tracking: six structural events
(`product_view`, `cta_click`, `app_handoff`, `form_start`, `form_success`,
`form_failure`) with enum-only properties (`placement`, `form`, `reason`). No
event carries a field value, email, wallet-shaped string, or raw error text;
the page adds no cookies or storage keys. Tracking is vendor-agnostic via a
small in-page wrapper and stays inactive until `CADENCE_ANALYTICS_ID` is set —
see `docs/monitoring.md` for the post-merge setup checklist.

## Availability

Uptime checks run on a schedule against three independent dependencies
(landing page, app destination, form endpoint) — see `.github/workflows/uptime.yml`
and `docs/monitoring.md` for the hosted-monitor recipe.
