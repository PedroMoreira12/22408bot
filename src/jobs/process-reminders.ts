import type { VkClient } from '../clients/vk.js';
import { log } from '../lib/logger.js';
import { Reminder } from '../models/reminder.js';
import { errorMessage, nextRetryDate } from './process-commands.js';

const MAX_ATTEMPTS = 10;
const LEASE_MILLISECONDS = 60_000;
const SENT_RETENTION_MILLISECONDS = 30 * 86_400_000;

export async function processDueReminders(
  vk: VkClient,
  deadline: number,
  limit = 25,
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;

  for (let index = 0; index < limit && Date.now() < deadline; index += 1) {
    const now = new Date();
    const reminder = await Reminder.findOneAndUpdate(
      {
        remindAt: { $lte: now },
        $and: [
          {
            $or: [
              { status: 'pending' },
              { status: { $exists: false } },
              { status: 'processing', leaseUntil: { $lte: now } },
              { status: 'processing', leaseUntil: { $exists: false } },
            ],
          },
          { $or: [{ nextAttemptAt: { $lte: now } }, { nextAttemptAt: { $exists: false } }] },
        ],
      },
      {
        $set: { status: 'processing', leaseUntil: new Date(now.getTime() + LEASE_MILLISECONDS) },
        $inc: { attempts: 1 },
      },
      { new: true, sort: { remindAt: 1 } },
    );
    if (!reminder) break;

    try {
      const username = await vk.getUserFirstName(Number(reminder.userId));
      await vk.createComment(
        Number(reminder.topicId),
        Number(reminder.messageId),
        `[post${reminder.messageId}|${username}], Lembrando, conforme você pediu ✈️`,
        `reminder:${reminder.topicId}:${reminder.messageId}`,
      );
      const sentAt = new Date();
      await Reminder.updateOne(
        { _id: reminder._id, status: 'processing' },
        {
          $set: {
            status: 'sent',
            sentAt,
            expiresAt: new Date(sentAt.getTime() + SENT_RETENTION_MILLISECONDS),
          },
          $unset: { leaseUntil: 1, lastError: 1 },
        },
      );
      sent += 1;
    } catch (error) {
      const attempts = reminder.attempts ?? 1;
      await Reminder.updateOne(
        { _id: reminder._id },
        {
          $set: {
            status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
            nextAttemptAt: nextRetryDate(attempts),
            lastError: errorMessage(error),
          },
          $unset: { leaseUntil: 1 },
        },
      );
      log('error', 'reminder.failed', {
        topicId: reminder.topicId,
        commentId: reminder.messageId,
        attempt: attempts,
        error,
      });
      failed += 1;
    }
  }

  return { sent, failed };
}
