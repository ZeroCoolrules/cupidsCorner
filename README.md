# Cupid's Corner 💘

A full-stack app that blends five things into one:

| From a dating app | From a webcam social site | From a messaging app | Social layer | From an AI companion |
| --- | --- | --- | --- | --- |
| Profiles, swipe discovery, filters, like/pass, mutual **matches**, "who liked you" | **Public rooms** — browse and join live, multi-person webcam rooms, no match needed (à la Cyber Friends) | Real-time DMs and group chats, backed by **Stream Chat** — typing, presence, read receipts, reactions | **Ratings**, **fans**, **gifts**, **Premium**, and real photos on every profile | **Cupid**, a built-in AI matchmaker you can chat with for advice |

A logged-out visitor lands on a real homepage (hero, live member/room/gift stats, feature grid) rather than a bare login form — that's the "presence" layer.

## One app from six repos

Cupid's Corner is now the single home for the dating projects. It already had the most complete feature set, so the others were folded into it:

| Repo | What it brought | What came over |
| --- | --- | --- |
| cupidsCorner | Swipe, matches, rooms, Stream chat and video, gifts, Premium, Stripe, Cupid AI | Base app |
| Bid-Love- | Date simulator with choices and chemistry | **Virtual dates** with your matches (`server/virtualDates.js`). Bidding on people and cashing tokens out were left behind on purpose. |
| dreamflirt_network | Identity verification and review | **Photo verification** with an admin review queue and a ✔ badge |
| emerald-connect-copy | Live streams, coins, gifts | Already covered by public rooms, gifts, and sparks |
| kikchat | Real-time chat, rooms, video tokens | Already covered by Stream chat, rooms, and calls |
| dating-pro | PG Dating Pro (a commercial, licensed script) | Nothing copied: its license doesn't allow reuse. Its paid features (memberships, pay-to-message, gifts) map to Premium, sparks, and gifts here. |

### How Discover ranks people

`server/matching.js` scores each candidate instead of showing Premium members first and the rest at random. Everyone under 18, blocked, already swiped, reported by 3+ people, or outside either person's "looking for" is filtered out. The rest are ranked by shared interests, same city, whether they already liked you, recent activity, verification, profile completeness, a new-member boost, Premium, and age gap. Cards show a match % and up to three reasons ("You both like film", "Also in Brooklyn"). All weights live in one `WEIGHTS` object.

### Safety additions

- Sign-up and profile edits require age 18+.
- Verification selfies are stored outside `/uploads`, only admins (`ADMIN_USERNAMES`) can view them, and they are deleted after review.

## Go Live (broadcasts)

The 📡 Live tab, built from the Social Streaming Rooms idea and DatingPro's live module, runs on the Stream keys the app already uses:

- **Backstage first.** The host's camera comes on privately. Viewers see nothing until the host taps **Start broadcast**. The host can pause and resume.
- **Co-hosts.** The host can invite up to 3 viewers on camera, and can remove them. A co-host can also leave the stage.
- **Live chat** runs beside the video. Viewers can chat without joining anything.
- **Gifts.** Sparks gifts go to the host or a co-host and show up in the chat. The stream keeps a running total.
- **Share.** The share sheet offers the phone's share menu, plus X, Facebook, WhatsApp, Telegram and copy link.
- Each host can run one stream at a time. Starting a new one ends the old one. When the host ends a stream, its chat is frozen.

## Feed and blog

**Feed** (`/feed`): members post a short update with an optional photo, and others like and comment. Blocks and bans apply as everywhere else, so you never see posts or comments from someone you blocked, who blocked you, or who is banned. Members delete their own posts; the post's author can remove comments under it; admins can remove anything. Reporting a post files a normal report against its author, so it shows up in the admin Reports queue.

**Blog** (`/blog`): articles written by admins (`ADMIN_USERNAMES`). Published articles are public with no sign-in, so they can be shared. Admins get a "Write an article" button on the blog page: title, summary, text with simple formatting (`## heading`, `- bullet`, `> quote`, `**bold**`, `*italic*`, `[text](https://link)`), a cover photo, and Save draft / Publish / Unpublish. Article text is rendered as plain elements, never as raw HTML.

API: `GET/POST /api/feed`, `DELETE /api/feed/:id`, `POST/DELETE /api/feed/:id/like`, `GET/POST /api/feed/:id/comments`, `DELETE /api/feed/comments/:id`, `POST /api/feed/:id/report`; public `GET /api/blog` and `GET /api/blog/:slug`; admin `GET/POST /api/admin/blog`, `GET/PUT/DELETE /api/admin/blog/:id`, `POST/DELETE /api/admin/blog/:id/cover`. All of it is also under `/api/v1`, so brand sites can show the same feed and blog. Code is in `server/social.js`; tables `feed_posts`, `feed_likes`, `feed_comments`, `blog_posts` are created at startup on SQLite and Postgres alike. Feed photos and blog covers are stored in `UPLOADS_DIR` with profile photos.

## Profile extras, winks, invites and meetups

**Profile questions.** Extra questions on a profile ("Height", "Wants children", "Pets"...). The list lives in the database with a starter set, and admins can add, rename, reorder and hide questions without a deploy. Sensitive topics are left out of the starter set on purpose.

**Photo albums and review queue.** Each member can add up to 12 album photos. An album photo stays hidden until an admin approves it. Profile pictures go live right away, as before, and join the same queue so an admin can still remove one. A removed photo's file is deleted and the member sees the reason.

**Winks.** A one-tap hello. Free members get 5 a day and Premium members 50, with one wink per person per day. Blocks and bans apply.

**Invite links.** Every member has a personal code. Someone who joins with it (`referralCode` on sign-up) gets 50 welcome sparks, and the inviter gets 100 sparks once that new member's first photo is approved. Tying the reward to an admin's check keeps throwaway sign-ups from farming sparks.

**Meetup board.** A member posts when they're free and what they'd like to do, and anyone can ask to join. The host decides who comes. The board shows only a general area; the exact place is a separate field that only the host and accepted guests can see. Blocks and bans apply both ways, and reporting a meetup files a normal report against the host in the admin Reports queue. Accepting someone opens a chat between host and guest.

Optional settings: `PHOTO_ALBUM_MAX` (12), `WINKS_PER_DAY` (5), `WINKS_PER_DAY_PREMIUM` (50), `REFERRAL_REWARD_SPARKS` (100), `REFERRAL_WELCOME_SPARKS` (50), `MEETUPS_ACTIVE_MAX` (3), `MEETUP_DAYS_AHEAD` (60).

API: `GET /api/profile-fields`, `PUT /api/me/profile-fields`, `GET/POST /api/admin/profile-fields`, `PUT /api/admin/profile-fields/:key`; `GET/POST /api/me/photos`, `DELETE /api/me/photos/:id`, `GET /api/users/:id/extras`; `GET /api/admin/photos?status=`, `POST /api/admin/photos/:id/decision`; `POST /api/users/:id/wink`, `GET /api/winks`, `GET /api/winks/unseen`; `GET /api/me/referral`, public `GET /api/public/referral/:code`; `GET/POST /api/meetups`, `GET /api/meetups/mine`, `GET/DELETE /api/meetups/:id`, `POST/DELETE /api/meetups/:id/join`, `POST /api/meetups/:id/requests/:requestId`, `POST /api/meetups/:id/report`. All of it is also under `/api/v1`. Code is in `server/extras.js` and `server/meetups.js`; tables `profile_field_defs`, `profile_field_values`, `profile_photos`, `winks`, `referral_codes`, `referrals`, `meetups`, `meetup_requests` are created at startup on SQLite and Postgres alike. The pages for these are in Qpids Place; the Cupid's Corner client does not show them yet.

## Compatibility questionnaire

About forty optional questions in nine topics on what new couples most often trip over: talking and arguing, money, family and children, pace, day-to-day habits, affection, values, plans and trust. For each one a member picks their own answer and says how much it matters that a partner is close to them (doesn't matter, a little, a lot, must match).

Two members' answers give a score once they share at least 8 questions. Closeness on each question is weighted by how much it matters to each person, and the pair's score is the geometric mean of the two sides, so it is only high when the fit works for both. The score moves people up or down in Discover (`WEIGHTS.quizFit` in `server/matching.js`) and is shown on a profile with a breakdown by topic, what the two line up on, and what is worth talking about early. A member's individual answers are never sent to anyone else. Admins get totals per answer, with no names.

API: `GET /api/quiz`, `PUT /api/quiz/answers`, `GET /api/users/:id/compatibility`, admin `GET /api/admin/quiz/insights`. Code and the question list are in `server/questionnaire.js`; table `quiz_answers`.

## DatingPro bridge

This brings members of a PG Dating Pro site (the `pg_*` tables, e.g. Cupid's Point) into cupidsCorner. They sign in with their **DatingPro email (or nickname) and their existing password**. Dating Pro stores bcrypt hashes, and the import copies them as they are.

```bash
# from a phpMyAdmin / mysqldump export
npm run import:datingpro -- --sql path/to/dump.sql --dry-run
npm run import:datingpro -- --sql path/to/dump.sql

# or straight from the live DatingPro database (npm install --workspace server mysql2 first)
DATINGPRO_DATABASE_URL=mysql://user:pass@host/dbname npm run import:datingpro
```

The import skips bots, unapproved members and anyone under 18. It is safe to re-run, because `datingpro_links` tracks who has already been imported. Photos are not copied yet.

## Brands (white-label sites)

One backend serves several branded sites. Members are one shared pool: a
brand sets the look and records where someone signed up, never who they can
see or match.

- A request is matched to a brand by the `X-Brand: <slug>` header (sent by a
  separate front end) or by the domain it arrives on; anything else is the
  default brand, `cupidscorner`. Existing members belong to it.
- `/api/v1/...` is the same API as `/api/...`; outside sites should call v1.
  Auth is the usual `Authorization: Bearer <token>` from signup/login.
- `GET /api/v1/public/brand` returns the matched brand's name, logo and colors.
- Admins manage brands with `GET/POST /api/v1/admin/brands` and
  `PUT /api/v1/admin/brands/:slug` (`slug`, `name`, `domain`, `logoUrl`,
  `primaryColor`, `accentColor`, `supportEmail`, `active`).
- A brand's domain (and `www.` of it) is allowed for CORS automatically.


## Buying sparks in the Android app

Inside the Qpids Place Android app, sparks are sold through Google Play Billing instead of Stripe. The app shows Google's purchase sheet and sends the resulting purchase token to `POST /api/billing/play/redeem`. The server asks Google whether the purchase is real and paid, adds the sparks once, and marks the purchase as used so the pack can be bought again. See `server/playBilling.js`.

- Set `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` (the service account key, raw or base64) and, if the app id differs, `GOOGLE_PLAY_PACKAGE_NAME`. Leave them unset and the app says buying isn't open yet.
- Create one one-time product per pack in Play Console with the IDs `sparks_small`, `sparks_medium`, `sparks_large`, priced to match the packs in `server/billing.js`.
- `npm --workspace server test` runs the checks against a stand-in for Google.

## Coach sessions (paid voice calls with Cupid)

Cupid also takes phone calls. A member pays sparks for one session, and only then sees the coach line and a six-digit one-time code. The voice agent asks the caller for the code and checks it with this API before it starts, so the number is no use to anyone who hasn't paid.

- The number is never in the code or the database. It is read from `COACH_PHONE_NUMBER` and returned only inside a paid session. Leave it unset and the feature is off.
- `COACH_SESSION_SPARKS` (default 1200, about $10 of sparks) is the price, `COACH_SESSION_MINUTES` (default 20) the length, and `COACH_CODE_HOURS` (default 48) how long a paid code can wait for the call.
- The clock starts the first time the agent accepts the code. Calling back with the same code during the session still works, so a dropped call doesn't cost a second session.
- Paying twice in a row doesn't charge twice: a member with a session waiting gets that same session back.

The voice agent sends `Authorization: Bearer <COACH_AGENT_SECRET>`:

```
POST /api/v1/coach/agent/verify   { "code": "123456" }
→ { "valid": true, "sessionId": 7, "resumed": false, "minutes": 20, "secondsLeft": 1200,
    "endsAt": "…", "member": { "firstName": "…", "age": 30, "gender": "…", "lookingFor": "…", "city": "…", "bio": "…" } }
→ { "valid": false }               wrong, used up or expired: ask again or end the call

POST /api/v1/coach/agent/end      { "code": "123456" }   optional, closes the session when the call ends
```

The agent that answers the line lives in [`voice-agent/`](voice-agent/README.md): a LiveKit agent that asks for the code, checks it with the calls above and runs the timed session.

Members use `GET /api/coach` (price, balance, and their session if they have paid) and `POST /api/coach/sessions` (pay). See `server/coach.js`.

## Database: SQLite or Postgres

The server runs on SQLite by default (`DB_PATH`). Set `DATABASE_URL` to a
Postgres connection string (a Supabase project works) and it runs on Postgres
instead, which is what several branded sites should share. The same queries
run on both; `server/db.js` translates them.

Switching a live site over, once:

1. Create the Postgres database (Supabase: New project, then Connect,
   then copy the "Session pooler" connection string).
2. In the Render shell: `cd server && DATABASE_URL='<that string>' npm run copy:sqlite-to-postgres`.
   It copies every member, chat, match and gift from the SQLite file into
   the empty Postgres database in one transaction. Photos stay on the disk.
3. Add `DATABASE_URL` in Render's Environment and redeploy.

To undo, remove `DATABASE_URL` and redeploy: the SQLite file is untouched.

## Stack

- **Backend** — Node + Express, SQLite via the built-in `node:sqlite` module (no native build step). Token sessions, bcrypt password hashing.
- **Frontend** — React + Vite + React Router, mobile-first UI.
- **Video** — [Stream Video](https://getstream.io/video/) (`@stream-io/node-sdk` server-side, `@stream-io/video-react-sdk` client-side). Every DM, group, and room gets a 🎥 button that opens a live, multi-participant WebRTC call.
- **Chat** — [Stream Chat](https://getstream.io/chat/) (`stream-chat`, isomorphic). DMs/groups/rooms are Stream channels (`conv-<id>`) when Stream is configured, with live typing indicators, read receipts, and emoji reactions. **When Stream isn't configured, the app automatically falls back to a local SQLite-backed polling chat** — typing/reactions/read-state still work there too, just polled instead of pushed. See `server/streamChat.js` and the `useStream` branch in `client/src/pages/Chat.jsx`. Cupid's thread always stays local.
- **Photos** — real photo uploads (`multer`, stored under `server/uploads/`, served statically). Falls back to the emoji avatar when a user hasn't uploaded one.
- **Social layer** — ratings (1–5★), fans (follow), block/report, "who liked you", and gifts (the "sparks" currency) live in SQLite; see `server/gifts.js` for the catalog and `server/premium.js` for the prompt bank and pricing constants.
- **Premium** — sparks-funded (200 ✨ / 7 days): unlocks the full "who liked you" list and boosts your profile to the top of others' Discover feed. Room hosts can similarly boost their room (100 ✨ / 3 hours) to sort first in the room directory.
- **Billing** — [Stripe Checkout](https://stripe.com) (`stripe`) lets people buy sparks with real money. Optional, same graceful-degradation pattern as Stream — the Buy Sparks screen just explains it isn't configured yet. See `server/billing.js`.
- **AI** — `server/cupid.js` ships a self-contained heuristic "brain" so it works with zero config. Point it at any OpenAI-compatible chat endpoint with env vars to use a real model:
  ```
  CUPID_LLM_URL=https://api.openai.com/v1/chat/completions
  CUPID_LLM_KEY=sk-...
  CUPID_LLM_MODEL=gpt-4o-mini
  ```

## Run it

```bash
npm install
npm run seed     # 10 demo users, 3 public rooms, sample matches/ratings/fans/gifts
npm run dev      # server on :8787, client on :5173
```

Open http://localhost:5173. Log in as `ava`, `leo`, `mira`, … (password `password123`), or sign up. Everyone gets 500 sparks and a free daily +50 spark bonus (once per ~20h) on login.

### Stream setup (optional but recommended)

1. Create a free account at [dashboard.getstream.io](https://dashboard.getstream.io) and make an app (Stream is free for hobby/small projects). One app covers both Chat and Video.
2. Copy `.env.example` to `.env` at the repo root and fill in the app's API key + secret:
   ```
   STREAM_API_KEY=...
   STREAM_API_SECRET=...
   ```
3. Restart `npm run dev`. Messaging switches from local polling to live Stream Chat automatically, and the 🎥 button starts real video rooms — no other changes needed.

### Stripe setup (optional)

1. Get API keys from the [Stripe dashboard](https://dashboard.stripe.com/apikeys) (test mode is fine for local dev).
2. Add to `.env`:
   ```
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   ```
3. Forward webhooks locally with the Stripe CLI: `stripe listen --forward-to localhost:8787/api/billing/webhook` (it prints the `whsec_...` to use above).

### Production-style build

```bash
npm run build    # builds client into client/dist
npm start        # Express serves the API + the built client on :8787
```

## Go live checklist

1. Deploy with the Render blueprint below. It uses the **starter** plan with a 1 GB persistent disk, so accounts and photos survive restarts (Render bills the instance and disk monthly).
2. Set `ADMIN_USERNAMES` to your own username, and `SUPPORT_EMAIL` to an inbox you read. The email shows in the Terms, Privacy Policy and Community Guidelines.
3. Sign up on the live site with that username. Your profile page then shows "Review pending verifications" and "Review reports".
4. Optional but recommended: Stream keys (chat and video), Stripe keys plus the webhook (sparks purchases), and a Cupid LLM key.
5. Don't run `npm run seed` in production: the demo members are fake people. The seed script refuses when `NODE_ENV=production`.
6. Have the Terms and Privacy Policy (`client/src/pages/Legal.jsx`) reviewed by a lawyer when you can; they are a starting point, not legal advice.

What protects users at launch: 18+ check and terms consent at sign-up, rate-limited login and sign-up, 8-character passwords, 30-day sessions, report and block on every profile, an admin reports queue that can suspend accounts, photo verification, and self-serve account deletion.

## Deploy to Render

The app is a single Express process (API + the built React client on one port), which maps directly onto a Render **Web Service**. A [render.yaml](render.yaml) blueprint is included.

### One-time setup

1. Push this repo to GitHub (see **Push to GitHub** below if it isn't there yet).
2. In the [Render dashboard](https://dashboard.render.com), **New → Blueprint**, pick the repo. Render reads `render.yaml` and creates the service — build command `npm install --include=dev && npm run build`, start command `npm start`, health check `/healthz`.
3. Set the secret env vars Render will prompt for (all optional — leave blank to skip that feature):
   - `STREAM_API_KEY`, `STREAM_API_SECRET` — video + chat
   - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` — buying sparks
   - `CUPID_LLM_URL`, `CUPID_LLM_KEY`, `CUPID_LLM_MODEL` — a real model for Cupid instead of the built-in heuristic
   - `COACH_PHONE_NUMBER`, `COACH_AGENT_SECRET` — paid voice sessions with Cupid (see **Coach sessions**)
4. Deploy. First boot creates an empty database automatically — run `npm run seed` locally against the same `DB_PATH` first, or just sign up fresh, once it's live.
5. If you enabled Stripe, add the webhook endpoint in the [Stripe dashboard](https://dashboard.stripe.com/webhooks): `https://<your-app>.onrender.com/api/billing/webhook`, listening for `checkout.session.completed`. Copy the signing secret it gives you into `STRIPE_WEBHOOK_SECRET`.

### Persistence — read before you rely on this

Render's **free** plan has no persistent disk: every deploy or restart wipes the SQLite database and any uploaded photos back to empty. That's fine for a demo/portfolio link, not for real users' data.

To make data durable:
`render.yaml` now ships with `plan: starter`, a persistent disk at `/var/data`, and `DB_PATH`, `UPLOADS_DIR` and `VERIFICATIONS_DIR` pointing at it. To run a throwaway demo on the free plan instead, set `plan: free` and remove the `disk:` block; every restart then wipes all data.

For a "real" production setup rather than a durable demo, the more common path is swapping SQLite for Render's managed Postgres — that's a genuine migration (different SQL dialect, a driver swap, rewriting every `db.prepare(...)` call in `server/index.js`/`db.js`/`seed.js`), not a config change, so it's not done here. Ask if you want that.

### Push to GitHub

```bash
git init
git add .
git commit -m "Cupid's Corner"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

## API sketch

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/auth/signup` `/api/auth/login` `/api/auth/logout` | auth |
| GET/PUT | `/api/me` | own profile (PUT also accepts `prompts: [{question, answer}]`) |
| POST/DELETE | `/api/me/photo` | upload/remove your profile photo (multipart) |
| POST | `/api/me/daily-bonus` | claim the daily sparks bonus if eligible |
| POST | `/api/me/premium` | activate/extend Premium (200 ✨ / 7 days) |
| GET | `/api/prompts/bank` | curated profile-prompt questions |
| GET | `/api/users/:id` `/api/users/:id/gifts` | public profile + rating/fan/gift stats |
| POST | `/api/users/:id/rating` | `{ stars }` (1–5) |
| POST/DELETE | `/api/users/:id/fan` | become/stop being a fan |
| POST/DELETE | `/api/users/:id/block` | block/unblock — hides them from Discover, DMs, and blocks gifts/ratings/fans both ways |
| POST | `/api/users/:id/report` | `{ reason }` |
| GET | `/api/likes` | who's liked you (locked behind Premium once there's a backlog) |
| GET | `/api/gifts/catalog` | gift catalog + your sparks balance |
| POST | `/api/gifts/send` | `{ recipientId, giftKey, conversationId? }` |
| GET | `/api/billing/packs` | sparks packs + whether Stripe is configured |
| POST | `/api/billing/checkout` | `{ packKey }` → Stripe Checkout URL |
| GET | `/api/discover` | `?minAge&maxAge&interest&sameCity` — profiles you haven't swiped |
| POST | `/api/swipe` | `{ targetId, direction }` → `{ matched, conversationId }` |
| GET | `/api/matches` | your matches + their DM ids |
| GET | `/api/rooms` | public room directory, boosted rooms sort first |
| POST | `/api/rooms` | `{ title, topic, emoji, color }` — open a room |
| POST | `/api/rooms/:id/join` | join a public room, no match required |
| POST | `/api/rooms/:id/boost` | host-only — 100 ✨ / 3 hours at the top of the directory |
| GET | `/api/conversations` `/api/conversations/:id` | your threads / one thread's metadata |
| POST | `/api/conversations/group` | `{ title, memberIds }` |
| POST | `/api/conversations/:id/members` | add someone to a group |
| POST | `/api/conversations/:id/leave` | leave a group or room |
| GET | `/api/conversations/:id/messages?after=<id>` | **fallback-mode only** — poll for messages, typing, and read state |
| POST | `/api/conversations/:id/messages` | **fallback-mode only** — send; Cupid auto-replies in `ai` threads |
| POST | `/api/conversations/:id/typing` | **fallback-mode only** — ping "I'm typing" |
| POST | `/api/conversations/:id/messages/:messageId/react` | **fallback-mode only** — toggle an emoji reaction |
| GET | `/api/coach` | coach session price, your balance, and your paid session (number + code) if you have one |
| POST | `/api/coach/sessions` | pay sparks for a coach session → number + one-time code |
| GET | `/api/stream/credentials` | Stream API key + video/chat tokens for the client SDKs |
| POST | `/api/conversations/:id/call` | get-or-create the Stream video room for a thread |

When Stream Chat is configured, the client talks to Stream directly for messages, typing, reactions, and read receipts instead of the fallback-mode endpoints above.

## Data model

`users` · `profiles` (`sparks`, `photo_url`, `prompts`, `premium_until`, `last_seen_at`, `last_bonus_at`) · `sessions` · `swipes` · `matches` · `conversations` (`dm` \| `group` \| `room` \| `ai`, rooms carry `is_public`/`boosted_until`) · `conversation_members` · `messages` (`text` \| `ai` \| `system` \| `gift`, fallback-mode only) · `ratings` · `fans` · `gifts_sent` · `blocks` · `reports` · `message_reactions` (fallback-mode) · `read_state` (fallback-mode)

## Not built (flagged, not implemented)

- **Identity/photo verification** — needs a third-party vendor (e.g. Stripe Identity, Persona); out of scope without new API keys.
- **Distance-based matching** — needs a geocoding/maps API; the "same city" filter is the lightweight stand-in.
- **Report review queue** — reports are captured (`reports` table) but there's no admin UI to triage them yet.
