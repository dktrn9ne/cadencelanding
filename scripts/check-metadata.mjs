#!/usr/bin/env node
/**
 * Metadata-presence check (PR 8).
 *
 * Severity is WARN today by design: the missing metadata is PR 6's scope
 * (SEO/social package). Once PR 6 lands, re-run with METADATA_STRICT=1 (or
 * flip the workflow to pass METADATA_STRICT=1) and this script gates red on
 * any absence. See .github/workflows/ci.yml for the matching TODO.
 *
 * Asserts presence only — content quality is not checked here.
 */
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const required = [
  ['title', /<title>[^<]+<\/title>/i],
  ['meta description', /<meta\s+name="description"\s+content="[^"]+"/i],
  ['canonical link', /<link\s+rel="canonical"\s+href="[^"]+"/i],
  ['favicon', /<link\s+rel="(?:icon|shortcut icon)"\s+href="[^"]+"/i],
  ['og:title', /<meta\s+property="og:title"\s+content="[^"]+"/i],
  ['og:description', /<meta\s+property="og:description"\s+content="[^"]+"/i],
  ['og:image', /<meta\s+property="og:image"\s+content="[^"]+"/i],
  ['twitter:card', /<meta\s+name="twitter:card"\s+content="[^"]+"/i],
];

const missing = required.filter(([, re]) => !re.test(html)).map(([name]) => name);

if (missing.length === 0) {
  console.log('metadata: all required tags present');
  process.exit(0);
}

for (const name of missing) {
  console.warn(`metadata: MISSING ${name}`);
}

if (process.env.METADATA_STRICT === '1') {
  console.error(`metadata: ${missing.length} missing (strict mode)`);
  process.exit(1);
}

console.warn(
  `metadata: ${missing.length} missing — WARN severity until PR 6 (SEO/social) lands,` +
  ' then flip the workflow to METADATA_STRICT=1'
);
process.exit(0);
