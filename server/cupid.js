// Cupid — the in-app AI matchmaker.
//
// This ships with a self-contained, no-API-key "heuristic" brain so the app
// works offline out of the box. To use a real LLM instead, set the env vars
// below and Cupid will call it, falling back to the heuristic on any error.
//
//   CUPID_LLM_URL   e.g. https://api.openai.com/v1/chat/completions
//   CUPID_LLM_KEY   your bearer token
//   CUPID_LLM_MODEL e.g. gpt-4o-mini  (default: gpt-4o-mini)

const SYSTEM_PROMPT =
  "You are Cupid, the flirty, warm, encouraging AI matchmaker inside a dating " +
  "app called Cupid's Corner. Give short, punchy, practical dating advice with " +
  "a wink. 1-3 sentences. Never be creepy or pushy; champion consent and honesty.";

export async function cupidReply(userText, history = []) {
  if (process.env.CUPID_LLM_URL && process.env.CUPID_LLM_KEY) {
    try {
      return await llmReply(userText, history);
    } catch (err) {
      console.warn("[cupid] LLM call failed, using heuristic:", err.message);
    }
  }
  return heuristicReply(userText);
}

async function llmReply(userText, history) {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.slice(-10).map((m) => ({
      role: m.kind === "ai" ? "assistant" : "user",
      content: m.body,
    })),
    { role: "user", content: userText },
  ];
  const res = await fetch(process.env.CUPID_LLM_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.CUPID_LLM_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.CUPID_LLM_MODEL || "gpt-4o-mini",
      messages,
      max_tokens: 160,
      temperature: 0.9,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("empty completion");
  return text;
}

// ---------------------------------------------------------------------------
// Heuristic brain
// ---------------------------------------------------------------------------

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const RULES = [
  {
    test: /\b(nervous|anxious|scared|shy|worried)\b/i,
    lines: [
      "Nerves just mean you care. Take one slow breath, ask them a question about themselves, and let curiosity do the heavy lifting. 💘",
      "A little shaky is charming, trust me. Aim to be interested, not impressive — it takes all the pressure off.",
    ],
  },
  {
    test: /\b(first date|firstdate|date idea|where should we|what should we do)\b/i,
    lines: [
      "Pick something with a built-in exit and a little to do: a coffee walk, a small museum, a food market. Low stakes, easy conversation.",
      "Daytime, public, 60–90 minutes, something you can talk over. If it's going well you extend it; if not, you both get your evening back.",
    ],
  },
  {
    test: /\b(text|texting|message|reply|respond|double text)\b/i,
    lines: [
      "Match their energy and length, reference something specific they said, and end on a question. Double texting once is totally fine — desperation is a tone, not a number.",
      "Good text = a callback to your last chat + a hook. \"Still thinking about your terrible pizza take — defend yourself over drinks Thursday?\"",
    ],
  },
  {
    test: /\b(opener|open with|say hi|start a conversation|ice ?breaker|what do i say)\b/i,
    lines: [
      "Skip \"hey.\" Grab one detail from their profile and react to it: \"A rock climber who bakes sourdough? Which one are you better at?\"",
      "Ask something they'll enjoy answering. Specific beats clever every time.",
    ],
  },
  {
    test: /\b(ghost|ghosted|stopped replying|left on read|no response)\b/i,
    lines: [
      "Ghosting says more about their communication skills than your worth. Send one light check-in if you want closure, then close the tab and move on. 💔→💘",
      "One follow-up is self-respect; three is a group project they didn't sign up for. Give it a day, then let it go.",
    ],
  },
  {
    test: /\b(breakup|broke up|ex|heartbroken|dumped|rejected)\b/i,
    lines: [
      "Be gentle with yourself this week — rejection is redirection. When you're ready, come back and I'll help you write a profile that actually sounds like you.",
      "Grieve it properly, then get curious again. The right person won't require you to shrink.",
    ],
  },
  {
    test: /\b(bio|profile|about me|what to write|describe myself)\b/i,
    lines: [
      "Three concrete things you love + one playful invitation. \"Trail runs, obscure documentaries, and aggressively themed dinner parties. Bring a strong opinion about breakfast.\"",
      "Show, don't list. Instead of \"adventurous,\" say \"last trip: got lost in Lisbon on purpose.\"",
    ],
  },
  {
    test: /\b(compliment|flirt|flirting|charming|rizz)\b/i,
    lines: [
      "Best flirting is specific and low-pressure: notice something only they would've said or done, and name it with a smile.",
      "Tease the thing they're a little proud of. Warmth + a raised eyebrow = chemistry.",
    ],
  },
  {
    test: /\b(exclusive|the talk|define the relationship|dtr|serious|commit)\b/i,
    lines: [
      "Say it plainly and kindly: \"I really like where this is going and I'd like to be exclusive. How do you feel?\" Clarity is a gift.",
      "If naming what you want scares them off, it was doing you a favor early.",
    ],
  },
  {
    test: /\b(match|matched|no matches|not matching|no one likes)\b/i,
    lines: [
      "Fresh photos, one shot of your face smiling, cut the sunglasses group pic. Then like intentionally, not endlessly — quality of attention shows.",
      "Slow matches usually means the profile is playing it too safe. Add one weird, true detail and watch it change.",
    ],
  },
  {
    test: /\b(thank|thanks|helpful|love you|great advice)\b/i,
    lines: [
      "Anytime. Go be brave out there. 💘",
      "That's what I'm here for. Now go send the message you're overthinking.",
    ],
  },
  {
    test: /\b(hi|hey|hello|yo|sup)\b/i,
    lines: [
      "Hey you. What's the romantic emergency — or are we just plotting? 💘",
      "Hi! Tell me who's caught your eye and what you're stuck on.",
    ],
  },
];

const GENERIC = [
  "Tell me a bit more — who's involved, and what outcome are you hoping for? I give better advice with details. 💘",
  "Here's my rule of thumb: be direct about what you want, generous about what they want, and unbothered by the rest.",
  "Say the honest version, a little softer. That's usually the move.",
  "Lead with curiosity. People fall for the way you make them feel about themselves.",
  "Whatever you're about to overthink — send it, but shorter and warmer.",
];

export function heuristicReply(userText) {
  const text = String(userText || "");
  for (const rule of RULES) {
    if (rule.test.test(text)) return pick(rule.lines);
  }
  return pick(GENERIC);
}

export const CUPID_WELCOME =
  "I'm Cupid, your personal matchmaker. 💘 Ask me anything — openers, first " +
  "dates, what that text meant, profile help. What's on your mind?";
