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
  await call.getOrCreate({
    data: {
      created_by_id: String(createdById),
      members: members.map((m) => ({ user_id: String(m.user_id) })),
    },
  });
  return { callType: "default", callId };
}
