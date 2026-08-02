import type { VkClient } from '../clients/vk.js';
import { executeCommand } from '../commands/execute.js';
import { parseCommand } from '../commands/parser.js';
import { log } from '../lib/logger.js';
import { CommandJob } from '../models/command-job.js';

const MAX_ATTEMPTS = 10;
const LEASE_MILLISECONDS = 60_000;

export async function processPendingCommands(
  vk: VkClient,
  deadline: number,
  limit = 25,
): Promise<{ completed: number; failed: number }> {
  let completed = 0;
  let failed = 0;

  for (let index = 0; index < limit && Date.now() < deadline; index += 1) {
    const now = new Date();
    const job = await CommandJob.findOneAndUpdate(
      {
        $and: [
          {
            $or: [
              { status: 'pending' },
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
      { new: true, sort: { nextAttemptAt: 1, createdAt: 1 } },
    );
    if (!job) break;

    try {
      const command = parseCommand(job.text);
      if (command) {
        await executeCommand(
          command,
          {
            topicId: Number(job.topicId),
            commentId: Number(job.commentId),
            userId: Number(job.userId),
            topicTitle: job.topicTitle,
            ...(job.authorName ? { authorName: job.authorName } : {}),
          },
          { vk },
        );
      }
      await CommandJob.updateOne(
        { _id: job._id, status: 'processing' },
        {
          $set: { status: 'completed', completedAt: new Date() },
          $unset: { leaseUntil: 1, lastError: 1 },
        },
      );
      completed += 1;
    } catch (error) {
      await recordFailure(job._id, job.attempts, error);
      log('error', 'command.failed', {
        topicId: job.topicId,
        commentId: job.commentId,
        attempt: job.attempts,
        error,
      });
      failed += 1;
    }
  }

  return { completed, failed };
}

async function recordFailure(id: unknown, attempts: number, error: unknown): Promise<void> {
  const terminal = attempts >= MAX_ATTEMPTS;
  await CommandJob.updateOne(
    { _id: id },
    {
      $set: {
        status: terminal ? 'failed' : 'pending',
        nextAttemptAt: nextRetryDate(attempts),
        lastError: errorMessage(error),
      },
      $unset: { leaseUntil: 1 },
    },
  );
}

export function nextRetryDate(attempts: number, now = new Date()): Date {
  const delayMinutes = Math.min(60, 2 ** Math.max(0, attempts - 1));
  return new Date(now.getTime() + delayMinutes * 60_000);
}

export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 500);
}
