// Stream Chat integration — backs the DM/group/room message threads.
// Uses the same STREAM_API_KEY / STREAM_API_SECRET as server/stream.js
// (Chat and Video are products on the same Stream app). When those aren't
// set, callers should fall back to the local `messages` table — see the
// `isStreamConfigured` check exported from stream.js and used throughout
// server/index.js.

import { StreamChat } from "stream-chat";
import { isStreamConfigured } from "./stream.js";

const SYSTEM_USER_ID = "cupids-corner-system";
let client = null;
let systemUserReady = false;

function getClient() {
  if (!isStreamConfigured()) return null;
  if (!client) {
    client = StreamChat.getInstance(
      process.env.STREAM_API_KEY,
      process.env.STREAM_API_SECRET
    );
  }
  return client;
}

export function createChatToken(userId) {
  const c = getClient();
  return c ? c.createToken(String(userId)) : null;
}

async function ensureSystemUser(c) {
  if (systemUserReady) return;
  await c.upsertUsers([
    { id: SYSTEM_USER_ID, name: "Cupid's Corner", role: "admin" },
  ]);
  systemUserReady = true;
}

function channelIdFor(conversationId) {
  return `conv-${conversationId}`;
}

// Creates/updates the Stream channel for a conversation and makes sure
// every current member is upserted + added. Best-effort: throws are caught
// by callers so a Stream hiccup never breaks the core matching/chat flow.
export async function syncChannel({ conversationId, type, title, members, createdById }) {
  const c = getClient();
  if (!c) return;
  await c.upsertUsers(
    members.map((m) => ({
      id: String(m.user_id),
      name: m.display_name,
      role: "user",
      custom: { emoji: m.avatar_emoji, color: m.avatar_color },
    }))
  );
  const channel = c.channel("messaging", channelIdFor(conversationId), {
    created_by_id: String(createdById ?? members[0]?.user_id),
    members: members.map((m) => String(m.user_id)),
    name: title || undefined,
    conversation_type: type,
  });
  await channel.create();
  // create() leaves an existing channel's members untouched (e.g. one made
  // empty by an earlier server-side message), so add them explicitly.
  // addMembers is a no-op for people who are already in.
  await channel.addMembers(members.map((m) => String(m.user_id)));
}

export async function addChannelMember(conversationId, member) {
  const c = getClient();
  if (!c) return;
  await c.upsertUsers([
    {
      id: String(member.user_id),
      name: member.display_name,
      role: "user",
      custom: { emoji: member.avatar_emoji, color: member.avatar_color },
    },
  ]);
  const channel = c.channel("messaging", channelIdFor(conversationId));
  await channel.addMembers([String(member.user_id)]);
}

export async function removeChannelMember(conversationId, userId) {
  const c = getClient();
  if (!c) return;
  const channel = c.channel("messaging", channelIdFor(conversationId));
  await channel.removeMembers([String(userId)]);
}

// Frozen channels reject new messages and reactions from everyone — used to
// shut a DM when either person blocks the other.
export async function setChannelFrozen(conversationId, frozen) {
  const c = getClient();
  if (!c) return;
  const channel = c.channel("messaging", channelIdFor(conversationId));
  await channel.updatePartial({ set: { frozen } });
}

export async function sendSystemMessage(conversationId, text) {
  const c = getClient();
  if (!c) return;
  await ensureSystemUser(c);
  const channel = c.channel("messaging", channelIdFor(conversationId));
  await channel.sendMessage({
    text,
    user_id: SYSTEM_USER_ID,
    messageKind: "system",
  });
}

export async function sendGiftMessage(conversationId, senderId, gift) {
  const c = getClient();
  if (!c) return;
  const channel = c.channel("messaging", channelIdFor(conversationId));
  await channel.sendMessage({
    text: `sent ${gift.emoji} ${gift.name}`,
    user_id: String(senderId),
    messageKind: "gift",
    gift,
  });
}
