import type { VkClient } from '../clients/vk.js';
import { commandCooldown, type CommandCooldown } from '../commands/cooldown.js';
import { executeCommand } from '../commands/execute.js';
import { parseCommand } from '../commands/parser.js';
import { log } from '../lib/logger.js';
import { CommandJob, type CommandJobRecord } from '../models/command-job.js';

const MAX_ATTEMPTS = 10;
const LEASE_MILLISECONDS = 60_000;

export async function processPendingCommands(
  vk: VkClient,
  deadline: number,
  limit = 25,
): Promise<{ completed: number; skipped: number; failed: number }> {
  let completed = 0;
  let skipped = 0;
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
      { returnDocument: 'after', sort: { nextAttemptAt: 1, createdAt: 1 } },
    );
    if (!job) break;

    try {
      const command = parseCommand(job.text);
      const cooldown = command ? commandCooldown(command) : null;
      if (cooldown && (await isCoolingDown(job, cooldown, now))) {
        await markCompleted(job._id, { commandKey: cooldown.key, skippedReason: 'cooldown' });
        skipped += 1;
        continue;
      }
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
      await markCompleted(job._id, cooldown ? { commandKey: cooldown.key } : {});
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

  return { completed, skipped, failed };
}

/** Verifica se o autor já recebeu a mesma consulta dentro do intervalo de cooldown. */
async function isCoolingDown(
  job: Pick<CommandJobRecord, 'userId'> & { _id: unknown },
  cooldown: CommandCooldown,
  now: Date,
): Promise<boolean> {
  const recent = await CommandJob.exists({
    _id: { $ne: job._id },
    userId: job.userId,
    commandKey: cooldown.key,
    status: 'completed',
    skippedReason: { $exists: false },
    completedAt: { $gte: new Date(now.getTime() - cooldown.milliseconds) },
  });
  return recent !== null;
}

async function markCompleted(
  id: unknown,
  fields: { commandKey?: string; skippedReason?: string },
): Promise<void> {
  await CommandJob.updateOne(
    { _id: id, status: 'processing' },
    {
      $set: { status: 'completed', completedAt: new Date(), ...fields },
      $unset: { leaseUntil: 1, lastError: 1 },
    },
  );
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
        ...(terminal ? { failedAt: new Date() } : {}),
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
