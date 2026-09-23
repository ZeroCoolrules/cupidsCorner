// Stream Video integration — powers the "room" webcams (watch several
// people's cameras at once, like a Cyber Friends–style chatroom) and 1:1
// video calls between matches.
//
// Get free API keys at https://dashboard.getstream.io (Stream is free for
// small/hobby projects) and set them as env vars, e.g. in a .env file at
// the repo root:
//
//   STREAM_API_KEY=xxxxxxxx
//   STREAM_API_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
//
// The app runs fine without these — video features just report as
// "not configured" instead of crashing.

import { StreamClient } from "@stream-io/node-sdk";
import { createChatToken } from "./streamChat.js";

let client = null;
let warned = false;

export function isStreamConfigured() {
  return Boolean(process.env.STREAM_API_KEY && process.env.STREAM_API_SECRET);
}

function getClient() {
  if (!isStreamConfigured()) return null;
  if (!client) {
    client = new StreamClient(
      process.env.STREAM_API_KEY,
      process.env.STREAM_API_SECRET
    );
  }
  return client;
}

function warnOnce() {
  if (!warned) {
    warned = true;
    console.warn(
      "[stream] STREAM_API_KEY / STREAM_API_SECRET not set — video calling is disabled. " +
        "Get free keys at https://dashboard.getstream.io and add them to a .env file."
    );
  }
}

// Upserts the user in Stream and returns { apiKey, token, userId } for the
// client SDK, or null if Stream isn't configured.
export async function streamCredentialsFor(profile) {
  const c = getClient();
  if (!c) {
    warnOnce();
    return null;
  }
  const userId = String(profile.id);
  await c.upsertUsers([
    {
      id: userId,
      name: profile.displayName,
      role: "user",
      custom: { emoji: profile.avatarEmoji, color: profile.avatarColor },
    },
  ]);
  const token = c.generateUserToken({ user_id: userId });
  const chatToken = createChatToken(userId);
  return { apiKey: process.env.STREAM_API_KEY, token, chatToken, userId };
}

// Who's live in each room right now, for the Rooms list:
// { [conversationId]: { count, users: [{ id, name, emoji, color }] } }.
// Rooms with no ongoing call are left out. Cached briefly because every
// open Rooms page polls this.
const LIVE_CACHE_MS = 10_000;
let liveCache = { key: "", at: 0, value: {} };

export async function liveRoomStatus(conversationIds) {
  const c = getClient();
  if (!c || !conversationIds.length) return {};
  const key = conversationIds.join(",");
  if (liveCache.key === key && Date.now() - liveCache.at < LIVE_CACHE_MS) return liveCache.value;

  const out = {};
  // $in lists are capped, so query in chunks of 25.
  for (let i = 0; i < conversationIds.length; i += 25) {
    const ids = conversationIds.slice(i, i + 25).map((id) => `conv-${id}`);
    const res = await c.video.queryCalls({
      filter_conditions: { type: "default", id: { $in: ids }, ongoing: true },
      limit: 25,
    });
    for (const { call } of res.calls) {
      // One person can have several sessions (two tabs) — count people.
      const users = new Map();
      for (const p of call.session?.participants || []) {
        users.set(p.user.id, {
          id: Number(p.user.id),
          name: p.user.name,
          emoji: p.user.custom?.emoji,
          color: p.user.custom?.color,
        });
      }
      if (users.size) {
        out[call.id.replace(/^conv-/, "")] = { count: users.size, users: [...users.values()] };
      }
    }
  }
  liveCache = { key, at: Date.now(), value: out };
  return out;
}

// Room host actions against a participant in the room's call.
// `sessionId` is only needed for spotlight/unspotlight (pins are per session).
export async function moderateRoomCall(conversationId, action, { targetId, sessionId, hostId }) {
  const c = getClient();
  if (!c) return;
  const call = c.video.call("default", `conv-${conversationId}`);
  const user_id = String(targetId);
  const by = String(hostId);
  switch (action) {
    case "mute":
      return call.muteUsers({ user_ids: [user_id], audio: true, muted_by_id: by });
    case "camOff":
      return call.muteUsers({ user_ids: [user_id], video: true, muted_by_id: by });
    case "spotlight":
      return call.videoPin({ user_id, session_id: sessionId });
    case "unspotlight":
      return call.videoUnpin({ user_id, session_id: sessionId });
    case "remove":
    case "ban":
      return ejectFromCall(call, user_id, by, action === "ban");
    default:
      throw new Error(`unknown action ${action}`);
  }
}

// Stream's kick and block endpoints reject one-character user ids ("1"–"9",
// i.e. the earliest accounts). For those, fall back to a custom call event
// that CallRoom.jsx obeys by leaving, and for bans also revoke publishing so
// they can't broadcast even if they force their way back in.
const EJECT_EVENT = "cupid.eject"; // keep in sync with CallRoom.jsx

async function ejectFromCall(call, user_id, by, ban) {
  if (user_id.length > 1) {
    // block: true means they can't rejoin this call even with a valid token.
    return call.kickUser({ user_id, block: ban, kicked_by_id: by });
  }
  if (ban) {
    await call.updateUserPermissions({
      user_id,
      revoke_permissions: ["send-audio", "send-video", "screenshare"],
    });
  }
  await call.sendCallEvent({ user_id: by, custom: { type: EJECT_EVENT, target: user_id } });
}

// Gets or creates a "default" (grid, many-webcam) call tied to a
// conversation, with every conversation member allowed to publish + watch.
// `members` is the full profile rows (id, display_name, avatar_emoji,
// avatar_color) — passed so everyone gets upserted into Stream, not just
// whoever happens to click the video button first.
export async function getOrCreateRoomCall(conversationId, members, createdById) {
  const c = getClient();
  if (!c) {
    warnOnce();
    return null;
  }
  await c.upsertUsers(
    members.map((m) => ({
      id: String(m.user_id),
      name: m.display_name,
      role: "user",
      custom: { emoji: m.avatar_emoji, color: m.avatar_color },
    }))
  );
  const callId = `conv-${conversationId}`;
  const call = c.video.call("default", callId);
  const callMembers = members.map((m) => ({ user_id: String(m.user_id) }));
  const res = await call.getOrCreate({
    data: { created_by_id: String(createdById), members: callMembers },
  });
  // getOrCreate ignores `data` when the call already exists, so anyone who
  // joined the conversation after the call was first created has to be
  // added explicitly. update_members is an upsert, so resending is harmless.
  if (!res.created) {
    await call.updateCallMembers({ update_members: callMembers });
  }
  return { callType: "default", callId };
}
