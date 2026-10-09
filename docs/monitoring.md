# Monitoring & post-merge setup

The landing page, the app destination, and the form endpoint fail
independently — so each dependency gets its own signal and its own alert. A
Formspree outage must never read as a landing-page outage.

## What watches what

| Dependency | URL | Healthy signature | Checked by |
| --- | --- | --- | --- |
| Landing page | `https://cadencelanding.vercel.app/` | GET 200 | `uptime.yml` → `landing-page` |
| App destination | `https://cadence-green-ten.vercel.app/` | GET 200 | `uptime.yml` → `app-destination` |
| Form endpoint | `https://formspree.io/f/mojgkzay` | **GET 400** (POST-only by design) | `uptime.yml` → `form-endpoint` |
| Formspree service | `https://status.formspree.io/` | GET 200 | `uptime.yml` → `form-endpoint` (second step) |

The scheduled `Uptime` workflow runs every 15 minutes (cron
`7,22,37,52 * * * *`, deliberately off the top-of-hour crunch). Each job fails
independently; killing one dependency's URL flips exactly one signal.

**Why the form endpoint expects a 400 on GET.** Formspree form endpoints are
POST-only: a GET returns 400 by design. That 400 *is* the healthy signature —
a naive "expect 200" monitor would alarm forever, and a scheduled real POST
would drop a test submission into the Formspree inbox on every run. Scheduled
runs therefore assert the 400 signature; a real POST e2e runs only on manual
dispatch (`workflow_dispatch`) and lands one submission in the inbox per run.

## Hosted monitors (recommended alert path)

Scheduled GitHub Actions checks are a supplement, not a replacement: they can
be delayed or dropped during GitHub incidents. A hosted monitor watches from
outside GitHub's blast radius. Recommended recipe — UptimeRobot free tier:

1. Create a free account at uptimerobot.com (one-time, Maurice-owned).
2. Add three HTTP(s) monitors, **5-minute interval**, email alerts:
   - `Cadence landing` → `https://cadencelanding.vercel.app/`
   - `Cadence app` → `https://cadence-green-ten.vercel.app/`
   - `Cadence form (expect 400)` → `https://formspree.io/f/mojgkzay` —
     set the expected status code to 400 (UptimeRobot supports "any status
     code except the expected one fails" via a custom keyword/monitor type;
     on the free tier use an HTTP monitor and expect `400`). If the plan
     cannot express expect-400, monitor `https://status.formspree.io/`
     instead — it is the service-level signal.
3. Add alert contacts (email; Slack optional on paid tier).

Any equivalent HTTP monitor (Better Stack, Healthchecks.io) substitutes
cleanly — the three-monitor shape is the contract, not the vendor.

## Post-merge checklist

- [ ] **Create the Umami Cloud site** (one-time account action): add a site
      for `https://cadencelanding.vercel.app`, copy the site/website ID.
- [ ] **Configure `CADENCE_ANALYTICS_ID`**: paste the ID into the
      `CADENCE_ANALYTICS_ID` constant at the top of the measurement layer in
      `index.html`. Until then, analytics no-ops (the page and all tests run
      fine without it — nothing depends on the account existing).
- [ ] **Verify the funnel in the Umami dashboard**: one live session should
      show pageview → `product_view` → `cta_click` (segmented by `placement`)
      and the signup path `form_start` → `form_success`, with UTM/referrer
      attribution on the session.
- [ ] **Create the hosted monitors** per the recipe above.
- [ ] **Dispatch one real-POST e2e**: run the `Uptime` workflow manually once
      (`gh workflow run uptime.yml`), then confirm the probe submission is in
      the Formspree inbox.
