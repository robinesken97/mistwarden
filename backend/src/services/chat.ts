/**
 * A chat message sent: checked, stored and sent to each member who may read
 * it, for the socket's chat.message and REST alike.
 *
 * The type comes from the sender's role, never from the request. With a
 * `recipientId` it is a WHISPER to that member (whisperRecipient in
 * services/permissions.ts), sent to the sender's and the recipient's sockets
 * in this campaign and to no one else, the GM included. The campaign's chat
 * cooldown, when the GM turns it on, holds for every sender, the GM too, and
 * the socket and REST share it.
 */

import type { Server } from 'socket.io';
import { prisma } from '../config/database';
import { foreignKeyConstraint } from '../utils/errors';
import { chatMessageLimiter } from '../websocket/shared';
import { campaignSockets } from '../websocket/utils';
import type { AuthenticatedSocket } from '../websocket/auth';
import type { ChatMessageBroadcast } from '../websocket/handlers/chat';
import { WHISPER_RECIPIENT_REFUSAL, WHISPER_SELF_REFUSAL } from '../validators/chat';
import { whisperRecipient } from './permissions';

export interface ChatSender {
  campaignId: string;
  userId: string;
  role: string | undefined;
}

export interface ChatInput {
  /** Trimmed and bounded already (validators/chat.ts). */
  content: string;
  /** What a GM asked to speak as; ignored for anyone else. */
  type?: 'PLAYER' | 'GM';
  recipientId?: string;
}

export interface ChatOptions {
  /** Sent back on the sender's own copies only, to match the one they show. */
  clientId?: string;
  /** Called as the write starts, with the stored message's id to come. */
  onWrite?: (id: Promise<string>) => void;
}

export type ChatOutcome =
  | { ok: true; message: ChatMessageBroadcast }
  | { ok: false; status: 400 | 404 | 429; error: string };

/** The sender's account was deleted between authenticating and sending. */
class UserGoneError extends Error {}

export async function sendChatMessage(io: Server, sender: ChatSender, input: ChatInput, opts: ChatOptions = {}): Promise<ChatOutcome> {
  const { campaignId, userId } = sender;

  // Who a whisper is for, asked before the cooldown, so a refused whisper
  // does not use it up.
  let whisperTo: { id: string; displayName: string } | null = null;
  if (input.recipientId !== undefined) {
    if (input.recipientId === userId) return { ok: false, status: 400, error: WHISPER_SELF_REFUSAL };
    whisperTo = await whisperRecipient(campaignId, userId, input.recipientId);
    if (!whisperTo) return { ok: false, status: 400, error: WHISPER_RECIPIENT_REFUSAL };
  }

  // The type is decided by the sender's role, not by the request: a
  // player's message is always PLAYER. The GM's is GM unless they ask to
  // speak as a player (out of character). A whisper is a WHISPER whoever
  // sends it.
  const type: 'PLAYER' | 'GM' | 'WHISPER' = whisperTo ? 'WHISPER' : sender.role === 'GM' ? (input.type ?? 'GM') : 'PLAYER';

  const campaignSettings = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { chatCooldownEnabled: true, chatCooldownSeconds: true },
  });
  if (campaignSettings?.chatCooldownEnabled) {
    const windowMs = (campaignSettings.chatCooldownSeconds ?? 5) * 1000;
    if (!chatMessageLimiter.check(`${userId}:${campaignId}`, 1, windowMs)) {
      return { ok: false, status: 429, error: `Rate limit: wait ${campaignSettings.chatCooldownSeconds}s between messages.` };
    }
  }

  const write = (async () => {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true },
    });
    if (!user) throw new UserGoneError();
    const message = await prisma.message.create({
      data: { campaignId, userId, type, content: input.content, recipientId: whisperTo?.id ?? null },
    });
    return { user, message };
  })();
  opts.onWrite?.(write.then(({ message }) => message.id));

  let written: Awaited<typeof write>;
  try {
    written = await write;
  } catch (error) {
    if (error instanceof UserGoneError) return { ok: false, status: 404, error: 'User not found' };
    // The recipient's account was deleted after they were looked up. Any
    // other missing row, such as the campaign deleted meanwhile, is a
    // failure to send.
    if (whisperTo && foreignKeyConstraint(error) === 'Message_recipientId_fkey') {
      return { ok: false, status: 400, error: WHISPER_RECIPIENT_REFUSAL };
    }
    throw error;
  }
  const { user, message } = written;

  const payload: ChatMessageBroadcast = {
    id: message.id,
    userId,
    userName: user.displayName,
    content: message.content,
    type,
    timestamp: message.createdAt.toISOString(),
    ...(whisperTo ? { recipientId: whisperTo.id, recipientName: whisperTo.displayName } : {}),
  };

  // Who may read a message is decided for each member here, as it is for
  // a secret roll: every member a message to everyone, and only the
  // sender's and the recipient's sockets in this campaign a whisper.
  // Never the user's own room, which spans every campaign they have open.
  // Nothing is awaited between fetching the sockets and the emits.
  const { clientId } = opts;
  for (const s of await campaignSockets(io, campaignId)) {
    const reader = s as unknown as AuthenticatedSocket;
    if (whisperTo && reader.userId !== userId && reader.userId !== whisperTo.id) continue;
    s.emit('chat.message', reader.userId === userId && clientId !== undefined ? { ...payload, clientId } : payload);
  }
  return { ok: true, message: payload };
}
