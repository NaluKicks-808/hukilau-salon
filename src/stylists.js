'use strict';

/**
 * Stylist index <-> name resolution for what a caller might say.
 * Indexes are fixed by the salon's employeeJSON order (confirmed via `npm run inspect`):
 *   0 Marcus, 1 Kelli, 2 Patricia Maples, 3 Amanda Maples
 * If the salon adds/reorders stylists, re-run `npm run inspect` and update this map.
 */

const STYLISTS = [
  { index: 0, full: 'Marcus', short: 'Marcus', aliases: ['marcus'] },
  { index: 1, full: 'Kelli', short: 'Kelli', aliases: ['kelli', 'kelly', 'kellie', 'kelley'] },
  {
    index: 2,
    full: 'Patricia Maples',
    short: 'Patricia',
    aliases: ['patricia', 'patricia maples', 'trish', 'trisha', 'pat', 'patty', 'patti'],
  },
  {
    index: 3,
    full: 'Amanda Maples',
    short: 'Amanda',
    aliases: ['amanda', 'amanda maples', 'mandy'],
  },
];

const NO_PREFERENCE = new Set([
  '',
  'any',
  'anyone',
  'any one',
  'anybody',
  'no preference',
  'no one',
  'whoever',
  'first available',
  'earliest',
  'soonest',
  "doesn't matter",
  'dont care',
  "don't care",
]);

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolve a spoken stylist name to a stylist record, or null for "any stylist".
 * @returns {{index:number, full:string, short:string} | null}
 */
function resolveStylist(input) {
  const n = normalize(input);
  if (NO_PREFERENCE.has(n)) return null;
  // exact alias
  for (const s of STYLISTS) {
    if (s.aliases.includes(n)) return s;
  }
  // token / prefix match (e.g. "patricia m", "kell")
  for (const s of STYLISTS) {
    for (const a of s.aliases) {
      if (n && (a.startsWith(n) || n.startsWith(a) || a.split(' ')[0] === n)) return s;
    }
  }
  return null;
}

function byIndex(index) {
  return STYLISTS.find((s) => s.index === index) || null;
}

function displayName(index) {
  const s = byIndex(index);
  return s ? s.full : `Stylist ${index}`;
}

function shortName(index) {
  const s = byIndex(index);
  return s ? s.short : `Stylist ${index}`;
}

module.exports = { STYLISTS, resolveStylist, byIndex, displayName, shortName };
