import bcrypt from "bcryptjs";
import { db, initDb } from "./db.js";
import { CUPID_WELCOME } from "./cupid.js";
import { GIFT_BY_KEY } from "./gifts.js";

initDb();

const DEMO_PASSWORD = "password123";

const people = [
  { u: "ava",    n: "Ava",    age: 28, g: "woman",     o: "straight", city: "Brooklyn",   e: "🌻", c: "#7cc8ff", bio: "Ceramics, cold brew, and long arguments about movies I haven't finished.", i: ["pottery", "film", "hiking"] },
  { u: "leo",    n: "Leo",    age: 31, g: "man",       o: "bi",       city: "Oakland",    e: "🎸", c: "#5b8def", bio: "Plays in a band nobody's heard of. Will cook you breakfast.", i: ["music", "cooking", "vinyl"] },
  { u: "mira",   n: "Mira",   age: 26, g: "woman",     o: "queer",    city: "Austin",     e: "🌵", c: "#3ec6a0", bio: "Trail runner, taco scientist, aggressively good at trivia.", i: ["running", "tacos", "trivia"] },
  { u: "sam",    n: "Sam",    age: 34, g: "nonbinary", o: "pan",      city: "Chicago",    e: "📚", c: "#f4a259", bio: "Bookstore haunt. I will lend you a novel and expect a full report.", i: ["reading", "coffee", "cats"] },
  { u: "noah",   n: "Noah",   age: 29, g: "man",       o: "straight", city: "Denver",     e: "🏔️", c: "#7d5fff", bio: "Climbs rocks, bakes sourdough, terrible at texting first.", i: ["climbing", "baking", "dogs"] },
  { u: "priya",  n: "Priya",  age: 27, g: "woman",     o: "straight", city: "Seattle",    e: "🌧️", c: "#4dd0e1", bio: "Rain enthusiast. Museum dates or bust.", i: ["art", "museums", "kayaking"] },
  { u: "diego",  n: "Diego",  age: 33, g: "man",       o: "gay",      city: "Miami",      e: "🌊", c: "#06d6a0", bio: "Salsa on Fridays, beach cleanups on Sundays. Bring sunscreen.", i: ["dancing", "surfing", "volunteering"] },
  { u: "yuki",   n: "Yuki",   age: 30, g: "woman",     o: "bi",       city: "Portland",   e: "🍜", c: "#ffd166", bio: "Ramen cartographer. Ask me for the good spots.", i: ["food", "cycling", "photography"] },
  { u: "theo",   n: "Theo",   age: 25, g: "man",       o: "straight", city: "Nashville",  e: "🎺", c: "#118ab2", bio: "Jazz trumpet, bad puns, good dog.", i: ["jazz", "puns", "camping"] },
  { u: "cleo",   n: "Cleo",   age: 32, g: "woman",     o: "queer",    city: "Los Angeles",e: "🪩", c: "#90caf9", bio: "Costume designer. I have opinions about your Halloween plans.", i: ["design", "thrifting", "roller skating"] },
];

const findUser = db.prepare("SELECT * FROM users WHERE username = ?");
const insertUser = db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)");
const insertProfile = db.prepare(`
  INSERT INTO profiles (user_id, display_name, age, gender, orientation, bio, city, avatar_emoji, avatar_color, interests)
  VALUES (@user_id, @display_name, @age, @gender, @orientation, @bio, @city, @avatar_emoji, @avatar_color, @interests)
`);
const insertConv = db.prepare("INSERT INTO conversations (type, title, created_by) VALUES (?, ?, ?)");
const insertRoom = db.prepare(`
  INSERT INTO conversations (type, title, topic, emoji, color, is_public, created_by)
  VALUES ('room', ?, ?, ?, ?, 1, ?)
`);
const insertMember = db.prepare("INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING");
const insertMessage = db.prepare("INSERT INTO messages (conversation_id, sender_id, kind, body) VALUES (?, ?, ?, ?)");
const insertSwipe = db.prepare("INSERT INTO swipes (swiper_id, target_id, direction) VALUES (?, ?, 'like') ON CONFLICT DO NOTHING");
const insertMatch = db.prepare("INSERT INTO matches (user_a, user_b) VALUES (?, ?) ON CONFLICT DO NOTHING");
const upsertRating = db.prepare(`
  INSERT INTO ratings (rater_id, ratee_id, stars) VALUES (?, ?, ?)
  ON CONFLICT(rater_id, ratee_id) DO UPDATE SET stars = excluded.stars
`);
const addFan = db.prepare("INSERT INTO fans (fan_id, target_id) VALUES (?, ?) ON CONFLICT DO NOTHING");
const insertGift = db.prepare(
  "INSERT INTO gifts_sent (sender_id, recipient_id, gift_key, conversation_id) VALUES (?, ?, ?, ?)"
);
const spendSparks = db.prepare("UPDATE profiles SET sparks = sparks - ? WHERE user_id = ?");

const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);
const ids = {};

for (const p of people) {
  let row = findUser.get(p.u);
  if (!row) {
    const info = insertUser.run(p.u, hash);
    const id = Number(info.lastInsertRowid);
    insertProfile.run({
      user_id: id,
      display_name: p.n,
      age: p.age,
      gender: p.g,
      orientation: p.o,
      bio: p.bio,
      city: p.city,
      avatar_emoji: p.e,
      avatar_color: p.c,
      interests: JSON.stringify(p.i),
    });
    const conv = insertConv.run("ai", "Cupid", null);
    const cid = Number(conv.lastInsertRowid);
    insertMember.run(cid, id);
    insertMessage.run(cid, null, "ai", CUPID_WELCOME);
    row = findUser.get(p.u);
    console.log("created", p.u);
  }
  ids[p.u] = row.id;
}

// a couple of pre-baked matches + a group so the app looks alive
function matchAndDm(u1, u2, greeting) {
  const [a, b] = ids[u1] < ids[u2] ? [ids[u1], ids[u2]] : [ids[u2], ids[u1]];
  insertSwipe.run(ids[u1], ids[u2]);
  insertSwipe.run(ids[u2], ids[u1]);
  insertMatch.run(a, b);
  const existing = db
    .prepare(
      `SELECT c.id FROM conversations c
       JOIN conversation_members x ON x.conversation_id = c.id AND x.user_id = ?
       JOIN conversation_members y ON y.conversation_id = c.id AND y.user_id = ?
       WHERE c.type = 'dm' LIMIT 1`
    )
    .get(a, b);
  if (existing) return;
  const conv = insertConv.run("dm", "", ids[u1]);
  const cid = Number(conv.lastInsertRowid);
  insertMember.run(cid, a);
  insertMember.run(cid, b);
  insertMessage.run(cid, null, "system", "You matched! Say hello 👋");
  if (greeting) insertMessage.run(cid, ids[u1], "text", greeting);
}

matchAndDm("ava", "leo", "ok your band name — defend it over coffee?");
matchAndDm("mira", "noah", "trivia night thursday, you in?");

const groupExists = db
  .prepare("SELECT id FROM conversations WHERE type='group' AND title = ?")
  .get("Trivia Team");
if (!groupExists) {
  const conv = insertConv.run("group", "Trivia Team", ids["mira"]);
  const cid = Number(conv.lastInsertRowid);
  for (const u of ["mira", "noah", "theo"]) insertMember.run(cid, ids[u]);
  insertMessage.run(cid, null, "system", "Mira started the group.");
  insertMessage.run(cid, ids["mira"], "text", "Category draft: I call history.");
  insertMessage.run(cid, ids["theo"], "text", "Dibs on music. Obviously.");
}

// public webcam rooms — anyone can browse + join, no match required
const rooms = [
  { title: "Friday Night Lounge", topic: "Hang out, watch cams, say hi.", emoji: "🍸", color: "#7cc8ff", host: "ava", members: ["ava", "leo", "priya"] },
  { title: "Trivia Night", topic: "Weekly trivia — obscure categories only.", emoji: "🧠", color: "#3ec6a0", host: "mira", members: ["mira", "noah", "theo", "sam"] },
  { title: "Late Night Talk", topic: "Whoever's up, come chat.", emoji: "🌙", color: "#7d5fff", host: "diego", members: ["diego", "yuki", "cleo"] },
];
for (const r of rooms) {
  const existing = db.prepare("SELECT id FROM conversations WHERE type='room' AND title=?").get(r.title);
  if (existing) continue;
  const conv = insertRoom.run(r.title, r.topic, r.emoji, r.color, ids[r.host]);
  const cid = Number(conv.lastInsertRowid);
  for (const u of r.members) insertMember.run(cid, ids[u]);
  insertMessage.run(cid, null, "system", `${people.find((p) => p.u === r.host).n} opened the room.`);
  console.log("created room", r.title);
}

// a few ratings and fans so profiles don't look empty
const ratings = [
  ["leo", "ava", 5], ["priya", "ava", 4], ["noah", "mira", 5],
  ["theo", "mira", 5], ["ava", "leo", 4], ["cleo", "diego", 5],
];
for (const [from, to, stars] of ratings) upsertRating.run(ids[from], ids[to], stars);

const fanPairs = [
  ["leo", "ava"], ["priya", "ava"], ["noah", "ava"],
  ["theo", "mira"], ["sam", "mira"], ["cleo", "diego"], ["yuki", "diego"],
];
for (const [from, to] of fanPairs) addFan.run(ids[from], ids[to]);

// a couple of demo gifts (also debits the sender's starting sparks balance)
const demoGifts = [
  ["leo", "ava", "rose"],
  ["noah", "mira", "coffee"],
  ["theo", "mira", "bouquet"],
];
for (const [from, to, key] of demoGifts) {
  insertGift.run(ids[from], ids[to], key, null);
  spendSparks.run(GIFT_BY_KEY[key].cost, ids[from]);
}

console.log("\nSeed complete. Demo logins (password: %s):", DEMO_PASSWORD);
console.log(people.map((p) => "  " + p.u).join("\n"));
