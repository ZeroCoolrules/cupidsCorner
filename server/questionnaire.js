// The compatibility questionnaire.
//
// Around forty questions on the things new couples most often trip over:
// how they talk and argue, money, family, pace, daily life, affection,
// values, plans and trust. For each one a member picks their own answer and
// says how much it matters that a partner is close to them on it.
//
// Two members' answers give a compatibility score:
//   - On each question both answered, "closeness" is 1 when the answers are
//     the same and falls toward 0 the further apart they are.
//   - Each person's side is the average closeness weighted by how much each
//     question matters to *them*. A must-have counts far more than a
//     nice-to-have.
//   - The pair's score is the geometric mean of the two sides, so it is only
//     high when the fit works for both people.
//
// The score feeds the Discover ranking (see matching.js) and is shown, with a
// breakdown by area, on a member's profile. Individual answers are private:
// nobody else is ever shown what a member answered, only which topics the two
// of them line up on and which are worth talking about early.
//
// Every question is optional. All wording here is our own.

import { db } from "./db.js";

// Fewer shared questions than this and we don't show a score at all.
export const QUIZ_MIN_SHARED = 8;
// How much weight a question gets: doesn't matter, a little, a lot, must-have.
const IMPORTANCE_WEIGHT = [0, 1, 4, 12];
export const IMPORTANCE_LABELS = ["Doesn't matter", "A little", "A lot", "Must match"];

// kind "scale": the options run in order, so nearby answers are a partial fit.
// kind "choice": the options are just different, so only the same answer fits.
const q = (key, text, options, kind = "scale") => ({ key, text, options, kind });

export const QUIZ_AREAS = [
  {
    key: "talk",
    title: "Talking and arguing",
    blurb: "Most early fights are about how you fight.",
    questions: [
      q("talk_raise", "When something bothers me, I usually…", ["Bring it up right away", "Bring it up once I've cooled off", "Wait and see if it passes", "Keep it to myself"]),
      q("talk_after", "After an argument, I need…", ["To talk it out straight away", "A short break, then talk", "A day or so to myself", "To move on without going back over it"]),
      q("talk_contact", "How often do you like to be in touch with someone you're dating?", ["All through the day", "A few times a day", "Once a day", "Every few days"]),
      q("talk_feedback", "Hearing honest criticism from a partner is…", ["Welcome, just say it", "Fine if it's gentle", "Hard, but I try", "Something I'd rather avoid"]),
      q("talk_stress", "When I'm stressed, I want a partner to…", ["Listen", "Help me fix it", "Take my mind off it", "Give me space"], "choice"),
    ],
  },
  {
    key: "money",
    title: "Money",
    blurb: "Easier to talk about now than later.",
    questions: [
      q("money_style", "My approach to money is closest to…", ["Save first, spend what's left", "Mostly save, with some treats", "An even balance", "Enjoy it now"]),
      q("money_shared", "In a serious relationship, finances should be…", ["Fully shared", "Mostly shared, some of our own", "Mostly separate, one shared pot", "Fully separate"]),
      q("money_debt", "Debt (cards, loans) in a partner is…", ["Not a concern", "Fine if there's a plan", "A worry", "A dealbreaker"]),
      q("money_dates", "On dates, who pays?", ["Whoever asked", "We split it", "We take turns", "I like to pay", "I like to be treated"], "choice"),
    ],
  },
  {
    key: "family",
    title: "Family and children",
    blurb: "The big ones. Honest answers save everyone time.",
    questions: [
      q("family_kids", "Children in my future:", ["Definitely want", "Probably want", "Not sure", "Probably not", "Definitely not"]),
      q("family_stepkids", "Dating someone who already has children:", ["Happy to", "Open to it", "Unsure", "Not for me"]),
      q("family_close", "How involved is your family in your life?", ["Very, we talk most days", "Close, about weekly", "Now and then", "Rarely"]),
      q("family_marriage", "Marriage is…", ["A goal for me", "Likely someday", "Not needed if we're committed", "Not for me"]),
    ],
  },
  {
    key: "pace",
    title: "Pace",
    blurb: "Wanting the same thing at different speeds is still a mismatch.",
    questions: [
      q("pace_goal", "What are you here for?", ["A life partner", "A serious relationship", "Dating and seeing where it goes", "Something casual"]),
      q("pace_exclusive", "How soon do you like to be exclusive?", ["After a date or two", "After a few weeks", "After a couple of months", "Whenever it happens"]),
      q("pace_meet", "How soon do you like to meet in person after matching?", ["Within days", "A week or two", "A few weeks", "Once I really know them"]),
      q("pace_movein", "Moving in together should come…", ["Within a year", "After a year or two", "After engagement or marriage", "Maybe never"]),
    ],
  },
  {
    key: "life",
    title: "Day to day",
    blurb: "The small habits you'd be living with.",
    questions: [
      q("life_weekend", "A good weekend is mostly…", ["Out with people", "A mix, leaning out", "A mix, leaning home", "At home"]),
      q("life_clock", "I'm…", ["An early bird", "Mostly a morning person", "Mostly a night person", "A night owl"]),
      q("life_drink", "Drinking:", ["Never", "Rarely", "Socially", "Often"]),
      q("life_tidy", "My space is usually…", ["Spotless", "Tidy", "Lived-in", "Messy"]),
      q("life_active", "Staying active:", ["Most days", "A few times a week", "Now and then", "Not my thing"]),
    ],
  },
  {
    key: "affection",
    title: "Affection and closeness",
    blurb: "How you show it and how much room you need.",
    questions: [
      q("aff_language", "I feel most cared for through…", ["Kind words", "Time together", "Thoughtful gestures", "Physical affection", "Help with everyday things"], "choice"),
      q("aff_public", "Affection in public:", ["Love it", "Comfortable with it", "A little is fine", "I prefer private"]),
      q("aff_intimacy", "Physical intimacy in a relationship is…", ["Essential", "Important", "Nice, but not central", "Not a focus for me"]),
      q("aff_space", "Time apart for my own friends and hobbies:", ["I need a lot", "I need some", "A little is enough", "I'd rather do most things together"]),
    ],
  },
  {
    key: "values",
    title: "Values",
    blurb: "What you won't bend on.",
    questions: [
      q("val_faith", "Faith or spirituality in my life:", ["Central", "Important", "A small part", "Not part of it"]),
      q("val_politics", "Politics between partners:", ["We need to agree", "We should mostly agree", "Differences are fine", "We'd just not discuss it"]),
      q("val_honesty", "Honesty, even when it stings:", ["Always", "Usually", "It depends", "Kindness comes first"]),
      q("val_new", "Trying new things (food, places, ideas):", ["Always up for it", "Often", "Sometimes", "I like what I know"]),
    ],
  },
  {
    key: "future",
    title: "Plans",
    blurb: "Where you're each headed.",
    questions: [
      q("fut_place", "Where I want to live long term:", ["Right where I am", "Somewhere in this region", "Open to moving", "I want to move away"]),
      q("fut_home", "My ideal home is in…", ["A city", "A suburb", "A small town", "The country"]),
      q("fut_career", "Career and ambition:", ["My top priority right now", "Important, kept in balance", "I work to live", "Not a focus"]),
      q("fut_pets", "Pets:", ["I have them, must love them", "I'd like some", "Fine either way", "I'd rather not"]),
    ],
  },
  {
    key: "trust",
    title: "Trust",
    blurb: "Boundaries are easier to agree on before they're tested.",
    questions: [
      q("trust_exes", "Staying friends with exes:", ["Totally fine", "Fine with boundaries", "Uncomfortable", "Not okay"]),
      q("trust_phones", "Sharing phone passwords and locations:", ["Open book", "Happy to if asked", "I prefer privacy", "No"]),
      q("trust_jealous", "Jealousy, for me, is…", ["Rare", "Occasional", "Something I'm working on", "Frequent"]),
    ],
  },
];

const QUESTIONS = new Map();
for (const area of QUIZ_AREAS) for (const question of area.questions) QUESTIONS.set(question.key, { ...question, area: area.key });
export const QUIZ_TOTAL = QUESTIONS.size;

export async function initQuestionnaire() {
  await db.schema(`
    CREATE TABLE IF NOT EXISTS quiz_answers (
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      question_key TEXT NOT NULL,
      answer       INTEGER NOT NULL,
      importance   INTEGER NOT NULL DEFAULT 1,
      updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, question_key)
    );
    CREATE INDEX IF NOT EXISTS idx_quiz_answers_question ON quiz_answers(question_key, answer);
  `);
}

const zq = {
  of: db.prepare("SELECT question_key, answer, importance FROM quiz_answers WHERE user_id = ?"),
  set: db.prepare(`
    INSERT INTO quiz_answers (user_id, question_key, answer, importance) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, question_key) DO UPDATE
      SET answer = excluded.answer, importance = excluded.importance, updated_at = datetime('now')
  `),
  clear: db.prepare("DELETE FROM quiz_answers WHERE user_id = ? AND question_key = ?"),
  tally: db.prepare(`
    SELECT question_key, answer, COUNT(*) AS n, SUM(importance) AS importance_sum,
           SUM(CASE WHEN importance = 3 THEN 1 ELSE 0 END) AS must
    FROM quiz_answers GROUP BY question_key, answer
  `),
  members: db.prepare("SELECT COUNT(DISTINCT user_id) AS c FROM quiz_answers"),
};

// A member's answers as { question_key: { answer, importance } }, valid ones only.
function toMap(rows) {
  const out = {};
  for (const r of rows) {
    const question = QUESTIONS.get(r.question_key);
    const answer = Number(r.answer);
    if (!question || !(answer >= 0 && answer < question.options.length)) continue;
    out[r.question_key] = { answer, importance: Math.min(3, Math.max(0, Number(r.importance) || 0)) };
  }
  return out;
}

export async function quizAnswersOf(userId) {
  return toMap(await zq.of.all(userId));
}

// Answers for many members in one query: Map(userId -> answers).
export async function quizAnswersFor(userIds) {
  const ids = [...new Set(userIds.map(Number).filter(Number.isFinite))];
  const byUser = new Map();
  if (ids.length === 0) return byUser;
  const rows = await db
    .prepare(`SELECT user_id, question_key, answer, importance FROM quiz_answers WHERE user_id IN (${ids.map(() => "?").join(",")})`)
    .all(...ids);
  const grouped = new Map();
  for (const r of rows) {
    if (!grouped.has(r.user_id)) grouped.set(r.user_id, []);
    grouped.get(r.user_id).push(r);
  }
  for (const [id, list] of grouped) byUser.set(Number(id), toMap(list));
  return byUser;
}

function closeness(question, a, b) {
  if (question.kind === "choice") return a === b ? 1 : 0;
  return 1 - Math.abs(a - b) / (question.options.length - 1);
}

// Compares two members' answers. Returns { ready: false, shared } until they
// have enough questions in common, then the score and its breakdown. Pure.
export function compareAnswers(mine, theirs) {
  const shared = [];
  for (const [key, a] of Object.entries(mine || {})) {
    const b = theirs?.[key];
    const question = QUESTIONS.get(key);
    if (!b || !question) continue;
    shared.push({ question, close: closeness(question, a.answer, b.answer), wMine: IMPORTANCE_WEIGHT[a.importance], wTheirs: IMPORTANCE_WEIGHT[b.importance], iMine: a.importance, iTheirs: b.importance });
  }
  if (shared.length < QUIZ_MIN_SHARED) return { ready: false, shared: shared.length, needed: QUIZ_MIN_SHARED };

  // One side's satisfaction: closeness weighted by what matters to that side.
  // With nothing marked as mattering, fall back to a plain average.
  const side = (list, w) => {
    const total = list.reduce((n, s) => n + s[w], 0);
    if (total === 0) return list.reduce((n, s) => n + s.close, 0) / list.length;
    return list.reduce((n, s) => n + s[w] * s.close, 0) / total;
  };
  const pair = (list) => Math.sqrt(side(list, "wMine") * side(list, "wTheirs"));
  const pct = (x) => Math.round(x * 100);

  const areas = QUIZ_AREAS.map((area) => {
    const list = shared.filter((s) => s.question.area === area.key);
    return list.length ? { key: area.key, title: area.title, percent: pct(pair(list)), shared: list.length } : null;
  }).filter(Boolean);

  const matters = (s) => Math.max(s.iMine, s.iTheirs);
  // Same or nearly the same, on something at least one of them cares about.
  const strengths = shared
    .filter((s) => s.close >= 0.75 && matters(s) >= 2)
    .sort((a, b) => matters(b) - matters(a) || b.close - a.close)
    .slice(0, 5)
    .map((s) => ({ key: s.question.key, text: s.question.text, area: s.question.area }));
  // Far apart, on something at least one of them cares a lot about.
  const talkAbout = shared
    .filter((s) => s.close <= 0.4 && matters(s) >= 2)
    .sort((a, b) => matters(b) - matters(a) || a.close - b.close)
    .slice(0, 5)
    .map((s) => ({ key: s.question.key, text: s.question.text, area: s.question.area, mustHave: matters(s) === 3 }));

  return { ready: true, percent: pct(pair(shared)), shared: shared.length, areas, strengths, talkAbout };
}

export function registerQuestionnaireRoutes(app, { auth, adminOnly, q: queries, rateLimit }) {
  const saveLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, message: "Slow down a little and try again in a minute." });

  const sheet = async (userId) => {
    const answers = await quizAnswersOf(userId);
    return {
      areas: QUIZ_AREAS.map((a) => ({ key: a.key, title: a.title, blurb: a.blurb, questions: a.questions })),
      importance: IMPORTANCE_LABELS,
      answers,
      answered: Object.keys(answers).length,
      total: QUIZ_TOTAL,
      minShared: QUIZ_MIN_SHARED,
    };
  };

  app.get("/api/quiz", auth, async (req, res) => {
    res.json(await sheet(req.userId));
  });

  // { answers: { question_key: { answer: 0-based option, importance: 0-3 } | null } }
  // null clears an answer. Unknown questions are ignored.
  app.put("/api/quiz/answers", auth, saveLimiter, async (req, res) => {
    const incoming = req.body?.answers;
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
      return res.status(400).json({ error: "Send your answers as { answers: { question: { answer, importance } } }." });
    }
    const todo = [];
    for (const [key, value] of Object.entries(incoming).slice(0, 200)) {
      const question = QUESTIONS.get(key);
      if (!question) continue;
      if (value === null) {
        todo.push([key, null]);
        continue;
      }
      const answer = Number(value?.answer);
      const importance = value?.importance === undefined ? 1 : Number(value.importance);
      if (!Number.isInteger(answer) || answer < 0 || answer >= question.options.length || !Number.isInteger(importance) || importance < 0 || importance > 3) {
        return res.status(400).json({ error: `That isn't a valid answer for "${question.text}"` });
      }
      todo.push([key, { answer, importance }]);
    }
    for (const [key, value] of todo) {
      if (value) await zq.set.run(req.userId, key, value.answer, value.importance);
      else await zq.clear.run(req.userId, key);
    }
    const answers = await quizAnswersOf(req.userId);
    res.json({ answers, answered: Object.keys(answers).length, total: QUIZ_TOTAL });
  });

  // How the signed-in member and another member fit. Never returns the other
  // member's answers, only topics.
  app.get("/api/users/:id/compatibility", auth, async (req, res) => {
    const id = Number(req.params.id);
    const target = await queries.userById.get(id);
    if (!target || target.banned_at || id === req.userId) return res.status(404).json({ error: "no such user" });
    if (await queries.isBlocked.get(req.userId, id, id, req.userId)) return res.status(404).json({ error: "no such user" });
    const mine = await quizAnswersOf(req.userId);
    const theirs = await quizAnswersOf(id);
    res.json({
      ...compareAnswers(mine, theirs),
      mineAnswered: Object.keys(mine).length,
      theirsAnswered: Object.keys(theirs).length,
      total: QUIZ_TOTAL,
    });
  });

  // For admins: what members as a whole answered, with no names attached.
  // Shows what people here are looking for and what they won't bend on.
  app.get("/api/admin/quiz/insights", auth, adminOnly, async (req, res) => {
    const tally = new Map();
    for (const r of await zq.tally.all()) {
      if (!tally.has(r.question_key)) tally.set(r.question_key, []);
      tally.get(r.question_key).push(r);
    }
    res.json({
      members: Number((await zq.members.get()).c),
      total: QUIZ_TOTAL,
      areas: QUIZ_AREAS.map((area) => ({
        key: area.key,
        title: area.title,
        questions: area.questions.map((question) => {
          const rows = tally.get(question.key) || [];
          const n = rows.reduce((sum, r) => sum + Number(r.n), 0);
          return {
            key: question.key,
            text: question.text,
            answered: n,
            mustMatch: rows.reduce((sum, r) => sum + Number(r.must), 0),
            avgImportance: n ? Math.round((rows.reduce((sum, r) => sum + Number(r.importance_sum), 0) / n) * 10) / 10 : 0,
            options: question.options.map((label, i) => ({ label, count: Number(rows.find((r) => Number(r.answer) === i)?.n || 0) })),
          };
        }),
      })),
    });
  });
}
