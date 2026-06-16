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
  // "Root touch up" is the most common spoken name for a gray root retouch — pin it so it never
  // gets pulled toward "Make-up"/"Up Do's" by the shared "up" token (see STOPWORDS note below).
  'root touch up': 'Gray Root Retouch',
  'root touchup': 'Gray Root Retouch',
  'root retouch': 'Gray Root Retouch',
  'gray root touch up': 'Gray Root Retouch',
  perm: 'Perm',
  balayage: 'Balayage',
  'full highlights': 'Full Head Highlight',
  'full head highlights': 'Full Head Highlight',
  'partial highlights': 'Half Head Highlights',
  'half highlights': 'Half Head Highlights',
  'brow lamination': 'Brow Lamination',
  brows: 'Brows',
  eyebrows: 'Brows',
  'brow wax': 'Brows',
  'eyebrow wax': 'Brows',
  // Stemming/synonym fixes for near-exact phrasings the token scorer narrowly misses
  // ("tint" vs "tinting"), so these resolve confidently instead of asking to clarify.
  'brow tint': 'Brow Tinting',
  'eyebrow tint': 'Brow Tinting',
  'brow tinting': 'Brow Tinting',
  'lash tint': 'Lash Tinting',
  'eyelash tint': 'Lash Tinting',
  'face wax': 'Full Face Wax',
  olaplex: 'Olaplex Ritual',
};

// Generic filler/intent words that carry no service meaning. They must NOT contribute to token
// overlap — otherwise a noise word like "up" in "root touch up" falsely matches "Make-up" and
// "Up Do's" (each a 2-token name sharing only "up") and outranks the real service, "Gray Root
// Retouch". None of the real service names reduce to empty after stripping these (e.g. "Up Do's"
// still keeps "dos", "Make-up" keeps "make"), and their common phrasings are alias/exact-covered.
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'for', 'to', 'with', 'my', 'your', 'please',
  'up', 'some', 'i', 'id', 'need', 'want', 'get', 'got', 'book', 'booking', 'schedule',
  'appointment', 'appt', 'like', 'would', 'can', 'could', 'do', 'have',
  // Fragment fillers in follow-up answers ("just a cut", "only the cut", "plain trim"). Safe:
  // no service name contains these. ("regular"/"no" are intentionally NOT here — they appear in
  // "Regular Blowout" / "Gray Retouch No Blowdry".)
  'just', 'only', 'plain', 'simple',
]);

function tokenize(s) {
  const all = normalize(s).split(' ').filter(Boolean);
  const kept = all.filter((t) => !STOPWORDS.has(t));
  // Never let stopword stripping zero out a name/query entirely — fall back to the raw tokens.
  return kept.length ? kept : all;
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
  // "Real" candidates share at least one whole word with the query (score >= 2). We only ever
  // ask the caller to choose among these — never among zero-overlap junk matches.
  const real = ranked.filter((r) => r.sc >= 2).slice(0, 3).map((r) => ({ index: r.s.index, name: r.s.name }));
  const candidates = real.length ? real : ranked.slice(0, 3).map((r) => ({ index: r.s.index, name: r.s.name }));

  // Confident if the top match shares real tokens and clearly beats the runner-up.
  if (best && best.sc >= 2 && (!second || best.sc - second.sc >= 1)) {
    return { match: toResult(best.s), candidates, ambiguous: false };
  }
  // Ambiguous = two or more PLAUSIBLE menu services with comparable scores (e.g. "haircut",
  // "gray retouch", "highlights"). The caller named a real service imprecisely and should be
  // asked which one. A lone weak partial (e.g. "lash lift" grazing "Lash Tinting") is NOT
  // ambiguous — best.sc>=2 but second.sc<2 — so it still falls through to off-menu capture.
  const ambiguous = !!(best && second && best.sc >= 2 && second.sc >= 2 && best.sc - second.sc < 1);
  return { match: null, candidates, ambiguous };
}

/**
 * Resolve multiple service names for a combo appointment (e.g. cut + color). Returns the matched
 * services and any that couldn't be resolved, so the caller can be asked to clarify.
 * @returns {{ matches: object[], unresolved: {input:string, candidates:object[]}[] }}
 */
function resolveServices(names, serviceJSON) {
  const matches = [];
  const unresolved = [];
  for (const n of names || []) {
    if (!n || !String(n).trim()) continue;
    const r = resolveService(n, serviceJSON);
    if (r.match) matches.push(r.match);
    else unresolved.push({ input: String(n).trim(), candidates: r.candidates, ambiguous: r.ambiguous });
  }
  return { matches, unresolved };
}

/**
 * Narrow a caller's follow-up fragment ("just a cut", "the one with style", "no style", "women's")
 * to ONE of a small set of options the assistant ALREADY offered. This is the dialog-state fix:
 * resolve_service is stateless, so when the assistant has asked "Women's Cut or Women's Cut & Style?"
 * and the caller replies with a fragment, it re-calls resolve_service with `among` = those options.
 * We then pick deterministically instead of the model restarting the whole men/women/kids question.
 *
 * Returns `narrowed:false` when the fragment doesn't match ANY offered option (e.g. the caller
 * changed their mind — "actually, men's") so the caller can fall back to full-menu resolution.
 *
 * @param {string} phrase
 * @param {string[]} amongNames  the option names just offered to the caller
 * @param {Array} serviceJSON
 * @returns {{match:object|null, candidates:{index:number,name:string}[], ambiguous:boolean, narrowed:boolean}}
 */
function resolveAmong(phrase, amongNames, serviceJSON) {
  const miss = { match: null, candidates: [], ambiguous: false, narrowed: false };
  // Resolve each offered option to a real menu service (keeps posID/duration), de-duped.
  const options = [];
  const seen = new Set();
  for (const nm of amongNames || []) {
    const r = resolveService(nm, serviceJSON);
    if (r.match && !seen.has(r.match.index)) {
      seen.add(r.match.index);
      options.push(r.match);
    }
  }
  if (options.length < 2) return miss; // nothing meaningful to narrow between

  const q = normalize(phrase);
  const qTokens = tokenize(q);
  const hasStyle = (o) => /\bstyle\b/.test(normalize(o.name));
  // "no style"/"without style" must win over the bare "style" token they contain.
  const noStyle = /\bno\s+style\b|\bwithout\s+style\b/.test(q);
  const mentionsStyle = !noStyle && (qTokens.includes('style') || /\bstyle\b|\bblow\s?dr|\bblowout\b/.test(q));
  // "just/only/plain/simple" already strip to nothing-but-the-core via STOPWORDS, so also treat a
  // fragment that reduced to a bare core word (e.g. "just a cut" -> ["cut"]) as a plain request.
  const wantsPlain = noStyle || (!mentionsStyle && /\b(just|only|plain|simple)\b/.test(q));
  const done = (o) => ({ match: o, candidates: [{ index: o.index, name: o.name }], ambiguous: false, narrowed: true });

  // Explicit style preference resolves the classic "Cut vs Cut & Style" fork outright.
  if (mentionsStyle) {
    const styled = options.filter(hasStyle);
    if (styled.length === 1) return done(styled[0]);
  }
  if (wantsPlain) {
    const plain = options
      .filter((o) => !hasStyle(o))
      .sort((a, b) => tokenize(normalize(a.name)).length - tokenize(normalize(b.name)).length);
    if (plain.length) return done(plain[0]);
  }

  // Otherwise score the fragment against ONLY the offered options.
  const ranked = options
    .map((o) => ({ o, sc: score(qTokens, tokenize(normalize(o.name))) }))
    .sort((a, b) => b.sc - a.sc);
  const best = ranked[0];
  const second = ranked[1];
  if (!best || best.sc < 2) return miss; // fragment matches none of the options -> fall through
  if (!second || best.sc - second.sc >= 0.25) return done(best.o);
  // Real overlap but still tied -> repeat the choice, but ONLY among the offered options.
  return { match: null, candidates: options.map((o) => ({ index: o.index, name: o.name })), ambiguous: true, narrowed: true };
}

// Cents -> spoken dollar amount, dropping a trailing .00 ("$35", "$27.50").
function formatPrice(cents) {
  const dollars = (cents || 0) / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

module.exports = { resolveService, resolveServices, resolveAmong, durationToMinutes, normalize, formatPrice };
