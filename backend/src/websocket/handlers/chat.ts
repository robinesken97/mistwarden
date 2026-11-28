// ============================================
// Chat handler: chat.message
// ============================================

import { Server } from 'socket.io';
import type { MessageType } from '@prisma/client';
import { AuthenticatedSocket } from '../auth';
import logger from '../../utils/logger';
import { withinCeiling } from '../shared';
import { ackFrom, refuseRequest } from '../ack';
import { ChatMessageSchema, CHAT_CONTENT_REFUSAL } from '../../validators/chat';
import { sendChatMessage } from '../../services/chat';

/**
 * The `chat.message` the server sends each member who may read the message.
 * The frontend declares the same fields (keepInStep.test.ts).
 */
export interface ChatMessageBroadcast {
  id: string;
  userId: string;
  userName: string;
  content: string;
  type: MessageType;
  timestamp: string;
  /** On a whisper: the one member it is for, beside its sender, and their name. */
  recipientId?: string;
  recipientName?: string;
  /** On the sender's own copy only: the `clientId` it was sent with. */
  clientId?: string;
}

/** How long a resent `clientId` is recognised. */
const CLIENT_ID_MEMORY_MS = 10 * 60 * 1000;
/** The most `clientId`s remembered at once, across every user. */
const CLIENT_ID_MEMORY_SIZE = 10_000;

/**
 * Messages sent with a `clientId`, by user and `clientId`, as the stored
 * message's id once it is written. A client that never heard the answer to
 * a message sends it again with the same `clientId`; this answers it with the
 * first message's id, so it is stored and sent once. The promise is kept
 * while the first is being written, so a resend arriving meanwhile waits for
 * it.
 */
const sentByClientId = new Map<string, { id: Promise<string>; at: number }>();

function forgetOldClientIds(now: number): void {
  for (const [key, entry] of sentByClientId) {
    if (now - entry.at < CLIENT_ID_MEMORY_MS && sentByClientId.size < CLIENT_ID_MEMORY_SIZE) break;
    sentByClientId.delete(key);
  }
}

export function registerChatHandlers(io: Server, socket: AuthenticatedSocket): void {
  /**
   * CHAT.MESSAGE - User sends chat message.
   * Validates content, saves to database, and sends it to each member who
   * may read it. The message type comes from the sender's role, never from
   * the payload. Always under the per-user flood ceiling; the campaign's chat
   * cooldown, when the GM turns it on, is the stricter rule on top.
   * With a `recipientId` it is a WHISPER to that member (whisperRecipient in
   * services/permissions.ts), sent to the sender's and the recipient's
   * sockets in this campaign and to no one else, the GM included.
   * Answered through the acknowledgement when one is passed (see ../ack.ts).
   * SECURITY: Uses server-authenticated socket.campaignId and socket.role only.
   */
  socket.on('chat.message', async (data: unknown, ackArg?: unknown) => {
    const ack = ackFrom(ackArg);
    const refuse = (message: string) => refuseRequest(socket, ack, message);
    let rememberedKey: string | null = null;
    try {
      if (!socket.campaignId) {
        refuse('Not authenticated to a campaign');
        return;
      }
      const campaignId = socket.campaignId;

      if (!withinCeiling(socket, 'chat.message', ack)) return;

      // The content arrives trimmed, its length counted before (validators/chat.ts).
      const parsed = ChatMessageSchema.safeParse(data);
      if (!parsed.success) {
        refuse(parsed.error.issues[0]?.message ?? CHAT_CONTENT_REFUSAL);
        return;
      }
      const { content, type: askedType, clientId, recipientId } = parsed.data;

      // A message already sent under this clientId is answered, not sent again.
      if (clientId !== undefined) {
        const key = `${socket.userId}:${clientId}`;
        const earlier = sentByClientId.get(key);
        if (earlier && Date.now() - earlier.at < CLIENT_ID_MEMORY_MS) {
          const id = await earlier.id.catch(() => null);
          if (id) {
            ack?.({ ok: true, id });
            return;
          }
        }
        rememberedKey = key;
      }

      // The whisper's recipient is asked after the clientId memory, so a
      // resend of one that reached its recipient before they left is
      // answered with the first id (services/chat.ts).
      let remembered = false;
      const outcome = await sendChatMessage(
        io,
        { campaignId, userId: socket.userId!, role: socket.role },
        { content, type: askedType, recipientId },
        {
          clientId,
          onWrite: rememberedKey === null ? undefined : (id) => {
            const now = Date.now();
            forgetOldClientIds(now);
            sentByClientId.set(rememberedKey!, { id, at: now });
            remembered = true;
          },
        },
      );
      if (!outcome.ok) {
        if (remembered) sentByClientId.delete(rememberedKey!);
        refuse(outcome.error);
        return;
      }
      const type = outcome.message.type;
      ack?.({ ok: true, id: outcome.message.id });

      logger.debug('chat.message', { type, userId: socket.userId, campaignId });
    } catch (error) {
      if (rememberedKey) sentByClientId.delete(rememberedKey);
      logger.error('chat.message failed', { err: error });
      refuse('Failed to send chat message');
    }
  });
}
