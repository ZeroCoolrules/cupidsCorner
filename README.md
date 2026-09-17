# Cupid's Corner 💘

A full-stack app that blends five things into one:

| From a dating app | From a webcam social site | From a messaging app | Social layer | From an AI companion |
| --- | --- | --- | --- | --- |
| Profiles, swipe discovery, filters, like/pass, mutual **matches**, "who liked you" | **Public rooms** — browse and join live, multi-person webcam rooms, no match needed (à la Cyber Friends) | Real-time DMs and group chats, backed by **Stream Chat** — typing, presence, read receipts, reactions | **Ratings**, **fans**, **gifts**, **Premium**, and real photos on every profile | **Cupid**, a built-in AI matchmaker you can chat with for advice |

A logged-out visitor lands on a real homepage (hero, live member/room/gift stats, feature grid) rather than a bare login form — that's the "presence" layer.

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

## Deploy to Render

The app is a single Express process (API + the built React client on one port), which maps directly onto a Render **Web Service**. A [render.yaml](render.yaml) blueprint is included.

### One-time setup

1. Push this repo to GitHub (see **Push to GitHub** below if it isn't there yet).
2. In the [Render dashboard](https://dashboard.render.com), **New → Blueprint**, pick the repo. Render reads `render.yaml` and creates the service — build command `npm install && npm run build`, start command `npm start`, health check `/healthz`.
3. Set the secret env vars Render will prompt for (all optional — leave blank to skip that feature):
   - `STREAM_API_KEY`, `STREAM_API_SECRET` — video + chat
   - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` — buying sparks
   - `CUPID_LLM_URL`, `CUPID_LLM_KEY`, `CUPID_LLM_MODEL` — a real model for Cupid instead of the built-in heuristic
4. Deploy. First boot creates an empty database automatically — run `npm run seed` locally against the same `DB_PATH` first, or just sign up fresh, once it's live.
5. If you enabled Stripe, add the webhook endpoint in the [Stripe dashboard](https://dashboard.stripe.com/webhooks): `https://<your-app>.onrender.com/api/billing/webhook`, listening for `checkout.session.completed`. Copy the signing secret it gives you into `STRIPE_WEBHOOK_SECRET`.

### Persistence — read before you rely on this

Render's **free** plan has no persistent disk: every deploy or restart wipes the SQLite database and any uploaded photos back to empty. That's fine for a demo/portfolio link, not for real users' data.

To make data durable:
1. In `render.yaml`, bump `plan: free` to `plan: starter` (or higher — persistent disks need a paid instance) and uncomment the `disk:` block plus its `DB_PATH` / `UPLOADS_DIR` env vars.
2. Redeploy. `server/db.js` and `server/index.js` already read `DB_PATH` and `UPLOADS_DIR` from the environment, so no code changes are needed — just those two env vars pointing at the mounted disk.

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
| GET | `/api/stream/credentials` | Stream API key + video/chat tokens for the client SDKs |
| POST | `/api/conversations/:id/call` | get-or-create the Stream video room for a thread |

When Stream Chat is configured, the client talks to Stream directly for messages, typing, reactions, and read receipts instead of the fallback-mode endpoints above.

## Data model

`users` · `profiles` (`sparks`, `photo_url`, `prompts`, `premium_until`, `last_seen_at`, `last_bonus_at`) · `sessions` · `swipes` · `matches` · `conversations` (`dm` \| `group` \| `room` \| `ai`, rooms carry `is_public`/`boosted_until`) · `conversation_members` · `messages` (`text` \| `ai` \| `system` \| `gift`, fallback-mode only) · `ratings` · `fans` · `gifts_sent` · `blocks` · `reports` · `message_reactions` (fallback-mode) · `read_state` (fallback-mode)

## Not built (flagged, not implemented)

- **Identity/photo verification** — needs a third-party vendor (e.g. Stripe Identity, Persona); out of scope without new API keys.
- **Distance-based matching** — needs a geocoding/maps API; the "same city" filter is the lightweight stand-in.
- **Report review queue** — reports are captured (`reports` table) but there's no admin UI to triage them yet.
