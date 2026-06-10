'use strict';

/**
 * Service resolution: map a caller's spoken service ("women's cut and style", "a blowout")
 * to a serviceJSON entry (index + posID + duration). serviceJSON is the source of truth and
 * is passed in (from salonClient.getSalonData) so we never drift from the live service list.
 *
 * Note on duration: the slot math uses the EMPLOYEE-specific duration (employeeJSON.serviceCfgs),
 * computed inside availability-core. The base duration here is only for display/echo.
 */

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function durationToMinutes(hms) {
  const parts = String(hms || '').split(':');
  if (parts.length === 3) return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  return 0;
}

// Common spoken phrases -> the exact canonical service name in serviceJSON.
const ALIASES = {
  'womens haircut': "Women's Cut",
  'womens cut': "Women's Cut",
  'womens cut and style': "Women's Cut & Style",
  'womens haircut and style': "Women's Cut & Style",
  'mens haircut': "Men's Haircut",
  'mens cut': "Men's Haircut",
  'kids haircut': "Kid's Haircut",
  'kids cut': "Kid's Haircut",
  'kids haircut and style': "Kid's Haircut & Style",
  'missionary haircut': 'Missionary Cut',
  blowout: 'Regular Blowout',
  'regular blowout': 'Regular Blowout',
  'blow out': 'Regular Blowout',
  'blow dry': 'Regular Blowout',
  makeup: 'Make-up',
  'make up': 'Make-up',
  updo: "Up Do's",
  updos: "Up Do's",
  'up do': "Up Do's",
  color: 'Whole Head Color',
  'full color': 'Whole Head Color',
  'all over color': 'Whole Head Color',
  perm: 'Perm',
  balayage: 'Balayage',
  'full highlights': 'Full Head Highlight',
  'full head highlights': 'Full Head Highlight',
  'partial highlights': 'Half Head Highlights',
  'half highlights': 'Half Head Highlights',
  'brow lamination': 'Brow Lamination',
  brows: 'Brows',
  eyebrows: 'Brows',
  'face wax': 'Full Face Wax',
  olaplex: 'Olaplex Ritual',
};

function tokenize(s) {
  return normalize(s).split(' ').filter(Boolean);
}

function score(queryTokens, nameTokens) {
  const nameSet = new Set(nameTokens);
  let shared = 0;
  for (const t of queryTokens) if (nameSet.has(t)) shared += 1;
  // proportion of the query and of the name that overlap (favors tight matches)
  const qProp = shared / Math.max(queryTokens.length, 1);
  const nProp = shared / Math.max(nameTokens.length, 1);
  return shared * 2 + qProp + nProp;
}

/**
 * @returns {{
 *   match: {index:number,name:string,posID:string,durationMinutes:number,priceCents:number,varies:boolean}|null,
 *   candidates: {index:number,name:string}[]
 * }}
 */
function resolveService(input, serviceJSON) {
  const services = (serviceJSON || []).map((s, index) => ({
    index,
    name: s.name,
    posID: s.posID,
    norm: normalize(s.name),
    durationMinutes: durationToMinutes(s.duration),
    priceCents: typeof s.price === 'number' ? s.price : 0,
  }));
  const toResult = (svc) =>
    svc
      ? {
          index: svc.index,
          name: svc.name,
          posID: svc.posID,
          durationMinutes: svc.durationMinutes,
          priceCents: svc.priceCents,
          varies: !svc.priceCents,
        }
      : null;

  const q = normalize(input);
  if (!q) return { match: null, candidates: [] };

  // 1) exact normalized name
  let hit = services.find((s) => s.norm === q);
  if (hit) return { match: toResult(hit), candidates: [] };

  // 2) explicit alias -> canonical name
  if (ALIASES[q]) {
    const canon = normalize(ALIASES[q]);
    hit = services.find((s) => s.norm === canon);
    if (hit) return { match: toResult(hit), candidates: [] };
  }

  // 3) token-overlap scoring
  const qTokens = tokenize(q);
  const ranked = services
    .map((s) => ({ s, sc: score(qTokens, tokenize(s.norm)) }))
    .sort((a, b) => b.sc - a.sc);

  const best = ranked[0];
  const second = ranked[1];
  const candidates = ranked.slice(0, 3).map((r) => ({ index: r.s.index, name: r.s.name }));

  // Confident if the top match shares real tokens and clearly beats the runner-up.
  if (best && best.sc >= 2 && (!second || best.sc - second.sc >= 1)) {
    return { match: toResult(best.s), candidates };
  }
  // Otherwise return candidates so the caller can be asked to clarify.
  return { match: null, candidates };
}

module.exports = { resolveService, durationToMinutes, normalize };
