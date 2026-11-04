// Discover ranking: who to show, and in what order.
//
// Replaces the old "Premium first, then random" order with one score per
// candidate so the people most likely to match back come first. Every
// weight lives in WEIGHTS so it can be tuned in one place.
//
// Hard filters (never shown): under 18, blocked either way, already swiped,
// heavily reported, or outside either person's "looking for".

export const WEIGHTS = {
  sharedInterest: 7, // per shared interest
  sharedInterestMax: 28,
  sameCity: 10,
  likedYou: 15, // they already liked you, so a like from you is a match
  activeToday: 10,
  activeThisWeek: 5,
  inactiveMonth: -12,
  verified: 8,
  completeProfile: 10, // photo + bio + at least one prompt
  newMember: 6, // joined in the last 7 days: give them a fair first look
  premium: 12, // paid boost, but it can't bury a much better fit
  ageGapFreeYears: 5, // no penalty inside this gap
  ageGapPerYear: -2,
  ageGapMax: -20,
  jitter: 4, // small randomness so the deck isn't identical every visit
};

export const REPORTS_TO_HIDE = 3;

const WOMEN = /\b(women|woman|female|females|girls?|ladies|lady)\b/i;
const MEN = /\b(men|man|male|males|guys?)\b/i;
const ANYONE = /\b(everyone|anyone|all|both|any|open)\b/i;

function genderBucket(gender) {
  const g = String(gender || "");
  if (WOMEN.test(g)) return "w";
  if (MEN.test(g)) return "m";
  return null; // non-binary or unstated: no hard filter
}

// Would a seeker with this "looking for" / orientation text and gender want
// to see `targetGender`? Accepts either "women" / "men" / "everyone" or an
// orientation word (straight, gay, lesbian, bi, pan, queer). Free-text
// fields, so anything unrecognised passes rather than hiding people by mistake.
export function wants(lookingFor, seekerGender, targetGender) {
  const lf = String(lookingFor || "");
  const target = genderBucket(targetGender);
  if (!lf || !target || ANYONE.test(lf) || /\b(bi|bisexual|pan|pansexual|queer)\b/i.test(lf)) return true;
  const wantsW = WOMEN.test(lf);
  const wantsM = MEN.test(lf);
  if (wantsW || wantsM) return (target === "w" && wantsW) || (target === "m" && wantsM);
  const self = genderBucket(seekerGender);
  if (/\blesbian\b/i.test(lf)) return target === "w";
  if (!self) return true;
  if (/\bstraight\b|\bhetero/i.test(lf)) return target !== self;
  if (/\bgay\b|\bhomosexual\b/i.test(lf)) return target === self;
  return true; // e.g. "something serious"
}

function daysSince(sqlDate) {
  if (!sqlDate) return Infinity;
  const t = Date.parse(String(sqlDate).replace(" ", "T") + (String(sqlDate).endsWith("Z") ? "" : "Z"));
  return Number.isFinite(t) ? (Date.now() - t) / 86400000 : Infinity;
}

const parseList = (json) => {
  try {
    const v = JSON.parse(json || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

// me, c: profile rows (profiles table) plus c.created_at, c.liked_me,
// c.is_premium, c.report_count. Returns null when the candidate is filtered.
export function scoreCandidate(me, c, rand = Math.random) {
  if (!c.age || c.age < 18) return null;
  if ((c.report_count || 0) >= REPORTS_TO_HIDE) return null;
  if (!wants(me.orientation, me.gender, c.gender) || !wants(c.orientation, c.gender, me.gender)) return null;

  let score = 40;
  const reasons = [];

  const mine = new Set(parseList(me.interests).map((i) => String(i).toLowerCase()));
  const shared = parseList(c.interests).filter((i) => mine.has(String(i).toLowerCase()));
  if (shared.length) {
    score += Math.min(shared.length * WEIGHTS.sharedInterest, WEIGHTS.sharedInterestMax);
    reasons.push(`You both like ${shared.slice(0, 3).join(", ")}`);
  }

  if (me.city && c.city && me.city.trim().toLowerCase() === c.city.trim().toLowerCase()) {
    score += WEIGHTS.sameCity;
    reasons.push(`Also in ${c.city}`);
  }

  if (c.liked_me) score += WEIGHTS.likedYou; // not shown as a reason: Premium reveals likes

  const idle = daysSince(c.last_seen_at);
  if (idle <= 1) {
    score += WEIGHTS.activeToday;
    reasons.push("Active today");
  } else if (idle <= 7) score += WEIGHTS.activeThisWeek;
  else if (idle > 30) score += WEIGHTS.inactiveMonth;

  if (c.verified_at) {
    score += WEIGHTS.verified;
    reasons.push("Photo verified");
  }

  const hasPrompts = parseList(c.prompts).length > 0;
  if (c.photo_url && c.bio && hasPrompts) score += WEIGHTS.completeProfile;
  else score += Math.round(WEIGHTS.completeProfile * ([c.photo_url, c.bio, hasPrompts].filter(Boolean).length / 3));

  if (daysSince(c.created_at) <= 7) score += WEIGHTS.newMember;
  if (c.is_premium) score += WEIGHTS.premium;

  if (me.age && c.age) {
    const gap = Math.abs(me.age - c.age) - WEIGHTS.ageGapFreeYears;
    if (gap > 0) score += Math.max(WEIGHTS.ageGapMax, gap * WEIGHTS.ageGapPerYear);
  }

  score += rand() * WEIGHTS.jitter;
  return { score, reasons: reasons.slice(0, 3) };
}

// Turns a raw rank score into the 0-100 "match %" shown on the card.
export function matchPercent(score) {
  return Math.max(1, Math.min(99, Math.round(score)));
}
