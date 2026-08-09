#!/usr/bin/env node
/*
 * Self-check for the sleep habit's floor + band mapping.  Run: node test-sleep-bands.js
 *
 * These two rules are easy to break by accident and hard to spot on a heatmap, since a
 * wrong shade still looks plausible:
 *   - time rounds DOWN (6h59m is six hours slept, not seven)
 *   - hours collapse into five bands: under 6h, 6-7, 7-8, 8-9, 9h+
 *
 * Kept in sync by hand with SLEEP_BANDS / rampIndex in src/app.jsx and with
 * recompute_sleep_day in the database.
 */
const SLEEP_BANDS = [6, 7, 8, 9];
const SLEEP_LEVELS = SLEEP_BANDS.length + 1;
const LABELS = ['under 6h', '6-7h', '7-8h', '8-9h', '9h+'];

function rampIndex(habit, v) {
  if (habit.source !== 'sleep') return v;
  if (v <= 0) return 0;
  let i = 0;
  while (i < SLEEP_BANDS.length && v >= SLEEP_BANDS[i]) i++;
  return i + 1;
}
// mirrors recompute_sleep_day: floor, but any recorded sleep is worth at least 1
const storedHours = (h, m) => (h * 60 + m > 0 ? Math.max(Math.floor(h + m / 60), 1) : 0);

const sleep = { source: 'sleep' };
const cases = [
  [0, 40, 1, 'under 6h'], [3, 50, 3, 'under 6h'], [5, 59, 5, 'under 6h'],
  [6, 0, 6, '6-7h'], [6, 59, 6, '6-7h'],
  [7, 0, 7, '7-8h'], [7, 45, 7, '7-8h'], [7, 59, 7, '7-8h'],
  [8, 0, 8, '8-9h'], [8, 59, 8, '8-9h'],
  [9, 0, 9, '9h+'], [11, 29, 11, '9h+'],
];

let failed = 0;
for (const [h, m, wantValue, wantBand] of cases) {
  const v = storedHours(h, m);
  const label = LABELS[rampIndex(sleep, v) - 1];
  if (v !== wantValue || label !== wantBand) {
    failed++;
    console.error(`FAIL ${h}h ${m}m -> value ${v} (${label}); expected ${wantValue} (${wantBand})`);
  }
}

console.assert(rampIndex(sleep, 0) === 0, 'no sleep must leave the cell empty');
console.assert(rampIndex({ source: null }, 4) === 4, 'non-sleep habits must be untouched');
console.assert(SLEEP_LEVELS === 5, 'exactly five shades');

if (failed) { console.error(`\n${failed} failure(s)`); process.exit(1); }
console.log(`${cases.length} cases pass — floor + 5 bands correct.`);
