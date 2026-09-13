/**
 * scripts/verify-rates.ts
 *
 * Lists every tax rate nobody has confirmed, plus anything verified over a
 * year ago. Run with: npm run verify-rates
 */

import { unverifiedFields, staleFields } from '../lib/tax/jurisdictions';

const unverified = unverifiedFields();
const stale = staleFields(365);

console.log(`\nUNVERIFIED (${unverified.length}) — placeholders, do not trust results:\n`);
for (const f of unverified) {
  console.log(`  ${f.scope}.${f.field}`);
  console.log(`    source: ${f.source}`);
  if (f.note) console.log(`    note:   ${f.note.slice(0, 120)}`);
}

console.log(`\nSTALE (${stale.length}) — verified over a year ago:\n`);
for (const f of stale) console.log(`  ${f.scope}.${f.field} — ${f.source}`);

console.log('\nTo clear an item: fix the value in the JSON file, then set');
console.log('its verifiedOn to today, e.g. "verifiedOn": "2026-09-12"\n');

if (unverified.length > 0) process.exitCode = 1;
