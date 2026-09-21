// Compatibility scoring for the paid POST /match/compatibility endpoint.
//
// Uses the same optional OpenAI-compatible LLM as Cupid (CUPID_LLM_*), and
// falls back to a deterministic heuristic so the endpoint always answers.

const SYSTEM_PROMPT =
  "You are a dating compatibility analyst. Given two profiles, return JSON only " +
  "with keys: score (integer 0-100), reasons (2-4 short strings), friction (0-2 " +
  "short strings), icebreaker (one friendly sentence). Base the score only on the " +
  "information provided: intent alignment, shared interests, and complementary " +
  "traits. Never comment on appearance, ethnicity, religion, or other sensitive " +
  "attributes.";

const clean = (s, max) => String(s ?? "").trim().slice(0, max);

// Returns { error } for bad input, otherwise { profileA, profileB } normalized.
export function parseProfiles(body) {
  const out = {};
  for (const key of ["profileA", "profileB"]) {
    const p = body?.[key];
    if (!p || typeof p !== "object") return { error: `${key} is required` };
    const age = Number(p.age);
    if (!Number.isFinite(age)) return { error: `${key}.age is required` };
    if (age < 18) return { error: "Both profiles must be 18 or older" };
    out[key] = {
      name: clean(p.name, 60) || "Someone",
      age: Math.round(age),
      bio: clean(p.bio, 600),
      interests: (Array.isArray(p.interests) ? p.interests : [])
        .slice(0, 20)
        .map((i) => clean(i, 40))
        .filter(Boolean),
      lookingFor: clean(p.lookingFor, 80),
    };
  }
  return out;
}

export async function compatibility(a, b) {
  if (process.env.CUPID_LLM_URL && process.env.CUPID_LLM_KEY) {
    try {
      return await llmCompatibility(a, b);
    } catch (err) {
      console.warn("[compat] LLM call failed, using heuristic:", err.message);
    }
  }
  return heuristicCompatibility(a, b);
}

async function llmCompatibility(a, b) {
  const res = await fetch(process.env.CUPID_LLM_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.CUPID_LLM_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.CUPID_LLM_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify({ profileA: a, profileB: b }) },
      ],
      max_tokens: 400,
      temperature: 0.6,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("empty completion");
  const parsed = JSON.parse(text.replace(/^```(?:json)?|```$/g, "").trim());
  const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score))));
  if (!Number.isFinite(score) || !Array.isArray(parsed.reasons)) throw new Error("bad shape");
  return {
    score,
    reasons: parsed.reasons.slice(0, 4).map(String),
    friction: (Array.isArray(parsed.friction) ? parsed.friction : []).slice(0, 2).map(String),
    icebreaker: String(parsed.icebreaker || ""),
  };
}

function heuristicCompatibility(a, b) {
  const setA = new Set(a.interests.map((i) => i.toLowerCase()));
  const shared = b.interests.filter((i) => setA.has(i.toLowerCase()));
  const sameIntent =
    a.lookingFor && b.lookingFor && a.lookingFor.toLowerCase() === b.lookingFor.toLowerCase();
  const ageGap = Math.abs(a.age - b.age);

  let score = 50;
  score += Math.min(shared.length, 4) * 8;
  if (sameIntent) score += 12;
  else if (a.lookingFor && b.lookingFor) score -= 10;
  score -= Math.max(0, ageGap - 8);
  score = Math.max(5, Math.min(98, score));

  const reasons = [];
  if (sameIntent) reasons.push(`Both are looking for: ${a.lookingFor}`);
  if (shared.length) reasons.push(`Shared interests: ${shared.join(", ")}`);
  if (ageGap <= 5) reasons.push("Close in age, so similar life stages");
  if (!reasons.length) reasons.push("Different backgrounds could make for fresh conversation");

  const friction = [];
  if (a.lookingFor && b.lookingFor && !sameIntent)
    friction.push(`Different goals (${a.lookingFor} vs ${b.lookingFor}) are worth discussing early`);
  if (ageGap > 10) friction.push("A larger age gap may mean different priorities");

  const hook = shared[0] || b.interests[0] || a.interests[0];
  const icebreaker = hook
    ? `${hook}: what's your best story involving it?`
    : "What's something you're unexpectedly passionate about?";

  return { score, reasons: reasons.slice(0, 4), friction: friction.slice(0, 2), icebreaker };
}
