# Performance budgets

This page is a hand-authored single-file static site with self-hosted subset
fonts and a decorative animation layer that pauses when it cannot be seen.
These budgets are the contract every future PR is measured against. No build
system exists; verification is self-contained (headless Chromium + Lighthouse,
run locally).

## Budgets

| Budget                          | Target                              | Rationale                                                                    |
| ------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------- |
| Lighthouse performance (mobile) | ≥ 90                                 | The headline gate, under the profile below.                                   |
| LCP                             | < 2.5 s                              | h1 text with the preloaded Playfair 700 display face.                         |
| CLS                             | < 0.1                                | Metric-matched local fallback faces hold the layout through late swaps.       |
| INP / TBT                       | < 200 ms / ≤ 150 ms                  | The pay-card wave path rebuild is off-screen-gated, never a background cost.  |
| Page weight                     | ≤ 250 KB transferred, ≤ 40 KB HTML   | Headroom over the ~33 KB document for future assets.                          |
| Font payload                    | ≤ 150 KB total woff2                 | Seven subset faces ship; only Playfair 700 and Inter 400 preload.             |
| Requests                        | 0 third-party, 0 render-blocking external CSS, 0 external JS | The zero-tooling static-site advantage, made explicit. |

## Test profile (the only one that counts)

Headless Chromium (latest stable), Lighthouse mobile form factor, **simulated
Slow 4G with 4× CPU throttling (Lighthouse defaults)**, page served over local
HTTP, **three runs with the median reported**. Baseline on `origin/main`,
candidate on the PR head — both archived as JSON + HTML reports with their
numbers quoted in the PR body. Never widen throttling to make a number.

Concretely, one run looks like:

```
CHROME_PATH=<chrome> npx lighthouse@12 http://127.0.0.1:8002/ --quiet \
  --chrome-flags="--headless=new --no-sandbox --disable-dev-shm-usage" \
  --form-factor=mobile --screenEmulation.mobile --throttling-method=simulate \
  --throttling.rttMs=150 --throttling.tcpSlowStartStartThroughputKbps=0 \
  --throttling.requestLatencyMs=562.5 --throttling.downloadThroughputKbps=1638.4 \
  --throttling.uploadThroughputKbps=384 --throttling.cpuSlowdownMultiplier=4 \
  --output=json --output=html --output-path=reports/run1
```

Serve the page first: `python3 -m http.server 8002` from the repo root.

## Results (2026-10-09)

| Metric            | Baseline `origin/main` (a29710a) | Head `perf/hardening` (71299a0) | Budget    |
| ----------------- | -------------------------------: | ------------------------------: | --------- |
| Performance score | 90 (90 / 90 / 90)                | **100** (100 / 100 / 100)       | ≥ 90      |
| LCP               | 2,867 ms                         | **1,652 ms**                    | < 2,500   |
| CLS               | 0.0197                           | **0.0002**                      | < 0.1     |
| TBT               | 0 ms                             | **0 ms**                        | ≤ 150     |
| Transferred       | 139.2 KB                         | **127.4 KB**                    | ≤ 250     |
| Requests          | 7 (5 third-party)                | **8 (0 third-party)**           | 0 third   |

The head adds one same-origin request versus baseline (favicon/manifest, from
the SEO package); the five baseline third-party requests (fonts CSS + font
binaries) are gone.

## Implementation notes

- **Fonts.** `fonts/` holds seven pyftsubset-built latin woff2 subsets — Inter
  400/600/700/800, IBM Plex Mono 400/600, Playfair Display 700 (OFL licenses
  alongside; subsets cover full printable Basic Latin + punctuation + currency
  so future copy edits don't strand glyphs). Only the LCP-critical faces
  preload. `font-display: swap` is kept; metric-matched local fallback faces
  (`size-adjust` / `ascent-override` / `descent-override`) hold the layout
  through a late swap or a total 404 — verified by renaming one woff2 and
  reloading with zero element-rect shift.
- **Decorative layer.** 36 seeded dots (hero 16, ecosystem 20, same 7-column
  jitter grid and per-dot timing as the original 70) and 4 dash-animated wave
  paths per field (was 6, alternating clay/forest rhythm kept). An
  IntersectionObserver (+80 px margin) toggles `data-paused` on every
  `.pattern` and the pay-card; CSS animations suspend, the pay-card rAF loop
  stops scheduling, and the 220 ms amount ticker idles. Everything resumes on
  re-entry; a `visibilitychange` guard restarts the loop through a single
  schedule helper so it can never double.
- **Containment deviation (deliberate).** `.pattern` containers get
  `contain: layout paint`; the pay-card gets `contain: layout` only — paint
  containment would clip its `:after` ring, which bleeds 96 px outside the
  card by design. Visual identity is a constraint, not a variable.
- **`content-visibility: auto`** on `#who`, `#product`, `#ecosystem`, `#how`,
  `.final` with `contain-intrinsic-size: auto 640px` — verified against
  smooth-scroll anchor navigation; drop it (keeping containment alone) if a
  future change breaks anchor landings.
- **Reduced motion.** `@media (prefers-reduced-motion: reduce)` kills all four
  decorative CSS animations outright; dots hold seeded positions, wave paths
  render as static strokes, the pay-card wave paints its first frame,
  `scroll-behavior` drops to `auto`. The amount ticker is content, not motion —
  it keeps its 4 s reduced cadence.
- **JavaScript off.** The page stays complete and readable: dots never seed,
  the pay wave and amount render static, CSS animations still play. Decorative
  JS is enhancement, never a dependency.

## Re-running the audits

1. Serve the repo root: `python3 -m http.server 8002`.
2. Run the profile command above three times (`run1`…`run3`).
3. Report medians; archive the JSON + HTML reports with the tested head SHA.
